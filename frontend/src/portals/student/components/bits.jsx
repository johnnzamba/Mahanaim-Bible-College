import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import {
	BookOpen,
	Check,
	Copy,
	FileText,
	Headphones,
	Image,
	Link2,
	MonitorPlay,
	PlayCircle,
	ScrollText,
	SearchX,
	Users,
} from "lucide-react"
import { Badge, Empty, ProgressBar, TONE } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { dueInfo, onServerClock, safeUrl, serverNow, syncServerTime } from "./lib"

/** Re-render every `ms` (and whenever the server clock is re-synced); returns server-now. */
export function useTick(ms = 1000) {
	const [now, setNow] = useState(serverNow)
	useEffect(() => {
		const id = setInterval(() => setNow(serverNow()), ms)
		const off = onServerClock(() => setNow(serverNow()))
		return () => {
			clearInterval(id)
			off()
		}
	}, [ms])
	return now
}

/** External link for a server-supplied URL: an <a> only when safeUrl() accepts it, otherwise inert text. */
export function SafeLink({ href, className, children, ...rest }) {
	const url = safeUrl(href)
	if (!url) return <span className={className}>{children}</span>
	return (
		<a href={url} target="_blank" rel="noreferrer" className={className} {...rest}>
			{children}
		</a>
	)
}

/** Learn the server clock from any payload that carries server_time. */
export function useServerTime(serverTime, receivedAt) {
	useEffect(() => {
		if (serverTime) syncServerTime(serverTime, receivedAt)
	}, [serverTime, receivedAt])
}

export function DueBadge({ due, done, size = "sm", className }) {
	useTick(30000)
	const info = dueInfo(due, { done })
	return (
		<Badge tone={info.tone} size={size} dot className={className}>
			{info.label}
		</Badge>
	)
}

/** Dark forest hero band used at the top of key pages. */
export function Hero({ children, className }) {
	return (
		<section className={clsx("hero-wash relative overflow-hidden rounded-2xl text-white shadow-soft", className)}>
			<div className="pattern-dots pointer-events-none absolute inset-0 opacity-40" aria-hidden />
			<div className="relative p-5 sm:p-6">{children}</div>
		</section>
	)
}

/** Gold call-to-action that keeps dark text in both themes (shared .btn-gold flips to light text in dark mode). */
export const GOLD_BTN = "btn bg-gold-500 text-brand-900 shadow-sm hover:bg-gold-400 dark:text-brand-50"

/** A small label/value pair on a dark hero. */
export function HeroStat({ label, value, sub }) {
	return (
		<div className="min-w-0">
			<div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{label}</div>
			<div className="mt-0.5 truncate text-xl font-bold tabular-nums">{value}</div>
			{sub ? <div className="truncate text-xs text-white/70">{sub}</div> : null}
		</div>
	)
}

const RESOURCE_ICONS = {
	PDF: FileText,
	Document: ScrollText,
	Video: PlayCircle,
	Audio: Headphones,
	Image,
	Link: Link2,
	Embed: MonitorPlay,
	Text: BookOpen,
}

export const resourceIcon = (type) => RESOURCE_ICONS[type] || FileText

export function CourseCard({ course, compact }) {
	const pct = Number(course.progress || 0)
	const lecturers = (course.lecturers || []).map((l) => l.staff_name || l.name).filter(Boolean)
	return (
		<Link
			to={`/student/courses/${encodeURIComponent(course.name)}`}
			className="card group flex h-full flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-soft"
		>
			<div className="flex items-start justify-between gap-3">
				<span className="rounded-md bg-cream px-2 py-0.5 text-[11px] font-bold tracking-wide text-gold-700">{course.course}</span>
				<span className="shrink-0 text-xs font-medium text-ink-soft">{Number(course.credits || 0)} cr</span>
			</div>
			<h3 className="mt-2 line-clamp-2 font-serif text-[15.5px] leading-snug text-ink group-hover:text-brand-700">{course.course_title}</h3>
			{lecturers.length ? (
				<p className="mt-1 flex items-center gap-1.5 truncate text-xs text-ink-soft">
					<Users size={12} className="shrink-0" /> <span className="truncate">{lecturers.join(", ")}</span>
				</p>
			) : null}
			<div className="mt-auto pt-4">
				<div className="mb-1 flex items-center justify-between text-[11px] text-ink-soft">
					<span>{compact ? "Progress" : `${course.resource_count || 0} resources`}</span>
					<span className="font-semibold text-ink">{Math.round(pct)}%</span>
				</div>
				<ProgressBar value={pct} size="sm" tone={pct >= 100 ? "green" : "brand"} />
			</div>
		</Link>
	)
}

export function CopyButton({ text, label = "Copy", className }) {
	const [done, setDone] = useState(false)
	return (
		<button
			type="button"
			className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-ink-soft hover:bg-cream hover:text-ink", className)}
			aria-label={`${label} ${text}`}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text)
					setDone(true)
					toast.success("Copied")
					setTimeout(() => setDone(false), 1500)
				} catch {
					toast.error("Couldn't copy. Select the text instead.")
				}
			}}
		>
			{done ? <Check size={12} /> : <Copy size={12} />} {label}
		</button>
	)
}

export function NotFound() {
	return (
		<div className="py-10">
			<Empty
				icon={SearchX}
				title="Page not found"
				subtitle="That link doesn't lead anywhere in the student portal."
				action={
					<Link to="/student" className="btn btn-primary btn-sm">
						Back to dashboard
					</Link>
				}
			/>
		</div>
	)
}

/** Coloured icon square. */
export function IconChip({ icon: Icon, tone = "brand", size = 36, className }) {
	return (
		<span className={clsx("grid shrink-0 place-items-center rounded-xl", (TONE[tone] || TONE.brand).soft, className)} style={{ width: size, height: size }}>
			<Icon size={Math.round(size * 0.48)} />
		</span>
	)
}

/** Thin list row with an icon, title, subtitle and trailing slot. */
export function ListRow({ icon, tone, title, sub, right, to, onClick, className }) {
	const inner = (
		<div className={clsx("flex items-center gap-3 px-4 py-3", className)}>
			{icon ? <IconChip icon={icon} tone={tone} size={34} /> : null}
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-semibold text-ink">{title}</div>
				{sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
			</div>
			{right ? <div className="shrink-0">{right}</div> : null}
		</div>
	)
	if (to)
		return (
			<Link to={to} className="block transition hover:bg-cream/60">
				{inner}
			</Link>
		)
	if (onClick)
		return (
			<button type="button" onClick={onClick} className="block w-full text-left transition hover:bg-cream/60">
				{inner}
			</button>
		)
	return inner
}

/** A plain-language description of an exam state. */
export function examTone(status) {
	return { Open: "green", Scheduled: "blue", Closed: "gray", Marking: "orange", Released: "green" }[status] || "gray"
}
