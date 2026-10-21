import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, NotebookPen, User, Video } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Empty, PageHeader, QueryState, Skeleton } from "@/shared/components/ui"
import { API, addDays, hhmm, isoDate, minutesOf, safeUrl, serverNow, startOfWeek, toDate } from "../components/lib"
import { useTick } from "../components/bits"
import { siteWallClock } from "@/shared/utils/format"

const MODE_TONE = { Online: "blue", Hybrid: "purple", "In Person": "green" }

export default function Timetable() {
	const [offset, setOffset] = useState(0)
	// Session dates are server-local, so "today" follows the server clock (synced in StudentPortal).
	const today = isoDate(siteWallClock(useTick(60_000)))
	const weekStart = useMemo(() => addDays(startOfWeek(today), offset * 7), [today, offset])
	const from = isoDate(weekStart)
	const to = isoDate(addDays(weekStart, 6))
	const q = useApi(API.timetable, { from_date: from, to_date: to }, { placeholderData: (prev) => prev })
	const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))), [weekStart])
	const [picked, setPicked] = useState(null)
	const activeDay = picked && days.includes(picked) ? picked : days.includes(today) ? today : days[0]

	const byDay = useMemo(() => {
		const m = Object.fromEntries(days.map((d) => [d, []]))
		for (const s of q.data?.sessions || []) m[s.session_date]?.push({ kind: "class", ...s, sort: minutesOf(s.start_time) })
		for (const e of q.data?.exams || []) {
			const d = isoDate(e.start_datetime)
			const t = String(e.start_datetime).slice(11, 16)
			m[d]?.push({ kind: "exam", ...e, start_time: t, sort: minutesOf(t) })
		}
		for (const d of days) m[d].sort((a, b) => a.sort - b.sort)
		return m
	}, [q.data, days])
	const total = Object.values(byDay).reduce((n, l) => n + l.length, 0)
	const range = `${weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(weekStart, 6).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`

	return (
		<>
			<PageHeader eyebrow="Learning" title="Timetable" subtitle="Your classes and exams for the week, with venues and online links." />
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="flex items-center rounded-xl border border-line bg-surface">
					<button type="button" className="grid h-9 w-9 place-items-center rounded-l-xl hover:bg-cream" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
						<ChevronLeft size={18} />
					</button>
					<button type="button" className="h-9 border-x border-line px-3 text-sm font-semibold hover:bg-cream" onClick={() => (setOffset(0), setPicked(null))}>
						This week
					</button>
					<button type="button" className="grid h-9 w-9 place-items-center rounded-r-xl hover:bg-cream" onClick={() => setOffset((o) => o + 1)} aria-label="Next week">
						<ChevronRight size={18} />
					</button>
				</div>
				<span className="text-sm font-semibold text-ink">{range}</span>
				<span className="ml-auto text-xs text-ink-soft">{q.isFetching ? "Loading…" : `${total} ${total === 1 ? "item" : "items"}`}</span>
			</div>

			<QueryState query={q} skeleton={<Skeleton className="h-96 rounded-2xl" />}>
				{() => (
					<>
						{/* Mobile: day chips + list */}
						<div className="lg:hidden">
							<div className="scroll-thin -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Day">
								{days.map((d) => {
									const dt = toDate(d)
									const on = d === activeDay
									return (
										<button
											key={d}
											type="button"
											role="tab"
											aria-selected={on}
											onClick={() => setPicked(d)}
											className={clsx(
												"flex min-w-[3.25rem] flex-col items-center rounded-xl border px-2 py-1.5 transition",
												on ? "border-brand-700 bg-brand-800 text-white dark:bg-brand-600 dark:text-brand-50" : "border-line bg-surface text-ink",
												d === today && !on && "border-gold-400"
											)}
										>
											<span className="text-[10px] font-semibold uppercase">{dt.toLocaleDateString("en-GB", { weekday: "short" })}</span>
											<span className="text-base font-bold">{dt.getDate()}</span>
											<span className={clsx("mt-0.5 h-1 w-1 rounded-full", byDay[d].length ? (on ? "bg-gold-300" : "bg-brand-500") : "bg-transparent")} />
										</button>
									)
								})}
							</div>
							<DayList items={byDay[activeDay]} date={activeDay} today={today} />
						</div>
						{/* Desktop: week grid */}
						<div className="hidden gap-2 lg:grid lg:grid-cols-7">
							{days.map((d) => {
								const dt = toDate(d)
								return (
									<div key={d} className={clsx("flex min-h-[22rem] flex-col rounded-2xl border bg-surface", d === today ? "border-gold-400 shadow-soft" : "border-line")}>
										<div className={clsx("rounded-t-2xl border-b border-line px-3 py-2", d === today && "bg-cream")}>
											<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{dt.toLocaleDateString("en-GB", { weekday: "long" })}</div>
											<div className="flex items-baseline gap-1.5">
												<span className="text-lg font-bold text-ink">{dt.getDate()}</span>
												<span className="text-xs text-ink-soft">{dt.toLocaleDateString("en-GB", { month: "short" })}</span>
												{d === today ? <span className="ml-auto text-[10px] font-bold uppercase text-gold-700">Today</span> : null}
											</div>
										</div>
										<div className="flex-1 space-y-2 p-2">
											{byDay[d].length ? byDay[d].map((it) => <Item key={`${it.kind}-${it.name}`} it={it} date={d} today={today} compact />) : <p className="px-1 pt-2 text-xs text-ink-soft">Free</p>}
										</div>
									</div>
								)
							})}
						</div>
					</>
				)}
			</QueryState>
		</>
	)
}

function DayList({ items, date: d, today }) {
	if (!items?.length)
		return (
			<div className="card">
				<Empty compact icon={CalendarDays} title={d === today ? "No classes today" : "Nothing scheduled"} subtitle="Enjoy some time for personal study and prayer." />
			</div>
		)
	return (
		<div className="space-y-2.5">
			{items.map((it) => (
				<Item key={`${it.kind}-${it.name}`} it={it} date={d} today={today} />
			))}
		</div>
	)
}

function Item({ it, date: d, today, compact }) {
	useTick(60000)
	const nowMin = (() => {
		const n = siteWallClock(serverNow())
		return n.getHours() * 60 + n.getMinutes()
	})()
	if (it.kind === "exam")
		return (
			<Link
				to={`/student/exams/${encodeURIComponent(it.name)}`}
				className="block rounded-xl border border-l-4 border-line border-l-purple-500 bg-surface p-2.5 transition hover:shadow-soft"
			>
				<div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">
					<NotebookPen size={12} /> {it.exam_type}
				</div>
				<div className={clsx("mt-0.5 font-semibold text-ink", compact ? "line-clamp-2 text-xs" : "text-sm")}>{it.title}</div>
				<div className="mt-1 text-[11px] text-ink-soft">
					{it.start_time} · {it.delivery_mode === "Online" ? "Online" : it.venue || it.delivery_mode}
				</div>
			</Link>
		)
	const live = d === today && nowMin >= minutesOf(it.start_time) && nowMin < minutesOf(it.end_time)
	const past = d < today || (d === today && nowMin >= minutesOf(it.end_time))
	const cancelled = /cancel/i.test(it.status || "")
	const online = it.mode === "Online" || it.mode === "Hybrid"
	return (
		<div
			className={clsx(
				"rounded-xl border border-l-4 bg-surface transition",
				compact ? "p-2.5" : "p-3.5",
				live ? "border-line border-l-emerald-500 shadow-soft" : cancelled ? "border-line border-l-red-400 opacity-70" : "border-line border-l-brand-500",
				past && !live && "opacity-75"
			)}
		>
			<div className="flex items-center gap-1.5">
				<span className={clsx("font-semibold tabular-nums text-ink", compact ? "text-[11px]" : "text-xs")}>
					{hhmm(it.start_time)}–{hhmm(it.end_time)}
				</span>
				{live ? <Badge tone="green" size="xs" dot>Now</Badge> : null}
				{cancelled ? <Badge tone="red" size="xs">Cancelled</Badge> : null}
				{!compact && it.mode ? (
					<Badge tone={MODE_TONE[it.mode] || "gray"} size="xs" className="ml-auto">
						{it.mode}
					</Badge>
				) : null}
			</div>
			<Link to={`/student/courses/${encodeURIComponent(it.course_offering)}`} className={clsx("mt-1 block font-semibold text-ink hover:text-brand-700", compact ? "line-clamp-2 text-xs" : "text-sm")}>
				{it.course_title}
			</Link>
			{it.topic && !compact ? <div className="text-xs text-ink-muted">{it.topic}</div> : null}
			<div className={clsx("mt-1.5 space-y-0.5 text-ink-soft", compact ? "text-[11px]" : "text-xs")}>
				{it.venue ? (
					<div className="flex items-center gap-1 truncate">
						<MapPin size={11} className="shrink-0" /> <span className="truncate">{it.venue}</span>
					</div>
				) : null}
				{it.lecturer_name ? (
					<div className="flex items-center gap-1 truncate">
						<User size={11} className="shrink-0" /> <span className="truncate">{it.lecturer_name}</span>
					</div>
				) : null}
				{compact && it.mode && it.mode !== "In Person" ? (
					<div className="flex items-center gap-1">
						<Clock size={11} /> {it.mode}
					</div>
				) : null}
			</div>
			{online && safeUrl(it.meeting_link) && !cancelled && !past ? (
				<a
					href={safeUrl(it.meeting_link)}
					target="_blank"
					rel="noreferrer"
					className={clsx("btn btn-sm mt-2 w-full", live ? "btn-primary" : "btn-secondary")}
					aria-label={`Join ${it.course_title} online`}
				>
					<Video size={14} /> {live ? "Join now" : "Join link"}
				</a>
			) : null}
		</div>
	)
}
