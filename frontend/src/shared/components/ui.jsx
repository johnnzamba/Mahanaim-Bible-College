import { forwardRef, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import clsx from "clsx"
import {
	AlertTriangle,
	ArrowDownRight,
	ArrowUpRight,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Eye,
	EyeOff,
	Inbox,
	Info,
	Loader2,
	RefreshCw,
	X,
	XCircle,
} from "lucide-react"
import { initials } from "../utils/format"
import { sanitizeHtml } from "../utils/sanitize"

/* ────────────────────────────── Surfaces ────────────────────────────── */

export function Card({ className, children, interactive, as: As = "div", ...props }) {
	return (
		<As
			className={clsx("card", interactive && "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-soft", className)}
			{...props}
		>
			{children}
		</As>
	)
}

export function PageHeader({ title, subtitle, eyebrow, actions, back, children }) {
	return (
		<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div className="min-w-0">
				{back ? (
					<Link to={back.to} className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-brand-700">
						<ChevronLeft size={14} /> {back.label || "Back"}
					</Link>
				) : null}
				{eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
				<h1 className="break-words font-serif text-[1.35rem] leading-tight text-ink sm:truncate sm:text-[1.6rem]">{title}</h1>
				{subtitle ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{subtitle}</p> : null}
				{children}
			</div>
			{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
		</div>
	)
}

export function Panel({ title, subtitle, actions, children, className, bodyClass, footer, icon: Icon }) {
	return (
		<section className={clsx("card flex min-w-0 flex-col", className)}>
			{title || actions ? (
				<header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
					<div className="flex min-w-0 items-center gap-2.5">
						{Icon ? (
							<span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
								<Icon size={16} />
							</span>
						) : null}
						<div className="min-w-0">
							<h3 className="truncate text-[15px] font-semibold text-ink">{title}</h3>
							{subtitle ? <p className="truncate text-xs text-ink-soft">{subtitle}</p> : null}
						</div>
					</div>
					{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
				</header>
			) : null}
			<div className={clsx("min-w-0 flex-1", bodyClass ?? "p-5")}>{children}</div>
			{footer ? <footer className="border-t border-line px-5 py-3">{footer}</footer> : null}
		</section>
	)
}

/* ────────────────────────────── Stats ────────────────────────────── */

export const TONE = {
	brand: { soft: "bg-brand-50 text-brand-700", solid: "bg-brand-700", ring: "stroke-brand-600", text: "text-brand-700" },
	gold: { soft: "bg-gold-50 text-gold-700", solid: "bg-gold-500", ring: "stroke-gold-500", text: "text-gold-700" },
	green: { soft: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", solid: "bg-emerald-600", ring: "stroke-emerald-500", text: "text-emerald-700" },
	blue: { soft: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300", solid: "bg-sky-600", ring: "stroke-sky-500", text: "text-sky-700" },
	orange: { soft: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300", solid: "bg-amber-500", ring: "stroke-amber-500", text: "text-amber-700" },
	red: { soft: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300", solid: "bg-red-600", ring: "stroke-red-500", text: "text-red-700" },
	purple: { soft: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300", solid: "bg-violet-600", ring: "stroke-violet-500", text: "text-violet-700" },
	gray: { soft: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300", solid: "bg-gray-500", ring: "stroke-gray-400", text: "text-gray-700" },
}

export function StatCard({ label, value, icon: Icon, tone = "brand", hint, delta, to, loading, className }) {
	const t = TONE[tone] || TONE.brand
	const body = (
		<div className={clsx("card flex h-full items-start gap-3 p-3.5 sm:gap-3.5 sm:p-4", to && "transition hover:-translate-y-0.5 hover:shadow-soft", className)}>
			{Icon ? (
				<span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-11 sm:w-11", t.soft)}>
					<Icon size={18} />
				</span>
			) : null}
			<div className="min-w-0 flex-1">
				<div className="line-clamp-2 text-xs font-semibold uppercase leading-snug tracking-wide text-ink-soft">{label}</div>
				{loading ? (
					<div className="skeleton mt-2 h-6 w-20" />
				) : (
					<div className="mt-1 break-words text-[1.2rem] font-bold leading-tight text-ink sm:truncate sm:text-[1.45rem]">{value ?? "—"}</div>
				)}
				{hint || delta != null ? (
					<div className="mt-1 flex items-center gap-2 text-xs text-ink-soft">
						{delta != null ? <DeltaPill value={delta} /> : null}
						{hint ? <span className="truncate">{hint}</span> : null}
					</div>
				) : null}
			</div>
		</div>
	)
	return to ? (
		<Link to={to} className="block">
			{body}
		</Link>
	) : (
		body
	)
}

export function DeltaPill({ value, suffix = "%", className }) {
	const n = Number(value || 0)
	const up = n >= 0
	const Icon = up ? ArrowUpRight : ArrowDownRight
	return (
		<span
			className={clsx(
				"inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold",
				up ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
				className
			)}
		>
			<Icon size={12} />
			{Math.abs(n)}
			{suffix}
		</span>
	)
}

export function Donut({ value = 0, size = 64, stroke = 7, tone = "brand", children, track = "stroke-line" }) {
	const r = (size - stroke) / 2
	const c = 2 * Math.PI * r
	const v = Math.max(0, Math.min(100, Number(value) || 0))
	return (
		<div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
			<svg width={size} height={size} className="-rotate-90">
				<circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={track} />
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={c}
					strokeDashoffset={c - (v / 100) * c}
					className={clsx("transition-[stroke-dashoffset] duration-700", (TONE[tone] || TONE.brand).ring)}
				/>
			</svg>
			<div className="absolute inset-0 grid place-items-center text-xs font-bold text-ink">{children ?? `${Math.round(v)}%`}</div>
		</div>
	)
}

export function ProgressBar({ value = 0, tone = "brand", className, size = "md", label }) {
	const v = Math.max(0, Math.min(100, Number(value) || 0))
	return (
		<div className={className}>
			{label ? (
				<div className="mb-1 flex justify-between text-xs text-ink-soft">
					<span>{label}</span>
					<span className="font-semibold text-ink-muted">{Math.round(v)}%</span>
				</div>
			) : null}
			<div className={clsx("w-full overflow-hidden rounded-full bg-line/70", size === "sm" ? "h-1.5" : "h-2.5")}>
				<div className={clsx("h-full rounded-full transition-all duration-700", (TONE[tone] || TONE.brand).solid)} style={{ width: `${v}%` }} />
			</div>
		</div>
	)
}

export function MetricRow({ items = [], className }) {
	return (
		<div className={clsx("grid divide-x divide-line rounded-2xl border border-line bg-surface", className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
			{items.map((it) => (
				<div key={it.label} className="min-w-0 px-4 py-3">
					<div className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{it.label}</div>
					<div className={clsx("mt-0.5 truncate text-lg font-bold", it.tone ? TONE[it.tone]?.text : "text-ink")}>{it.value}</div>
				</div>
			))}
		</div>
	)
}

/* ────────────────────────────── Badges / avatars ────────────────────────────── */

const STATUS_TONE = {
	green: [
		"active", "approved", "paid", "confirmed", "completed", "complete", "published", "passed", "pass", "enrolled",
		"accepted", "admitted", "issued", "sent", "delivered", "success", "graduated", "cleared", "open", "verified",
		"present", "registered", "in session", "valid", "approved by dean", "settled", "returned", "available", "attended",
	],
	orange: [
		"pending", "draft", "submitted", "under review", "partially paid", "partly paid", "awaiting payment", "in progress",
		"queued", "scheduled", "planned", "on hold", "interview scheduled", "registration open", "late", "processing",
		"waitlisted", "deferred", "examinations", "provisional", "moderation", "pending approval", "borrowed", "reserved",
		"interview", "unmatched", "matched", "reissued", "excused", "rescheduled",
	],
	red: [
		"rejected", "cancelled", "failed", "fail", "overdue", "suspended", "withdrawn", "expired", "revoked", "absent",
		"unpaid", "dismissed", "closed", "error", "blocked", "lost", "discontinued", "inactive", "retake", "supplementary",
		"declined", "voided", "reversed", "no transaction",
	],
	blue: ["new", "offered", "shortlisted", "info", "upcoming", "alumni", "transferred", "offer sent", "returned for changes", "allocated"],
}

export function toneForStatus(status) {
	const s = String(status || "").toLowerCase().trim()
	for (const [tone, list] of Object.entries(STATUS_TONE)) if (list.includes(s)) return tone
	return "gray"
}

export function Badge({ children, status, tone, className, dot = false, size = "sm" }) {
	const label = children ?? status
	const t = tone || toneForStatus(status ?? children)
	return (
		<span
			className={clsx(
				"inline-flex max-w-full items-center gap-1.5 truncate rounded-full font-semibold",
				size === "xs" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-0.5 text-[11.5px]",
				(TONE[t] || TONE.gray).soft,
				className
			)}
		>
			{dot ? <span className={clsx("h-1.5 w-1.5 rounded-full", (TONE[t] || TONE.gray).solid)} /> : null}
			{label}
		</span>
	)
}

export function Avatar({ name, src, size = 40, className, ring }) {
	const [broken, setBroken] = useState(false)
	const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) }
	if (src && !broken) {
		return (
			<img
				src={src}
				alt={name || ""}
				style={style}
				onError={() => setBroken(true)}
				className={clsx("shrink-0 rounded-full object-cover", ring && "ring-2 ring-surface", className)}
			/>
		)
	}
	return (
		<span
			style={style}
			aria-label={name}
			className={clsx(
				"inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 font-bold text-gold-200 dark:from-brand-200 dark:to-brand-100 dark:text-gold-300",
				ring && "ring-2 ring-surface",
				className
			)}
		>
			{initials(name)}
		</span>
	)
}

export function AvatarCell({ name, sub, image, size = 36, to }) {
	const inner = (
		<span className="flex min-w-0 items-center gap-3">
			<Avatar name={name} src={image} size={size} />
			<span className="min-w-0">
				<span className="block truncate font-semibold text-ink">{name}</span>
				{sub ? <span className="block truncate text-xs text-ink-soft">{sub}</span> : null}
			</span>
		</span>
	)
	return to ? (
		<Link to={to} className="hover:opacity-80">
			{inner}
		</Link>
	) : (
		inner
	)
}

/* ────────────────────────────── States ────────────────────────────── */

export function Empty({ title = "Nothing here yet", subtitle, icon: Icon = Inbox, action, className, compact }) {
	return (
		<div className={clsx("flex flex-col items-center justify-center text-center", compact ? "py-8" : "py-14", className)}>
			<span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-cream text-gold-600">
				<Icon size={22} />
			</span>
			<div className="font-semibold text-ink">{title}</div>
			{subtitle ? <p className="mt-1 max-w-sm text-sm text-ink-soft">{subtitle}</p> : null}
			{action ? <div className="mt-4">{action}</div> : null}
		</div>
	)
}

export function Spinner({ size = 18, className }) {
	return <Loader2 size={size} className={clsx("animate-spin", className)} />
}

export function Loading({ label = "Loading…", className }) {
	return (
		<div className={clsx("flex items-center justify-center gap-2 py-14 text-sm text-ink-soft", className)}>
			<Spinner /> {label}
		</div>
	)
}

export function Skeleton({ className }) {
	return <div className={clsx("skeleton", className)} />
}

export function SkeletonRows({ rows = 5, className }) {
	return (
		<div className={clsx("space-y-3", className)}>
			{Array.from({ length: rows }).map((_, i) => (
				<div key={i} className="flex items-center gap-3">
					<Skeleton className="h-9 w-9 rounded-full" />
					<div className="flex-1 space-y-1.5">
						<Skeleton className="h-3 w-2/5" />
						<Skeleton className="h-3 w-1/4" />
					</div>
				</div>
			))}
		</div>
	)
}

export function ErrorState({ error, onRetry, title = "Couldn't load this", className }) {
	return (
		<div className={clsx("flex flex-col items-center justify-center py-12 text-center", className)}>
			<span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950">
				<AlertTriangle size={22} />
			</span>
			<div className="font-semibold text-ink">{title}</div>
			<p className="mt-1 max-w-md whitespace-pre-line text-sm text-ink-soft">{error?.message || String(error || "")}</p>
			{onRetry ? (
				<button type="button" className="btn btn-secondary btn-sm mt-4" onClick={onRetry}>
					<RefreshCw size={14} /> Try again
				</button>
			) : null}
		</div>
	)
}

/** Render a react-query result: loading → skeleton, error → retry, empty → Empty, else children(data). */
export function QueryState({ query, children, empty, isEmpty, skeleton }) {
	if (query.isLoading) return skeleton ?? <SkeletonRows />
	if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
	const data = query.data
	const blank = isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : data == null
	if (blank && empty !== undefined) return empty
	return children(data)
}

const ALERT = {
	info: { cls: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100", Icon: Info },
	success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100", Icon: CheckCircle2 },
	warning: { cls: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100", Icon: AlertTriangle },
	error: { cls: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100", Icon: XCircle },
	brand: { cls: "border-gold-200 bg-cream text-ink", Icon: Info },
}

export function Alert({ tone = "info", title, children, action, className, icon }) {
	const { cls, Icon } = ALERT[tone] || ALERT.info
	const I = icon || Icon
	return (
		<div className={clsx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", cls, className)}>
			<I size={18} className="mt-0.5 shrink-0" />
			<div className="min-w-0 flex-1">
				{title ? <div className="font-semibold">{title}</div> : null}
				{children ? <div className={clsx(title && "mt-0.5", "opacity-90")}>{children}</div> : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	)
}

/* ────────────────────────────── Buttons ────────────────────────────── */

// Literal class names: Tailwind only keeps component classes it can find verbatim in the source.
export const BUTTON_VARIANTS = {
	primary: "btn-primary",
	gold: "btn-gold",
	secondary: "btn-secondary",
	ghost: "btn-ghost",
	danger: "btn-danger",
	"danger-soft": "btn-danger-soft",
}

export const Button = forwardRef(function Button(
	{ variant = "primary", size, loading, icon: Icon, iconRight: IconRight, children, className, type = "button", disabled, ...props },
	ref
) {
	return (
		<button
			ref={ref}
			type={type}
			disabled={disabled || loading}
			className={clsx("btn", BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary, size === "sm" && "btn-sm", size === "lg" && "btn-lg", className)}
			{...props}
		>
			{loading ? <Spinner size={16} /> : Icon ? <Icon size={size === "sm" ? 14 : 16} /> : null}
			{children}
			{IconRight && !loading ? <IconRight size={size === "sm" ? 14 : 16} /> : null}
		</button>
	)
})

export function IconButton({ icon: Icon, label, tone = "default", className, size = 16, ...props }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={clsx(
				"inline-grid h-8 w-8 place-items-center rounded-lg transition",
				tone === "danger" ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950" : "text-ink-muted hover:bg-brand-50 hover:text-ink",
				className
			)}
			{...props}
		>
			<Icon size={size} />
		</button>
	)
}

/* ────────────────────────────── Form controls ────────────────────────────── */

export function Field({ label, hint, error, required, children, className, htmlFor }) {
	return (
		<div className={className}>
			{label ? (
				<label className="label" htmlFor={htmlFor}>
					{label}
					{required ? <span className="ml-0.5 text-red-500">*</span> : null}
				</label>
			) : null}
			{children}
			{error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
		</div>
	)
}

export const Input = forwardRef(function Input({ label, hint, error, required, className, inputClassName, icon: Icon, ...props }, ref) {
	const id = useId()
	return (
		<Field label={label} hint={hint} error={error} required={required} className={className} htmlFor={props.id || id}>
			<div className="relative">
				{Icon ? <Icon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" /> : null}
				<input
					ref={ref}
					id={props.id || id}
					required={required}
					className={clsx("input", Icon && "pl-9", error && "border-red-400", inputClassName)}
					{...props}
				/>
			</div>
		</Field>
	)
})

export const PasswordInput = forwardRef(function PasswordInput({ label, hint, error, className, required, ...props }, ref) {
	const [show, setShow] = useState(false)
	const id = useId()
	return (
		<Field label={label} hint={hint} error={error} required={required} className={className} htmlFor={id}>
			<div className="relative">
				<input ref={ref} id={id} type={show ? "text" : "password"} required={required} className={clsx("input pr-10", error && "border-red-400")} {...props} />
				<button
					type="button"
					tabIndex={-1}
					onClick={() => setShow((s) => !s)}
					className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-soft hover:text-ink"
					aria-label={show ? "Hide password" : "Show password"}
				>
					{show ? <EyeOff size={16} /> : <Eye size={16} />}
				</button>
			</div>
		</Field>
	)
})

export const Textarea = forwardRef(function Textarea({ label, hint, error, required, className, rows = 4, ...props }, ref) {
	const id = useId()
	return (
		<Field label={label} hint={hint} error={error} required={required} className={className} htmlFor={id}>
			<textarea ref={ref} id={id} rows={rows} required={required} className={clsx("input resize-y", error && "border-red-400")} {...props} />
		</Field>
	)
})

/** options: array of strings or {value,label}; placeholder adds an empty first option. */
export const Select = forwardRef(function Select({ label, hint, error, required, className, options, placeholder, children, ...props }, ref) {
	const id = useId()
	return (
		<Field label={label} hint={hint} error={error} required={required} className={className} htmlFor={id}>
			<select ref={ref} id={id} required={required} className={clsx("input pr-8", error && "border-red-400")} {...props}>
				{placeholder !== undefined ? <option value="">{placeholder}</option> : null}
				{options
					? options.map((o) => {
							const v = typeof o === "object" ? o.value : o
							const l = typeof o === "object" ? o.label ?? o.value : o
							return (
								<option key={v} value={v}>
									{l}
								</option>
							)
						})
					: children}
			</select>
		</Field>
	)
})

export function Checkbox({ label, description, checked, onChange, className, disabled, ...props }) {
	return (
		<label className={clsx("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60", className)}>
			<input
				type="checkbox"
				checked={Boolean(checked)}
				disabled={disabled}
				onChange={(e) => onChange?.(e.target.checked, e)}
				className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-700 accent-[rgb(var(--brand-700))]"
				{...props}
			/>
			<span className="min-w-0">
				<span className="block text-sm font-medium text-ink">{label}</span>
				{description ? <span className="block text-xs text-ink-soft">{description}</span> : null}
			</span>
		</label>
	)
}

export function Switch({ checked, onChange, label, description, disabled, className }) {
	return (
		<label className={clsx("flex items-center justify-between gap-4", disabled ? "opacity-60" : "cursor-pointer", className)}>
			{label || description ? (
				<span className="min-w-0">
					{label ? <span className="block text-sm font-medium text-ink">{label}</span> : null}
					{description ? <span className="block text-xs text-ink-soft">{description}</span> : null}
				</span>
			) : null}
			<button
				type="button"
				role="switch"
				aria-checked={Boolean(checked)}
				disabled={disabled}
				onClick={() => onChange?.(!checked)}
				className={clsx("relative inline-flex h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-brand-700" : "bg-line")}
			>
				<span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
			</button>
		</label>
	)
}

export function RadioCards({ options, value, onChange, cols = 2, className }) {
	return (
		<div className={clsx("grid gap-3", cols === 3 ? "sm:grid-cols-3" : cols === 1 ? "" : "sm:grid-cols-2", className)}>
			{options.map((o) => {
				const active = value === o.value
				const Icon = o.icon
				return (
					<button
						key={o.value}
						type="button"
						onClick={() => onChange(o.value)}
						disabled={o.disabled}
						className={clsx(
							"flex items-start gap-3 rounded-xl border p-4 text-left transition disabled:opacity-50",
							active ? "border-brand-700 bg-brand-50 ring-4 ring-brand-500/10" : "border-line bg-surface hover:border-brand-300"
						)}
					>
						{Icon ? (
							<span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", active ? "bg-brand-700 text-white" : "bg-cream text-gold-700")}>
								<Icon size={18} />
							</span>
						) : null}
						<span className="min-w-0">
							<span className="block font-semibold text-ink">{o.label}</span>
							{o.description ? <span className="mt-0.5 block text-xs text-ink-soft">{o.description}</span> : null}
						</span>
					</button>
				)
			})}
		</div>
	)
}

/** File picker that uploads immediately via frappe.uploadFile; value = file_url. */
export function FileDrop({ label, hint, accept, onFile, busy, value, className }) {
	const ref = useRef(null)
	const [drag, setDrag] = useState(false)
	return (
		<Field label={label} hint={hint} className={className}>
			<div
				onDragOver={(e) => {
					e.preventDefault()
					setDrag(true)
				}}
				onDragLeave={() => setDrag(false)}
				onDrop={(e) => {
					e.preventDefault()
					setDrag(false)
					const f = e.dataTransfer.files?.[0]
					if (f) onFile(f)
				}}
				onClick={() => ref.current?.click()}
				className={clsx(
					"flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition",
					drag ? "border-brand-500 bg-brand-50" : "border-line hover:border-brand-300 hover:bg-cream/60"
				)}
			>
				{busy ? (
					<Spinner />
				) : value ? (
					<span className="flex items-center gap-2 font-semibold text-brand-700">
						<CheckCircle2 size={16} /> {String(value).split("/").pop()}
					</span>
				) : (
					<span className="text-ink-muted">
						<span className="font-semibold text-brand-700">Choose a file</span> or drag it here
					</span>
				)}
				<input
					ref={ref}
					type="file"
					accept={accept}
					className="hidden"
					onChange={(e) => {
						const f = e.target.files?.[0]
						if (f) onFile(f)
						e.target.value = ""
					}}
				/>
			</div>
		</Field>
	)
}

/* ────────────────────────────── Navigation bits ────────────────────────────── */

export function Tabs({ tabs, active, onChange, className, size = "md" }) {
	return (
		<div className={clsx("scroll-thin flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_rgb(var(--line))]", className)} role="tablist">
			{tabs.map((t) => {
				const id = typeof t === "string" ? t : t.id
				const label = typeof t === "string" ? t : t.label
				const count = typeof t === "object" ? t.count : undefined
				const on = active === id
				return (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={on}
						onClick={() => onChange(id)}
						className={clsx(
							"relative flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 font-semibold transition",
							size === "sm" ? "px-2.5 py-2 text-xs" : "px-3.5 py-2.5 text-sm",
							on ? "border-gold-500 text-ink" : "border-transparent text-ink-soft hover:text-ink"
						)}
					>
						{label}
						{count != null ? (
							<span className={clsx("rounded-full px-1.5 text-[10.5px]", on ? "bg-gold-100 text-gold-800" : "bg-line/70 text-ink-soft")}>{count}</span>
						) : null}
					</button>
				)
			})}
		</div>
	)
}

export function Chip({ active, children, className, ...props }) {
	return (
		<button type="button" className={clsx("chip", active && "chip-active", className)} {...props}>
			{children}
		</button>
	)
}

export function Pagination({ page, pageSize = 20, total, onChange, className }) {
	const pages = Math.max(1, Math.ceil((total || 0) / pageSize))
	if (!total || total <= pageSize) return null
	const from = (page - 1) * pageSize + 1
	const to = Math.min(total, page * pageSize)
	return (
		<div className={clsx("flex items-center justify-between gap-3 px-1 py-3 text-xs text-ink-soft", className)}>
			<span>
				{from}–{to} of {total.toLocaleString()}
			</span>
			<div className="flex items-center gap-1">
				<IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} />
				<span className="px-2 font-semibold text-ink-muted">
					{page} / {pages}
				</span>
				<IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)} />
			</div>
		</div>
	)
}

export function useClientPage(rows = [], pageSize = 20) {
	const [page, setPage] = useState(1)
	const total = rows?.length || 0
	useEffect(() => {
		if ((page - 1) * pageSize >= total && page > 1) setPage(1)
	}, [total, page, pageSize])
	const slice = useMemo(() => (rows || []).slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize])
	return { page, setPage, slice, total, pageSize }
}

/* ────────────────────────────── Overlays ────────────────────────────── */

function useEscape(open, onClose) {
	useEffect(() => {
		if (!open) return undefined
		const onKey = (e) => e.key === "Escape" && onClose?.()
		document.addEventListener("keydown", onKey)
		const prev = document.body.style.overflow
		document.body.style.overflow = "hidden"
		return () => {
			document.removeEventListener("keydown", onKey)
			document.body.style.overflow = prev
		}
	}, [open, onClose])
}

const MODAL_W = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl", full: "max-w-6xl" }

export function Modal({ open, title, subtitle, onClose, children, footer, size = "md" }) {
	useEscape(open, onClose)
	if (!open) return null
	return createPortal(
		<div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
			<button type="button" aria-label="Close" className="absolute inset-0 bg-brand-900/40 backdrop-blur-[2px]" onClick={onClose} />
			<div className={clsx("relative flex max-h-[92vh] w-full animate-fade-up flex-col rounded-t-2xl bg-surface shadow-lift sm:rounded-2xl", MODAL_W[size])}>
				<header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
					<div className="min-w-0">
						<h2 className="font-serif text-lg text-ink">{title}</h2>
						{subtitle ? <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p> : null}
					</div>
					<IconButton icon={X} label="Close" onClick={onClose} />
				</header>
				<div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
				{footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 safe-bottom">{footer}</footer> : null}
			</div>
		</div>,
		document.body
	)
}

export function Drawer({ open, title, subtitle, onClose, children, footer, width = "max-w-xl" }) {
	useEscape(open, onClose)
	if (!open) return null
	return createPortal(
		<div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true">
			<button type="button" aria-label="Close" className="absolute inset-0 bg-brand-900/40 backdrop-blur-[2px]" onClick={onClose} />
			<aside className={clsx("relative flex h-full w-full flex-col bg-surface shadow-lift", width)}>
				<header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
					<div className="min-w-0">
						<h2 className="truncate font-serif text-lg text-ink">{title}</h2>
						{subtitle ? <p className="mt-0.5 truncate text-xs text-ink-soft">{subtitle}</p> : null}
					</div>
					<IconButton icon={X} label="Close" onClick={onClose} />
				</header>
				<div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
				{footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 safe-bottom">{footer}</footer> : null}
			</aside>
		</div>,
		document.body
	)
}

export function ConfirmDialog({
	open,
	title = "Are you sure?",
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	tone = "primary",
	loading,
	onConfirm,
	onClose,
	children,
}) {
	return (
		<Modal
			open={open}
			title={title}
			onClose={onClose}
			size="sm"
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={loading}>
						{cancelLabel}
					</Button>
					<Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
						{confirmLabel}
					</Button>
				</>
			}
		>
			{message ? <p className="text-sm text-ink-muted">{message}</p> : null}
			{children}
		</Modal>
	)
}

/* ────────────────────────────── Data display ────────────────────────────── */

export function InfoRow({ label, value, className }) {
	return (
		<div className={clsx("flex items-start justify-between gap-4 py-2 text-sm", className)}>
			<span className="shrink-0 text-ink-soft">{label}</span>
			<span className="min-w-0 text-right font-medium text-ink">{value ?? "—"}</span>
		</div>
	)
}

export function KeyValueGrid({ items, cols = 2, className }) {
	return (
		<dl className={clsx("grid gap-x-6 gap-y-4", cols === 1 ? "grid-cols-1" : cols === 3 ? "sm:grid-cols-3" : cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2", className)}>
			{items.filter(Boolean).map((it) => (
				<div key={it.label} className={clsx("min-w-0", it.wide && "sm:col-span-full")}>
					<dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{it.label}</dt>
					<dd className="mt-0.5 break-words text-sm font-medium text-ink">{it.value ?? "—"}</dd>
				</div>
			))}
		</dl>
	)
}

export function Tile({ icon: Icon, label, sub, to, onClick, tone = "brand", badge }) {
	const t = TONE[tone] || TONE.brand
	const inner = (
		<>
			<span className={clsx("grid h-11 w-11 place-items-center rounded-xl", t.soft)}>
				<Icon size={20} />
			</span>
			<span className="mt-2.5 block text-sm font-semibold text-ink">{label}</span>
			{sub ? <span className="block text-xs text-ink-soft">{sub}</span> : null}
			{badge ? <span className="absolute right-3 top-3">{badge}</span> : null}
		</>
	)
	const cls = "card relative flex flex-col items-start p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft"
	return to ? (
		<Link to={to} className={cls}>
			{inner}
		</Link>
	) : (
		<button type="button" onClick={onClick} className={cls}>
			{inner}
		</button>
	)
}

export function Divider({ label, className }) {
	if (!label) return <hr className={clsx("border-line", className)} />
	return (
		<div className={clsx("flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft", className)}>
			<span className="h-px flex-1 bg-line" />
			{label}
			<span className="h-px flex-1 bg-line" />
		</div>
	)
}

/** Server HTML (CMS bodies, announcements, answers), sanitised in the browser before render. */
export function Html({ html, className }) {
	const clean = useMemo(() => sanitizeHtml(html), [html])
	return <div className={clsx("prose-mbc", className)} dangerouslySetInnerHTML={{ __html: clean }} />
}
