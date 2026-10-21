import { createContext, useContext, useEffect, useId, useMemo, useState } from "react"
import clsx from "clsx"
import { Check, Copy, ImagePlus, KeyRound, Lock, Save, Trash2 } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { safeUrl } from "@/shared/utils/sanitize"
import { Badge, Button, Empty, Field, Input, Select, Spinner, Switch, Textarea } from "@/shared/components/ui"

export const S = "mahanaim.api.setup."
export const MP = "mahanaim.api.mpesa."
export const LMS = "mahanaim.api.learning."
export const MASK_RE = /^\*+$/

export const errText = (e) => e?.message || (e ? String(e) : "")

/** Compare a draft value with the stored one, treating null/""/0-for-checks sensibly. */
export function same(a, b) {
	const norm = (v) => (v === null || v === undefined ? "" : typeof v === "boolean" ? Number(v) : String(v))
	return norm(a) === norm(b)
}

/**
 * Local draft over a server document: only changed keys are kept, so the "Save changes" bar
 * reflects real differences and only those fields are sent.
 */
export function useDraft(server) {
	const [draft, setDraft] = useState({})
	const values = useMemo(() => ({ ...(server || {}), ...draft }), [server, draft])
	const dirty = useMemo(() => Object.keys(draft).filter((k) => !same(draft[k], server?.[k])), [draft, server])
	const set = (key, value) =>
		setDraft((d) => {
			const next = { ...d, [key]: value }
			if (same(value, server?.[key])) delete next[key]
			return next
		})
	const changes = () => Object.fromEntries(dirty.map((k) => [k, draft[k]]))
	return { values, draft, dirty, isDirty: dirty.length > 0, set, changes, reset: () => setDraft({}) }
}

/** Warn before closing the tab with unsaved edits. */
export function useUnloadGuard(active) {
	useEffect(() => {
		if (!active) return undefined
		const h = (e) => {
			e.preventDefault()
			e.returnValue = ""
		}
		window.addEventListener("beforeunload", h)
		return () => window.removeEventListener("beforeunload", h)
	}, [active])
}

/** Mahanaim Settings draft shared by the form tabs, so edits survive switching tabs. */
export const SettingsContext = createContext(null)
export const useSettingsForm = () => useContext(SettingsContext)

/** Sticky "unsaved changes" bar pinned to the bottom of the content column (above the mobile tab bar). */
export function SaveBar({ show, count, message, onSave, onDiscard, saving, label = "Save changes" }) {
	if (!show) return null
	const text = message || (count ? `${count} unsaved change${count === 1 ? "" : "s"}` : "You have unsaved changes")
	return (
		<div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur lg:bottom-0 lg:left-[264px]">
			<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
				<span className="flex items-center gap-2 text-sm text-ink-muted">
					<span className="h-2 w-2 rounded-full bg-amber-500" /> {text}
				</span>
				<span className="flex gap-2">
					{onDiscard ? (
						<Button variant="secondary" size="sm" onClick={onDiscard} disabled={saving}>
							Discard
						</Button>
					) : null}
					<Button size="sm" icon={Save} onClick={onSave} loading={saving}>
						{label}
					</Button>
				</span>
			</div>
		</div>
	)
}

export function NoAccess() {
	return (
		<div className="card mx-auto mt-6 max-w-lg">
			<Empty icon={Lock} title="Settings are for administrators" subtitle="Only the College Administrator or a System Manager can change campus-wide settings." />
		</div>
	)
}

/** A titled card holding a group of form fields. */
export function FormSection({ title, subtitle, icon: Icon, children, actions, className, cols = 2 }) {
	return (
		<section className={clsx("card", className)}>
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:flex-nowrap">
				<div className="flex min-w-0 items-start gap-3">
					{Icon ? (
						<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
							<Icon size={17} />
						</span>
					) : null}
					<div className="min-w-0">
						<h3 className="text-[15px] font-semibold text-ink">{title}</h3>
						{subtitle ? <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p> : null}
					</div>
				</div>
				{actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
			</header>
			<div className={clsx("grid gap-x-5 gap-y-4 p-5", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3")}>{children}</div>
		</section>
	)
}

/** A switch row that spans the full form width. */
export function ToggleRow({ label, description, checked, onChange, disabled, className }) {
	return (
		<div className={clsx("rounded-xl border border-line bg-cream/40 px-4 py-3 sm:col-span-2", className)}>
			<Switch label={label} description={description} checked={Boolean(Number(checked))} onChange={(v) => onChange(v ? 1 : 0)} disabled={disabled} />
		</div>
	)
}

/**
 * Secret input: never shows the stored value. Blank means "keep what is stored"; typing a value
 * replaces it on save.
 */
export function SecretInput({ label, stored, value, onChange, hint, error, className }) {
	const id = useId()
	return (
		<Field
			label={
				<span className="flex items-center gap-2">
					{label}
					{stored ? (
						<Badge tone="green" size="xs">
							Stored
						</Badge>
					) : (
						<Badge tone="gray" size="xs">
							Not set
						</Badge>
					)}
				</span>
			}
			hint={hint || (stored ? "Leave blank to keep the stored value." : undefined)}
			error={error}
			className={className}
			htmlFor={id}
		>
			<div className="relative">
				<KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
				<input
					id={id}
					type="password"
					autoComplete="new-password"
					className={clsx("input pl-9", error && "border-red-400")}
					placeholder={stored ? "•••••••• (unchanged)" : "Enter a value"}
					value={value || ""}
					onChange={(e) => onChange(e.target.value)}
				/>
			</div>
		</Field>
	)
}

/** Image attachment with preview, upload and remove. */
export function ImageField({ label, hint, value, onChange, isPrivate = false, meta, className }) {
	const [busy, setBusy] = useState(false)
	const id = useId()
	const upload = async (file) => {
		if (!file) return
		if (!file.type.startsWith("image/")) return toast.error("Choose an image file (PNG, JPG or SVG).")
		if (file.size > 4 * 1024 * 1024) return toast.error("Images must be smaller than 4 MB.")
		setBusy(true)
		try {
			const doc = await frappe.uploadFile(file, isPrivate, meta || {})
			onChange(doc?.file_url || "")
		} catch (e) {
			toast.error(errText(e) || "Upload failed")
		} finally {
			setBusy(false)
		}
	}
	return (
		<Field label={label} hint={hint} className={className} htmlFor={id}>
			<div className="flex items-center gap-3 rounded-xl border border-line p-3">
				<div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-cream/60">
					{busy ? <Spinner /> : safeUrl(value) ? <img src={safeUrl(value)} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus size={20} className="text-ink-soft" />}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-xs text-ink-soft">{value ? String(value).split("/").pop() : "No image uploaded"}</p>
					<div className="mt-2 flex flex-wrap gap-2">
						<label htmlFor={id} className="btn btn-secondary btn-sm cursor-pointer">
							{value ? "Replace" : "Upload"}
						</label>
						<input
							id={id}
							type="file"
							accept="image/*"
							className="sr-only"
							onChange={(e) => {
								upload(e.target.files?.[0])
								e.target.value = ""
							}}
						/>
						{value ? (
							<Button size="sm" variant="ghost" icon={Trash2} onClick={() => onChange("")}>
								Remove
							</Button>
						) : null}
					</div>
				</div>
			</div>
		</Field>
	)
}

/** Clipboard copy that also works on plain-http hosts where navigator.clipboard is unavailable. */
export async function copyText(text) {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text)
			return true
		}
	} catch {
		/* fall through to the textarea fallback */
	}
	const ta = document.createElement("textarea")
	ta.value = text
	ta.setAttribute("readonly", "")
	ta.style.position = "fixed"
	ta.style.opacity = "0"
	document.body.appendChild(ta)
	ta.select()
	let ok = false
	try {
		ok = document.execCommand("copy")
	} catch {
		ok = false
	}
	ta.remove()
	return ok
}

export function CopyButton({ getText, label = "Copy", size = "sm" }) {
	const [done, setDone] = useState(false)
	const [busy, setBusy] = useState(false)
	const click = async () => {
		setBusy(true)
		try {
			const text = await getText()
			if (!text) return
			if (await copyText(text)) {
				setDone(true)
				setTimeout(() => setDone(false), 1600)
			} else toast.error("Couldn't copy; select the text and copy it manually.")
		} catch (e) {
			toast.error(errText(e))
		} finally {
			setBusy(false)
		}
	}
	return (
		<Button variant="secondary" size={size} icon={done ? Check : Copy} onClick={click} loading={busy} aria-label={label}>
			{done ? "Copied" : label}
		</Button>
	)
}

/** Generic schema-driven input for one Mahanaim Settings field. */
export function SettingField({ f, values, set, errors, stored, linkOptions }) {
	const v = values[f.key]
	const err = errors?.[f.key]
	const span = f.wide ? "sm:col-span-2" : undefined
	const common = { label: f.label, hint: f.hint, error: err, required: f.required, className: span }
	switch (f.type) {
		case "check":
			return <ToggleRow label={f.label} description={f.hint} checked={v} onChange={(x) => set(f.key, x)} disabled={f.disabled} />
		case "select":
			return <Select {...common} value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} options={f.options} />
		case "link": {
			const opts = linkOptions?.[f.source] || []
			const list = v && !opts.some((o) => o.value === v) ? [{ value: v, label: v }, ...opts] : opts
			return <Select {...common} value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} options={list} placeholder={f.placeholder ?? "Select…"} disabled={f.disabled} />
		}
		case "text":
			return <Textarea {...common} rows={f.rows || 3} value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className={clsx(span, f.mono && "[&_textarea]:font-mono [&_textarea]:text-xs")} />
		case "image":
			return <ImageField label={f.label} hint={f.hint} value={v} onChange={(x) => set(f.key, x)} isPrivate={f.private} meta={{ doctype: "Mahanaim Settings", docname: "Mahanaim Settings", fieldname: f.key }} className={span} />
		case "password":
			return <SecretInput label={f.label} hint={f.hint} stored={Boolean(stored?.[f.key])} value={MASK_RE.test(String(v ?? "")) ? "" : v} onChange={(x) => set(f.key, x === "" ? stored?.[f.key] ?? "" : x)} error={err} className={span} />
		case "int":
		case "float":
		case "currency":
		case "percent":
			return (
				<Input
					{...common}
					type="number"
					inputMode="decimal"
					min={f.min}
					max={f.max}
					step={f.type === "int" ? 1 : "any"}
					value={v ?? ""}
					onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))}
				/>
			)
		default:
			return <Input {...common} type={f.inputType || "text"} value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} disabled={f.disabled} />
	}
}

/** Client-side checks mirroring the server rules, so mistakes show next to the field. */
export function validateSettings(values, fields) {
	const errors = {}
	for (const f of fields) {
		if (f.when && !f.when(values)) continue
		const v = values[f.key]
		if (f.required && (v === null || v === undefined || String(v).trim() === "")) errors[f.key] = `${f.label} is required.`
		else if (["int", "float", "currency", "percent"].includes(f.type) && v !== "" && v != null) {
			const n = Number(v)
			if (Number.isNaN(n)) errors[f.key] = "Enter a number."
			else if (f.min != null && n < f.min) errors[f.key] = `Must be at least ${f.min}.`
			else if (f.max != null && n > f.max) errors[f.key] = `Must be at most ${f.max}.`
		}
		if (!errors[f.key] && f.validate) {
			const msg = f.validate(v, values)
			if (msg) errors[f.key] = msg
		}
	}
	return errors
}

/** Option lists for Link fields that only administrators see. */
export function useLinkSources() {
	const lookups = useApi(`${S}lookups`, {}, { staleTime: 5 * 60_000 })
	const currencies = useApi("frappe.client.get_list", { doctype: "Currency", fields: ["name"], filters: { enabled: 1 }, limit_page_length: 0 }, { staleTime: 30 * 60_000, retry: false })
	const scales = useApi("frappe.client.get_list", { doctype: "Grading Scale", fields: ["name"], limit_page_length: 0 }, { staleTime: 10 * 60_000, retry: false })
	return useMemo(() => {
		const d = lookups.data || {}
		return {
			terms: (d.terms || []).map((t) => ({ value: t.name, label: t.is_current ? `${t.term_label || t.name} (current)` : t.term_label || t.name })),
			years: (d.academic_years || []).map((y) => ({ value: y.name, label: y.year_name || y.name })),
			currencies: (currencies.data || []).map((c) => ({ value: c.name, label: c.name })),
			scales: (scales.data || []).map((s) => ({ value: s.name, label: s.name })),
			lookups: d,
		}
	}, [lookups.data, currencies.data, scales.data])
}
