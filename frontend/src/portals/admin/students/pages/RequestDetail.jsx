import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { CheckCircle2, ClipboardCheck, ExternalLink, FileText, Paperclip, PlayCircle, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { Timeline } from "@/shared/components/kit"
import { Alert, Avatar, Badge, Button, ErrorState, InfoRow, KeyValueGrid, Modal, PageHeader, Panel, ProgressBar, SkeletonRows, Textarea } from "@/shared/components/ui"
import { date, dateTime } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { API, CAN, NoAccess, StudentStatus, fileName, isPermissionError, kv } from "../lib"

const DECISIONS = {
	"Under Review": { label: "Start review", icon: PlayCircle, variant: "secondary", title: "Start reviewing this request", notes: "Optional note for the record" },
	Approved: { label: "Approve", icon: CheckCircle2, variant: "primary", title: "Approve request", notes: "Note to the student (optional)" },
	Rejected: { label: "Reject", icon: XCircle, variant: "danger", title: "Reject request", notes: "Reason, sent to the student", required: true },
	Completed: { label: "Mark completed", icon: ClipboardCheck, variant: "secondary", title: "Mark as completed", notes: "What was done, for example: transcript collected" },
}
const EFFECT = {
	Deferment: "The student becomes Deferred and their enrolments for the term are withdrawn.",
	Withdrawal: "The student becomes Withdrawn, their enrolments for the term are withdrawn and the portal account is disabled.",
	Resumption: "The student becomes Active again and can register for courses.",
	"Programme Transfer": "The student's programme is changed to the requested programme.",
	"Campus Transfer": "The student's campus is changed to the requested campus.",
	"Course Drop": "The course enrolment is dropped and removed from the semester registration.",
	"Transcript Request": "A draft transcript is created for the registrar to review and issue.",
	"Document Request": "A draft transcript is created for the registrar to review and issue.",
	Clearance: "Every department must be cleared before the request can be approved.",
}

/** /admin/students/requests/:name */
export default function RequestDetail() {
	const { name } = useParams()
	const { hasRole } = useSession()
	const allowed = hasRole(...CAN.read, ...CAN.requestsRead)
	const q = useApi(`${API}get_request`, { name }, { enabled: allowed })
	const back = { to: "/admin/students/requests", label: "Requests" }
	const deny = "Student requests are handled by the registrar, the academic dean, finance and the library."
	if (!allowed || isPermissionError(q.error)) return <><PageHeader title="Request" back={back} /><NoAccess message={deny} /></>
	if (q.isLoading) return <><PageHeader title="Loading request…" back={back} /><Panel><SkeletonRows rows={6} /></Panel></>
	if (q.isError) return <><PageHeader title="Request" back={back} /><Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel></>
	return <View r={q.data} back={back} />
}

function View({ r, back }) {
	const { hasRole, roles } = useSession()
	const canDecide = hasRole(...CAN.write)
	const [decision, setDecision] = useState(null)
	const st = r.student_info || {}
	const actions = canDecide ? (r.allowed_transitions || []).filter((d) => DECISIONS[d]) : []
	const clearance = r.clearance || []
	const cleared = clearance.filter((c) => c.status === "Cleared").length
	const open = ["Pending", "Under Review"].includes(r.status)
	const pendingClearance = clearance.filter((c) => c.status !== "Cleared")
	const isDocument = ["Transcript Request", "Document Request"].includes(r.request_type)

	const details = kv([
		{ label: "Request type", value: r.request_type },
		r.academic_term || r.request_type !== "Clearance" ? { label: "Term", value: r.academic_term } : null,
		r.from_date || ["Deferment", "Withdrawal"].includes(r.request_type) ? { label: "From", value: r.from_date ? date(r.from_date) : null } : null,
		r.to_date || r.request_type === "Deferment" ? { label: "Until", value: r.to_date ? date(r.to_date) : null } : null,
		r.request_type === "Programme Transfer" ? { label: "New programme", value: r.new_programme } : null,
		r.request_type === "Campus Transfer" ? { label: "New campus", value: r.new_campus } : null,
		r.request_type === "Course Drop" ? { label: "Course", value: r.course ? `${r.course.course} · ${r.course.academic_term} (${r.course.status})` : r.course_enrolment } : null,
		r.document_type ? { label: "Document", value: r.document_type } : null,
		isDocument && r.copies ? { label: "Copies", value: r.copies } : null,
		isDocument && r.delivery_method ? { label: "Delivery", value: r.delivery_method } : null,
		{ label: "Raised", value: r.creation ? dateTime(r.creation) : null },
	])

	return (
		<>
			<PageHeader
				back={back}
				eyebrow={r.name}
				title={`${r.request_type} request`}
				subtitle={`From ${r.student_name}`}
				actions={
					<>
						<Badge status={r.status} />
						{actions.map((d) => {
							const a = DECISIONS[d]
							return (
								<Button key={d} size="sm" variant={a.variant} icon={a.icon} onClick={() => setDecision(d)}>
									{a.label}
								</Button>
							)
						})}
					</>
				}
			/>

			{actions.includes("Approved") && EFFECT[r.request_type] ? (
				<Alert tone={r.request_type === "Clearance" && pendingClearance.length ? "warning" : "info"} className="mb-5" title="On approval">
					{EFFECT[r.request_type]}
					{r.request_type === "Clearance" && pendingClearance.length ? ` Still waiting for: ${pendingClearance.map((c) => c.department).join(", ")}.` : ""}
				</Alert>
			) : null}

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-5 lg:col-span-2">
					<Panel title="Request">
						<KeyValueGrid cols={2} items={details} />
						<div className="mt-4">
							<div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Reason</div>
							<p className="whitespace-pre-line text-sm text-ink">{r.reason || <span className="text-ink-soft">No reason given.</span>}</p>
						</div>
						{safeUrl(r.attachment) ? (
							<a href={safeUrl(r.attachment)} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
								<Paperclip size={14} /> {fileName(r.attachment)}
							</a>
						) : null}
					</Panel>

					{clearance.length ? (
						<Panel
							title="Clearance checklist"
							subtitle={open ? "Each department signs off its own row" : "Clearance is closed for this request"}
							actions={<span className="text-xs font-semibold text-ink-soft">{cleared} of {clearance.length} cleared</span>}
						>
							<ProgressBar className="mb-4" value={(cleared / clearance.length) * 100} tone={cleared === clearance.length ? "green" : "orange"} />
							<ul className="divide-y divide-line">
								{clearance.map((c) => (
									<ClearanceRow key={c.name} item={c} request={r.name} open={open} />
								))}
							</ul>
						</Panel>
					) : null}

					{r.transcript ? (
						<Panel title="Transcript">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div className="flex items-center gap-2 text-sm">
									<FileText size={16} className="text-brand-700" />
									<span className="font-semibold">{r.transcript.name}</span>
									<Badge status={r.transcript.status} />
								</div>
								{canAccess(roles, "/credentials") ? (
									<Link to={`/admin/credentials/transcripts/${encodeURIComponent(r.transcript.name)}`} className="btn btn-secondary btn-sm">
										Open transcript <ExternalLink size={13} />
									</Link>
								) : null}
							</div>
						</Panel>
					) : null}

					{r.reviewer || r.review_notes || r.decision_date ? (
						<Panel title="Decision">
							<KeyValueGrid cols={2} items={kv([{ label: "Reviewer", value: r.reviewer }, { label: "Decided", value: r.decision_date ? date(r.decision_date) : null }])} />
							{r.review_notes ? <p className="mt-3 whitespace-pre-line text-sm text-ink">{r.review_notes}</p> : null}
						</Panel>
					) : null}
				</div>

				<aside className="min-w-0 space-y-5">
					<Panel title="Student">
						<div className="mb-3 flex items-center gap-3">
							<Avatar name={st.full_name || r.student_name} src={st.photo || undefined} size={48} />
							<div className="min-w-0">
								<Link to={`/admin/students/${encodeURIComponent(r.student)}`} className="block truncate font-semibold text-brand-700 hover:underline">
									{st.full_name || r.student_name}
								</Link>
								<div className="text-xs text-ink-soft">{st.student_number || r.student}</div>
							</div>
						</div>
						<div className="space-y-1">
							<InfoRow label="Status" value={<StudentStatus status={st.status} />} />
							<InfoRow label="Programme" value={st.programme_name || st.programme} />
							<InfoRow label="Campus" value={st.campus} />
							<InfoRow label="Year" value={st.year_of_study} />
						</div>
					</Panel>
					<Panel title="History">
						{(r.status_log || []).length ? (
							<Timeline
								steps={[...r.status_log].reverse().map((s, i) => ({
									label: s.from_status ? `${s.from_status} → ${s.to_status}` : s.to_status,
									date: [s.timestamp ? dateTime(s.timestamp) : null, s.user].filter(Boolean).join(" · "),
									note: s.note,
									status: i === 0 ? (s.to_status === "Rejected" ? "failed" : "current") : "done",
								}))}
							/>
						) : (
							<p className="text-sm text-ink-soft">No changes yet.</p>
						)}
					</Panel>
				</aside>
			</div>

			<DecisionModal request={r} decision={decision} onClose={() => setDecision(null)} blocked={decision === "Approved" && r.request_type === "Clearance" && pendingClearance.length > 0} />
		</>
	)
}

function ClearanceRow({ item, request, open }) {
	const [mode, setMode] = useState(null)
	const [notes, setNotes] = useState("")
	const act = useAction(`${API}update_clearance_item`, {
		invalidate: [API],
		success: (res) => `${item.department} clearance updated`,
		onSuccess: () => {
			setMode(null)
			setNotes("")
		},
	})
	const canEdit = open && item.can_clear
	return (
		<li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-semibold text-ink">{item.department}</span>
					<Badge status={item.status} size="xs" tone={item.status === "Cleared" ? "green" : item.status === "Not Cleared" ? "red" : "orange"} />
				</div>
				<div className="text-xs text-ink-soft">
					{item.cleared_by ? `Cleared by ${item.cleared_by}${item.cleared_on ? ` · ${dateTime(item.cleared_on)}` : ""}` : item.status === "Pending" ? "Waiting for sign-off" : ""}
				</div>
				{item.remarks ? <div className="mt-0.5 text-xs text-ink-muted">“{item.remarks}”</div> : null}
			</div>
			{canEdit ? (
				<div className="flex shrink-0 flex-wrap gap-2">
					{item.status !== "Cleared" ? (
						<Button size="sm" icon={CheckCircle2} onClick={() => setMode("Cleared")}>
							Clear
						</Button>
					) : null}
					{item.status !== "Not Cleared" ? (
						<Button size="sm" variant="secondary" onClick={() => setMode("Not Cleared")}>
							Not cleared
						</Button>
					) : null}
					{item.status !== "Pending" ? (
						<Button size="sm" variant="ghost" onClick={() => setMode("Pending")}>
							Reset
						</Button>
					) : null}
				</div>
			) : open ? (
				<span className="text-xs text-ink-soft">Signed off by {item.department}</span>
			) : null}
			<Modal
				open={Boolean(mode)}
				onClose={() => setMode(null)}
				size="sm"
				title={`${item.department}: ${mode === "Cleared" ? "clear" : mode === "Pending" ? "reset to pending" : "not cleared"}`}
				footer={
					<>
						<Button variant="secondary" onClick={() => setMode(null)}>
							Cancel
						</Button>
						<Button
							variant={mode === "Not Cleared" ? "danger" : "primary"}
							loading={act.isPending}
							onClick={() => {
								if (mode === "Not Cleared" && !notes.trim()) return
								act.mutate({ request, row: item.name, status: mode, notes: notes.trim() || undefined })
							}}
						>
							Save
						</Button>
					</>
				}
			>
				<Textarea
					label="Remarks"
					required={mode === "Not Cleared"}
					rows={3}
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					placeholder={mode === "Not Cleared" ? "What the student must settle first, for example: 2 library books outstanding" : "Optional"}
					error={mode === "Not Cleared" && !notes.trim() ? "Tell the student what is outstanding" : undefined}
				/>
			</Modal>
		</li>
	)
}

function DecisionModal({ request, decision, onClose, blocked }) {
	const [notes, setNotes] = useState("")
	const [touched, setTouched] = useState(false)
	const a = DECISIONS[decision] || {}
	const act = useAction(`${API}decide_request`, {
		invalidate: [API],
		success: (res) => `Request ${String(res.status).toLowerCase()}`,
		onSuccess: () => {
			setNotes("")
			setTouched(false)
			onClose()
		},
	})
	const missing = a.required && !notes.trim()
	return (
		<Modal
			open={Boolean(decision)}
			onClose={onClose}
			title={a.title}
			subtitle={`${request.request_type} · ${request.student_name}`}
			size="sm"
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant={a.variant === "danger" ? "danger" : "primary"}
						icon={a.icon}
						loading={act.isPending}
						disabled={blocked}
						onClick={() => {
							setTouched(true)
							if (missing) return
							act.mutate({ name: request.name, decision, notes: notes.trim() || undefined })
						}}
					>
						{a.label}
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				{decision === "Approved" && EFFECT[request.request_type] ? <Alert tone={blocked ? "warning" : "info"}>{blocked ? "Every department must clear the student first." : EFFECT[request.request_type]}</Alert> : null}
				<Textarea label="Notes" required={a.required} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={a.notes} error={touched && missing ? "A reason is required" : undefined} />
			</div>
		</Modal>
	)
}
