import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { AlertTriangle, BookOpen, CheckCircle2, ExternalLink, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { DataTable } from "@/shared/components/kit"
import { Alert, Avatar, Badge, Button, ErrorState, InfoRow, Modal, PageHeader, Panel, ProgressBar, SkeletonRows, Switch, Textarea } from "@/shared/components/ui"
import { date, dateTime, num } from "@/shared/utils/format"
import { API, FLAT, CAN, NoAccess, STUDENTS_FORBIDDEN, StudentStatus, isPermissionError } from "../lib"

/** /admin/students/registrations/:name */
export default function RegistrationDetail() {
	const { name } = useParams()
	const { hasRole } = useSession()
	const q = useApi(`${API}get_registration`, { name }, { enabled: hasRole(...CAN.read) })
	const back = { to: "/admin/students/registrations", label: "Registrations" }
	if (!hasRole(...CAN.read) || isPermissionError(q.error)) return <><PageHeader title="Registration" back={back} /><NoAccess message={STUDENTS_FORBIDDEN} /></>
	if (q.isLoading) return <><PageHeader title="Loading registration…" back={back} /><Panel><SkeletonRows rows={6} /></Panel></>
	if (q.isError) return <><PageHeader title="Registration" back={back} /><Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel></>
	return <View reg={q.data} back={back} />
}

function View({ reg, back }) {
	const { hasRole, roles } = useSession()
	const canDecide = hasRole(...CAN.write) && reg.status === "Submitted"
	const [approveOpen, setApproveOpen] = useState(false)
	const [rejectOpen, setRejectOpen] = useState(false)
	const st = reg.student_info || {}
	const missing = reg.missing_prerequisites || {}
	const missingCount = Object.keys(missing).length
	const active = (reg.courses || []).filter((c) => c.status !== "Dropped")
	const credits = Number(reg.total_credits || 0)
	const max = Number(reg.max_credits || 0)
	const overLimit = max > 0 && credits > max
	const fee = reg.fee_clearance

	const offerings = useApi("mahanaim.api.academics.list_offerings", { term: reg.academic_term, page_length: 200 }, { enabled: Boolean(reg.academic_term) && canDecide, staleTime: 30_000 })
	const seats = useMemo(() => Object.fromEntries((offerings.data?.data || []).map((o) => [o.name, o])), [offerings.data])
	const full = active.filter((c) => {
		const o = seats[c.course_offering]
		return o && Number(o.capacity) > 0 && Number(o.enrolled_count) >= Number(o.capacity)
	})
	const academics = canAccess(roles, "/academics")

	const cols = [
		{
			key: "course",
			label: "Course",
			render: (c) => (
				<div className="min-w-0">
					<div className="flex items-center gap-1.5 font-semibold">
						{c.course}
						{missing[c.course] ? <AlertTriangle size={13} className="text-amber-600" aria-label="Missing prerequisites" /> : null}
					</div>
					<div className="truncate text-xs text-ink-soft">{c.course_title}</div>
					{missing[c.course] ? <div className="text-xs text-amber-700">Needs {missing[c.course].map((p) => p.course).join(", ")}</div> : null}
				</div>
			),
		},
		{ key: "course_type", label: "Type", hideOnMobile: true, render: (c) => c.course_type || "—" },
		{
			key: "course_offering",
			label: "Offering",
			hideOnMobile: true,
			render: (c) => {
				const o = seats[c.course_offering]
				const label = academics ? (
					<Link to={`/admin/academics/offerings/${encodeURIComponent(c.course_offering)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
						{c.course_offering}
					</Link>
				) : (
					c.course_offering
				)
				return (
					<div className="text-xs">
						<div>{label}</div>
						{o && Number(o.capacity) > 0 ? (
							<div className={Number(o.enrolled_count) >= Number(o.capacity) ? "font-semibold text-red-600" : "text-ink-soft"}>
								{num(o.enrolled_count)} / {num(o.capacity)} seats
							</div>
						) : null}
					</div>
				)
			},
		},
		{ key: "credits", label: "Credits", align: "right", render: (c) => num(c.credits || 0) },
		{ key: "status", label: "Status", render: (c) => <Badge status={c.status} size="xs" /> },
	]

	return (
		<>
			<PageHeader
				back={back}
				eyebrow={`${reg.name} · ${reg.term_label || reg.academic_term}`}
				title={reg.student_name}
				subtitle={`Semester registration for ${reg.term_label || reg.academic_term}`}
				actions={
					<>
						<Badge status={reg.status} size="md" />
						{canDecide ? (
							<>
								<Button variant="danger" size="sm" icon={XCircle} onClick={() => setRejectOpen(true)}>
									Reject
								</Button>
								<Button size="sm" icon={CheckCircle2} onClick={() => setApproveOpen(true)}>
									Approve
								</Button>
							</>
						) : null}
					</>
				}
			/>

			<div className="mb-5 space-y-3">
				{reg.status === "Rejected" && reg.remarks ? <Alert tone="error" title="Rejected">{reg.remarks}</Alert> : null}
				{reg.status === "Submitted" && missingCount ? (
					<Alert tone="warning" title={`Prerequisites not met for ${missingCount} course${missingCount === 1 ? "" : "s"}`}>
						{Object.entries(missing).map(([course, rows]) => (
							<div key={course}>
								<b>{course}</b> needs {rows.map((r) => `${r.course}${r.title ? ` (${r.title})` : ""}`).join(", ")}.
							</div>
						))}
					</Alert>
				) : null}
				{reg.status === "Submitted" && overLimit ? (
					<Alert tone="warning" title="Over the credit limit">
						{num(credits)} credits selected; the maximum per term is {num(max)}.
					</Alert>
				) : null}
				{reg.status === "Submitted" && full.length ? (
					<Alert tone="warning" title="Course full">
						{full.map((c) => c.course).join(", ")} {full.length === 1 ? "has" : "have"} no seats left.
					</Alert>
				) : null}
				{fee && fee.cleared === false ? (
					<Alert tone="info" title="Fee arrears">
						{fee.message}
					</Alert>
				) : null}
			</div>

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-5 lg:col-span-2">
					<Panel title="Courses" subtitle={`${num(active.length)} course${active.length === 1 ? "" : "s"} registered`} bodyClass="p-0" icon={BookOpen}>
						<DataTable className={FLAT} cols={cols} rows={reg.courses || []} empty="No courses selected" rowKey={(c) => c.name || c.course_offering} noCards={false} />
					</Panel>
					<Panel title="Credit load">
						<ProgressBar value={max ? (credits / max) * 100 : 0} tone={overLimit ? "red" : credits / (max || 1) > 0.85 ? "orange" : "brand"} label={`${num(credits)} of ${num(max)} credits`} />
						<p className="mt-2 text-xs text-ink-soft">The maximum credit load per term is set in college settings.</p>
					</Panel>
				</div>
				<aside className="min-w-0 space-y-5">
					<Panel title="Student">
						<div className="mb-3 flex items-center gap-3">
							<Avatar name={st.full_name || reg.student_name} src={st.photo || undefined} size={48} />
							<div className="min-w-0">
								<Link to={`/admin/students/${encodeURIComponent(reg.student)}`} className="block truncate font-semibold text-brand-700 hover:underline">
									{st.full_name || reg.student_name}
								</Link>
								<div className="text-xs text-ink-soft">{st.student_number || reg.student}</div>
							</div>
						</div>
						<div className="space-y-1">
							<InfoRow label="Status" value={<StudentStatus status={st.status} />} />
							<InfoRow label="Programme" value={st.programme_name || reg.programme} />
							<InfoRow label="Campus" value={reg.campus} />
							<InfoRow label="Study mode" value={reg.study_mode} />
							<InfoRow label="Year" value={reg.year_of_study} />
						</div>
					</Panel>
					<Panel title="Registration">
						<div className="space-y-1">
							<InfoRow label="Term" value={reg.term_label || reg.academic_term} />
							<InfoRow label="Created" value={reg.creation ? dateTime(reg.creation) : null} />
							<InfoRow label="Last updated" value={reg.modified ? dateTime(reg.modified) : null} />
							<InfoRow label="Approved by" value={reg.approved_by} />
							<InfoRow label="Approved on" value={reg.approved_on ? date(reg.approved_on) : null} />
							<InfoRow
								label="Fee invoice"
								value={
									reg.fee_invoice ? (
										canAccess(roles, "/finance") ? (
											<Link to={`/admin/finance/invoices/${encodeURIComponent(reg.fee_invoice)}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
												{reg.fee_invoice} <ExternalLink size={12} />
											</Link>
										) : (
											reg.fee_invoice
										)
									) : null
								}
							/>
							{fee ? <InfoRow label="Fee clearance" value={fee.cleared ? <Badge tone="green">Cleared</Badge> : <Badge tone="orange">Arrears</Badge>} /> : null}
						</div>
					</Panel>
				</aside>
			</div>

			{canDecide ? (
				<>
					<ApproveModal open={approveOpen} onClose={() => setApproveOpen(false)} reg={reg} issues={{ prerequisites: missingCount > 0, credits: overLimit, capacity: full.length > 0 }} />
					<RejectModal open={rejectOpen} onClose={() => setRejectOpen(false)} reg={reg} />
				</>
			) : null}
		</>
	)
}

function ApproveModal({ open, onClose, reg, issues }) {
	const [o, setO] = useState({ capacity: false, prerequisites: false, credits: false })
	const act = useAction(`${API}approve_registration`, { invalidate: [API, "mahanaim.api.academics.list_offerings"], success: "Registration approved and the student enrolled", onSuccess: onClose })
	const needed = Object.entries(issues).filter(([k, v]) => v && !o[k])
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Approve registration"
			subtitle={`${reg.student_name} · ${reg.term_label || reg.academic_term}`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						icon={CheckCircle2}
						loading={act.isPending}
						onClick={() =>
							act.mutate({
								name: reg.name,
								ignore_capacity: o.capacity ? 1 : 0,
								ignore_prerequisites: o.prerequisites ? 1 : 0,
								ignore_credit_limit: o.credits ? 1 : 0,
							})
						}
					>
						Approve
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<p className="text-sm text-ink-muted">The student is enrolled on {reg.courses?.filter((c) => c.status !== "Dropped").length || 0} course(s) and notified. Use an override only when the rule should not apply to this student.</p>
				<div className="divide-y divide-line rounded-xl border border-line">
					<Switch className="p-3" label="Ignore course capacity" description={issues.capacity ? "One or more courses are full." : "Enrol even if a course is full."} checked={o.capacity} onChange={(v) => setO((p) => ({ ...p, capacity: v }))} />
					<Switch className="p-3" label="Ignore prerequisites" description={issues.prerequisites ? "Some prerequisites are not passed." : "Allow courses whose prerequisites are not passed."} checked={o.prerequisites} onChange={(v) => setO((p) => ({ ...p, prerequisites: v }))} />
					<Switch className="p-3" label="Ignore credit limit" description={issues.credits ? "The credit load is over the limit." : "Allow more credits than the term maximum."} checked={o.credits} onChange={(v) => setO((p) => ({ ...p, credits: v }))} />
				</div>
				{needed.length ? (
					<Alert tone="warning">
						Approval will fail unless you override: {needed.map(([k]) => ({ capacity: "course capacity", prerequisites: "prerequisites", credits: "credit limit" })[k]).join(", ")}.
					</Alert>
				) : null}
			</div>
		</Modal>
	)
}

function RejectModal({ open, onClose, reg }) {
	const [reason, setReason] = useState("")
	const [err, setErr] = useState("")
	const act = useAction(`${API}reject_registration`, { invalidate: [API], success: "Registration rejected. The student has been notified.", onSuccess: onClose })
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Reject registration"
			subtitle={`${reg.student_name} · ${reg.term_label || reg.academic_term}`}
			size="sm"
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="danger"
						loading={act.isPending}
						onClick={() => {
							if (!reason.trim()) return setErr("Give the student a reason so they can fix and resubmit")
							act.mutate({ name: reg.name, reason: reason.trim() })
						}}
					>
						Reject
					</Button>
				</>
			}
		>
			<Textarea
				label="Reason"
				required
				rows={4}
				value={reason}
				error={err}
				onChange={(e) => {
					setReason(e.target.value)
					setErr("")
				}}
				placeholder="For example: BIB201 needs BIB101 first. Please replace it with an elective."
				hint="Sent to the student by email and in the portal."
			/>
		</Modal>
	)
}
