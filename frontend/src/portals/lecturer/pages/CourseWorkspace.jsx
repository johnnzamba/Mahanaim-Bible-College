import { Suspense, lazy, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { CalendarPlus, Download, ExternalLink, MessageSquare } from "lucide-react"
import { Badge, Button, Card, ErrorState, Loading, PageHeader, Tabs } from "@/shared/components/ui"
import { useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { MessageClassModal } from "../components/MessageClassModal"
import { SessionDialog } from "../components/SessionDialog"
import { StatusBadge } from "../components/bits"
import { safeUrl } from "@/shared/utils/sanitize"
import { M, download } from "../components/lib"

const OverviewTab = lazy(() => import("../components/course/OverviewTab"))
const ContentTab = lazy(() => import("../components/course/ContentTab"))
const AssignmentsTab = lazy(() => import("../components/course/AssignmentsTab"))
const ExamsTab = lazy(() => import("../components/course/ExamsTab"))
const AttendanceTab = lazy(() => import("../components/course/AttendanceTab"))
const GradebookTab = lazy(() => import("../components/course/GradebookTab"))
const StudentsTab = lazy(() => import("../components/course/StudentsTab"))

const TABS = {
	overview: OverviewTab,
	content: ContentTab,
	assignments: AssignmentsTab,
	exams: ExamsTab,
	attendance: AttendanceTab,
	gradebook: GradebookTab,
	students: StudentsTab,
}

export default function CourseWorkspace() {
	const { offering } = useParams()
	const [params, setParams] = useSearchParams()
	const tab = TABS[params.get("tab")] ? params.get("tab") : "overview"
	const [message, setMessage] = useState(false)
	const [newSession, setNewSession] = useState(false)
	const q = useApi(M.overview, { offering })
	const d = q.data
	const o = d?.offering
	const setTab = (t) => setParams(t === "overview" ? {} : { tab: t }, { replace: true })
	const Tab = TABS[tab]

	if (q.isError) {
		return (
			<div className="space-y-6">
				<PageHeader title="Course" back={{ to: "/lecturer/courses", label: "My courses" }} />
				<Card>
					<ErrorState error={q.error} onRetry={() => q.refetch()} title={q.error?.status === 403 ? "You don't teach this course" : "Couldn't load this course"} />
				</Card>
			</div>
		)
	}

	const counts = o?.counts || {}
	const toGrade = (d?.to_grade?.submissions || 0) + (d?.to_grade?.essay_answers || 0)

	return (
		<div className="space-y-6">
			<PageHeader
				back={{ to: "/lecturer/courses", label: "My courses" }}
				eyebrow={o ? `${o.course} · ${o.academic_term}` : "Course"}
				title={o?.course_title || "Loading course…"}
				subtitle={
					o ? (
						<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
							<span>
								{o.campus} · {o.study_mode}
								{o.section && o.section !== "A" ? ` · Section ${o.section}` : ""} · {o.credits} credits
							</span>
							<StatusBadge kind="sheet" status={d?.mark_sheet?.status || "Not Started"} size="xs">
								Marks: {d?.mark_sheet?.status || "Not started"}
							</StatusBadge>
							{o.lecturers?.length > 1 ? (
								<Badge tone="gray" size="xs">
									Co-taught: {o.lecturers.map((l) => l.staff_name).join(", ")}
								</Badge>
							) : null}
						</span>
					) : null
				}
				actions={
					o ? (
						<>
							{safeUrl(o.lms_url) ? (
								<a href={safeUrl(o.lms_url)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
									<ExternalLink size={14} /> LMS
								</a>
							) : null}
							<Button size="sm" variant="secondary" icon={Download} onClick={() => download(frappe.downloadUrl(M.rosterCsv, { offering }))}>
								Roster
							</Button>
							<Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setNewSession(true)}>
								Session
							</Button>
							<Button size="sm" icon={MessageSquare} onClick={() => setMessage(true)}>
								Message class
							</Button>
						</>
					) : null
				}
			/>

			<Tabs
				className="overflow-y-hidden pb-px"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "overview", label: "Overview" },
					{ id: "content", label: "Content", count: o ? counts.modules || 0 : undefined },
					{ id: "assignments", label: "Assignments", count: o ? counts.assignments || 0 : undefined },
					{ id: "exams", label: "Exams", count: o ? counts.exams || 0 : undefined },
					{ id: "attendance", label: "Attendance", count: d?.sessions?.attendance_due?.length || undefined },
					{ id: "gradebook", label: "Gradebook" },
					{ id: "students", label: "Students", count: d ? d.roster?.length || 0 : undefined },
				]}
			/>
			{toGrade && tab === "overview" ? (
				<div className="-mt-3 flex flex-wrap gap-2 text-xs">
					{d.to_grade.submissions ? (
						<button type="button" className="chip" onClick={() => setTab("assignments")}>
							{d.to_grade.submissions} submission{d.to_grade.submissions === 1 ? "" : "s"} to grade
						</button>
					) : null}
					{d.to_grade.essay_answers ? (
						<button type="button" className="chip" onClick={() => setTab("exams")}>
							{d.to_grade.essay_answers} exam answer{d.to_grade.essay_answers === 1 ? "" : "s"} to mark
						</button>
					) : null}
				</div>
			) : null}

			{q.isLoading ? (
				<Loading className="min-h-[30vh]" />
			) : (
				<Suspense fallback={<Loading className="min-h-[30vh]" />}>
					<Tab offering={offering} data={d} onTab={setTab} />
				</Suspense>
			)}

			<MessageClassModal open={message} onClose={() => setMessage(false)} offering={offering} title={o ? `${o.course} · ${o.course_title}` : ""} />
			<SessionDialog open={newSession} onClose={() => setNewSession(false)} offering={offering} />
		</div>
	)
}
