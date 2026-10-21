import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { CheckCircle2, Circle, Clock, FilePlus2, Inbox, Paperclip, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, ConfirmDialog, Drawer, Empty, KeyValueGrid, PageHeader, QueryState, SkeletonRows, StatCard } from "@/shared/components/ui"
import { Timeline, Toolbar } from "@/shared/components/kit"
import { date, dateTime } from "@/shared/utils/format"
import { IconChip, SafeLink } from "../components/bits"
import { RequestModal, typeMeta } from "../components/RequestModal"
import { TranscriptRequestModal } from "../components/TranscriptRequestModal"
import { API, INV, since } from "../components/lib"

const OPEN = ["Pending", "Under Review"]
const CHIPS = [
	{ id: "all", label: "All" },
	{ id: "open", label: "In progress" },
	{ id: "closed", label: "Closed" },
]

/** Request progress reconstructed from its fields (my_requests carries no status log). */
function timeline(r) {
	const s = r.status
	const reviewed = ["Under Review", "Approved", "Rejected", "Completed"].includes(s)
	const steps = [
		{ label: "Submitted", date: dateTime(r.creation), status: "done" },
		{ label: "Under review", status: reviewed ? "done" : s === "Pending" ? "current" : "pending" },
	]
	if (s === "Cancelled") return [steps[0], { label: "Cancelled", date: dateTime(r.modified), note: "Cancelled by you", status: "failed" }]
	if (s === "Rejected") return [...steps, { label: "Rejected", date: r.decision_date ? date(r.decision_date) : null, note: r.review_notes, status: "failed" }]
	steps[1].status = s === "Under Review" ? "current" : steps[1].status
	steps.push({ label: "Approved", date: r.decision_date ? date(r.decision_date) : null, note: s === "Approved" ? r.review_notes : null, status: ["Approved", "Completed"].includes(s) ? "done" : "pending" })
	steps.push({ label: "Completed", note: s === "Completed" ? r.review_notes : null, status: s === "Completed" ? "done" : s === "Approved" ? "current" : "pending" })
	return steps
}

function summary(r) {
	switch (r.request_type) {
		case "Deferment":
			return `${date(r.from_date)} – ${date(r.to_date)}`
		case "Resumption":
			return r.from_date ? `From ${date(r.from_date)}` : null
		case "Programme Transfer":
			return r.new_programme ? `To ${r.new_programme}` : null
		case "Campus Transfer":
			return r.new_campus ? `To ${r.new_campus}` : null
		case "Document Request":
		case "Transcript Request":
			return [r.document_type, r.copies ? `${r.copies} ${Number(r.copies) === 1 ? "copy" : "copies"}` : null, r.delivery_method].filter(Boolean).join(" · ")
		case "Clearance": {
			const c = r.clearance || []
			return c.length ? `${c.filter((x) => x.status === "Cleared").length} of ${c.length} offices cleared` : null
		}
		default:
			return r.academic_term || null
	}
}

export default function Requests() {
	const q = useApi(API.requests)
	const [params, setParams] = useSearchParams()
	const [chip, setChip] = useState("all")
	const [search, setSearch] = useState("")
	const [creating, setCreating] = useState(params.get("new") != null)
	const [transcript, setTranscript] = useState(false)
	const openName = params.get("open")
	const rows = q.data?.data || []
	const list = useMemo(() => {
		const s = search.trim().toLowerCase()
		return rows.filter(
			(r) =>
				(chip === "all" || (chip === "open" ? OPEN.includes(r.status) : !OPEN.includes(r.status))) &&
				(!s || `${r.name} ${r.request_type} ${r.reason || ""} ${r.document_type || ""}`.toLowerCase().includes(s))
		)
	}, [rows, chip, search])
	const current = rows.find((r) => r.name === openName) || null
	const setOpen = (name) => setParams((p) => (name ? p.set("open", name) : p.delete("open"), p.delete("new"), p), { replace: true })
	const counts = {
		open: rows.filter((r) => OPEN.includes(r.status)).length,
		approved: rows.filter((r) => ["Approved", "Completed"].includes(r.status)).length,
		rejected: rows.filter((r) => r.status === "Rejected").length,
	}

	return (
		<>
			<PageHeader
				eyebrow="Me"
				title="My requests"
				subtitle="Deferments, withdrawals, transfers, letters and clearance — submitted and tracked online."
				actions={
					<Button icon={FilePlus2} onClick={() => setCreating(true)}>
						New request
					</Button>
				}
			/>
			<div className="mb-5 grid grid-cols-3 gap-3">
				<StatCard label="In progress" value={counts.open} icon={Clock} tone="blue" loading={q.isLoading} />
				<StatCard label="Approved" value={counts.approved} icon={CheckCircle2} tone="green" loading={q.isLoading} />
				<StatCard label="Rejected" value={counts.rejected} icon={XCircle} tone={counts.rejected ? "red" : "gray"} loading={q.isLoading} />
			</div>
			<Toolbar search={search} onSearch={setSearch} placeholder="Search requests" chips={CHIPS} active={chip} onChip={setChip} className="mb-3" />
			<QueryState
				query={q}
				skeleton={<SkeletonRows rows={4} className="card p-4" />}
				isEmpty={() => !list.length}
				empty={
					<div className="card">
						<Empty
							icon={Inbox}
							title={rows.length ? "No requests match" : "No requests yet"}
							subtitle={rows.length ? "Try a different filter." : "Need a letter, a deferment or clearance? Start a request and follow it here."}
							action={
								!rows.length ? (
									<Button size="sm" icon={FilePlus2} onClick={() => setCreating(true)}>
										New request
									</Button>
								) : null
							}
						/>
					</div>
				}
			>
				{() => (
					<div className="card divide-y divide-line overflow-hidden">
						{list.map((r) => {
							const m = typeMeta(r.request_type)
							const sub = summary(r)
							return (
								<button key={r.name} type="button" onClick={() => setOpen(r.name)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-cream/60">
									<IconChip icon={m.icon} tone={m.tone} size={40} />
									<span className="min-w-0 flex-1">
										<span className="flex flex-wrap items-center gap-x-2">
											<span className="font-semibold text-ink">{r.request_type}</span>
											<span className="font-mono text-[11px] text-ink-soft">{r.name}</span>
										</span>
										<span className="block truncate text-xs text-ink-soft">
											{sub ? `${sub} · ` : ""}
											{since(r.creation)}
										</span>
									</span>
									<Badge status={r.status} dot />
								</button>
							)
						})}
					</div>
				)}
			</QueryState>
			<RequestDrawer r={current} loading={Boolean(openName) && q.isLoading} onClose={() => setOpen(null)} />
			<RequestModal open={creating} onClose={() => setCreating(false)} onTranscript={() => setTranscript(true)} onCreated={(r) => setOpen(r.name)} />
			<TranscriptRequestModal open={transcript} onClose={() => setTranscript(false)} />
		</>
	)
}

function RequestDrawer({ r, onClose }) {
	const [confirm, setConfirm] = useState(false)
	const cancel = useAction(API.cancelRequest, { invalidate: [INV.students, INV.credentials], success: "Request cancelled", onSuccess: () => setConfirm(false) })
	const m = r ? typeMeta(r.request_type) : null
	return (
		<Drawer
			open={Boolean(r)}
			onClose={onClose}
			title={r?.request_type}
			subtitle={r ? `${r.name} · submitted ${date(r.creation)}` : null}
			footer={
				r?.can_cancel ? (
					<div className="flex justify-end">
						<Button variant="danger" icon={XCircle} onClick={() => setConfirm(true)}>
							Cancel request
						</Button>
					</div>
				) : null
			}
		>
			{r ? (
				<div className="space-y-5">
					<div className="flex items-center gap-3">
						<IconChip icon={m.icon} tone={m.tone} size={44} />
						<div>
							<Badge status={r.status} dot />
							<p className="mt-1 text-xs text-ink-soft">Last updated {since(r.modified)}</p>
						</div>
					</div>
					{r.review_notes && ["Rejected", "Approved", "Completed", "Under Review"].includes(r.status) ? (
						<Alert tone={r.status === "Rejected" ? "error" : "info"} title="Note from the Registrar">
							{r.review_notes}
						</Alert>
					) : null}
					<section>
						<h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-soft">Progress</h4>
						<Timeline steps={timeline(r)} />
					</section>
					{(r.clearance || []).length ? (
						<section>
							<h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Clearance</h4>
							<ul className="divide-y divide-line rounded-xl border border-line">
								{r.clearance.map((c) => (
									<li key={c.name} className="flex items-center gap-3 px-4 py-2.5">
										{c.status === "Cleared" ? <CheckCircle2 size={18} className="text-emerald-600" /> : c.status === "Not Cleared" || c.status === "Blocked" ? <XCircle size={18} className="text-red-600" /> : <Circle size={18} className="text-ink-soft" />}
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium text-ink">{c.department}</span>
											{c.remarks ? <span className="block text-xs text-ink-soft">{c.remarks}</span> : null}
										</span>
										<span className={clsx("text-xs", c.status === "Cleared" ? "text-emerald-600" : "text-ink-soft")}>{c.cleared_on ? date(c.cleared_on) : c.status}</span>
									</li>
								))}
							</ul>
						</section>
					) : null}
					<section>
						<h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Details</h4>
						<KeyValueGrid
							items={[
								{ label: "Term", value: r.academic_term },
								{ label: "From", value: r.from_date ? date(r.from_date) : null },
								{ label: "To", value: r.to_date ? date(r.to_date) : null },
								{ label: "New programme", value: r.new_programme },
								{ label: "New campus", value: r.new_campus },
								{ label: "Course enrolment", value: r.course_enrolment },
								{ label: "Document", value: r.document_type },
								{ label: "Copies", value: r.copies && ["Document Request", "Transcript Request"].includes(r.request_type) ? r.copies : null },
								{ label: "Delivery", value: ["Document Request", "Transcript Request"].includes(r.request_type) ? r.delivery_method : null },
								{ label: "Decision date", value: r.decision_date ? date(r.decision_date) : null },
							].filter((x) => x.value)}
						/>
						{r.reason ? (
							<div className="mt-3 rounded-xl bg-cream p-3">
								<div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Your reason</div>
								<p className="mt-1 whitespace-pre-line text-sm text-ink">{r.reason}</p>
							</div>
						) : null}
						{r.attachment ? (
							<SafeLink className="link mt-3 inline-flex items-center gap-1.5 text-sm" href={r.attachment}>
								<Paperclip size={14} /> {r.attachment.split("/").pop()}
							</SafeLink>
						) : null}
					</section>
				</div>
			) : null}
			<ConfirmDialog
				open={confirm}
				title="Cancel this request?"
				message="The Registrar will stop processing it. You can submit a new one later."
				confirmLabel="Cancel request"
				tone="danger"
				loading={cancel.isPending}
				onClose={() => setConfirm(false)}
				onConfirm={() => cancel.mutate({ name: r.name })}
			/>
		</Drawer>
	)
}
