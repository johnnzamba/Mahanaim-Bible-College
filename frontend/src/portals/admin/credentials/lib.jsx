import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ShieldOff } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { Badge, Empty, ErrorState, Input, Panel, Select, SkeletonRows } from "@/shared/components/ui"
import { useDebounced } from "@/shared/components/kit"
import { ROLES } from "@/shared/access"

export const API = "mahanaim.api.credentials."
export const STU = "mahanaim.api.students."

/** DataTable draws its own card; inside a Panel with bodyClass="p-0" it should sit flat. */
export const FLAT = "!rounded-none !border-0 !shadow-none"

export const TRANSCRIPT_TYPES = ["Provisional", "Official", "Final"]
export const DOC_STATUSES = ["Draft", "Issued", "Revoked"]
export const VERIFY_RESULTS = ["Valid", "Revoked", "Not Found"]
export const TERM_HINT = "Leave empty to include every term"
export const VERIFY_DOCTYPES = ["Transcript", "Certificate", "Invoice", "Receipt", "Student", "Unknown"]

/**
 * credentials.py: reads (list/get/eligible_graduates/verification_logs) = Registrar, Academic Dean, Auditor;
 * writes (generate/refresh/issue/revoke/issue_certificates) and override_fee_check = Registrar (admins pass).
 * students.py: list_requests = Registrar, Dean, Finance, Library; decide_request = Registrar, Dean.
 */
export const CAN = {
	read: [ROLES.REGISTRAR, ROLES.DEAN, ROLES.AUDITOR],
	write: [ROLES.REGISTRAR],
	override: [ROLES.REGISTRAR],
	requests: [ROLES.REGISTRAR, ROLES.DEAN],
	decide: [ROLES.REGISTRAR, ROLES.DEAN],
	student360: [ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE],
}

const DOC_TONE = { Draft: "gold", Issued: "green", Revoked: "red" }
const RESULT_TONE = { Valid: "green", Revoked: "red", "Not Found": "gray" }

export function DocStatus({ status, size }) {
	if (!status) return null
	return <Badge status={status} tone={DOC_TONE[status]} size={size} />
}

export function VerifyResult({ result, size = "xs" }) {
	if (!result) return null
	return <Badge status={result} tone={RESULT_TONE[result]} size={size} />
}

/** Today's date in the browser's time zone (toISOString would give the UTC date). */
export function today() {
	const d = new Date()
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function useLookups() {
	return useApi("mahanaim.api.setup.lookups", {}, { staleTime: 10 * 60_000 })
}

export const termLabel = (L, name) => {
	const t = (L?.terms || []).find((x) => x.name === name)
	return t ? t.term_label || t.term_name || t.name : name
}

export function compact(obj) {
	const out = {}
	for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null && v !== false) out[k] = v
	return out
}

/** KeyValueGrid shows "—" only for null, so blank strings from the server become null. */
export const kv = (items) => items.filter(Boolean).map((i) => ({ ...i, value: i.value === "" || i.value == null ? null : i.value }))

/** Filters live in the URL so lists survive back-navigation. Changing a filter resets `page`. */
export function useUrlFilters() {
	const [params, setParams] = useSearchParams()
	const get = useCallback((k) => params.get(k) || "", [params])
	const set = useCallback(
		(patch) =>
			setParams(
				(prev) => {
					const next = new URLSearchParams(prev)
					for (const [k, v] of Object.entries(patch)) {
						if (v === "" || v == null || v === false) next.delete(k)
						else next.set(k, String(v))
					}
					if (!("page" in patch)) next.delete("page")
					return next
				},
				{ replace: true }
			),
		[setParams]
	)
	return [get, set, params]
}

export function NoAccess({ message = "Your role cannot open this screen." }) {
	return (
		<Panel>
			<Empty icon={ShieldOff} title="Not available for your role" subtitle={message} />
		</Panel>
	)
}

export function isPermissionError(err) {
	return err?.status === 403 || err?.exc_type === "PermissionError"
}

export const pdfUrl = (doctype, name) => frappe.downloadUrl(`${API}download_pdf`, { doctype, name })
export const printUrl = (doctype, name) => frappe.downloadUrl(`${API}print_view`, { doctype, name })

/** Server-rendered print view inside a script-less sandbox (srcDoc keeps it off our origin). */
export function PrintPreview({ doctype, name, title, landscape }) {
	const q = useApi(`${API}print_view`, { doctype, name }, { staleTime: 30_000 })
	if (q.isLoading) return <SkeletonRows rows={10} />
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	// The page's own Print button needs scripts, which the sandbox blocks; "Print view" opens the real page.
	const html = typeof q.data === "string" ? q.data.replace("</head>", "<style>.toolbar{display:none!important}</style></head>") : ""
	const label = title || `${doctype} ${name}`
	if (landscape) return <ScaledFrame html={html} title={label} />
	return <iframe title={label} srcDoc={html} sandbox="" className="h-[75vh] min-h-[28rem] w-full rounded-xl border border-line bg-white" />
}

// The certificate is a fixed A4-landscape sheet (297 x 210 mm at 96 dpi); scale it down to the panel width.
const SHEET = { w: 1123, h: 794 }

function ScaledFrame({ html, title }) {
	const ref = useRef(null)
	const [width, setWidth] = useState(0)
	useEffect(() => {
		const el = ref.current
		if (!el) return undefined
		const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	const scale = width ? Math.min(1, width / SHEET.w) : 0
	return (
		<div ref={ref} className="w-full overflow-hidden rounded-xl border border-line bg-white" style={{ height: scale ? SHEET.h * scale : 240 }}>
			{scale ? (
				<iframe
					title={title}
					srcDoc={html}
					sandbox=""
					scrolling="no"
					style={{ display: "block", width: SHEET.w, height: SHEET.h, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }}
				/>
			) : null}
		</div>
	)
}

/** Debounced student search over students.list_students (Registrar, Dean, Finance). */
export function StudentPicker({ value, onChange, label = "Student", required }) {
	const [text, setText] = useState("")
	const q = useDebounced(text.trim(), 300)
	const res = useApi(`${STU}list_students`, { search: q, page_length: 8 }, { enabled: q.length >= 2 && !value })
	const rows = res.data?.data || []
	if (value) {
		return (
			<div>
				<span className="label">
					{label}
					{required ? <span className="ml-0.5 text-red-500">*</span> : null}
				</span>
				<div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-cream px-3 py-2">
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-ink">{value.full_name}</div>
						<div className="truncate text-xs text-ink-soft">
							{[value.student_number || value.name, value.programme_name || value.programme, value.status].filter(Boolean).join(" · ")}
						</div>
					</div>
					<button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => onChange(null)}>
						Change
					</button>
				</div>
			</div>
		)
	}
	return (
		<div>
			<Input label={label} required={required} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a name, student number or email" autoComplete="off" />
			{q.length >= 2 ? (
				<div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface">
					{res.isLoading ? (
						<div className="px-3 py-2 text-sm text-ink-soft">Searching…</div>
					) : rows.length ? (
						rows.map((r) => (
							<button key={r.name} type="button" className="block w-full px-3 py-2 text-left hover:bg-cream" onClick={() => onChange(r)}>
								<div className="truncate text-sm font-semibold text-ink">{r.full_name}</div>
								<div className="truncate text-xs text-ink-soft">{[r.student_number || r.name, r.programme_name || r.programme, r.status].filter(Boolean).join(" · ")}</div>
							</button>
						))
					) : (
						<div className="px-3 py-2 text-sm text-ink-soft">{res.isError ? res.error?.message : "No students found"}</div>
					)}
				</div>
			) : null}
		</div>
	)
}

/** as_of_term options: closed and current terms, newest first. */
export function TermSelect({ L, value, onChange, label = "Results up to", hint }) {
	return (
		<Select
			label={label}
			hint={hint}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder="All published results"
			options={(L?.terms || []).map((t) => ({ value: t.name, label: `${t.term_label || t.term_name || t.name}${t.is_current ? " (current)" : ""}` }))}
		/>
	)
}

/** Snapshot → [{term,label,courses,gpa,credits}] (stored JSON from results.transcript_data). */
export function snapshotTerms(doc) {
	let s = doc?.snapshot
	if (typeof s === "string") {
		try {
			s = JSON.parse(s || "{}")
		} catch {
			s = {}
		}
	}
	return (s && s.terms) || []
}
