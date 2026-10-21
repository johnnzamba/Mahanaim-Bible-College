import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { CheckCircle2, ClipboardList, ExternalLink, Send, Undo2 } from "lucide-react"
import { Alert, Avatar, Badge, Button, ConfirmDialog, ErrorState, Modal, PageHeader, Panel, Skeleton, SkeletonRows, Textarea } from "@/shared/components/ui"
import { PersonRow, Timeline } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { dateTime } from "@/shared/utils/format"
import { useSession } from "@/shared/session"
import { ACAD, BASE, RESULTS, useAcademicRoles } from "../lib"
import { Facts, SheetBadge } from "../components/common"
import { EntriesTable, GradePanel, SheetKpis, WeightsPanel } from "../components/MarkSheetView"

const BUCKET = { cat: "CAT", assignment: "Assignment", exam: "Exam", other: "Other" }

/** sheet_dict carries user ids only: name lecturers and the signed-in user, show anyone else by id. */
function who(user, lecturers, me) {
	if (!user) return null
	if (me?.user === user) return `${me.full_name || user} (you)`
	const l = lecturers.find((x) => x.user === user)
	return l ? l.staff_name : user
}

function steps(s, me) {
	const lect = s.lecturers || []
	const at = (d) => (d ? dateTime(d) : null)
	const order = ["Draft", "Submitted", "Approved", "Published"]
	const reached = order.indexOf(s.status)
	const out = [{ label: "Prepared by the lecturer", status: "done", note: `${s.student_count || 0} students on the sheet` }]
	if (s.status === "Returned") {
		out.push({ label: "Submitted", status: s.submitted_on ? "done" : "upcoming", date: s.submitted_on ? `${at(s.submitted_on)} · ${who(s.submitted_by, lect, me)}` : null })
		out.push({ label: "Returned to the lecturer", status: "failed", note: s.return_reason })
		out.push({ label: "Resubmission", status: "current", note: "Waiting for the lecturer to fix and resubmit" })
		out.push({ label: "Approved by the Academic Dean", status: "upcoming" })
		out.push({ label: "Published by the Registrar", status: "upcoming" })
		return out
	}
	const mark = (i) => (reached >= i ? "done" : reached === i - 1 ? "current" : "upcoming")
	out.push({
		label: reached >= 1 ? "Submitted for approval" : "Waiting for the lecturer to submit",
		status: mark(1),
		date: s.submitted_on ? `${at(s.submitted_on)} · ${who(s.submitted_by, lect, me)}` : null,
	})
	out.push({
		label: reached >= 2 ? "Approved by the Academic Dean" : "Academic Dean approval",
		status: mark(2),
		date: reached >= 2 && s.approved_on ? `${at(s.approved_on)} · ${who(s.approved_by, lect, me)}` : null,
	})
	out.push({
		label: reached >= 3 ? "Published to students" : "Registrar publishes",
		status: mark(3),
		date: reached >= 3 && s.published_on ? `${at(s.published_on)}${s.published_by ? ` · ${who(s.published_by, lect, me)}` : ""}` : null,
		note: reached >= 3 ? "Course results created, transcripts and standing updated, students notified." : null,
	})
	if (s.return_reason && reached >= 1) out.splice(2, 0, { label: "Returned earlier", status: "done", note: s.return_reason })
	return out
}

export default function MarkSheetDetail() {
	const { name } = useParams()
	const roles = useAcademicRoles()
	const session = useSession()
	const q = useApi(`${RESULTS}get_mark_sheet_by_name`, { name })
	const [confirm, setConfirm] = useState(null)
	const [remarks, setRemarks] = useState("")
	const [touched, setTouched] = useState(false)
	const opts = (msg) => ({ invalidate: [RESULTS, `${ACAD}academics_stats`, `${ACAD}list_offerings`, `${ACAD}get_offering`], success: msg, onSuccess: () => setConfirm(null) })
	const approve = useAction(`${RESULTS}approve_mark_sheet`, opts("Mark sheet approved; the Registrar can publish it now"))
	const publish = useAction(`${RESULTS}publish_mark_sheet`, opts("Results published to students"))
	const ret = useAction(`${RESULTS}return_mark_sheet`, opts("Mark sheet returned to the lecturer"))

	if (q.isLoading)
		return (
			<div className="space-y-4">
				<Skeleton className="h-16 w-2/3" />
				<SkeletonRows rows={8} />
			</div>
		)
	if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} title="Couldn't load this mark sheet" />
	const s = q.data
	const a = s.actions || {}
	const canApprove = a.can_approve && roles.dean
	const canPublish = a.can_publish && roles.registrar
	const canReturn = a.can_return && roles.admin
	const pending = (s.entries || []).filter((e) => e.pending_components?.length).length
	const offeringLink = `${BASE}/offerings/${encodeURIComponent(s.course_offering)}`

	return (
		<div>
			<PageHeader
				eyebrow="Mark sheet"
				title={s.course_title}
				back={{ to: `${BASE}/mark-sheets`, label: "Mark sheets" }}
				actions={
					<>
						{canReturn ? (
							<Button
								variant="secondary"
								icon={Undo2}
								onClick={() => {
									setRemarks("")
									setTouched(false)
									setConfirm("return")
								}}
							>
								Return
							</Button>
						) : null}
						{canApprove ? (
							<Button icon={CheckCircle2} onClick={() => setConfirm("approve")}>
								Approve
							</Button>
						) : null}
						{canPublish ? (
							<Button variant="gold" icon={Send} onClick={() => setConfirm("publish")}>
								Publish results
							</Button>
						) : null}
					</>
				}
			>
				<Facts
					items={[
						{ label: "Status", value: <SheetBadge status={s.status} /> },
						{ label: "Offering", value: <Link className="font-semibold text-brand-700 hover:underline" to={offeringLink}>{s.course_offering}</Link> },
						{ label: "Term", value: s.academic_term },
						{ label: "Campus", value: s.campus },
					]}
				/>
			</PageHeader>

			{s.status === "Submitted" && !canApprove ? <Alert className="mb-4" title="Waiting for the Academic Dean">The Dean approves submitted mark sheets before the Registrar can publish them.</Alert> : null}
			{s.status === "Approved" && !canPublish ? <Alert className="mb-4" title="Approved, waiting for the Registrar">Only the Registrar publishes results to students.</Alert> : null}
			{s.status === "Returned" ? (
				<Alert tone="warning" className="mb-4" title="Returned to the lecturer">
					{s.return_reason}
				</Alert>
			) : null}
			{s.status === "Draft" ? <Alert className="mb-4" title="Still with the lecturer">The lecturer is entering marks; it appears in your queue once submitted.</Alert> : null}
			{pending && ["Submitted", "Approved"].includes(s.status) ? (
				<Alert tone="warning" className="mb-4" title={`${pending} student${pending === 1 ? " has" : "s have"} unmarked work`}>
					They will get grade I (Incomplete) if this sheet is published as it is.
				</Alert>
			) : null}

			<SheetKpis sheet={s} />

			<div className="mt-5 grid items-start gap-5 xl:grid-cols-[1fr_20rem]">
				<Panel title="Entries" subtitle="Weighted points per component" icon={ClipboardList} bodyClass="p-3 sm:p-4">
					<EntriesTable sheet={s} />
				</Panel>
				<div className="space-y-5">
					<Panel title="Workflow">
						<Timeline steps={steps(s, session)} />
					</Panel>
					<GradePanel sheet={s} />
					<WeightsPanel sheet={s} />
					<Panel title="Lecturers">
						{s.lecturers?.length ? (
							<div className="-my-2 divide-y divide-line">
								{s.lecturers.map((l) => (
									<PersonRow key={l.staff_member} name={l.staff_name} sub={l.role} Avatar={Avatar} />
								))}
							</div>
						) : (
							<p className="text-sm text-ink-soft">No lecturer assigned.</p>
						)}
					</Panel>
					<Panel title="Counted assessments" subtitle="Exams and assignments that feed this sheet">
						{s.assessments?.length ? (
							<ul className="space-y-2 text-sm">
								{s.assessments.map((x) => (
									<li key={x.name} className="flex items-center justify-between gap-2">
										{x.kind === "exam" ? (
											<Link to={`${BASE}/exams/${encodeURIComponent(x.name)}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
												{x.title}
											</Link>
										) : (
											<span className="min-w-0 truncate font-medium text-ink">{x.title}</span>
										)}
										<span className="flex shrink-0 items-center gap-1.5">
											<Badge tone="gray" size="xs">
												{BUCKET[x.bucket] || x.bucket}
											</Badge>
											<Badge status={x.status} size="xs" />
										</span>
									</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-ink-soft">None yet.</p>
						)}
						<Link to={`${offeringLink}?tab=assessments`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
							Offering assessments <ExternalLink size={12} />
						</Link>
					</Panel>
				</div>
			</div>

			<ConfirmDialog
				open={confirm === "approve"}
				title="Approve this mark sheet?"
				message={`${s.course_title}: ${s.student_count} students, ${s.pass_count} passing. The Registrar can then publish it.`}
				confirmLabel="Approve"
				loading={approve.isPending}
				onConfirm={() => approve.mutate({ name })}
				onClose={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm === "publish"}
				title="Publish these results?"
				message={`${s.student_count} students will see their grades for ${s.course_title}. Course results and transcripts are updated and students are notified. This can't be undone here.`}
				confirmLabel="Publish"
				loading={publish.isPending}
				onConfirm={() => publish.mutate({ name })}
				onClose={() => setConfirm(null)}
			>
				{pending ? (
					<Alert tone="warning" className="mt-3">
						{pending} student{pending === 1 ? "" : "s"} will be published as Incomplete.
					</Alert>
				) : null}
			</ConfirmDialog>
			<Modal
				open={confirm === "return"}
				onClose={() => setConfirm(null)}
				title="Return to the lecturer"
				subtitle="The lecturer can edit and resubmit. Say what needs fixing."
				footer={
					<>
						<Button variant="secondary" onClick={() => setConfirm(null)}>
							Cancel
						</Button>
						<Button
							variant="danger"
							icon={Undo2}
							loading={ret.isPending}
							onClick={() => {
								setTouched(true)
								if (remarks.trim()) ret.mutate({ name, remarks: remarks.trim() })
							}}
						>
							Return mark sheet
						</Button>
					</>
				}
			>
				<Textarea label="Remarks" required rows={4} value={remarks} onChange={(e) => setRemarks(e.target.value)} error={touched && !remarks.trim() ? "Give the reason for returning it" : undefined} placeholder="e.g. CAT 2 marks are missing for three students." autoFocus />
			</Modal>
		</div>
	)
}
