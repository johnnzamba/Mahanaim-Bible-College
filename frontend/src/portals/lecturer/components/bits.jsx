import { Badge, Select } from "@/shared/components/ui"
import { offeringLabel, toneOf, useMyOfferings } from "./lib"

export function StatusBadge({ kind, status, dot = true, size, children }) {
	if (!status) return null
	return (
		<Badge status={status} tone={toneOf(kind, status)} dot={dot} size={size}>
			{children ?? status}
		</Badge>
	)
}

/** Select one of the offerings I teach (current term unless `term` is given). */
export function OfferingSelect({ value, onChange, label = "Course", term = "", placeholder, className, hint }) {
	const q = useMyOfferings(term)
	const rows = q.data?.data || []
	return (
		<Select
			label={label}
			hint={hint}
			className={className}
			value={value || ""}
			onChange={(e) => onChange(e.target.value, rows.find((o) => o.name === e.target.value))}
			placeholder={placeholder ?? (q.isLoading ? "Loading…" : "Choose a course")}
			options={rows.map((o) => ({ value: o.name, label: offeringLabel(o) }))}
		/>
	)
}

/** Compact numeric input used in the inline tables (gradebook, bulk grading, marking). */
export function ScoreInput({ value, onChange, max, min = 0, step = "0.5", label, disabled, className, invalid }) {
	const n = value === "" || value === null || value === undefined ? null : Number(value)
	const bad = invalid || (n !== null && (Number.isNaN(n) || n < min || (max != null && n > max)))
	return (
		<input
			type="number"
			inputMode="decimal"
			aria-label={label}
			aria-invalid={bad || undefined}
			min={min}
			max={max}
			step={step}
			disabled={disabled}
			value={value ?? ""}
			onChange={(e) => onChange(e.target.value)}
			onWheel={(e) => e.currentTarget.blur()}
			className={`input !w-20 !px-2 !py-1.5 text-right tabular-nums ${bad ? "!border-red-400 !ring-red-500/10" : ""} ${className || ""}`}
		/>
	)
}

/** Floating save bar that sits above the mobile tab bar; render it last in the page. */
export function SaveBar({ note, children, className = "" }) {
	return (
		<div
			className={`sticky bottom-20 z-20 mx-auto mt-4 flex w-full max-w-3xl animate-fade-up flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface/95 px-4 py-2.5 shadow-lift backdrop-blur lg:bottom-4 ${className}`}
		>
			{note ? <div className="min-w-0 text-sm text-ink-muted">{note}</div> : null}
			<div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
		</div>
	)
}
