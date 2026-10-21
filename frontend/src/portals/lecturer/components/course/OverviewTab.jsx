import { Link } from "react-router-dom"
import { AlertTriangle, CalendarClock, ClipboardCheck, FileCheck2, GraduationCap, NotebookPen, Percent, Sheet, Users } from "lucide-react"
import { Alert, AvatarCell, Badge, Empty, Panel, ProgressBar, StatCard } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { dateTime, num, pct } from "@/shared/utils/format"
import { StatusBadge } from "../bits"
import { dayLabel, hm, pctTone, score, ymd } from "../lib"

export function courseKpis(d) {
	const roster = d?.roster || []
	const withSessions = roster.filter((r) => r.sessions_held)
	const attendance = withSessions.length ? withSessions.reduce((a, r) => a + (Number(r.attendance_percentage) || 0), 0) / withSessions.length : null
	const live = (d?.assignments || []).filter((a) => a.status !== "Draft")
	const expected = live.length * roster.length
	const submitted = live.reduce((a, x) => a + (x.submission_count || 0), 0)
	const submissionRate = expected ? (submitted / expected) * 100 : null
	const graded = roster.filter((r) => r.final_grade)
	const sheetAvg = d?.mark_sheet?.average_score
	return { enrolled: roster.length, attendance, submissionRate, sheetAvg: sheetAvg ? Number(sheetAvg) : null, graded: graded.length }
}

export default function OverviewTab({ data: d, offering, onTab }) {
	const k = courseKpis(d)
	const roster = d.roster || []
	const atRisk = roster.filter((r) => (r.sessions_held && Number(r.attendance_percentage) < 75) || r.fee_cleared === false)
	const due = d.sessions?.attendance_due || []
	const upcoming = (d.sessions?.upcoming || []).filter((s) => !due.some((x) => x.name === s.name)).slice(0, 4)
	const sheet = d.mark_sheet
	const assessments = [
		...(d.assignments || []).map((a) => ({ ...a, kind: "assignment", when: a.due_date, to: `/lecturer/assignments/${a.name}`, progress: a.submission_count, of: roster.length })),
		...(d.exams || []).map((e) => ({ ...e, kind: "exam", when: e.start_datetime, to: `/lecturer/exams/${e.name}`, progress: e.submitted_count, of: roster.length })),
	].sort((a, b) => String(b.when || "").localeCompare(String(a.when || "")))

	return (
		<div className="space-y-6">
			{sheet?.status === "Returned" ? (
				<Alert
					tone="error"
					title="The Dean returned this mark sheet"
					action={
						<Link to={`/lecturer/gradebook/${offering}`} className="btn btn-secondary btn-sm">
							Fix marks
						</Link>
					}
				>
					{sheet.return_reason || "See the remarks on the mark sheet."}
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
				<StatCard label="Enrolled" value={num(k.enrolled)} icon={Users} hint={d.offering?.capacity ? `of ${d.offering.capacity} places` : "students"} to={`/lecturer/courses/${offering}?tab=students`} />
				<StatCard
					label="Avg attendance"
					value={k.attendance == null ? "—" : pct(k.attendance)}
					icon={ClipboardCheck}
					tone={k.attendance == null ? "gray" : k.attendance >= 75 ? "green" : "orange"}
					hint={`${d.sessions?.held || 0} of ${d.sessions?.total || 0} sessions held`}
				/>
				<StatCard
					label="Submission rate"
					value={k.submissionRate == null ? "—" : pct(k.submissionRate)}
					icon={FileCheck2}
					tone="blue"
					hint={`${(d.assignments || []).filter((a) => a.status !== "Draft").length} live assignments`}
				/>
				<StatCard label="Average mark" value={k.sheetAvg == null ? "—" : `${score(k.sheetAvg, 1)}%`} icon={Percent} tone="gold" hint="from the mark sheet" />
			</div>

			<div className="grid gap-6 lg:grid-cols-3">
				<div className="space-y-6 lg:col-span-2">
					<Panel
						title="Assessments"
						icon={NotebookPen}
						bodyClass="p-0"
						actions={
							<div className="flex gap-1">
								<button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab("assignments")}>
									Assignments
								</button>
								<button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab("exams")}>
									Exams
								</button>
							</div>
						}
					>
						{assessments.length ? (
							<ul className="divide-y divide-line">
								{assessments.map((a) => (
									<li key={a.name}>
										<Link to={a.to} className="flex flex-col gap-2 px-5 py-3 hover:bg-cream/60 sm:flex-row sm:items-center sm:gap-4">
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<Badge tone={a.kind === "exam" ? "purple" : "blue"} size="xs">
														{a.kind === "exam" ? a.exam_type : a.assessment_component}
													</Badge>
													<span className="truncate font-semibold text-ink">{a.title}</span>
												</div>
												<div className="mt-0.5 text-xs text-ink-soft">
													{a.kind === "exam" ? `Starts ${dateTime(a.start_datetime)} · ${score(a.total_marks)} marks` : `Due ${dateTime(a.due_date)} · out of ${score(a.max_score)}`}
												</div>
											</div>
											<div className="flex items-center gap-3 sm:w-56">
												<ProgressBar value={a.of ? (a.progress / a.of) * 100 : 0} className="flex-1" size="sm" />
												<span className="w-12 text-right text-xs tabular-nums text-ink-muted">
													{a.progress || 0}/{a.of}
												</span>
												<StatusBadge kind={a.kind} status={a.status} size="xs" />
											</div>
										</Link>
									</li>
								))}
							</ul>
						) : (
							<Empty compact icon={NotebookPen} title="No assignments or exams yet" subtitle="Create one from the Assignments or Exams tab." />
						)}
					</Panel>

					<Panel
						title="Students"
						icon={Users}
						bodyClass="p-0"
						actions={
							<button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab("students")}>
								Full roster
							</button>
						}
					>
						<DataTable
							rowKey="student"
							rows={roster}
							pageSize={8}
							className="!rounded-none !border-0 !shadow-none"
							empty="No students enrolled yet"
							emptyIcon={Users}
							cols={[
								{ key: "full_name", label: "Student", render: (r) => <AvatarCell name={r.full_name} sub={r.student_number} image={r.photo} size={32} /> },
								{
									key: "attendance_percentage",
									label: "Attendance",
									align: "right",
									render: (r) => (r.sessions_held ? <Badge tone={pctTone(r.attendance_percentage)}>{pct(r.attendance_percentage)}</Badge> : <span className="text-ink-soft">—</span>),
								},
								{ key: "assignment_average", label: "Assign. avg", align: "right", hideOnMobile: true, render: (r) => score(r.assignment_average, 1) },
								{ key: "final_grade", label: "Grade", align: "right", render: (r) => (r.final_grade ? <b>{r.final_grade}</b> : <span className="text-ink-soft">—</span>) },
							]}
						/>
					</Panel>
				</div>

				<div className="space-y-6">
					<Panel title="Classes" icon={CalendarClock} bodyClass="p-0" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => onTab("attendance")}>All sessions</button>}>
						{due.length || upcoming.length ? (
							<ul className="divide-y divide-line">
								{due.map((s) => (
									<li key={s.name} className="flex items-center gap-3 px-5 py-3">
										<div className="min-w-0 flex-1">
											<div className="text-sm font-semibold text-ink">
												{dayLabel(s.session_date)} · {hm(s.start_time)}
											</div>
											<div className="truncate text-xs text-ink-soft">{s.topic || "Class session"}</div>
										</div>
										<Link to={`/lecturer/attendance/${s.name}`} className="btn btn-gold btn-sm">
											Roll call
										</Link>
									</li>
								))}
								{upcoming.map((s) => (
									<li key={s.name} className="flex items-center gap-3 px-5 py-3">
										<div className="min-w-0 flex-1">
											<div className="text-sm font-semibold text-ink">
												{dayLabel(s.session_date)} · {hm(s.start_time)}
											</div>
											<div className="truncate text-xs text-ink-soft">{s.topic || "Class session"}</div>
										</div>
										{s.session_date === ymd() ? (
											<Link to={`/lecturer/attendance/${s.name}`} className="btn btn-secondary btn-sm">
												Roll call
											</Link>
										) : null}
									</li>
								))}
							</ul>
						) : (
							<Empty compact icon={CalendarClock} title="No upcoming classes" />
						)}
					</Panel>

					<Panel title="Mark sheet" icon={Sheet}>
						<div className="flex items-center justify-between gap-3">
							<StatusBadge kind="sheet" status={sheet?.status || "Not Started"} />
							<Link to={`/lecturer/gradebook/${offering}`} className="btn btn-secondary btn-sm">
								<GraduationCap size={14} /> Open
							</Link>
						</div>
						{sheet ? (
							<dl className="mt-4 grid grid-cols-3 gap-2 text-center">
								<div>
									<dt className="text-[11px] text-ink-soft">Students</dt>
									<dd className="font-bold tabular-nums text-ink">{sheet.student_count ?? 0}</dd>
								</div>
								<div>
									<dt className="text-[11px] text-ink-soft">Passing</dt>
									<dd className="font-bold tabular-nums text-ink">{sheet.pass_count ?? 0}</dd>
								</div>
								<div>
									<dt className="text-[11px] text-ink-soft">Average</dt>
									<dd className="font-bold tabular-nums text-ink">{score(sheet.average_score, 1)}</dd>
								</div>
							</dl>
						) : (
							<p className="mt-3 text-xs text-ink-soft">Created the first time you open it.</p>
						)}
					</Panel>

					<Panel title="Needs attention" icon={AlertTriangle} bodyClass="p-0">
						{atRisk.length ? (
							<ul className="divide-y divide-line">
								{atRisk.slice(0, 6).map((r) => (
									<li key={r.student} className="px-5 py-3">
										<AvatarCell name={r.full_name} sub={r.student_number} image={r.photo} size={32} />
										<div className="mt-1.5 flex flex-wrap gap-1.5 pl-11">
											{r.sessions_held && Number(r.attendance_percentage) < 75 ? <Badge tone="red" size="xs">Attendance {pct(r.attendance_percentage)}</Badge> : null}
											{r.fee_cleared === false ? <Badge tone="orange" size="xs">Fees not cleared</Badge> : null}
										</div>
									</li>
								))}
							</ul>
						) : (
							<Empty compact icon={Users} title="No one flagged" subtitle="Attendance is above 75% and fees are cleared." />
						)}
					</Panel>
				</div>
			</div>
		</div>
	)
}
