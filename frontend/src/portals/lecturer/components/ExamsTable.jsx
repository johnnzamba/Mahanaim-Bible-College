import { useNavigate } from "react-router-dom"
import { Activity, NotebookPen, PenLine } from "lucide-react"
import { Badge } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { dateTime } from "@/shared/utils/format"
import { StatusBadge } from "./bits"
import { score } from "./lib"

/** Exams list shared by the course workspace and the cross-course Exams page. */
export function ExamsTable({ query, rows, showCourse, empty = "No exams yet", emptyAction }) {
	const nav = useNavigate()
	return (
		<DataTable
			query={query}
			rows={rows}
			onRow={(e) => nav(`/lecturer/exams/${e.name}`)}
			empty={empty}
			emptyIcon={NotebookPen}
			emptyAction={emptyAction}
			initialSort={{ key: "start_datetime", dir: "desc" }}
			cols={[
				{
					key: "title",
					label: "Exam",
					render: (e) => (
						<div className="min-w-0">
							<div className="truncate font-semibold text-ink">{e.title}</div>
							<div className="truncate text-xs text-ink-soft">
								{showCourse ? `${e.course_title} · ` : ""}
								{e.exam_type} · {e.delivery_mode}
								{e.question_count != null ? ` · ${e.question_count} questions` : ""}
							</div>
						</div>
					),
				},
				{
					key: "start_datetime",
					label: "Window",
					render: (e) => (
						<div className="text-xs">
							<div className="text-ink">{dateTime(e.start_datetime)}</div>
							<div className="text-ink-soft">
								to {dateTime(e.end_datetime)} · {e.duration_minutes} min
							</div>
						</div>
					),
				},
				{ key: "total_marks", label: "Marks", align: "right", hideOnMobile: true, render: (e) => score(e.total_marks) },
				{
					key: "submitted_count",
					label: "Sat",
					align: "right",
					render: (e) => (
						<span className="tabular-nums">
							{e.submitted_count || 0}
							{e.attempt_count > e.submitted_count ? <span className="text-xs text-orange-600"> +{e.attempt_count - e.submitted_count} live</span> : null}
						</span>
					),
				},
				{
					key: "to_mark",
					label: "To mark",
					align: "right",
					render: (e) => (e.to_mark ? <Badge tone="purple">{e.to_mark}</Badge> : <span className="text-ink-soft">—</span>),
				},
				{ key: "status", label: "Status", render: (e) => <StatusBadge kind="exam" status={e.status} /> },
				{
					key: "go",
					label: "",
					sortable: false,
					render: (e) => (
						<div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
							{e.status === "Open" ? (
								<button type="button" className="btn btn-secondary btn-sm" onClick={() => nav(`/lecturer/exams/${e.name}/monitor`)}>
									<Activity size={14} /> Monitor
								</button>
							) : null}
							{e.to_mark ? (
								<button type="button" className="btn btn-gold btn-sm" onClick={() => nav(`/lecturer/exams/${e.name}/marking`)}>
									<PenLine size={14} /> Mark
								</button>
							) : null}
						</div>
					),
				},
			]}
		/>
	)
}
