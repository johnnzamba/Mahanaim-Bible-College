import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
	BookOpen,
	CalendarClock,
	CalendarRange,
	ClipboardCheck,
	FileQuestion,
	FileSpreadsheet,
	GraduationCap,
	Layers,
	Library,
	Scale,
	UserX,
	Users,
	Wand2,
} from "lucide-react"
import { Badge, Button, Empty, Modal, PageHeader, Panel, ProgressBar, QueryState, Select, SkeletonRows, StatCard, Tile } from "@/shared/components/ui"
import { BarsChart, DonutChart, Legendary } from "@/shared/components/Charts"
import { useAction, useApi } from "@/shared/api/hooks"
import { ago, date, dateTime, daysUntil, num, parseServerDate } from "@/shared/utils/format"
import { ACAD, BASE, RESULTS, RESULT_COLORS, SETUP, SHEET_STATUS, rowsOf, termOptions, useAcademicRoles, useLookups, useTermParam } from "../lib"
import { SheetBadge, TermSelect } from "../components/common"
import { useTermExams, useTermOfferings } from "../components/useTerm"

function TermBanner({ lookups, term, canSet }) {
	const row = (lookups?.terms || []).find((t) => t.name === term)
	const cal = useApi(`${SETUP}academic_calendar`, { academic_year: row?.academic_year }, { enabled: Boolean(row?.academic_year) })
	const full = useMemo(() => (cal.data?.years || []).flatMap((y) => y.terms || []).find((t) => t.name === term), [cal.data, term])
	const [open, setOpen] = useState(false)
	const [pick, setPick] = useState("")
	const setCurrent = useAction(`${SETUP}set_current_term`, {
		invalidate: [SETUP, ACAD, RESULTS],
		success: (r) => `${r.current_term} is now the current term`,
		onSuccess: () => setOpen(false),
	})
	if (!row) {
		return (
			<div className="card mb-5 p-5">
				<Empty compact title="No academic term selected" subtitle="Set up the academic calendar and mark a term as current." action={<Link to={`${BASE}/calendar`} className="btn btn-primary btn-sm">Open calendar</Link>} />
			</div>
		)
	}
	const start = row.start_date ? new Date(`${row.start_date}T00:00:00`) : null
	const end = row.end_date ? new Date(`${row.end_date}T23:59:59`) : null
	const now = new Date()
	const span = start && end ? end - start : 0
	const elapsed = span ? Math.min(100, Math.max(0, ((now - start) / span) * 100)) : 0
	const weeks = span ? Math.max(1, Math.ceil(span / (7 * 864e5))) : 0
	const week = start && now >= start ? Math.min(weeks, Math.floor((now - start) / (7 * 864e5)) + 1) : 0
	const isCurrent = row.name === lookups.current_term
	const milestones = full
		? [
				full.registration_end && { label: "Registration closes", date: full.registration_end },
				full.exam_start && { label: "Exams begin", date: full.exam_start },
				full.results_release_date && { label: "Results release", date: full.results_release_date },
			].filter(Boolean)
		: []
	return (
		<section className="card mb-5 overflow-hidden">
			<div className="flex flex-col gap-4 bg-brand-800 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between dark:bg-brand-900">
				<div className="min-w-0">
					<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-300">{isCurrent ? "Current term" : "Viewing term"}</div>
					<div className="mt-0.5 truncate font-serif text-xl">{row.term_label || row.name}</div>
					<div className="mt-1 text-xs text-white/75">
						{date(row.start_date)} – {date(row.end_date)}
						{week ? ` · Week ${week} of ${weeks}` : ""}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Badge status={row.status} />
					{canSet ? (
						<Button
							size="sm"
							variant="gold"
							icon={CalendarClock}
							onClick={() => {
								setPick(lookups.current_term || "")
								setOpen(true)
							}}
						>
							Set current term
						</Button>
					) : null}
				</div>
			</div>
			<div className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
				<ProgressBar value={elapsed} label="Term elapsed" />
				{milestones.length ? (
					<ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
						{milestones.map((m) => {
							const d = daysUntil(m.date)
							return (
								<li key={m.label} className="text-ink-soft">
									{m.label} <span className="font-semibold text-ink">{date(m.date, { day: "numeric", month: "short" })}</span>
									{d != null && d >= 0 && d <= 30 ? <span className="ml-1 text-gold-700">({d === 0 ? "today" : `in ${d}d`})</span> : null}
								</li>
							)
						})}
					</ul>
				) : null}
			</div>
			<Modal
				open={open}
				onClose={() => setOpen(false)}
				title="Set the current term"
				subtitle="Registration, timetables, fees and dashboards follow the current term."
				size="sm"
				footer={
					<>
						<Button variant="secondary" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button loading={setCurrent.isPending} disabled={!pick || pick === lookups.current_term} onClick={() => setCurrent.mutate({ term: pick })}>
							Make current
						</Button>
					</>
				}
			>
				<Select label="Term" value={pick} onChange={(e) => setPick(e.target.value)} options={termOptions(lookups)} />
			</Modal>
		</section>
	)
}

function ListRow({ to, title, sub, right }) {
	return (
		<li>
			<Link to={to} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-cream/60">
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-semibold text-ink">{title}</div>
					{sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
				</div>
				<div className="shrink-0">{right}</div>
			</Link>
		</li>
	)
}

export default function Overview() {
	const lookups = useLookups()
	const L = lookups.data
	const [term, setTerm] = useTermParam(L)
	const roles = useAcademicRoles()
	const stats = useApi(`${ACAD}academics_stats`, { term }, { enabled: Boolean(term) })
	const pending = useApi(`${RESULTS}pending_mark_sheets`, { term }, { enabled: Boolean(term) && roles.admin })
	const offerings = useTermOfferings(term)
	const termExams = useTermExams(term)
	const S = stats.data
	const rs = S?.results_status || {}
	const q = (p) => (term ? `${p}?term=${encodeURIComponent(term)}` : p)

	const unstaffed = useMemo(() => rowsOf(offerings.data).filter((o) => o.status !== "Cancelled" && !(o.lecturers || []).length), [offerings.data])
	const upcoming = useMemo(() => {
		const now = Date.now()
		return termExams.exams
			.filter((e) => ["Open", "Scheduled", "Draft"].includes(e.status) && (e.status === "Open" || !e.end_datetime || parseServerDate(e.end_datetime) >= now))
			.sort((a, b) => String(a.start_datetime || "9").localeCompare(String(b.start_datetime || "9")))
	}, [termExams.exams])
	const resultData = ["Not Started", ...SHEET_STATUS].map((s) => ({ label: s, value: rs[s] || 0, color: RESULT_COLORS[s] })).filter((d) => d.value)
	const byStatus = Object.entries(S?.offerings?.by_status || {}).map(([label, value]) => ({ label, value }))
	const awaiting = (rs.Submitted || 0) + (rs.Approved || 0)

	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Academic overview"
				subtitle="Programmes, teaching, exams and results at a glance."
				actions={
					<>
						<TermSelect lookups={L} value={term} onChange={setTerm} className="min-w-[13rem]" />
						{roles.admin ? (
							<Link to={`${BASE}/offerings?generate=1${term ? `&term=${encodeURIComponent(term)}` : ""}`} className="btn btn-primary">
								<Wand2 size={16} /> Generate offerings
							</Link>
						) : null}
					</>
				}
			/>

			{lookups.isLoading ? <SkeletonRows rows={3} /> : <TermBanner lookups={L} term={term} canSet={roles.admin} />}

			<div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<StatCard
					label="Offerings this term"
					icon={BookOpen}
					loading={stats.isLoading}
					value={num(S?.offerings?.total)}
					hint={S ? `${num(S.offerings.without_lecturer)} without a lecturer` : null}
					tone={S?.offerings?.without_lecturer ? "orange" : "brand"}
					to={q(`${BASE}/offerings`)}
				/>
				<StatCard label="Course enrolments" icon={Users} loading={stats.isLoading} value={num(S?.enrolments)} hint="Students enrolled this term" tone="blue" />
				<StatCard label="Classes this week" icon={CalendarClock} loading={stats.isLoading} value={num(S?.sessions_this_week)} hint="Scheduled and held sessions" tone="green" />
				<StatCard
					label="Mark sheets in review"
					icon={FileSpreadsheet}
					loading={stats.isLoading}
					value={num(awaiting)}
					hint={S ? `${num(rs.Submitted || 0)} to approve · ${num(rs.Approved || 0)} to publish` : null}
					tone={awaiting ? "gold" : "brand"}
					to={q(`${BASE}/mark-sheets`)}
				/>
				<StatCard
					label="Programmes"
					icon={GraduationCap}
					loading={stats.isLoading}
					value={S ? `${num(S.programmes.active)} active` : null}
					hint={S ? `${num(S.programmes.total)} in the catalogue` : null}
					to={`${BASE}/programmes`}
				/>
				<StatCard
					label="Courses"
					icon={Library}
					loading={stats.isLoading}
					value={S ? `${num(S.courses.active)} active` : null}
					hint={S ? `${num(S.courses.total)} in the catalogue` : null}
					tone="purple"
					to={`${BASE}/courses`}
				/>
			</div>

			<div className="mb-5 grid gap-5 lg:grid-cols-3">
				<Panel
					title="Mark sheets to action"
					subtitle={roles.dean && roles.registrar ? "To approve or publish" : roles.dean ? "Submitted for approval" : "Approved, ready to publish"}
					icon={ClipboardCheck}
					bodyClass="p-2"
					actions={<Link to={q(`${BASE}/mark-sheets`)} className="text-xs font-semibold text-brand-700 hover:underline">View all</Link>}
				>
					<QueryState query={pending} isEmpty={(d) => !rowsOf(d).length} empty={<Empty compact icon={ClipboardCheck} title="Nothing waiting" subtitle="New submissions will appear here." />}>
						{(d) => (
							<ul>
								{rowsOf(d).slice(0, 6).map((s) => (
									<ListRow
										key={s.name}
										to={`${BASE}/mark-sheets/${encodeURIComponent(s.name)}`}
										title={s.course_title || s.course_offering}
										sub={`${s.campus || ""}${s.submitted_on ? ` · submitted ${ago(s.submitted_on)}` : ""}`}
										right={<SheetBadge status={s.status} size="xs" />}
									/>
								))}
							</ul>
						)}
					</QueryState>
				</Panel>

				<Panel
					title="No lecturer yet"
					subtitle="Offerings to staff"
					icon={UserX}
					bodyClass="p-2"
					actions={unstaffed.length ? <Badge tone="orange">{unstaffed.length}</Badge> : null}
				>
					<QueryState query={offerings} isEmpty={() => !unstaffed.length} empty={<Empty compact icon={Users} title="Every offering has a lecturer" />}>
						{() => (
							<ul>
								{unstaffed.slice(0, 6).map((o) => (
									<ListRow
										key={o.name}
										to={`${BASE}/offerings/${encodeURIComponent(o.name)}`}
										title={`${o.course} · ${o.course_title}`}
										sub={`${o.campus}${o.study_mode ? ` · ${o.study_mode}` : ""} · ${num(o.enrolled_count)} enrolled`}
										right={<Badge status={o.status} size="xs" />}
									/>
								))}
								{unstaffed.length > 6 ? (
									<li className="px-2 pt-1 text-xs">
										<Link to={q(`${BASE}/offerings`)} className="font-semibold text-brand-700 hover:underline">
											and {unstaffed.length - 6} more
										</Link>
									</li>
								) : null}
							</ul>
						)}
					</QueryState>
				</Panel>

				<Panel
					title="Upcoming exams"
					subtitle="Open and scheduled"
					icon={CalendarRange}
					bodyClass="p-2"
					actions={<Link to={q(`${BASE}/exams`)} className="text-xs font-semibold text-brand-700 hover:underline">All exams</Link>}
				>
					{termExams.isLoading ? (
						<SkeletonRows rows={4} />
					) : upcoming.length ? (
						<ul>
							{upcoming.slice(0, 6).map((e) => (
								<ListRow
									key={e.name}
									to={`${BASE}/exams/${encodeURIComponent(e.name)}`}
									title={e.title}
									sub={`${e.course} · ${e.start_datetime ? dateTime(e.start_datetime) : "Not scheduled"}`}
									right={<Badge status={e.status} size="xs" />}
								/>
							))}
						</ul>
					) : (
						<Empty compact icon={CalendarRange} title="No upcoming exams" subtitle="Lecturers set exams up from their portal." />
					)}
				</Panel>
			</div>

			<div className="mb-5 grid gap-5 lg:grid-cols-2">
				<Panel title="Results progress" subtitle="Mark sheet status across this term's offerings" icon={Scale}>
					{stats.isLoading ? (
						<SkeletonRows rows={3} />
					) : resultData.length ? (
						<div className="grid items-center gap-4 sm:grid-cols-2">
							<DonutChart data={resultData} height={190} center={num(rs.Published || 0)} centerLabel="Published" />
							<Legendary data={resultData} />
						</div>
					) : (
						<Empty compact title="No offerings this term yet" />
					)}
				</Panel>
				<Panel title="Offerings by status" subtitle="Planned, open, running and completed" icon={Layers}>
					{stats.isLoading ? (
						<SkeletonRows rows={3} />
					) : byStatus.length ? (
						<BarsChart data={byStatus} series={[{ key: "value", label: "Offerings" }]} height={200} />
					) : (
						<Empty compact title="No offerings this term yet" />
					)}
				</Panel>
			</div>

			<h2 className="mb-3 text-base font-semibold text-ink">Go to</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				<Tile icon={GraduationCap} label="Programmes" sub="Curricula and entry" to={`${BASE}/programmes`} />
				<Tile icon={Library} label="Courses" sub="Credits and prerequisites" to={`${BASE}/courses`} tone="purple" />
				<Tile icon={BookOpen} label="Offerings" sub="Lecturers and timetable" to={q(`${BASE}/offerings`)} tone="blue" />
				<Tile icon={CalendarRange} label="Calendar" sub="Years, terms, intakes" to={`${BASE}/calendar`} tone="green" />
				<Tile icon={ClipboardCheck} label="Exams" sub="Monitor and release" to={q(`${BASE}/exams`)} tone="orange" />
				<Tile icon={FileQuestion} label="Question bank" sub="Six question types" to={`${BASE}/question-bank`} tone="gold" />
				<Tile icon={FileSpreadsheet} label="Mark sheets" sub="Approve and publish" to={q(`${BASE}/mark-sheets`)} />
				<Tile icon={Scale} label="Results" sub="Term outcomes" to={q(`${BASE}/results`)} tone="purple" />
				<Tile icon={Layers} label="Grading scales" sub="Bands and points" to={`${BASE}/grading`} tone="blue" />
			</div>
		</>
	)
}
