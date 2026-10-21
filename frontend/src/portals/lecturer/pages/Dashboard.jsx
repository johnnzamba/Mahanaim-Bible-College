import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
	AlarmClock,
	BookOpen,
	CalendarClock,
	CalendarPlus,
	ChevronRight,
	ClipboardCheck,
	FileCheck2,
	MapPin,
	NotebookPen,
	PenLine,
	Sheet,
	Users,
	Video,
} from "lucide-react"
import { Alert, Badge, Button, Empty, PageHeader, Panel, QueryState, Skeleton, StatCard } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { dateTime, greeting, num, siteWallClock } from "@/shared/utils/format"
import { StatusBadge } from "../components/bits"
import { SessionDialog } from "../components/SessionDialog"
import { useAcross } from "../components/useAcross"
import { M, dayLabel, hm, isPast, ymd } from "../components/lib"

const SHEET_ORDER = ["Not Started", "Draft", "Returned", "Submitted", "Approved", "Published"]

function SessionRow({ s, due }) {
	const today = s.session_date === ymd()
	return (
		<li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
			<div className="w-16 shrink-0 text-center">
				<div className="text-sm font-bold tabular-nums text-ink">{hm(s.start_time)}</div>
				<div className="text-[11px] text-ink-soft">{s.end_time ? hm(s.end_time) : ""}</div>
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate font-semibold text-ink">{s.course_title}</div>
				<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
					{s.topic ? <span className="truncate">{s.topic}</span> : null}
					{s.venue ? (
						<span className="inline-flex items-center gap-1">
							<MapPin size={12} /> {s.venue}
						</span>
					) : null}
					{s.mode && s.mode !== "In Person" ? (
						<span className="inline-flex items-center gap-1">
							<Video size={12} /> {s.mode}
						</span>
					) : null}
					{!today ? <span>{dayLabel(s.session_date)}</span> : null}
				</div>
			</div>
			{due ? (
				<Link to={`/lecturer/attendance/${s.name}`} className="btn btn-gold btn-sm w-full sm:w-auto">
					<ClipboardCheck size={14} /> Take attendance
				</Link>
			) : today ? (
				<Link to={`/lecturer/attendance/${s.name}`} className="btn btn-secondary btn-sm w-full sm:w-auto">
					<ClipboardCheck size={14} /> Roll call
				</Link>
			) : null}
		</li>
	)
}

export default function Dashboard() {
	const session = useSession()
	const q = useApi(M.dashboard)
	const assignments = useAcross(M.listAssignments, { status: "Published" })
	const [newSession, setNewSession] = useState(false)
	const d = q.data
	const t = d?.totals || {}
	const first = (session.staff?.full_name || session.full_name || "").split(" ")[0]

	const today = ymd()
	const dueNames = new Set((d?.attendance_due || []).map((s) => s.name))
	// The server's "today" can differ from the browser's (site timezone), so a class happening now may sit in
	// either list; merge both for today's view.
	const upNames = new Set((d?.upcoming_sessions || []).map((s) => s.name))
	const todays = [...(d?.upcoming_sessions || []), ...(d?.attendance_due || []).filter((s) => !upNames.has(s.name))]
		.filter((s) => s.session_date === today)
		.sort((a, b) => hm(a.start_time).localeCompare(hm(b.start_time)))
	const later = (d?.upcoming_sessions || []).filter((s) => s.session_date > today).slice(0, 4)
	const overdue = (d?.attendance_due || []).filter((s) => s.session_date < today)

	const dueSoon = useMemo(
		() =>
			(assignments.data?.data || [])
				.filter((a) => a.due_date && !isPast(a.due_date))
				.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
				.slice(0, 5),
		[assignments.data]
	)

	const sheets = d?.mark_sheets || {}
	const sheetTotal = Object.values(sheets).reduce((a, b) => a + b, 0)
	const returned = sheets.Returned || 0

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow={d?.term ? `${greeting()} · ${d.term}` : greeting()}
				title={first ? `Welcome back, ${first}` : "Lecturer dashboard"}
				subtitle="Today's classes, what needs marking, and where each course stands."
				actions={
					<>
						<Button variant="secondary" icon={CalendarPlus} onClick={() => setNewSession(true)}>
							New session
						</Button>
						<Link to="/lecturer/courses" className="btn btn-primary">
							<BookOpen size={16} /> My courses
						</Link>
					</>
				}
			/>

			{q.isSuccess && !d?.term ? (
				<Alert tone="warning" title="No current academic term">
					The registry hasn't set the current term yet, so the dashboard is empty. Your courses from every term are under My courses.
				</Alert>
			) : null}
			{returned ? (
				<Alert
					tone="error"
					title={`${returned} mark sheet${returned === 1 ? " was" : "s were"} returned`}
					action={
						<Link to="/lecturer/gradebook" className="btn btn-secondary btn-sm">
							Review
						</Link>
					}
				>
					The Dean sent them back with remarks. Make the corrections and resubmit.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-5">
				<StatCard loading={q.isLoading} label="Courses" value={num(t.offerings)} icon={BookOpen} to="/lecturer/courses" hint="this term" />
				<StatCard loading={q.isLoading} label="Students" value={num(t.students)} icon={Users} tone="blue" hint="enrolled" />
				<StatCard
					loading={q.isLoading}
					label="To grade"
					value={num(t.submissions_to_grade)}
					icon={FileCheck2}
					tone={t.submissions_to_grade ? "gold" : "green"}
					hint="assignment submissions"
				/>
				<StatCard
					loading={q.isLoading}
					label="Exam answers"
					value={num(t.answers_to_mark)}
					icon={PenLine}
					tone={t.answers_to_mark ? "orange" : "green"}
					hint={`${num(t.attempts_to_mark)} attempts to mark`}
					to="/lecturer/exams"
				/>
				<StatCard
					loading={q.isLoading}
					label="Attendance due"
					value={num(t.attendance_due)}
					icon={ClipboardCheck}
					tone={t.attendance_due ? "red" : "green"}
					hint="sessions without a roll call"
					to="/lecturer/attendance"
					className="col-span-2 lg:col-span-1"
				/>
			</div>

			<div className="grid gap-6 lg:grid-cols-3">
				<div className="space-y-6 lg:col-span-2">
					<Panel
						title="Today's classes"
						subtitle={siteWallClock().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
						icon={CalendarClock}
						bodyClass="p-0"
						actions={
							<Link to="/lecturer/timetable" className="btn btn-ghost btn-sm">
								Timetable <ChevronRight size={14} />
							</Link>
						}
					>
						<QueryState query={q} skeleton={<div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}>
							{() =>
								todays.length ? (
									<ul className="divide-y divide-line">
										{todays.map((s) => (
											<SessionRow key={s.name} s={s} due={dueNames.has(s.name)} />
										))}
									</ul>
								) : (
									<Empty
										compact
										icon={CalendarClock}
										title="No classes today"
										subtitle={later.length ? `Next: ${later[0].course_title}, ${dayLabel(later[0].session_date)} at ${hm(later[0].start_time)}` : "Nothing scheduled in the next two weeks."}
										action={
											<Button size="sm" variant="secondary" icon={CalendarPlus} onClick={() => setNewSession(true)}>
												Schedule a session
											</Button>
										}
									/>
								)
							}
						</QueryState>
						{overdue.length ? (
							<div className="border-t border-line">
								<div className="flex items-center gap-2 px-5 pt-3 text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
									<AlarmClock size={14} /> Roll call still due
								</div>
								<ul className="divide-y divide-line">
									{overdue.slice(0, 5).map((s) => (
										<SessionRow key={s.name} s={s} due />
									))}
								</ul>
							</div>
						) : null}
						{todays.length && later.length ? (
							<div className="border-t border-line px-5 py-3 text-xs text-ink-soft">
								Coming up:{" "}
								{later.map((s, i) => (
									<span key={s.name}>
										{i ? " · " : ""}
										<span className="font-semibold text-ink-muted">{s.course_title}</span> {dayLabel(s.session_date)} {hm(s.start_time)}
									</span>
								))}
							</div>
						) : null}
					</Panel>

					<DataTable
						query={q}
						rows={d?.offerings}
						rowTo={(o) => `/lecturer/courses/${o.name}`}
						empty="You aren't assigned to any course this term"
						emptyIcon={BookOpen}
						cols={[
							{
								key: "course_title",
								label: "Course",
								render: (o) => (
									<div className="min-w-0">
										<div className="truncate font-semibold text-ink">{o.course_title}</div>
										<div className="text-xs text-ink-soft">
											{o.course} · {o.campus} · {o.study_mode}
										</div>
									</div>
								),
								sortValue: (o) => o.course_title,
							},
							{ key: "enrolled_count", label: "Students", align: "right" },
							{
								key: "to_grade",
								label: "To grade",
								align: "right",
								sortValue: (o) => (o.to_grade?.submissions || 0) + (o.to_grade?.essay_answers || 0),
								render: (o) => {
									const n = (o.to_grade?.submissions || 0) + (o.to_grade?.essay_answers || 0)
									return n ? <Badge tone="gold">{n}</Badge> : <span className="text-ink-soft">0</span>
								},
							},
							{ key: "results_status", label: "Mark sheet", render: (o) => <StatusBadge kind="sheet" status={o.results_status || "Not Started"} /> },
						]}
					/>
				</div>

				<div className="space-y-6">
					<Panel title="Marking queue" icon={FileCheck2} bodyClass="p-0">
						<QueryState query={q} skeleton={<div className="p-5"><Skeleton className="h-16" /></div>}>
							{() => {
								const rows = (d?.offerings || []).filter((o) => o.to_grade?.submissions || o.to_grade?.essay_answers)
								return rows.length ? (
									<ul className="divide-y divide-line">
										{rows.map((o) => (
											<li key={o.name}>
												<Link to={`/lecturer/courses/${o.name}?tab=assignments`} className="flex items-center gap-3 px-5 py-3 hover:bg-cream/60">
													<div className="min-w-0 flex-1">
														<div className="truncate text-sm font-semibold text-ink">{o.course_title}</div>
														<div className="text-xs text-ink-soft">
															{o.to_grade.submissions ? `${o.to_grade.submissions} submission${o.to_grade.submissions === 1 ? "" : "s"}` : null}
															{o.to_grade.submissions && o.to_grade.essay_answers ? " · " : null}
															{o.to_grade.essay_answers ? `${o.to_grade.essay_answers} exam answer${o.to_grade.essay_answers === 1 ? "" : "s"}` : null}
														</div>
													</div>
													<ChevronRight size={16} className="text-ink-soft" />
												</Link>
											</li>
										))}
									</ul>
								) : (
									<Empty compact icon={FileCheck2} title="All caught up" subtitle="Nothing waiting to be graded." />
								)
							}}
						</QueryState>
					</Panel>

					<Panel
						title="Mark sheets"
						icon={Sheet}
						actions={
							<Link to="/lecturer/gradebook" className="btn btn-ghost btn-sm">
								Gradebook <ChevronRight size={14} />
							</Link>
						}
					>
						<QueryState query={q} skeleton={<Skeleton className="h-16" />}>
							{() =>
								sheetTotal ? (
									<ul className="space-y-2.5">
										{SHEET_ORDER.filter((s) => sheets[s]).map((s) => (
											<li key={s} className="flex items-center justify-between gap-3 text-sm">
												<StatusBadge kind="sheet" status={s} />
												<span className="font-semibold tabular-nums text-ink">{sheets[s]}</span>
											</li>
										))}
									</ul>
								) : (
									<p className="text-sm text-ink-soft">No mark sheets yet.</p>
								)
							}
						</QueryState>
					</Panel>

					<Panel
						title="Upcoming exams"
						icon={NotebookPen}
						bodyClass="p-0"
						actions={
							<Link to="/lecturer/exams" className="btn btn-ghost btn-sm">
								All <ChevronRight size={14} />
							</Link>
						}
					>
						<QueryState query={q} skeleton={<div className="p-5"><Skeleton className="h-16" /></div>}>
							{() =>
								d?.upcoming_exams?.length ? (
									<ul className="divide-y divide-line">
										{d.upcoming_exams.map((e) => (
											<li key={e.name}>
												<Link to={`/lecturer/exams/${e.name}`} className="flex items-start gap-3 px-5 py-3 hover:bg-cream/60">
													<div className="min-w-0 flex-1">
														<div className="truncate text-sm font-semibold text-ink">{e.title}</div>
														<div className="truncate text-xs text-ink-soft">
															{e.course_title} · {dateTime(e.start_datetime)}
														</div>
													</div>
													<StatusBadge kind="exam" status={e.status} size="xs" />
												</Link>
											</li>
										))}
									</ul>
								) : (
									<Empty compact icon={NotebookPen} title="No exams coming up" />
								)
							}
						</QueryState>
					</Panel>

					<Panel title="Assignments due" icon={FileCheck2} bodyClass="p-0">
						<QueryState query={assignments} skeleton={<div className="p-5"><Skeleton className="h-16" /></div>}>
							{() =>
								dueSoon.length ? (
									<ul className="divide-y divide-line">
										{dueSoon.map((a) => (
											<li key={a.name}>
												<Link to={`/lecturer/assignments/${a.name}`} className="flex items-start gap-3 px-5 py-3 hover:bg-cream/60">
													<div className="min-w-0 flex-1">
														<div className="truncate text-sm font-semibold text-ink">{a.title}</div>
														<div className="truncate text-xs text-ink-soft">
															{a.course_title} · due {dateTime(a.due_date)}
														</div>
													</div>
													<span className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted">
														{a.submission_count}/{a.enrolled_count}
													</span>
												</Link>
											</li>
										))}
									</ul>
								) : (
									<Empty compact icon={FileCheck2} title="No open assignments" />
								)
							}
						</QueryState>
					</Panel>
				</div>
			</div>

			<SessionDialog open={newSession} onClose={() => setNewSession(false)} />
		</div>
	)
}
