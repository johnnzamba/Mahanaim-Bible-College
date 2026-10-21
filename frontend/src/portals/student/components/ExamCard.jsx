import { Link } from "react-router-dom"
import clsx from "clsx"
import { AlertTriangle, Clock, KeyRound, MapPin, Monitor, NotebookPen, Timer } from "lucide-react"
import { Badge } from "@/shared/components/ui"
import { dateTime } from "@/shared/utils/format"
import { humanSpan, msUntil } from "./lib"
import { GOLD_BTN, IconChip, examTone, useTick } from "./bits"

/** Exam summary card used on the exams list, dashboard and course home. */
export function ExamCard({ exam: e, className }) {
	useTick(30000)
	const to = `/student/exams/${encodeURIComponent(e.name)}`
	const released = (e.attempts || []).filter((a) => a.status === "Released")
	const last = released[released.length - 1]
	const opensIn = e.status === "Scheduled" ? msUntil(e.start_datetime) : null
	const closesIn = e.status === "Open" ? msUntil(e.end_datetime) : null
	return (
		<div className={clsx("card flex flex-col gap-3 p-4 sm:flex-row sm:items-center", className)}>
			<Link to={to} className="flex min-w-0 flex-1 items-start gap-3">
				<IconChip icon={NotebookPen} tone={e.status === "Open" ? "green" : e.status === "Scheduled" ? "blue" : "gray"} size={40} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="truncate font-semibold text-ink">{e.title}</span>
						<Badge tone="gray" size="xs">{e.exam_type}</Badge>
						{e.requires_access_code ? (
							<Badge tone="purple" size="xs">
								<KeyRound size={10} /> Code
							</Badge>
						) : null}
					</div>
					<div className="truncate text-xs text-ink-soft">{e.course_title}</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
						<span className="inline-flex items-center gap-1">
							<Clock size={12} /> {dateTime(e.start_datetime)}
						</span>
						<span className="inline-flex items-center gap-1">
							<Timer size={12} /> {e.duration_minutes} min
						</span>
						<span className="inline-flex items-center gap-1">
							{e.delivery_mode === "Online" ? <Monitor size={12} /> : <MapPin size={12} />}
							{e.delivery_mode === "Online" ? "Online" : e.venue || e.delivery_mode}
						</span>
						<span>
							Attempts {e.attempts_used}/{Math.max(1, Number(e.max_attempts || 1))}
						</span>
					</div>
					{e.status === "Open" && !e.can_start && e.reasons?.length ? (
						<p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
							<AlertTriangle size={13} className="mt-px shrink-0" /> <span className="line-clamp-2">{e.reasons[0]}</span>
						</p>
					) : null}
				</div>
			</Link>
			<div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
				{e.in_progress_attempt ? (
					<Badge tone="orange" dot>In progress</Badge>
				) : e.best_percentage != null ? (
					<Badge tone={Number(e.best_percentage) >= 50 ? "green" : "red"}>Best {Math.round(e.best_percentage)}%</Badge>
				) : (
					<Badge tone={examTone(e.status)} dot>
						{e.status === "Scheduled" && opensIn > 0 ? `Opens in ${humanSpan(opensIn)}` : e.status === "Open" && closesIn > 0 ? `Closes in ${humanSpan(closesIn)}` : e.status}
					</Badge>
				)}
				{e.in_progress_attempt ? (
					<Link to={to} className={`${GOLD_BTN} btn-sm`}>
						Resume
					</Link>
				) : e.status === "Open" && e.can_start ? (
					<Link to={to} className="btn btn-primary btn-sm">
						{e.attempts_used ? "Retake" : "Start"}
					</Link>
				) : last ? (
					<Link to={`/student/exams/result/${encodeURIComponent(last.name)}`} className="btn btn-secondary btn-sm">
						View result
					</Link>
				) : (
					<Link to={to} className="btn btn-ghost btn-sm">
						Details
					</Link>
				)}
			</div>
		</div>
	)
}
