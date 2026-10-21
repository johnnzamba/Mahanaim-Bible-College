import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Ban, BadgeCheck, CheckCircle2, ExternalLink, FileClock, RefreshCw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react"
import { useAction, useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { Alert, Avatar, Badge, Button, ConfirmDialog, Empty, ErrorState, KeyValueGrid, PageHeader, Panel, SkeletonRows, Tabs, Textarea } from "@/shared/components/ui"
import { DownloadLink } from "@/shared/components/kit"
import { ago, date, dateTime, num } from "@/shared/utils/format"
import { API, CAN, DocStatus, NoAccess, PrintPreview, STU, isPermissionError, kv, pdfUrl, printUrl, snapshotTerms, termLabel, useLookups } from "../lib"
import { IssueTranscriptDialog, RevokeDialog } from "../components/Dialogs"

/** /admin/credentials/transcripts/:name */
export default function TranscriptDetail() {
	const { name } = useParams()
	const { hasRole, roles } = useSession()
	const allowed = hasRole(...CAN.read)
	const canWrite = hasRole(...CAN.write)
	const [tab, setTab] = useState("preview")
	const [issueOpen, setIssueOpen] = useState(false)
	const [revokeOpen, setRevokeOpen] = useState(false)
	const invalidate = useInvalidate()
	const L = useLookups().data || {}

	const q = useApi(`${API}get_transcript`, { name }, { enabled: allowed })
	const refresh = useAction(`${API}refresh_transcript`, { invalidate: [API], success: "Results snapshot refreshed" })

	const back = { to: "/admin/credentials", label: "Transcripts & certificates" }
	if (!allowed || isPermissionError(q.error)) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Transcript" back={back} />
				<NoAccess message="Transcripts are managed by the registrar; the academic dean and auditors can view them." />
			</>
		)
	}
	if (q.isLoading) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Transcript" back={back} />
				<Panel>
					<SkeletonRows rows={8} />
				</Panel>
			</>
		)
	}
	if (q.isError) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Transcript" back={back} />
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			</>
		)
	}

	const t = q.data || {}
	const terms = snapshotTerms(t)
	const canStudent = hasRole(...CAN.student360) && canAccess(roles, "/students")

	return (
		<>
			<PageHeader
				eyebrow={`Credentials · ${t.name}`}
				back={back}
				title={
					<span className="flex flex-wrap items-center gap-2">
						{t.transcript_type} transcript <DocStatus status={t.status} />
					</span>
				}
				subtitle={[t.student_name, t.student_number, t.programme].filter(Boolean).join(" · ")}
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(API)}>
							Reload
						</Button>
						<a href={printUrl("Transcript", t.name)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
							<ExternalLink size={14} /> Print view
						</a>
						<DownloadLink href={pdfUrl("Transcript", t.name)}>PDF</DownloadLink>
						{canWrite && t.status === "Draft" ? (
							<>
								<Button variant="secondary" size="sm" icon={RefreshCw} loading={refresh.isPending} onClick={() => refresh.mutate({ name: t.name })}>
									Refresh results
								</Button>
								<Button size="sm" icon={BadgeCheck} onClick={() => setIssueOpen(true)}>
									Issue
								</Button>
							</>
						) : null}
						{canWrite && t.status === "Issued" ? (
							<Button size="sm" variant="danger-soft" icon={Ban} onClick={() => setRevokeOpen(true)}>
								Revoke
							</Button>
						) : null}
					</>
				}
			/>

			{t.status === "Revoked" ? (
				<Alert tone="error" icon={ShieldAlert} title="Revoked" className="mb-4">
					{t.revoked_reason || "No reason recorded."} Verification checks for {t.verification_code || "this code"} now report it as revoked.
				</Alert>
			) : t.status === "Draft" ? (
				<Alert tone="warning" icon={FileClock} className="mb-4">
					This is a draft and has no verification code yet. Results were captured {t.modified ? ago(t.modified) : "when it was created"}; refresh them if marks have been published since. The fee clearance check runs when you issue it.
				</Alert>
			) : null}

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-4 lg:col-span-2">
					<Tabs
						active={tab}
						onChange={setTab}
						tabs={[
							{ id: "preview", label: "Preview" },
							{ id: "results", label: "Results", count: terms.length },
						]}
					/>
					{tab === "results" ? <ResultsBySnapshot t={t} terms={terms} /> : <PrintPreview doctype="Transcript" name={t.name} title={`Transcript ${t.name}`} />}
				</div>

				<div className="min-w-0 space-y-4">
					<Panel title="Student" icon={ScrollText}>
						<div className="flex items-center gap-3">
							<Avatar name={t.student_name} size={44} />
							<div className="min-w-0">
								{canStudent ? (
									<Link to={`/admin/students/${encodeURIComponent(t.student)}`} className="font-semibold text-brand-700 hover:underline">
										{t.student_name}
									</Link>
								) : (
									<div className="font-semibold text-ink">{t.student_name}</div>
								)}
								<div className="text-xs text-ink-soft">{[t.student_number, t.programme].filter(Boolean).join(" · ")}</div>
							</div>
						</div>
						<div className="mt-4 grid grid-cols-3 gap-2 text-center">
							<Figure label="CGPA" value={t.cgpa != null ? Number(t.cgpa).toFixed(2) : "—"} />
							<Figure label="Credits" value={t.total_credits != null ? num(t.total_credits) : "—"} />
							<Figure label="Terms" value={num(terms.length)} />
						</div>
						{t.classification ? <div className="mt-3 text-center text-sm font-semibold text-ink">{t.classification}</div> : null}
					</Panel>

					<Panel title="Details" icon={ShieldCheck}>
						<KeyValueGrid
							cols={2}
							items={kv([
								{ label: "Verification code", value: t.verification_code ? <span className="font-mono">{t.verification_code}</span> : null, wide: true },
								{ label: "Issued on", value: t.issue_date ? date(t.issue_date) : null },
								{ label: "Results up to", value: t.as_of_term ? termLabel(L, t.as_of_term) : "All terms" },
								{ label: "Times verified", value: num(t.verification_count || 0) },
								{ label: "Fee check", value: t.override_fee_check ? <Badge status="Overridden" tone="orange" size="xs" /> : t.status === "Issued" ? "Cleared" : "On issue" },
								{ label: "Issued by", value: t.issued_by, wide: true },
								{ label: "Created", value: dateTime(t.creation), wide: true },
								{ label: "Issue notes", value: t.eligibility_notes ? <span className="whitespace-pre-line text-ink-muted">{t.eligibility_notes}</span> : null, wide: true },
								t.status === "Revoked" ? { label: "Revoked because", value: t.revoked_reason, wide: true } : null,
							])}
						/>
					</Panel>

					{t.request ? <LinkedRequest transcript={t} /> : null}
				</div>
			</div>

			<IssueTranscriptDialog open={issueOpen} transcript={t} onClose={() => setIssueOpen(false)} />
			<RevokeDialog open={revokeOpen} doctype="Transcript" name={t.name} label={t.name} onClose={() => setRevokeOpen(false)} />
		</>
	)
}

function Figure({ label, value }) {
	return (
		<div className="rounded-xl bg-cream px-2 py-2">
			<div className="text-lg font-bold tabular-nums text-ink">{value}</div>
			<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
		</div>
	)
}

function ResultsBySnapshot({ t, terms }) {
	if (!terms.length) {
		return (
			<Panel>
				<Empty icon={ScrollText} title="No published results in this snapshot" subtitle={t.status === "Draft" ? "Publish results first, then refresh the draft." : undefined} />
			</Panel>
		)
	}
	return (
		<div className="space-y-4">
			{terms.map((term) => (
				<Panel
					key={term.term || term.label}
					title={term.label || term.term}
					subtitle={term.academic_year}
					actions={
						<div className="text-right text-xs text-ink-soft">
							<div className="font-semibold tabular-nums text-ink">GPA {term.gpa != null ? Number(term.gpa).toFixed(2) : "—"}</div>
							<div>{num(term.credits_earned ?? term.credits ?? 0)} credits</div>
						</div>
					}
					bodyClass="p-0"
				>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-soft">
									<th className="px-4 py-2 font-semibold">Course</th>
									<th className="px-3 py-2 text-right font-semibold">Credits</th>
									<th className="px-3 py-2 text-right font-semibold">Mark</th>
									<th className="px-3 py-2 text-center font-semibold">Grade</th>
									<th className="hidden px-4 py-2 font-semibold sm:table-cell">Result</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-line">
								{(term.courses || []).map((c) => (
									<tr key={`${c.code}-${c.attempt || ""}`}>
										<td className="px-4 py-2">
											<div className="font-semibold text-ink">{c.code}</div>
											<div className="text-xs text-ink-soft">{c.title}</div>
										</td>
										<td className="px-3 py-2 text-right tabular-nums">{num(c.credits)}</td>
										<td className="px-3 py-2 text-right tabular-nums">{c.total != null ? num(c.total) : "—"}</td>
										<td className="px-3 py-2 text-center font-bold">{c.grade || "—"}</td>
										<td className="hidden px-4 py-2 sm:table-cell">
											<Badge status={c.status || "—"} size="xs" />
											{c.attempt && c.attempt !== "First" ? <span className="ml-1 text-[11px] text-ink-soft">{c.attempt}</span> : null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Panel>
			))}
			<div className="flex justify-end gap-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
				<span>
					CGPA <b className="tabular-nums">{t.cgpa != null ? Number(t.cgpa).toFixed(2) : "—"}</b>
				</span>
				<span>
					Credits <b className="tabular-nums">{num(t.total_credits || 0)}</b>
				</span>
				{t.classification ? <b>{t.classification}</b> : null}
			</div>
		</div>
	)
}

/** The Student Request this transcript answers. Issuing does not close it, so offer to complete it. */
function LinkedRequest({ transcript: t }) {
	const { hasRole, roles } = useSession()
	const canRequests = hasRole(...CAN.requests)
	const [act, setAct] = useState(null)
	const [notes, setNotes] = useState("")
	const r = useApi(`${STU}get_request`, { name: t.request }, { enabled: canRequests })
	const decide = useAction(`${STU}decide_request`, {
		invalidate: [STU, API],
		success: (res, v) => `${res.name} ${v.decision === "Completed" ? "marked completed" : v.decision.toLowerCase()}`,
		onSuccess: () => setAct(null),
	})
	const req = r.data
	const link = canAccess(roles, "/students") ? `/admin/students/requests/${encodeURIComponent(t.request)}` : null
	const transitions = req?.allowed_transitions || []

	return (
		<Panel title="Student request" icon={FileClock}>
			{!canRequests ? (
				<p className="text-sm text-ink-muted">Generated for request {t.request}.</p>
			) : r.isLoading ? (
				<SkeletonRows rows={2} />
			) : r.isError ? (
				<ErrorState error={r.error} onRetry={() => r.refetch()} />
			) : (
				<div className="space-y-3 text-sm">
					<div className="flex items-center justify-between gap-2">
						{link ? (
							<Link to={link} className="font-semibold text-brand-700 hover:underline">
								{req.name}
							</Link>
						) : (
							<span className="font-semibold">{req.name}</span>
						)}
						<Badge status={req.status} size="xs" />
					</div>
					<div className="text-xs text-ink-soft">
						{[req.document_type, req.copies ? `${req.copies} cop${Number(req.copies) === 1 ? "y" : "ies"}` : null, req.delivery_method, `raised ${date(req.creation)}`].filter(Boolean).join(" · ")}
					</div>
					{req.reason ? <p className="text-xs text-ink-muted">“{req.reason}”</p> : null}
					{hasRole(...CAN.decide) ? (
						<div className="flex flex-wrap gap-2">
							{transitions.includes("Approved") && req.status !== "Approved" ? (
								<Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setAct("Approved")}>
									Approve request
								</Button>
							) : null}
							{transitions.includes("Completed") && t.status === "Issued" ? (
								<Button size="sm" icon={CheckCircle2} onClick={() => setAct("Completed")}>
									Mark request completed
								</Button>
							) : null}
						</div>
					) : null}
					{req.status === "Approved" && t.status === "Draft" ? <p className="text-xs text-ink-soft">Issuing the transcript completes this request and tells the student it is ready.</p> : null}
				</div>
			)}
			<ConfirmDialog
				open={Boolean(act)}
				onClose={() => setAct(null)}
				loading={decide.isPending}
				title={act === "Completed" ? `Complete ${t.request}?` : `Approve ${t.request}?`}
				confirmLabel={act === "Completed" ? "Mark completed" : "Approve"}
				message={act === "Completed" ? `${t.student_name} is told the transcript is ready.` : "This transcript is already linked to the request, so no new draft is created."}
				onConfirm={() => decide.mutate({ name: t.request, decision: act, notes: notes.trim() || undefined })}
			>
				<Textarea className="mt-3" label="Note to the student" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
			</ConfirmDialog>
		</Panel>
	)
}
