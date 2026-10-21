import { useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, BookOpen, CalendarDays, Clock, GraduationCap, Laptop, MapPin, Newspaper, Radio, Ticket, Users } from "lucide-react"
import { Avatar, Badge, Skeleton } from "@/shared/components/ui"
import { date, money, time } from "@/shared/utils/format"
import { plainText } from "@/shared/api/frappe"
import { bareName, clip, toDate } from "../lib"

const WASHES = [
	"from-brand-900 via-brand-800 to-brand-700",
	"from-brand-800 via-brand-700 to-gold-700",
	"from-gold-700 via-brand-800 to-brand-900",
	"from-brand-700 via-brand-900 to-brand-800",
]

function hash(s = "") {
	let h = 0
	for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
	return Math.abs(h)
}

/** Image from the API, or a branded gradient + pattern + icon composition when there is none (or it fails). */
export function Cover({ src, alt = "", seed = "", icon: Icon = BookOpen, className, label, children, rounded = "" }) {
	const [failed, setFailed] = useState(false)
	const showImg = src && !failed
	return (
		<div className={clsx("relative overflow-hidden", rounded, className)}>
			{showImg ? (
				<img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
			) : (
				<div className={clsx("absolute inset-0 bg-gradient-to-br", WASHES[hash(seed) % WASHES.length])}>
					<div aria-hidden className="pattern-dots absolute inset-0 opacity-40" />
					<div aria-hidden className="absolute -right-8 -top-8 h-32 w-32 rounded-full border border-white/10" />
					<div aria-hidden className="absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-gold-500/10" />
					<Icon aria-hidden size={56} strokeWidth={1.25} className="absolute bottom-4 right-4 text-white/20 transition duration-500 group-hover:scale-110" />
					{label ? <span className="absolute left-4 top-4 max-w-[70%] font-serif text-sm leading-snug text-white/80">{label}</span> : null}
				</div>
			)}
			{children}
		</div>
	)
}

export function ProgrammeCard({ p, className }) {
	const fee = p.indicative_fee_per_term
	return (
		<Link
			to={`/programmes/${encodeURIComponent(p.code)}`}
			className={clsx("card group flex flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-lift", className)}
		>
			<Cover src={p.image} seed={p.code || p.name} icon={GraduationCap} className="h-40" label={p.award_title || p.name}>
				<span className="absolute bottom-3 left-3 rounded-full bg-surface/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-800 shadow-sm">
					{p.level}
				</span>
			</Cover>
			<div className="flex flex-1 flex-col p-5">
				<div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{p.code}</div>
				<h3 className="mt-1 font-serif text-lg leading-snug text-ink group-hover:text-brand-800">{p.name}</h3>
				{p.short_description ? <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">{p.short_description}</p> : null}
				<div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-soft">
					{p.duration ? (
						<span className="inline-flex items-center gap-1.5">
							<Clock size={13} /> {p.duration}
						</span>
					) : null}
					{p.study_modes?.length ? (
						<span className="inline-flex items-center gap-1.5">
							<Laptop size={13} /> {p.study_modes.slice(0, 2).join(", ")}
							{p.study_modes.length > 2 ? ` +${p.study_modes.length - 2}` : ""}
						</span>
					) : null}
					{p.campuses?.length ? (
						<span className="inline-flex items-center gap-1.5">
							<MapPin size={13} /> {p.campuses.length === 1 ? p.campuses[0] : `${p.campuses.length} campuses`}
						</span>
					) : null}
				</div>
				<div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
					<span className="text-ink-soft">
						{fee ? (
							<>
								From <span className="font-semibold text-ink">{money(fee)}</span>/term
							</>
						) : (
							"View details"
						)}
					</span>
					<ArrowRight size={16} className="text-gold-600 transition group-hover:translate-x-1" />
				</div>
			</div>
		</Link>
	)
}

export function NewsCard({ post, featured, className }) {
	const to = `/news/${post.route}`
	if (featured) {
		return (
			<Link to={to} className={clsx("card group grid overflow-hidden transition hover:shadow-lift md:grid-cols-2", className)}>
				<Cover src={post.cover_image} seed={post.title} icon={Newspaper} className="min-h-[220px] md:min-h-[320px]" alt={post.title} />
				<div className="flex flex-col justify-center p-6 sm:p-8">
					<div className="flex flex-wrap items-center gap-2">
						<Badge tone="gold">Featured</Badge>
						{post.category ? <Badge tone="brand">{post.category}</Badge> : null}
					</div>
					<h3 className="mt-3 font-serif text-2xl leading-snug text-ink group-hover:text-brand-800 sm:text-3xl">{post.title}</h3>
					{post.excerpt ? <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed text-ink-muted">{clip(plainText(post.excerpt), 260)}</p> : null}
					<div className="mt-5 flex items-center justify-between text-xs text-ink-soft">
						<span>
							{date(post.published_on)}
							{post.author ? ` · ${post.author}` : ""}
						</span>
						<span className="inline-flex items-center gap-1 font-semibold text-brand-700">
							Read story <ArrowRight size={14} className="transition group-hover:translate-x-1" />
						</span>
					</div>
				</div>
			</Link>
		)
	}
	return (
		<Link to={to} className={clsx("card group flex flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-lift", className)}>
			<Cover src={post.cover_image} seed={post.title} icon={Newspaper} className="h-44" alt={post.title}>
				{post.category ? (
					<span className="absolute left-3 top-3 rounded-full bg-surface/95 px-2.5 py-1 text-[11px] font-bold text-brand-800 shadow-sm">{post.category}</span>
				) : null}
			</Cover>
			<div className="flex flex-1 flex-col p-5">
				<div className="text-xs text-ink-soft">{date(post.published_on)}</div>
				<h3 className="mt-1.5 line-clamp-2 font-serif text-lg leading-snug text-ink group-hover:text-brand-800">{post.title}</h3>
				{post.excerpt ? <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">{clip(plainText(post.excerpt), 180)}</p> : null}
				<span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-brand-700">
					Read more <ArrowRight size={14} className="transition group-hover:translate-x-1" />
				</span>
			</div>
		</Link>
	)
}

export function DateBlock({ value, className, dark }) {
	const d = toDate(value)
	if (!d) return null
	return (
		<div
			className={clsx(
				"flex w-16 shrink-0 flex-col items-center justify-center rounded-2xl py-2 text-center",
				dark ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-cream text-brand-800 ring-1 ring-gold-200",
				className
			)}
		>
			<span className={clsx("text-[10.5px] font-bold uppercase tracking-widest", dark ? "text-gold-300" : "text-gold-700")}>
				{date(value, { month: "short" })}
			</span>
			<span className="font-serif text-2xl font-bold leading-none">{date(value, { day: "numeric" })}</span>
			<span className="mt-0.5 text-[10px] font-semibold opacity-60">{date(value, { year: "numeric" })}</span>
		</div>
	)
}

export function eventWhen(e) {
	const s = toDate(e.start_datetime)
	const end = toDate(e.end_datetime)
	if (!s) return ""
	const sameDay = end && date(e.start_datetime) === date(e.end_datetime)
	if (end && !sameDay) return `${date(e.start_datetime)} – ${date(e.end_datetime)}`
	return `${date(e.start_datetime, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · ${time(e.start_datetime)}${end ? `–${time(e.end_datetime)}` : ""}`
}

export function EventCard({ ev, className, compact }) {
	const free = !Number(ev.fee)
	return (
		<Link
			to={`/events/${ev.route}`}
			className={clsx("card group flex gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-lift sm:p-5", compact ? "items-center" : "items-start", className)}
		>
			<DateBlock value={ev.start_datetime} />
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					{ev.event_type ? <Badge tone="brand">{ev.event_type}</Badge> : null}
					{ev.status && !["Published", "Scheduled", "Open", "Upcoming"].includes(ev.status) ? <Badge status={ev.status}>{ev.status}</Badge> : null}
					{ev.livestream_url ? (
						<Badge tone="red">
							<Radio size={11} className="mr-0.5 inline" /> Live stream
						</Badge>
					) : null}
				</div>
				<h3 className="mt-1.5 line-clamp-2 font-serif text-lg leading-snug text-ink group-hover:text-brand-800">{ev.title}</h3>
				<div className="mt-1.5 space-y-1 text-xs text-ink-soft">
					<div className="flex items-center gap-1.5">
						<CalendarDays size={13} className="shrink-0" /> {eventWhen(ev)}
					</div>
					{ev.venue || ev.campus ? (
						<div className="flex items-center gap-1.5">
							<MapPin size={13} className="shrink-0" /> <span className="truncate">{ev.venue || ev.campus}</span>
						</div>
					) : null}
				</div>
				{!compact && ev.summary ? <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{clip(plainText(ev.summary), 160)}</p> : null}
				{!compact && (ev.registration_required || !free) ? (
					<div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
						<span className={clsx("inline-flex items-center gap-1", free ? "text-emerald-700" : "text-gold-700")}>
							<Ticket size={13} /> {free ? "Free" : money(ev.fee)}
						</span>
						{ev.seats_left != null && ev.capacity ? (
							<span className="inline-flex items-center gap-1 text-ink-soft">
								<Users size={13} /> {ev.seats_left > 0 ? `${ev.seats_left} seats left` : "Fully booked"}
							</span>
						) : null}
					</div>
				) : null}
			</div>
		</Link>
	)
}

export function PersonCard({ person, onClick, className }) {
	const name = person.full_name || person.name
	const Tag = onClick ? "button" : "div"
	return (
		<Tag
			type={onClick ? "button" : undefined}
			onClick={onClick}
			className={clsx("card group flex w-full flex-col items-center p-4 text-center transition sm:p-6", onClick && "hover:-translate-y-1 hover:shadow-lift", className)}
		>
			<div className="relative">
				<span aria-hidden className="absolute -inset-1.5 rounded-full bg-gradient-to-br from-gold-300 to-brand-700 opacity-60" />
				<Avatar
					name={bareName(name)}
					src={person.photo}
					size={96}
					className="relative !h-[72px] !w-[72px] !text-[27px] ring-4 ring-surface sm:!h-24 sm:!w-24 sm:!text-[36px]"
				/>
			</div>
			<h3 className="mt-4 font-serif text-base leading-snug text-ink sm:text-lg">{name}</h3>
			{person.designation ? <div className="mt-0.5 text-xs font-semibold text-gold-700 sm:text-sm">{person.designation}</div> : null}
			{person.department ? <div className="mt-1 text-xs text-ink-soft">{person.department}</div> : null}
			{person.specialisation ? <div className="mt-2 line-clamp-2 text-xs text-ink-muted">{person.specialisation}</div> : null}
			{onClick && person.bio ? <span className="mt-3 text-xs font-semibold text-brand-700 group-hover:underline">Read bio</span> : null}
		</Tag>
	)
}

export function CardGridSkeleton({ count = 3, className, tall = true }) {
	return (
		<div className={clsx("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className="card overflow-hidden">
					{tall ? <Skeleton className="h-40 rounded-none" /> : null}
					<div className="space-y-2.5 p-5">
						<Skeleton className="h-3 w-1/4" />
						<Skeleton className="h-5 w-4/5" />
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-2/3" />
					</div>
				</div>
			))}
		</div>
	)
}

export function ListSkeleton({ rows = 3, className }) {
	return (
		<div className={clsx("space-y-4", className)}>
			{Array.from({ length: rows }).map((_, i) => (
				<div key={i} className="card flex gap-4 p-5">
					<Skeleton className="h-16 w-16 rounded-2xl" />
					<div className="flex-1 space-y-2.5">
						<Skeleton className="h-3 w-1/5" />
						<Skeleton className="h-5 w-3/5" />
						<Skeleton className="h-3 w-2/5" />
					</div>
				</div>
			))}
		</div>
	)
}
