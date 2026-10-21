import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { Award, Ban, BadgeCheck, FileClock, FileText, RefreshCw, ScrollText, ShieldCheck } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { AvatarCell, Button, PageHeader, Pagination, Select, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { ago, date, dateTime, num } from "@/shared/utils/format"
import { API, CAN, DOC_STATUSES, NoAccess, STU, TRANSCRIPT_TYPES, VERIFY_DOCTYPES, VERIFY_RESULTS, DocStatus, VerifyResult, compact, isPermissionError, useLookups, useUrlFilters } from "../lib"
import GenerateTranscript from "../components/GenerateTranscript"
import RequestQueue from "../components/RequestQueue"
import { IssueTranscriptDialog, RevokeDialog } from "../components/Dialogs"

const PAGE = 20
const LOG_PAGE = 50

/** Row buttons sit inside DataTable's row link; keep their clicks from navigating. */
const stop = (fn) => (e) => {
	e.preventDefault()
	e.stopPropagation()
	fn()
}

/** /admin/credentials?tab=transcripts|certificates|verifications */
export default function CredentialsHome() {
	const { hasRole } = useSession()
	const allowed = hasRole(...CAN.read)
	const canWrite = hasRole(...CAN.write)
	const canRequests = hasRole(...CAN.requests)
	const [get, set] = useUrlFilters()
	const tab = get("tab") || "transcripts"
	const invalidate = useInvalidate()
	const [genOpen, setGenOpen] = useState(false)

	const drafts = useApi(`${API}list_transcripts`, { status: "Draft", page_length: 1 }, { enabled: allowed })
	const issuedT = useApi(`${API}list_transcripts`, { status: "Issued", page_length: 1 }, { enabled: allowed })
	const issuedC = useApi(`${API}list_certificates`, { status: "Issued", page_length: 1 }, { enabled: allowed })
	const logs = useApi(`${API}verification_logs`, { page_length: 1 }, { enabled: allowed })
	const reqs = useApi(`${STU}list_requests`, { request_type: "Transcript Request", status: ["Pending", "Under Review"], page_length: 1 }, { enabled: allowed && canRequests })
	const revokedT = useApi(`${API}list_transcripts`, { status: "Revoked", page_length: 1 }, { enabled: allowed && !canRequests })
	const revokedC = useApi(`${API}list_certificates`, { status: "Revoked", page_length: 1 }, { enabled: allowed && !canRequests })

	if (!allowed || isPermissionError(drafts.error)) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Transcripts & certificates" />
				<NoAccess message="Transcripts and certificates are managed by the registrar; the academic dean and auditors can view them." />
			</>
		)
	}

	const refresh = () => {
		invalidate(API)
		invalidate(`${STU}list_requests`)
	}
	const lastLog = logs.data?.data?.[0]

	return (
		<>
			<PageHeader
				eyebrow="Credentials"
				title="Transcripts & certificates"
				subtitle="Generate, issue and revoke academic documents, and see who has verified them."
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={refresh}>
							Refresh
						</Button>
						{canWrite ? (
							<>
								<Button variant="secondary" size="sm" icon={FileText} onClick={() => setGenOpen(true)}>
									Generate transcript
								</Button>
								<Link to="/admin/credentials/issue" className="btn btn-primary btn-sm">
									<Award size={14} /> Issue certificates
								</Link>
							</>
						) : null}
					</>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				{canRequests ? (
					<StatCard label="Open requests" value={num(reqs.data?.total || 0)} loading={reqs.isLoading} icon={FileClock} tone="orange" hint="To approve or reject" />
				) : (
					<StatCard
						label="Revoked"
						value={num((revokedT.data?.total || 0) + (revokedC.data?.total || 0))}
						loading={revokedT.isLoading || revokedC.isLoading}
						icon={Ban}
						tone="red"
						hint={`incl. ${num(revokedC.data?.total || 0)} certificate${revokedC.data?.total === 1 ? "" : "s"}`}
					/>
				)}
				<StatCard label="Draft transcripts" value={num(drafts.data?.total || 0)} loading={drafts.isLoading} icon={ScrollText} tone="gold" hint="Waiting to be issued" />
				<StatCard
					label="Issued"
					value={num((issuedT.data?.total || 0) + (issuedC.data?.total || 0))}
					loading={issuedT.isLoading || issuedC.isLoading}
					icon={BadgeCheck}
					tone="green"
					hint={`incl. ${num(issuedC.data?.total || 0)} certificate${issuedC.data?.total === 1 ? "" : "s"}`}
				/>
				<StatCard label="Verifications" value={num(logs.data?.total || 0)} loading={logs.isLoading} icon={ShieldCheck} tone="blue" hint={lastLog ? `Last ${ago(lastLog.verified_on)}` : "No checks yet"} />
			</div>

			<Tabs
				className="mb-4"
				active={tab}
				onChange={(id) => set({ tab: id === "transcripts" ? "" : id, status: "", q: "", type: "", programme: "", doctype: "", result: "" })}
				tabs={[
					{ id: "transcripts", label: "Transcripts" },
					{ id: "certificates", label: "Certificates" },
					{ id: "verifications", label: "Verification log" },
				]}
			/>

			{tab === "certificates" ? <CertificatesTab get={get} set={set} /> : tab === "verifications" ? <VerificationsTab get={get} set={set} /> : <TranscriptsTab get={get} set={set} />}

			<GenerateTranscript open={genOpen} onClose={() => setGenOpen(false)} />
		</>
	)
}

/** Search box state that writes `q` to the URL after a pause. */
function useSearch(get, set) {
	const [search, setSearch] = useState(get("q"))
	const q = useDebounced(search.trim(), 350)
	useEffect(() => {
		if (q !== get("q")) set({ q })
	}, [q, get, set])
	return [search, setSearch, q]
}

function statusChips(counts) {
	return [{ id: "", label: "All" }, ...DOC_STATUSES.map((s) => ({ id: s, label: s, count: counts?.[s] }))]
}

function TranscriptsTab({ get, set }) {
	const { hasRole } = useSession()
	const canWrite = hasRole(...CAN.write)
	const canRequests = hasRole(...CAN.requests)
	const page = Number(get("page") || 1)
	const [search, setSearch, q] = useSearch(get, set)
	const [issueT, setIssueT] = useState(null)
	const [revokeT, setRevokeT] = useState(null)

	const filters = compact({ status: get("status"), transcript_type: get("type"), search: q })
	const list = useApi(`${API}list_transcripts`, { ...filters, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData })
	const data = list.data || {}

	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <AvatarCell name={r.student_name} sub={[r.student_number, r.programme].filter(Boolean).join(" · ")} /> },
		{
			key: "name",
			label: "Transcript",
			render: (r) => (
				<div className="min-w-0">
					<div className="font-semibold text-ink">{r.transcript_type}</div>
					<div className="text-xs text-ink-soft">
						{r.name}
						{r.request ? ` · for ${r.request}` : ""}
					</div>
				</div>
			),
		},
		{
			key: "cgpa",
			label: "Results",
			hideOnMobile: true,
			render: (r) => (
				<div className="whitespace-nowrap">
					<div className="font-semibold tabular-nums text-ink">{r.cgpa != null ? `CGPA ${Number(r.cgpa).toFixed(2)}` : "—"}</div>
					<div className="text-xs text-ink-soft">{[r.total_credits != null ? `${num(r.total_credits)} credits` : null, r.classification].filter(Boolean).join(" · ")}</div>
				</div>
			),
		},
		{
			key: "issue_date",
			label: "Issued",
			hideOnMobile: true,
			sortValue: (r) => r.issue_date || "",
			render: (r) =>
				r.issue_date ? (
					<div className="whitespace-nowrap">
						<div>{date(r.issue_date)}</div>
						<div className="font-mono text-[11px] text-ink-soft">{r.verification_code}</div>
					</div>
				) : (
					<span className="text-xs text-ink-soft">Created {date(r.creation)}</span>
				),
		},
		{
			key: "status",
			label: "Status",
			render: (r) => (
				<div>
					<DocStatus status={r.status} />
					{r.override_fee_check ? <div className="mt-1 text-[11px] text-orange-600">Fee override</div> : null}
				</div>
			),
		},
		canWrite
			? {
					key: "actions",
					label: "",
					align: "right",
					render: (r) =>
						r.status === "Draft" ? (
							<Button size="sm" variant="secondary" icon={BadgeCheck} onClick={stop(() => setIssueT(r))}>
								Issue
							</Button>
						) : r.status === "Issued" ? (
							<Button size="sm" variant="danger-soft" icon={Ban} onClick={stop(() => setRevokeT(r))}>
								Revoke
							</Button>
						) : null,
				}
			: null,
	].filter(Boolean)

	return (
		<div className="space-y-5">
			{canRequests ? <RequestQueue /> : null}
			<div>
				<Toolbar search={search} onSearch={setSearch} placeholder="Search name, number or transcript…" chips={statusChips()} active={get("status")} onChip={(id) => set({ status: id })} />
				<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
					<Select aria-label="Transcript type" value={get("type")} onChange={(e) => set({ type: e.target.value })} placeholder="All types" options={TRANSCRIPT_TYPES} />
					<div className="flex items-center justify-end gap-3 text-xs text-ink-soft sm:col-span-3">
						<span>{list.isFetching ? "Loading…" : `${num(data.total || 0)} transcript${data.total === 1 ? "" : "s"}`}</span>
						{get("type") || get("status") || q ? (
							<button
								type="button"
								className="font-semibold text-brand-700 hover:underline"
								onClick={() => {
									setSearch("")
									set({ type: "", status: "", q: "" })
								}}
							>
								Clear filters
							</button>
						) : null}
					</div>
				</div>
				<DataTable cols={cols} rows={data.data || []} query={list} rowTo={(r) => `/admin/credentials/transcripts/${encodeURIComponent(r.name)}`} empty="No transcripts match these filters" emptyIcon={ScrollText} />
				<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
			</div>
			<IssueTranscriptDialog open={Boolean(issueT)} transcript={issueT} onClose={() => setIssueT(null)} />
			<RevokeDialog open={Boolean(revokeT)} doctype="Transcript" name={revokeT?.name} label={revokeT ? `${revokeT.name} (${revokeT.student_name})` : ""} onClose={() => setRevokeT(null)} />
		</div>
	)
}

function CertificatesTab({ get, set }) {
	const { hasRole } = useSession()
	const canWrite = hasRole(...CAN.write)
	const page = Number(get("page") || 1)
	const [search, setSearch, q] = useSearch(get, set)
	const [revokeC, setRevokeC] = useState(null)
	const L = useLookups().data || {}

	const filters = compact({ status: get("status"), programme: get("programme"), search: q })
	const list = useApi(`${API}list_certificates`, { ...filters, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData })
	const data = list.data || {}

	const cols = [
		{ key: "student_name", label: "Graduate", render: (r) => <AvatarCell name={r.student_name} sub={r.student_number || r.student} /> },
		{
			key: "award_title",
			label: "Award",
			render: (r) => (
				<div className="min-w-0 max-w-[18rem]">
					<div className="truncate font-semibold text-ink">{r.award_title || r.programme}</div>
					<div className="truncate font-mono text-[11px] text-ink-soft">{r.certificate_serial || r.name}</div>
				</div>
			),
		},
		{
			key: "classification",
			label: "Classification",
			hideOnMobile: true,
			render: (r) => (
				<div className="whitespace-nowrap">
					<div>{r.classification || "—"}</div>
					{r.cgpa != null ? <div className="text-xs tabular-nums text-ink-soft">CGPA {Number(r.cgpa).toFixed(2)}</div> : null}
				</div>
			),
		},
		{ key: "graduation_date", label: "Graduated", hideOnMobile: true, sortValue: (r) => r.graduation_date || "", render: (r) => <span className="whitespace-nowrap">{r.graduation_date ? date(r.graduation_date) : "—"}</span> },
		{ key: "status", label: "Status", render: (r) => <DocStatus status={r.status} /> },
		canWrite
			? {
					key: "actions",
					label: "",
					align: "right",
					render: (r) =>
						r.status === "Issued" ? (
							<Button size="sm" variant="danger-soft" icon={Ban} onClick={stop(() => setRevokeC(r))}>
								Revoke
							</Button>
						) : null,
				}
			: null,
	].filter(Boolean)

	return (
		<div>
			<Toolbar search={search} onSearch={setSearch} placeholder="Search name, number or serial…" chips={statusChips()} active={get("status")} onChip={(id) => set({ status: id })} />
			<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
				<Select
					aria-label="Programme"
					className="col-span-2"
					value={get("programme")}
					onChange={(e) => set({ programme: e.target.value })}
					placeholder="All programmes"
					options={(L.programmes || []).map((p) => ({ value: p.name, label: p.programme_name || p.name }))}
				/>
				<div className="col-span-2 flex items-center justify-end gap-3 text-xs text-ink-soft">
					<span>{list.isFetching ? "Loading…" : `${num(data.total || 0)} certificate${data.total === 1 ? "" : "s"}`}</span>
					{canWrite ? (
						<Link to="/admin/credentials/issue" className="font-semibold text-brand-700 hover:underline">
							Issue certificates →
						</Link>
					) : null}
				</div>
			</div>
			<DataTable cols={cols} rows={data.data || []} query={list} rowTo={(r) => `/admin/credentials/certificates/${encodeURIComponent(r.name)}`} empty="No certificates match these filters" emptyIcon={Award} />
			<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
			<RevokeDialog open={Boolean(revokeC)} doctype="Certificate" name={revokeC?.name} label={revokeC ? `${revokeC.certificate_serial || revokeC.name} (${revokeC.student_name})` : ""} onClose={() => setRevokeC(null)} />
		</div>
	)
}

const DOC_ROUTE = { Transcript: "transcripts", Certificate: "certificates" }

function VerificationsTab({ get, set }) {
	const page = Number(get("page") || 1)
	const [code, setCode] = useState(get("q"))
	const filters = compact({ code: get("q"), document_type: get("doctype"), result: get("result") })
	const list = useApi(`${API}verification_logs`, { ...filters, start: (page - 1) * LOG_PAGE, page_length: LOG_PAGE }, { placeholderData: keepPreviousData })
	const data = list.data || {}

	const cols = [
		{
			key: "verified_on",
			label: "When",
			sortValue: (r) => r.verified_on,
			render: (r) => (
				<div className="whitespace-nowrap">
					<div className="text-ink">{dateTime(r.verified_on)}</div>
					<div className="text-xs text-ink-soft">{ago(r.verified_on)}</div>
				</div>
			),
		},
		{ key: "verification_code", label: "Code", render: (r) => <span className="font-mono text-xs">{r.verification_code || "—"}</span> },
		{
			key: "document_name",
			label: "Document",
			render: (r) =>
				r.document_name && DOC_ROUTE[r.document_type] ? (
					<Link className="font-semibold text-brand-700 hover:underline" to={`/admin/credentials/${DOC_ROUTE[r.document_type]}/${encodeURIComponent(r.document_name)}`}>
						{r.document_type} {r.document_name}
					</Link>
				) : (
					<span>{[r.document_type, r.document_name].filter(Boolean).join(" ") || "—"}</span>
				),
		},
		{ key: "result", label: "Result", render: (r) => <VerifyResult result={r.result} /> },
		{
			key: "requester_name",
			label: "Checked by",
			hideOnMobile: true,
			render: (r) =>
				r.requester_name || r.requester_organisation ? (
					<div className="min-w-0 max-w-[14rem]">
						<div className="truncate">{r.requester_name || "—"}</div>
						<div className="truncate text-xs text-ink-soft">{r.requester_organisation}</div>
					</div>
				) : (
					<span className="text-xs text-ink-soft">Anonymous</span>
				),
		},
		{ key: "ip_address", label: "IP", hideOnMobile: true, render: (r) => <span className="font-mono text-xs text-ink-soft">{r.ip_address || "—"}</span> },
	]

	const submit = (e) => {
		e.preventDefault()
		set({ q: code.trim().toUpperCase() })
	}

	return (
		<div>
			<form onSubmit={submit} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
				<div className="col-span-2 flex gap-2">
					<input className="input font-mono" aria-label="Verification code" placeholder="Exact verification code" value={code} onChange={(e) => setCode(e.target.value)} />
					<Button type="submit" variant="secondary">
						Find
					</Button>
				</div>
				<Select aria-label="Document type" value={get("doctype")} onChange={(e) => set({ doctype: e.target.value })} placeholder="All documents" options={VERIFY_DOCTYPES} />
				<Select aria-label="Result" value={get("result")} onChange={(e) => set({ result: e.target.value })} placeholder="All results" options={VERIFY_RESULTS} />
			</form>
			<div className="mb-2 flex items-center justify-end gap-3 text-xs text-ink-soft">
				<span>{list.isFetching ? "Loading…" : `${num(data.total || 0)} check${data.total === 1 ? "" : "s"}`}</span>
				{get("q") || get("doctype") || get("result") ? (
					<button
						type="button"
						className="font-semibold text-brand-700 hover:underline"
						onClick={() => {
							setCode("")
							set({ q: "", doctype: "", result: "" })
						}}
					>
						Clear filters
					</button>
				) : null}
			</div>
			<DataTable cols={cols} rows={data.data || []} query={list} empty="No verification checks match these filters" emptyIcon={ShieldCheck} />
			<Pagination page={page} pageSize={LOG_PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
		</div>
	)
}
