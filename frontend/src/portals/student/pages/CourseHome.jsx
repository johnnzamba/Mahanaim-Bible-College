import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import {
	Award,
	BookOpen,
	CalendarCheck,
	ChevronDown,
	ClipboardList,
	ExternalLink,
	Layers,
	Mail,
	Megaphone,
	NotebookPen,
	Target,
} from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Avatar, Badge, Donut, Empty, Html, PageHeader, Panel, QueryState, Skeleton, Tabs } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, num, pct } from "@/shared/utils/format"
import { API, ASSIGNMENT_STATE, hhmm, pctTone, safeUrl, since } from "../components/lib"
import { DueBadge, IconChip, useServerTime } from "../components/bits"
import { ResourceItem } from "../components/ResourceItem"
import { ExamCard } from "../components/ExamCard"

const TABS = ["content", "assignments", "exams", "attendance", "grades"]

export default function CourseHome() {
	const { offering } = useParams()
	const [params, setParams] = useSearchParams()
	const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "content"
	const setTab = (t) => setParams(t === "content" ? {} : { tab: t }, { replace: true })
	const q = useApi(API.course, { offering })
	const asg = useApi(API.assignments, { offering })
	const exams = useApi(API.exams)
	useServerTime(exams.data?.server_time, exams.dataUpdatedAt)

	const courseExams = useMemo(() => {
		const d = exams.data || {}
		return [...(d.open || []), ...(d.upcoming || []), ...(d.past || [])].filter((e) => e.course_offering === offering)
	}, [exams.data, offering])

	const off = q.data?.offering || {}
	const assignments = asg.data?.data || []
	const due = assignments.filter((a) => ["pending", "overdue"].includes(a.state)).length

	return (
		<>
			<PageHeader
				back={{ to: "/student/courses", label: "My courses" }}
				eyebrow={off.course_code ? `${off.course_code} · ${off.academic_term || ""}` : "Course"}
				title={off.course_title || (q.isLoading ? "Loading…" : "Course")}
				subtitle={off.credits ? `${num(off.credits)} credits · pass mark ${num(off.pass_mark || 40)}%` : null}
				actions={
					safeUrl(q.data?.lms_url) ? (
						<a href={safeUrl(q.data.lms_url)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
							<ExternalLink size={14} /> Open in LMS
						</a>
					) : null
				}
			/>
			<QueryState
				query={q}
				skeleton={
					<div className="space-y-4">
						<Skeleton className="h-28 rounded-2xl" />
						<Skeleton className="h-64 rounded-2xl" />
					</div>
				}
			>
				{(data) => (
					<div className="space-y-5">
						<div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
							<div className="flex items-center gap-4">
								<Donut value={data.progress?.percentage || 0} size={72} stroke={8} tone={data.progress?.percentage >= 100 ? "green" : "brand"} />
								<div>
									<div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Your progress</div>
									<div className="text-lg font-bold text-ink">
										{data.progress?.completed || 0} of {data.progress?.total || 0} resources
									</div>
									<div className="text-xs text-ink-soft">{data.modules?.length || 0} modules</div>
								</div>
							</div>
							<div className="grid flex-1 grid-cols-3 gap-2 sm:ml-auto sm:max-w-md">
								<MiniStat label="To submit" value={asg.isLoading ? "…" : due} tone={due ? "orange" : "green"} onClick={() => setTab("assignments")} />
								<MiniStat label="Exams" value={exams.isLoading ? "…" : courseExams.filter((e) => e.status !== "Closed").length} tone="blue" onClick={() => setTab("exams")} />
								<MiniStat label="Lecturers" value={data.lecturers?.length || 0} tone="gold" />
							</div>
						</div>

						<Tabs className="pb-px"
							tabs={[
								{ id: "content", label: "Content" },
								{ id: "assignments", label: "Assignments", count: assignments.length || undefined },
								{ id: "exams", label: "Exams", count: courseExams.length || undefined },
								{ id: "attendance", label: "Attendance" },
								{ id: "grades", label: "Grades" },
							]}
							active={tab}
							onChange={setTab}
						/>

						{tab === "content" ? <ContentTab data={data} /> : null}
						{tab === "assignments" ? <AssignmentsTab query={asg} /> : null}
						{tab === "exams" ? <ExamsTab query={exams} rows={courseExams} /> : null}
						{tab === "attendance" ? <AttendanceTab offering={offering} /> : null}
						{tab === "grades" ? <GradesTab assignments={assignments} exams={courseExams} course={off.course || off.course_code} loading={asg.isLoading} /> : null}
					</div>
				)}
			</QueryState>
		</>
	)
}

function MiniStat({ label, value, tone, onClick }) {
	const Tag = onClick ? "button" : "div"
	return (
		<Tag type={onClick ? "button" : undefined} onClick={onClick} className={clsx("rounded-xl border border-line px-3 py-2 text-left", onClick && "transition hover:border-brand-300 hover:bg-cream/50")}>
			<div className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
			<div className={clsx("text-lg font-bold", tone === "orange" ? "text-amber-600" : tone === "green" ? "text-emerald-600" : "text-ink")}>{value}</div>
		</Tag>
	)
}

function ContentTab({ data }) {
	const modules = useMemo(() => {
		const list = [...(data.modules || [])]
		if (data.resources?.length) list.push({ name: "__loose", module_title: "Other resources", resources: data.resources })
		return list
	}, [data])
	const firstOpen = useMemo(() => {
		const m = modules.find((x) => (x.resources || []).some((r) => r.progress?.status !== "Completed"))
		return (m || modules[0])?.name
	}, [modules])
	const [open, setOpen] = useState(() => new Set(firstOpen ? [firstOpen] : []))
	const toggle = (n) =>
		setOpen((s) => {
			const x = new Set(s)
			if (x.has(n)) x.delete(n)
			else x.add(n)
			return x
		})
	const off = data.offering || {}
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="space-y-3 lg:col-span-2">
				{modules.length ? (
					modules.map((m) => {
						const rs = m.resources || []
						const done = rs.filter((r) => r.progress?.status === "Completed").length
						const isOpen = open.has(m.name)
						return (
							<section key={m.name} className="card overflow-hidden">
								<button type="button" onClick={() => toggle(m.name)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-cream/40 sm:px-5">
									<IconChip icon={Layers} tone={done && done === rs.length ? "green" : "brand"} size={36} />
									<div className="min-w-0 flex-1">
										{m.week ? <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-700">Week {m.week}</div> : null}
										<div className="truncate font-semibold text-ink">{m.module_title}</div>
									</div>
									<span className="shrink-0 text-xs font-semibold text-ink-soft">
										{done}/{rs.length}
									</span>
									<ChevronDown size={18} className={clsx("shrink-0 text-ink-soft transition", isOpen && "rotate-180")} />
								</button>
								{isOpen ? (
									<div className="border-t border-line bg-canvas/40 px-3 py-3 sm:px-4">
										{m.description ? <p className="mb-3 px-1 text-sm text-ink-muted">{m.description}</p> : null}
										{rs.length ? (
											<ul className="space-y-2">
												{rs.map((r) => (
													<ResourceItem key={r.name} resource={r} />
												))}
											</ul>
										) : (
											<p className="px-1 py-2 text-sm text-ink-soft">No resources in this module yet.</p>
										)}
									</div>
								) : null}
							</section>
						)
					})
				) : (
					<div className="card">
						<Empty icon={BookOpen} title="No course content yet" subtitle="Your lecturer hasn't published any modules. Check back soon." />
					</div>
				)}
			</div>
			<div className="space-y-4">
				{off.description || off.learning_outcomes ? (
					<Panel title="About this course" icon={Target}>
						{off.description ? <Html html={off.description} className="text-sm" /> : null}
						{off.learning_outcomes ? (
							<>
								<div className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Learning outcomes</div>
								<Html html={off.learning_outcomes} className="text-sm" />
							</>
						) : null}
					</Panel>
				) : null}
				<Panel title="Lecturers" icon={BookOpen} bodyClass="p-0">
					{(data.lecturers || []).length ? (
						<ul className="divide-y divide-line">
							{data.lecturers.map((l) => (
								<li key={l.staff_member} className="flex items-center gap-3 px-5 py-3">
									<Avatar name={l.staff_name} src={l.photo} size={38} />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-semibold text-ink">{l.staff_name}</div>
										<div className="truncate text-xs text-ink-soft">{[l.role, l.designation].filter(Boolean).join(" · ")}</div>
									</div>
									{l.email ? (
										<a href={`mailto:${l.email}`} className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-brand-50 hover:text-brand-700" aria-label={`Email ${l.staff_name}`}>
											<Mail size={16} />
										</a>
									) : null}
								</li>
							))}
						</ul>
					) : (
						<p className="px-5 py-4 text-sm text-ink-soft">Not assigned yet.</p>
					)}
				</Panel>
				<Panel title="Course notices" icon={Megaphone} bodyClass="p-0">
					{(data.announcements || []).length ? (
						<ul className="divide-y divide-line">
							{data.announcements.map((a) => (
								<li key={a.name} className="px-5 py-3">
									<div className="flex items-center justify-between gap-2">
										<span className="truncate text-sm font-semibold text-ink">{a.title}</span>
										<span className="shrink-0 text-[11px] text-ink-soft">{since(a.sent_on)}</span>
									</div>
									<Html html={a.body} className="mt-1 line-clamp-4 text-[13px] leading-6" />
								</li>
							))}
						</ul>
					) : (
						<p className="px-5 py-4 text-sm text-ink-soft">No notices for this course.</p>
					)}
				</Panel>
			</div>
		</div>
	)
}

function AssignmentsTab({ query }) {
	return (
		<DataTable
			query={query}
			rowTo={(r) => `/student/assignments/${encodeURIComponent(r.name)}`}
			empty="No assignments for this course yet"
			emptyIcon={ClipboardList}
			cols={[
				{ key: "title", label: "Assignment", render: (r) => <span className="font-semibold text-ink">{r.title}</span> },
				{ key: "assessment_component", label: "Type", hideOnMobile: true },
				{
					key: "due_date",
					label: "Due",
					render: (r) => (
						<span className="flex flex-col gap-1">
							<span className="text-xs text-ink-muted">{date(r.due_date)}</span>
							{["pending", "overdue"].includes(r.state) ? <DueBadge due={r.due_date} size="xs" /> : null}
						</span>
					),
				},
				{
					key: "state",
					label: "Status",
					render: (r) => <Badge tone={ASSIGNMENT_STATE[r.state]?.tone}>{ASSIGNMENT_STATE[r.state]?.label || r.state}</Badge>,
				},
				{
					key: "score",
					label: "Score",
					align: "right",
					sortValue: (r) => r.submission?.final_score ?? -1,
					render: (r) => (r.submission?.released ? `${num(r.submission.final_score, 1)} / ${num(r.max_score)}` : "—"),
				},
			]}
		/>
	)
}

function ExamsTab({ query, rows }) {
	if (query.isLoading) return <Skeleton className="h-28 rounded-2xl" />
	if (!rows.length)
		return (
			<div className="card">
				<Empty icon={NotebookPen} title="No exams for this course" subtitle="CATs and exams scheduled by your lecturer appear here." />
			</div>
		)
	return (
		<div className="space-y-3">
			{rows.map((e) => (
				<ExamCard key={e.name} exam={e} />
			))}
		</div>
	)
}

function AttendanceTab({ offering }) {
	const q = useApi(API.attendance, { offering })
	const s = q.data?.data?.[0]
	return (
		<QueryState query={q} skeleton={<Skeleton className="h-48 rounded-2xl" />}>
			{(data) => (
				<div className="grid gap-4 lg:grid-cols-3">
					<Panel title="Summary" icon={CalendarCheck}>
						{s && Number(s.held) ? (
							<div className="flex items-center gap-4">
								<Donut value={s.percentage} size={84} stroke={9} tone={pctTone(s.percentage)} />
								<dl className="grid flex-1 grid-cols-2 gap-2 text-sm">
									<Stat label="Present" value={s.present} />
									<Stat label="Late" value={s.late} />
									<Stat label="Absent" value={s.absent} />
									<Stat label="Excused" value={s.excused} />
								</dl>
							</div>
						) : (
							<p className="text-sm text-ink-soft">No sessions have been marked yet.</p>
						)}
					</Panel>
					<div className="lg:col-span-2">
						<DataTable
							rows={data.sessions || []}
							empty="No attendance records yet"
							emptyIcon={CalendarCheck}
							cols={[
								{ key: "session_date", label: "Date", render: (r) => date(r.session_date, { weekday: "short", day: "numeric", month: "short" }) },
								{ key: "start_time", label: "Time", render: (r) => hhmm(r.start_time), hideOnMobile: true },
								{ key: "topic", label: "Topic", hideOnMobile: true },
								{ key: "status", label: "Status", render: (r) => <Badge status={r.status} dot /> },
							]}
						/>
					</div>
				</div>
			)}
		</QueryState>
	)
}

function Stat({ label, value }) {
	return (
		<div>
			<dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
			<dd className="font-bold text-ink">{value ?? 0}</dd>
		</div>
	)
}

function GradesTab({ assignments, exams, course, loading }) {
	const results = useApi(API.results)
	const final = useMemo(() => {
		for (const t of results.data?.terms || []) {
			const c = (t.courses || []).find((x) => x.code === course)
			if (c) return { ...c, term: t.label }
		}
		return null
	}, [results.data, course])
	const graded = assignments.filter((a) => a.submission?.released)
	const released = exams.flatMap((e) => (e.attempts || []).filter((a) => a.status === "Released").map((a) => ({ ...a, exam: e })))
	if (loading) return <Skeleton className="h-40 rounded-2xl" />
	return (
		<div className="space-y-4">
			{final ? (
				<div className="card flex flex-wrap items-center gap-4 p-5">
					<IconChip icon={Award} tone="gold" size={44} />
					<div className="min-w-0 flex-1">
						<div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Final result · {final.term}</div>
						<div className="text-lg font-bold text-ink">
							{num(final.total, 0)}% · Grade {final.grade}
						</div>
					</div>
					<Badge status={final.status} />
				</div>
			) : null}
			<Panel title="Coursework" icon={ClipboardList} bodyClass="p-0">
				{graded.length ? (
					<ul className="divide-y divide-line">
						{graded.map((a) => (
							<li key={a.name}>
								<Link to={`/student/assignments/${encodeURIComponent(a.name)}`} className="flex items-center gap-3 px-5 py-3 hover:bg-cream/60">
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-semibold text-ink">{a.title}</div>
										<div className="text-xs text-ink-soft">{a.assessment_component}</div>
									</div>
									<span className="text-sm font-bold tabular-nums text-ink">
										{num(a.submission.final_score, 1)} / {num(a.max_score)}
									</span>
									<Badge tone={pctTone((a.submission.final_score / (a.max_score || 1)) * 100, { good: 70, warn: 50 })} size="xs">
										{pct((a.submission.final_score / (a.max_score || 1)) * 100)}
									</Badge>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<p className="px-5 py-4 text-sm text-ink-soft">No graded coursework released yet.</p>
				)}
			</Panel>
			<Panel title="Exams & CATs" icon={NotebookPen} bodyClass="p-0">
				{released.length ? (
					<ul className="divide-y divide-line">
						{released.map((a) => (
							<li key={a.name}>
								<Link to={`/student/exams/result/${encodeURIComponent(a.name)}`} className="flex items-center gap-3 px-5 py-3 hover:bg-cream/60">
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-semibold text-ink">{a.exam.title}</div>
										<div className="text-xs text-ink-soft">Attempt {a.attempt_number}</div>
									</div>
									<Badge tone={pctTone(a.percentage, { good: 70, warn: 50 })}>{pct(a.percentage)}</Badge>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<p className="px-5 py-4 text-sm text-ink-soft">No exam results released yet.</p>
				)}
			</Panel>
		</div>
	)
}
