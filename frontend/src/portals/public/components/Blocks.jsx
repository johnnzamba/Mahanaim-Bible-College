import { useEffect, useId, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, Check, ChevronDown, ChevronRight, Copy, Facebook, Linkedin, Mail, MessageCircle, Quote, Twitter } from "lucide-react"
import { absoluteUrl } from "../lib"

export function Container({ className, children, narrow }) {
	return <div className={clsx("mx-auto px-4 lg:px-8", narrow ? "max-w-4xl" : "max-w-7xl", className)}>{children}</div>
}

/** Vertical rhythm for a page band. tone: plain | cream | surface | dark */
export function Band({ tone = "plain", className, children, id, narrow }) {
	return (
		<section
			id={id}
			className={clsx(
				"relative scroll-mt-24 py-14 sm:py-20",
				tone === "cream" && "bg-cream/70",
				tone === "surface" && "border-y border-line bg-surface",
				tone === "dark" && "hero-wash overflow-hidden text-white",
				className
			)}
		>
			{tone === "dark" ? <div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" /> : null}
			<Container narrow={narrow} className="relative">
				{children}
			</Container>
		</section>
	)
}

export function SectionHeading({ eyebrow, title, subtitle, align = "left", action, dark, className }) {
	const center = align === "center"
	return (
		<div className={clsx("mb-10 flex flex-col gap-4", center ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between", className)}>
			<div className={clsx(center ? "max-w-2xl" : "max-w-3xl")}>
				{eyebrow ? <div className={clsx("eyebrow", dark && "text-gold-300")}>{eyebrow}</div> : null}
				<h2 className={clsx("mt-2 font-serif text-[28px] leading-tight sm:text-4xl", dark ? "text-white" : "text-ink")}>{title}</h2>
				{subtitle ? <p className={clsx("mt-3 text-[15px] leading-relaxed", dark ? "text-white/75" : "text-ink-muted")}>{subtitle}</p> : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	)
}

export function Breadcrumbs({ items = [], dark = true }) {
	if (!items.length) return null
	return (
		<nav aria-label="Breadcrumb" className="mb-5">
			<ol className={clsx("flex flex-wrap items-center gap-1 text-xs font-medium", dark ? "text-white/60" : "text-ink-soft")}>
				<li>
					<Link to="/" className={clsx("hover:underline", dark ? "hover:text-white" : "hover:text-ink")}>
						Home
					</Link>
				</li>
				{items.map((it, i) => (
					<li key={`${it.label}-${i}`} className="flex items-center gap-1">
						<ChevronRight size={12} aria-hidden />
						{it.to && i < items.length - 1 ? (
							<Link to={it.to} className={clsx("hover:underline", dark ? "hover:text-white" : "hover:text-ink")}>
								{it.label}
							</Link>
						) : (
							<span aria-current={i === items.length - 1 ? "page" : undefined} className={clsx("line-clamp-1", dark ? "text-white/85" : "text-ink")}>
								{it.label}
							</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	)
}

/** Inner-page hero band: breadcrumbs, eyebrow, serif title, lead and optional actions / aside. */
export function PageHero({ eyebrow, title, subtitle, crumbs, actions, aside, children, compact }) {
	return (
		<section className="hero-wash relative overflow-hidden text-white">
			<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
			<div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full border border-white/10" />
			<div aria-hidden className="pointer-events-none absolute -right-10 top-24 h-64 w-64 rounded-full border border-gold-400/20" />
			<Container className={clsx("relative", compact ? "py-10 sm:py-14" : "py-12 sm:py-20")}>
				<Breadcrumbs items={crumbs} />
				<div className={clsx("grid gap-10", aside && "lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center")}>
					<div className="min-w-0 animate-fade-up">
						{eyebrow ? <div className="eyebrow text-gold-300">{eyebrow}</div> : null}
						<h1 className="mt-3 max-w-4xl font-serif text-[32px] text-white leading-[1.15] sm:text-5xl">{title}</h1>
						{subtitle ? <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">{subtitle}</p> : null}
						{actions ? <div className="mt-7 flex flex-wrap gap-3">{actions}</div> : null}
						{children}
					</div>
					{aside ? <div className="min-w-0 animate-fade-up">{aside}</div> : null}
				</div>
			</Container>
		</section>
	)
}

/** A KJV verse, set in the serif face. */
export function Scripture({ verse, dark, className, size = "md" }) {
	if (!verse) return null
	return (
		<figure className={clsx("relative", className)}>
			<Quote aria-hidden size={size === "lg" ? 44 : 30} className={clsx("mb-3", dark ? "text-gold-400/70" : "text-gold-500/70")} />
			<blockquote
				className={clsx(
					"font-serif italic leading-relaxed",
					size === "lg" ? "text-xl sm:text-2xl" : size === "sm" ? "text-[15px]" : "text-lg",
					dark ? "text-white/90" : "text-ink"
				)}
			>
				{verse.text}
			</blockquote>
			<figcaption className={clsx("mt-3 text-xs font-bold uppercase tracking-[0.18em]", dark ? "text-gold-300" : "text-gold-700")}>
				{verse.ref} <span className="font-semibold opacity-70">(KJV)</span>
			</figcaption>
		</figure>
	)
}

/** Closing call-to-action panel used at the bottom of most pages. */
export function CtaBand({
	eyebrow = "Answer the call",
	title = "Ready to be equipped for the harvest?",
	text = "Applications are open. Create your account in minutes, choose a programme and track every step online.",
	primary = { label: "Apply now", to: "/apply" },
	secondary = { label: "Talk to admissions", to: "/contact" },
	className,
}) {
	return (
		<section className={clsx("py-14 sm:py-20", className)}>
			<Container>
				<div className="hero-wash relative overflow-hidden rounded-3xl px-6 py-12 text-white shadow-lift sm:px-12 sm:py-14">
					<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
					<div aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full border-[28px] border-gold-500/10" />
					<div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
						<div className="max-w-2xl">
							<div className="eyebrow text-gold-300">{eyebrow}</div>
							<h2 className="mt-2 font-serif text-3xl leading-tight text-white sm:text-4xl">{title}</h2>
							{text ? <p className="mt-3 text-[15px] leading-relaxed text-white/75">{text}</p> : null}
						</div>
						<div className="flex shrink-0 flex-wrap gap-3">
							{primary ? (
								<Link to={primary.to} className="btn btn-gold btn-lg">
									{primary.label} <ArrowRight size={18} />
								</Link>
							) : null}
							{secondary ? (
								<Link to={secondary.to} className="btn btn-lg border border-white/25 text-white hover:bg-white/10">
									{secondary.label}
								</Link>
							) : null}
						</div>
					</div>
				</div>
			</Container>
		</section>
	)
}

/** Feature tile: icon in a soft square, title and text. */
export function Feature({ icon: Icon, title, children, dark, className }) {
	return (
		<div className={clsx("group", className)}>
			<span
				className={clsx(
					"grid h-12 w-12 place-items-center rounded-2xl transition group-hover:-translate-y-0.5",
					dark ? "bg-white/10 text-gold-300 ring-1 ring-white/15" : "bg-cream text-gold-700 ring-1 ring-gold-200"
				)}
			>
				<Icon size={22} />
			</span>
			<h3 className={clsx("mt-4 font-serif text-lg", dark ? "text-white" : "text-ink")}>{title}</h3>
			<div className={clsx("mt-1.5 text-sm leading-relaxed", dark ? "text-white/70" : "text-ink-muted")}>{children}</div>
		</div>
	)
}

/** Disclosure list. items: [{id, title, content, meta}] — one open at a time unless `multiple`. */
export function Accordion({ items = [], defaultOpen, multiple, className }) {
	const uid = useId()
	const [open, setOpen] = useState(() => new Set(defaultOpen ? [defaultOpen] : []))
	useEffect(() => {
		if (defaultOpen) setOpen((prev) => (prev.has(defaultOpen) ? prev : new Set(multiple ? [...prev, defaultOpen] : [defaultOpen])))
	}, [defaultOpen, multiple])
	const toggle = (id) =>
		setOpen((prev) => {
			const next = new Set(multiple ? prev : [])
			if (prev.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	return (
		<div className={clsx("divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface", className)}>
			{items.map((it, i) => {
				const id = it.id ?? String(i)
				const on = open.has(id)
				const panel = `${uid}-p-${i}`
				return (
					<div key={id} id={it.anchor} className="scroll-mt-28">
						<h3>
							<button
								type="button"
								aria-expanded={on}
								aria-controls={panel}
								onClick={() => toggle(id)}
								className={clsx("flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-cream/60", on && "bg-cream/50")}
							>
								<span className="min-w-0 flex-1">
									<span className="block text-[15px] font-semibold text-ink">{it.title}</span>
									{it.meta ? <span className="mt-0.5 block text-xs text-ink-soft">{it.meta}</span> : null}
								</span>
								<ChevronDown size={18} className={clsx("mt-0.5 shrink-0 text-ink-soft transition-transform", on && "rotate-180 text-gold-600")} />
							</button>
						</h3>
						{on ? (
							<div id={panel} role="region" className="animate-fade-up px-5 pb-5 text-sm leading-relaxed text-ink-muted">
								{it.content}
							</div>
						) : null}
					</div>
				)
			})}
		</div>
	)
}

export function ShareLinks({ title, url, className }) {
	const [copied, setCopied] = useState(false)
	const href = absoluteUrl(url || (typeof window !== "undefined" ? window.location.pathname : ""))
	const t = encodeURIComponent(title || "")
	const u = encodeURIComponent(href)
	const links = [
		{ label: "WhatsApp", icon: MessageCircle, href: `https://wa.me/?text=${t}%20${u}` },
		{ label: "Facebook", icon: Facebook, href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
		{ label: "X (Twitter)", icon: Twitter, href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
		{ label: "LinkedIn", icon: Linkedin, href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
		{ label: "Email", icon: Mail, href: `mailto:?subject=${t}&body=${u}` },
	]
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(href)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			window.prompt("Copy this link", href)
		}
	}
	return (
		<div className={clsx("flex flex-wrap items-center gap-2", className)}>
			{links.map(({ label, icon: Icon, href: h }) => (
				<a
					key={label}
					href={h}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Share on ${label}`}
					title={`Share on ${label}`}
					className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-muted transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
				>
					<Icon size={16} />
				</a>
			))}
			<button
				type="button"
				onClick={copy}
				className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-ink-muted transition hover:border-brand-300 hover:text-ink"
			>
				{copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
				{copied ? "Copied" : "Copy link"}
			</button>
		</div>
	)
}

/** Numbered steps laid out as connected cards (admissions process, M-Pesa steps…). */
export function Steps({ steps = [], dark, cols = 3, className }) {
	return (
		<ol className={clsx("grid gap-4", { 2: "sm:grid-cols-2", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-2 lg:grid-cols-5" }[cols] || "sm:grid-cols-2 lg:grid-cols-3", className)}>
			{steps.map((s, i) => {
				const title = typeof s === "string" ? s : s.title
				const text = typeof s === "string" ? null : s.text
				return (
					<li
						key={`${title}-${i}`}
						className={clsx(
							"relative rounded-2xl p-5",
							dark ? "border border-white/10 bg-white/5" : "border border-line bg-surface shadow-card"
						)}
					>
						<span
							className={clsx(
								"grid h-9 w-9 place-items-center rounded-full font-serif text-sm font-bold",
								dark ? "bg-gold-500 text-brand-900" : "bg-brand-800 text-white"
							)}
						>
							{i + 1}
						</span>
						<div className={clsx("mt-3 font-semibold", dark ? "text-white" : "text-ink")}>{title}</div>
						{text ? <div className={clsx("mt-1 text-sm leading-relaxed", dark ? "text-white/70" : "text-ink-muted")}>{text}</div> : null}
					</li>
				)
			})}
		</ol>
	)
}
