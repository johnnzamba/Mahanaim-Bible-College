import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, ClipboardCheck, MapPin, Video } from "lucide-react"
import { Badge, Button, Card, Empty, PageHeader, Panel, ProgressBar, Select, SkeletonRows, StatCard } from "@/shared/components/ui"
import { Toolbar } from "@/shared/components/kit"
import { frappe } from "@/shared/api/frappe"
import { num, pct, siteWallClock } from "@/shared/utils/format"
import { SessionDialog } from "../components/SessionDialog"
import { CancelSessionDialog, SessionsTable } from "../components/course/AttendanceTab"
import { StatusBadge } from "../components/bits"
import { useAcross } from "../components/useAcross"
import { M, addDays, dayLabel, hm, pctTone, ymd } from "../components/lib"

function TodayCard({ s }) {
	const online = s.mode && s.mode !== "In Person"
	return (
		<div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<div className="grid h-12 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-center leading-tight text-brand-700">
					<span className="text-sm font-bold tabular-nums">{hm(s.start_time)}</span>
					<span className="text-[10px] text-ink-soft">{hm(s.end_time)}</span>
				</div>
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{s.course_title}</div>
					<div className="truncate text-sm text-ink-muted">{s.topic || "No topic set"}</div>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
						<span className="inline-flex items-center gap-1">
							{online ? <Video size={12} /> : <MapPin size={12} />}
							{online ? s.mode : s.venue || "Venue TBC"}
						</span>
						<StatusBadge kind="session" status={s.status} size="xs" />
						{s.attendance_taken ? (
							<Badge tone="green" size="xs">
								{s.present_count}/{(s.present_count || 0) + (s.absent_count || 0)} present
							</Badge>
						) : null}
					</div>
				</div>
			</div>
			{s.status !== "Cancelled" ? (
				<Link to={`/lecturer/attendance/${s.name}`} className={`btn ${s.attendance_taken ? "btn-secondary" : "btn-gold"} w-full sm:w-auto`}>
					<ClipboardCheck size={16} /> {s.attendance_taken ? "Edit roll call" : "Take attendance"}
				</Link>
			) : null}
		</div>
	)
}

export default function Attendance() {
	const q = useAcross(M.listSessions, {})
	const [when, setWhen] = useState("week")
	const [course, setCourse] = useState("")
	const [dialog, setDialog] = useState(null)
	const [cancel, setCancel] = useState(null)
	const today = ymd()
	const weekEnd = ymd(addDays(siteWallClock(), 7))
	const all = useMemo(
		() => (q.data?.data || []).slice().sort((a, b) => `${a.session_date}${hm(a.start_time)}`.localeCompare(`${b.session_date}${hm(b.start_time)}`)),
		[q.data]
	)
	const todays = all.filter((s) => s.session_date === today)
	const due = all.filter((s) => s.session_date < today && s.status === "Scheduled" && !s.attendance_taken)
	const rows = all
		.filter((s) => !course || s.course_offering === course)
		.filter((s) =>
			when === "week" ? s.session_date >= today && s.session_date <= weekEnd : when === "upcoming" ? s.session_date >= today : when === "past" ? s.session_date < today : true
		)
	if (when === "past") rows.reverse()

	const names = q.offerings.map((o) => o.name)
	const reports = useQuery({
		queryKey: [M.attendanceReport, { across: names }],
		enabled: names.length > 0,
		queryFn: async () => {
			const out = {}
			await Promise.all(names.map((offering) => frappe.call(M.attendanceReport, { offering }).then((r) => (out[offering] = r)).catch(() => null)))
			return out
		},
	})
	const lowTotal = Object.values(reports.data || {}).reduce((a, r) => a + (r.students || []).filter((s) => s.held && Number(s.percentage) < 75).length, 0)
	const held = all.filter((s) => s.status === "Held").length

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Teaching"
				title="Attendance"
				subtitle={dayLabel(today)}
				actions={
					<Button size="sm" icon={CalendarPlus} onClick={() => setDialog({})}>
						New session
					</Button>
				}
			/>

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
				<StatCard label="Today" value={num(todays.length)} icon={CalendarClock} hint={todays.length ? `${todays.filter((s) => s.attendance_taken).length} taken` : "No classes"} loading={q.isLoading} />
				<StatCard label="Roll call overdue" value={num(due.length)} tone={due.length ? "orange" : undefined} icon={ClipboardCheck} loading={q.isLoading} />
				<StatCard label="Sessions held" value={num(held)} tone="green" icon={CheckCircle2} loading={q.isLoading} />
				<StatCard label="Below 75%" value={num(lowTotal)} tone={lowTotal ? "red" : undefined} icon={AlertTriangle} hint="students, all courses" loading={reports.isLoading} />
			</div>

			<section aria-labelledby="today-h" className="space-y-3">
				<h2 id="today-h" className="font-display text-lg font-semibold text-ink">
					Today's classes
				</h2>
				{q.isLoading ? (
					<Card className="p-5">
						<SkeletonRows rows={2} />
					</Card>
				) : todays.length ? (
					<div className="grid gap-3 xl:grid-cols-2">
						{todays.map((s) => (
							<TodayCard key={s.name} s={s} />
						))}
					</div>
				) : (
					<Card>
						<Empty compact icon={CalendarClock} title="No classes today" subtitle="Sessions you schedule appear here on the day, ready for roll call." />
					</Card>
				)}
			</section>

			{due.length ? (
				<Panel title={`Roll call overdue (${due.length})`} subtitle="Past sessions with no attendance recorded" icon={AlertTriangle} bodyClass="p-0">
					<SessionsTable rows={due} showCourse onEdit={setDialog} onCancel={setCancel} />
				</Panel>
			) : null}

			<div className="grid gap-6 xl:grid-cols-3">
				<div className="space-y-3 xl:col-span-2">
					<h2 className="font-display text-lg font-semibold text-ink">Sessions</h2>
					<Toolbar
						chips={[
							{ id: "week", label: "Next 7 days" },
							{ id: "upcoming", label: "Upcoming" },
							{ id: "past", label: "Past" },
							{ id: "all", label: "All" },
						]}
						active={when}
						onChip={setWhen}
						right={
							<Select
								aria-label="Course"
								className="w-full sm:w-56"
								value={course}
								onChange={(e) => setCourse(e.target.value)}
								placeholder="All courses"
								options={q.offerings.map((o) => ({ value: o.name, label: `${o.course} · ${o.course_title}` }))}
							/>
						}
					/>
					<SessionsTable
						query={q}
						rows={q.isSuccess ? rows : undefined}
						showCourse
						onEdit={setDialog}
						onCancel={setCancel}
						empty={when === "past" ? "No past sessions" : "Nothing scheduled. Use New session to add a class or a weekly series."}
					/>
				</div>
				<Panel title="Class attendance" subtitle="Present or late, excluding excused">
					{reports.isLoading ? (
						<SkeletonRows rows={3} />
					) : q.offerings.length ? (
						<ul className="space-y-4">
							{q.offerings.map((o) => {
								const r = reports.data?.[o.name]
								const low = (r?.students || []).filter((s) => s.held && Number(s.percentage) < 75).length
								return (
									<li key={o.name}>
										<Link to={`/lecturer/courses/${o.name}?tab=attendance`} className="group block">
											<div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
												<span className="truncate font-semibold text-ink group-hover:underline">{o.course_title}</span>
												<span className="shrink-0 tabular-nums text-ink-muted">{r?.held ? pct(r.average_percentage) : "—"}</span>
											</div>
											<ProgressBar value={r?.held ? Number(r.average_percentage) : 0} tone={r?.held ? pctTone(r.average_percentage) : "gray"} size="sm" />
											<div className="mt-1 text-[11px] text-ink-soft">
												{r ? `${r.held} held` : "No report"}
												{low ? <span className="font-semibold text-red-700 dark:text-red-300"> · {low} below 75%</span> : null}
											</div>
										</Link>
									</li>
								)
							})}
						</ul>
					) : (
						<p className="text-sm text-ink-soft">No courses this term.</p>
					)}
				</Panel>
			</div>

			<SessionDialog open={Boolean(dialog)} onClose={() => setDialog(null)} offering={dialog?.course_offering || (q.offerings.length === 1 ? q.offerings[0].name : undefined)} session={dialog?.name ? dialog : null} />
			<CancelSessionDialog session={cancel} onClose={() => setCancel(null)} />
		</div>
	)
}
