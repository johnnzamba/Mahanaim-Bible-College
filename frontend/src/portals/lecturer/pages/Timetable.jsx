import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, FileQuestion, MapPin, Video } from "lucide-react"
import { Button, Card, Empty, ErrorState, IconButton, PageHeader, SkeletonRows } from "@/shared/components/ui"
import { date } from "@/shared/utils/format"
import { SessionDialog } from "../components/SessionDialog"
import { StatusBadge } from "../components/bits"
import { useAcross } from "../components/useAcross"
import { M, addDays, hm, minutesOf, mondayOf, parseYmd, ymd } from "../components/lib"

const PALETTE = [
	"border-l-brand-600 bg-brand-50 text-brand-800",
	"border-l-gold-500 bg-gold-50 text-gold-800",
	"border-l-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200",
	"border-l-sky-600 bg-sky-50 text-sky-900 dark:bg-sky-500/10 dark:text-sky-200",
	"border-l-purple-600 bg-purple-50 text-purple-900 dark:bg-purple-500/10 dark:text-purple-200",
	"border-l-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-500/10 dark:text-orange-200",
]
const HOUR = 52
const DAYS = 7

function useWeek(start) {
	const from = ymd(start)
	const to = ymd(addDays(start, DAYS - 1))
	const sessions = useAcross(M.listSessions, { from_date: from, to_date: to })
	const exams = useAcross(M.listExams, {})
	return { from, to, sessions, exams }
}

export default function Timetable() {
	const [start, setStart] = useState(() => mondayOf(new Date()))
	const { from, to, sessions, exams } = useWeek(start)
	const [dialog, setDialog] = useState(null)
	const today = ymd()
	const days = Array.from({ length: DAYS }, (_, i) => ymd(addDays(start, i)))
	const colour = useMemo(() => Object.fromEntries(sessions.offerings.map((o, i) => [o.name, PALETTE[i % PALETTE.length]])), [sessions.offerings])

	const byDay = useMemo(() => {
		const out = Object.fromEntries(days.map((d) => [d, { sessions: [], exams: [] }]))
		for (const s of sessions.data?.data || []) out[s.session_date]?.sessions.push(s)
		for (const e of exams.data?.data || []) {
			if (["Draft", "Cancelled"].includes(e.status) || !e.start_datetime) continue
			const a = String(e.start_datetime).slice(0, 10)
			const b = String(e.end_datetime || e.start_datetime).slice(0, 10)
			for (const d of days) if (d >= a && d <= b) out[d].exams.push(e)
		}
		for (const d of days) out[d].sessions.sort((x, y) => minutesOf(x.start_time) - minutesOf(y.start_time))
		return out
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessions.data, exams.data, from])

	const all = days.flatMap((d) => byDay[d].sessions)
	const startHour = Math.min(7, ...all.map((s) => Math.floor(minutesOf(s.start_time) / 60)))
	const endHour = Math.max(18, ...all.map((s) => Math.ceil(minutesOf(s.end_time) / 60)))
	const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
	const showWeekend = days.slice(5).some((d) => byDay[d].sessions.length || byDay[d].exams.length)
	const gridDays = showWeekend ? days : days.slice(0, 5)
	const hoursTaught = all.filter((s) => s.status !== "Cancelled").reduce((a, s) => a + (minutesOf(s.end_time) - minutesOf(s.start_time)) / 60, 0)
	const label = `${date(from, { day: "numeric", month: "short" })} – ${date(to, { day: "numeric", month: "short", year: "numeric" })}`
	const loading = sessions.isLoading

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Teaching"
				title="Timetable"
				subtitle={loading ? label : `${label} · ${all.length} class${all.length === 1 ? "" : "es"} · ${Math.round(hoursTaught * 10) / 10} h`}
				actions={
					<Button size="sm" icon={CalendarDays} onClick={() => setDialog({})}>
						New session
					</Button>
				}
			/>
			<div className="flex items-center gap-2">
				<IconButton icon={ChevronLeft} label="Previous week" onClick={() => setStart((d) => addDays(d, -7))} />
				<IconButton icon={ChevronRight} label="Next week" onClick={() => setStart((d) => addDays(d, 7))} />
				<Button size="sm" variant="secondary" disabled={from === ymd(mondayOf(new Date()))} onClick={() => setStart(mondayOf(new Date()))}>
					This week
				</Button>
				<span className="ml-1 text-sm font-semibold text-ink">{label}</span>
			</div>

			{sessions.isError ? (
				<Card>
					<ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
				</Card>
			) : loading ? (
				<Card className="p-5">
					<SkeletonRows rows={6} />
				</Card>
			) : (
				<>
					{/* Desktop week grid */}
					<Card className="hidden overflow-hidden lg:block">
						<div className="grid" style={{ gridTemplateColumns: `56px repeat(${gridDays.length}, minmax(0, 1fr))` }}>
							<div className="border-b border-line bg-cream/60" />
							{gridDays.map((d) => (
								<div key={d} className={`border-b border-l border-line px-2 py-2 text-center ${d === today ? "bg-brand-50" : "bg-cream/60"}`}>
									<div className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{parseYmd(d).toLocaleDateString("en-GB", { weekday: "short" })}</div>
									<div className={`text-lg font-bold tabular-nums ${d === today ? "text-brand-700" : "text-ink"}`}>{parseYmd(d).getDate()}</div>
								</div>
							))}
							{gridDays.some((d) => byDay[d].exams.length) ? (
								<>
									<div className="border-b border-line px-1 py-1.5 text-right text-[10px] font-semibold uppercase text-ink-soft">Exams</div>
									{gridDays.map((d) => (
										<div key={d} className="space-y-1 border-b border-l border-line p-1">
											{byDay[d].exams.map((e) => (
												<Link key={e.name} to={`/lecturer/exams/${e.name}`} className="flex items-center gap-1 truncate rounded-md bg-purple-50 px-1.5 py-1 text-[11px] font-semibold text-purple-800 hover:underline dark:bg-purple-500/10 dark:text-purple-200" title={`${e.title} · ${e.course_title}`}>
													<FileQuestion size={11} className="shrink-0" />
													<span className="truncate">{e.title}</span>
												</Link>
											))}
										</div>
									))}
								</>
							) : null}
							<div className="relative">
								{hours.map((h) => (
									<div key={h} className="pr-2 text-right text-[11px] tabular-nums text-ink-soft" style={{ height: HOUR }}>
										<span className="relative -top-2">{String(h).padStart(2, "0")}:00</span>
									</div>
								))}
							</div>
							{gridDays.map((d) => (
								<div key={d} className={`relative border-l border-line ${d === today ? "bg-brand-50/40" : ""}`} style={{ height: hours.length * HOUR }}>
									{hours.map((h, i) => (
										<div key={h} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR }} />
									))}
									{byDay[d].sessions.map((s) => {
										const top = ((minutesOf(s.start_time) - startHour * 60) / 60) * HOUR
										const height = Math.max(26, ((minutesOf(s.end_time) - minutesOf(s.start_time)) / 60) * HOUR - 2)
										const cancelled = s.status === "Cancelled"
										return (
											<Link
												key={s.name}
												to={cancelled ? `/lecturer/courses/${s.course_offering}?tab=attendance` : `/lecturer/attendance/${s.name}`}
												className={`absolute inset-x-1 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-xs shadow-sm transition hover:shadow-lift ${colour[s.course_offering] || PALETTE[0]} ${cancelled ? "opacity-50 line-through" : ""}`}
												style={{ top, height }}
												title={`${s.course_title} · ${hm(s.start_time)}–${hm(s.end_time)}${s.topic ? ` · ${s.topic}` : ""}`}
											>
												<div className="truncate font-semibold">{s.course_title}</div>
												<div className="truncate opacity-80">
													{hm(s.start_time)}–{hm(s.end_time)} · {s.mode !== "In Person" ? s.mode : s.venue || "TBC"}
												</div>
												{height > 60 && s.topic ? <div className="truncate opacity-70">{s.topic}</div> : null}
												{s.attendance_taken ? <ClipboardCheck size={12} className="absolute right-1.5 top-1.5 opacity-70" aria-label="Attendance taken" /> : null}
											</Link>
										)
									})}
									{d === today ? <NowLine startHour={startHour} endHour={endHour} /> : null}
								</div>
							))}
						</div>
					</Card>

					{/* Mobile / tablet day list */}
					<div className="space-y-4 lg:hidden">
						{days.map((d) => {
							const { sessions: list, exams: ex } = byDay[d]
							if (!list.length && !ex.length && d !== today) return null
							return (
								<section key={d} aria-label={parseYmd(d).toDateString()}>
									<h2 className={`mb-2 text-sm font-bold ${d === today ? "text-brand-700" : "text-ink"}`}>
										{parseYmd(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
										{d === today ? " · Today" : ""}
									</h2>
									<div className="space-y-2">
										{ex.map((e) => (
											<Link key={e.name} to={`/lecturer/exams/${e.name}`} className="card flex items-center gap-3 border-l-4 border-l-purple-500 p-3">
												<FileQuestion size={18} className="shrink-0 text-purple-600" />
												<div className="min-w-0 flex-1">
													<div className="truncate text-sm font-semibold text-ink">{e.title}</div>
													<div className="truncate text-xs text-ink-soft">{e.course_title}</div>
												</div>
												<StatusBadge kind="exam" status={e.status} size="xs" />
											</Link>
										))}
										{list.map((s) => (
											<Link key={s.name} to={`/lecturer/attendance/${s.name}`} className={`card flex items-center gap-3 border-l-4 p-3 ${(colour[s.course_offering] || PALETTE[0]).split(" ")[0]} ${s.status === "Cancelled" ? "opacity-60" : ""}`}>
												<div className="w-12 shrink-0 text-center leading-tight">
													<div className="text-sm font-bold tabular-nums text-ink">{hm(s.start_time)}</div>
													<div className="text-[11px] tabular-nums text-ink-soft">{hm(s.end_time)}</div>
												</div>
												<div className="min-w-0 flex-1">
													<div className="truncate text-sm font-semibold text-ink">{s.course_title}</div>
													<div className="flex items-center gap-1 truncate text-xs text-ink-soft">
														{s.mode !== "In Person" ? <Video size={12} /> : <MapPin size={12} />}
														{s.mode !== "In Person" ? s.mode : s.venue || "Venue TBC"}
														{s.topic ? ` · ${s.topic}` : ""}
													</div>
												</div>
												<StatusBadge kind="session" status={s.status} size="xs" />
											</Link>
										))}
										{!list.length && !ex.length ? <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-sm text-ink-soft">No classes today</p> : null}
									</div>
								</section>
							)
						})}
						{!all.length && !days.some((d) => byDay[d].exams.length) ? (
							<Card>
								<Empty compact icon={CalendarDays} title="Nothing scheduled this week" />
							</Card>
						) : null}
					</div>
				</>
			)}
			<SessionDialog open={Boolean(dialog)} onClose={() => setDialog(null)} />
		</div>
	)
}

function NowLine({ startHour, endHour }) {
	const n = new Date()
	const m = n.getHours() * 60 + n.getMinutes()
	if (m < startHour * 60 || m > endHour * 60) return null
	return (
		<div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: ((m - startHour * 60) / 60) * HOUR }} aria-hidden>
			<span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
			<span className="h-px flex-1 bg-red-500" />
		</div>
	)
}
