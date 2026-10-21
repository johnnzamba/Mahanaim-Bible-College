import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import clsx from "clsx"
import { Lock, Save, Search, UserRound, X } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"
import { Button, Empty, Field, Pagination, Spinner } from "@/shared/components/ui"
import { useDebounced } from "@/shared/components/kit"
import { money } from "@/shared/utils/format"

export const F = "mahanaim.api.finance."
export const M = "mahanaim.api.mpesa."
/** Every finance write can move balances shown on the dashboards too. */
export const REFRESH = [F, M, "mahanaim.api.dashboard."]

export const INVOICE_STATUSES = ["Draft", "Unpaid", "Partly Paid", "Overdue", "Paid", "Cancelled"]
export const PAYMENT_MODES = ["M-Pesa", "Bank Deposit", "Bank Transfer", "Cash", "Cheque", "Card", "Sponsor Remittance"]
export const MANUAL_MODES = ["Cash", "Bank Deposit", "Bank Transfer", "Cheque", "Card", "Sponsor Remittance", "M-Pesa"]
export const PAYMENT_FOR = ["Student Fees", "Application Fee", "Other"]
export const PAYMENT_STATUSES = ["Confirmed", "Cancelled"]
export const CREDIT_TYPES = ["Scholarship", "Bursary", "Waiver", "Discount", "Sponsor Credit", "Write-off", "Correction Credit"]
export const DEBIT_TYPES = ["Penalty", "Correction Debit"]
export const ADJUSTMENT_TYPES = [...CREDIT_TYPES, ...DEBIT_TYPES]
export const REFUND_STATUSES = ["Pending", "Approved", "Rejected", "Paid"]
export const REFUND_MODES = ["M-Pesa", "Bank Transfer", "Cheque", "Cash"]
export const REQUEST_STATUSES = ["Initiated", "Pending", "Completed", "Failed", "Cancelled", "Timeout"]
export const REQUEST_PURPOSES = ["Student Fees", "Application Fee", "Event Fee", "Giving", "Other"]
export const TRANSACTION_STATUSES = ["Unmatched", "Matched", "Allocated", "Reversed"]
export const TRANSACTION_SOURCES = ["STK Push", "C2B", "Manual Import", "Pull API"]
export const COMPONENT_TYPES = ["Tuition", "Registration", "Library", "Examination", "ICT", "Welfare", "Accommodation", "Meals", "Graduation", "Application", "Other"]
export const FEE_CATEGORIES = ["Standard", "Sponsored", "Staff Dependent", "International"]
export const SCHOLARSHIP_TYPES = ["Full", "Partial", "Bursary", "Work Study", "Church Sponsored", "Merit"]

export const today = () => new Date().toISOString().slice(0, 10)
export const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
export const m = (v) => money(v)

/** Who may do what here: Finance Officer writes, Auditor reads, super users pass everything. */
export function useFinanceRole() {
	const s = useSession()
	return {
		canRead: s.hasRole(ROLES.FINANCE, ROLES.AUDITOR),
		canWrite: s.hasRole(ROLES.FINANCE),
		canSearchStudents: s.hasRole(ROLES.FINANCE, ROLES.REGISTRAR, ROLES.DEAN),
		isSuper: s.isSuper,
	}
}

export function useLookups() {
	return useApi("mahanaim.api.setup.lookups", {}, { staleTime: 5 * 60_000 })
}

/** Option lists for the shared filter selects. */
export function useOptions() {
	const q = useLookups()
	return useMemo(() => {
		const d = q.data || {}
		return {
			programmes: (d.programmes || []).map((p) => ({ value: p.name, label: p.programme_name || p.name })),
			campuses: (d.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name })),
			terms: (d.terms || []).map((t) => ({ value: t.name, label: t.term_label || t.name })),
			years: (d.academic_years || []).map((y) => ({ value: y.name, label: y.year_name || y.name })),
			studyModes: (d.study_modes || []).map((s) => ({ value: s.name, label: s.study_mode_name || s.name })),
			currentTerm: d.current_term,
			currentYear: d.current_year,
		}
	}, [q.data])
}

const compact = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== "" && v != null && v !== false))

/**
 * Server-paged list for the `{data, total}` finance envelope. The page resets whenever a filter
 * changes; the previous page stays on screen while the next one loads.
 */
export function usePaged(method, filters = {}, pageSize = 20, options = {}) {
	const [page, setPage] = useState(1)
	const clean = compact(filters)
	const sig = JSON.stringify(clean)
	useEffect(() => setPage(1), [sig])
	const args = { ...clean, start: (page - 1) * pageSize, page_length: pageSize }
	const query = useApi(method, args, { placeholderData: (prev) => prev, ...options })
	const rows = query.data?.data || query.data?.rows || []
	return { query, page, setPage, rows, total: query.data?.total || 0, pageSize }
}

export function Pager({ list }) {
	return <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onChange={list.setPage} />
}

export function NoAccess({ what = "this area" }) {
	return (
		<div className="card mx-auto mt-6 max-w-lg">
			<Empty icon={Lock} title="You don't have access here" subtitle={`Your role doesn't include ${what}. Ask a College Administrator if you need it.`} />
		</div>
	)
}

/** A compact, labelled filter select used in toolbars. */
export function FilterSelect({ value, onChange, options, placeholder, className }) {
	return (
		<select value={value || ""} onChange={(e) => onChange(e.target.value)} className={clsx("input h-10 w-full py-0 text-sm sm:w-auto", className)}>
			<option value="">{placeholder}</option>
			{(options || []).map((o) => {
				const v = typeof o === "object" ? o.value : o
				return (
					<option key={v} value={v}>
						{typeof o === "object" ? o.label : o}
					</option>
				)
			})}
		</select>
	)
}

export function DateRange({ from, to, onFrom, onTo, className }) {
	return (
		<div className={clsx("flex items-center gap-1.5", className)}>
			<input type="date" aria-label="From date" value={from || ""} onChange={(e) => onFrom(e.target.value)} className="input h-10 w-full py-0 text-sm sm:w-[9.5rem]" />
			<span className="text-xs text-ink-soft">to</span>
			<input type="date" aria-label="To date" value={to || ""} onChange={(e) => onTo(e.target.value)} className="input h-10 w-full py-0 text-sm sm:w-[9.5rem]" />
		</div>
	)
}

async function searchStudents(term, canSearchStudents) {
	if (canSearchStudents) {
		const r = await frappe.call("mahanaim.api.students.list_students", { search: term, page_length: 8 })
		return (r?.data || []).map((s) => ({ name: s.name, full_name: s.full_name, student_number: s.student_number, programme: s.programme, phone: s.phone }))
	}
	// Auditors can't list students; find them through the invoices they can read instead.
	const r = await frappe.call(`${F}list_invoices`, { search: term, page_length: 30 })
	const seen = new Map()
	for (const i of r?.data || []) if (!seen.has(i.student)) seen.set(i.student, { name: i.student, full_name: i.student_name, programme: i.programme })
	return [...seen.values()].slice(0, 8)
}

/**
 * Student typeahead. `value` is the selected student object ({name, full_name, student_number}) or null.
 */
export function StudentPicker({ value, onChange, label = "Student", required, error, hint, placeholder = "Search by name, number, phone…", autoFocus }) {
	const { canSearchStudents } = useFinanceRole()
	const [text, setText] = useState("")
	const [open, setOpen] = useState(false)
	const q = useDebounced(text.trim(), 250)
	const box = useRef(null)
	const results = useQuery({
		queryKey: ["f7-student-search", q, canSearchStudents],
		queryFn: () => searchStudents(q, canSearchStudents),
		enabled: q.length >= 2,
		staleTime: 30_000,
	})
	useEffect(() => {
		const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
		document.addEventListener("mousedown", close)
		return () => document.removeEventListener("mousedown", close)
	}, [])

	if (value) {
		return (
			<Field label={label} required={required} error={error} hint={hint}>
				<div className="flex items-center gap-3 rounded-xl border border-line bg-cream/50 px-3 py-2">
					<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
						<UserRound size={16} />
					</span>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-semibold text-ink">{value.full_name || value.name}</div>
						<div className="truncate text-xs text-ink-soft">{[value.student_number, value.name !== value.student_number ? value.name : null, value.programme].filter(Boolean).join(" · ")}</div>
					</div>
					<button type="button" onClick={() => onChange(null)} className="rounded-md p-1 text-ink-soft hover:bg-surface hover:text-ink" aria-label="Change student">
						<X size={16} />
					</button>
				</div>
			</Field>
		)
	}
	const list = results.data || []
	return (
		<Field label={label} required={required} error={error} hint={hint}>
			<div className="relative" ref={box}>
				<Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
				<input
					className={clsx("input pl-9", error && "border-red-400")}
					value={text}
					autoFocus={autoFocus}
					placeholder={placeholder}
					onFocus={() => setOpen(true)}
					onChange={(e) => {
						setText(e.target.value)
						setOpen(true)
					}}
					aria-label={label}
				/>
				{open && q.length >= 2 ? (
					<div className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface shadow-soft">
						{results.isFetching && !list.length ? (
							<div className="flex items-center gap-2 px-3 py-3 text-sm text-ink-soft">
								<Spinner size={14} /> Searching…
							</div>
						) : results.isError ? (
							<div className="px-3 py-3 text-sm text-red-600">{results.error?.message}</div>
						) : list.length ? (
							list.map((s) => (
								<button
									key={s.name}
									type="button"
									onClick={() => {
										onChange(s)
										setText("")
										setOpen(false)
									}}
									className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cream"
								>
									<UserRound size={15} className="shrink-0 text-ink-soft" />
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium text-ink">{s.full_name || s.name}</span>
										<span className="block truncate text-xs text-ink-soft">{[s.student_number || s.name, s.programme].filter(Boolean).join(" · ")}</span>
									</span>
								</button>
							))
						) : (
							<div className="px-3 py-3 text-sm text-ink-soft">No students match “{q}”.</div>
						)}
					</div>
				) : null}
			</div>
		</Field>
	)
}

/** `inRow`: for tables whose rows are already links (an <a> inside an <a> is invalid), so navigate by script instead. */
export function StudentLink({ id, name, sub, inRow }) {
	const nav = useNavigate()
	if (!id) return <span className="text-ink-soft">—</span>
	const to = `/admin/finance/students?student=${encodeURIComponent(id)}`
	const cls = "block truncate font-medium text-ink hover:text-brand-700"
	const go = (e) => {
		e.preventDefault()
		e.stopPropagation()
		nav(to)
	}
	return (
		<span className="min-w-0">
			{inRow ? (
				<span role="link" tabIndex={0} title="Open student account" className={clsx(cls, "cursor-pointer hover:underline")} onClick={go} onKeyDown={(e) => e.key === "Enter" && go(e)}>
					{name || id}
				</span>
			) : (
				<Link to={to} onClick={(e) => e.stopPropagation()} className={cls}>
					{name || id}
				</Link>
			)}
			{sub || (name && name !== id) ? <span className="block truncate text-xs text-ink-soft">{sub || id}</span> : null}
		</span>
	)
}

/** Read a server error message for inline display. */
export const errText = (e) => e?.message || (e ? String(e) : "")

export function Money({ value, className, strong }) {
	return <span className={clsx("tabular-nums", strong && "font-semibold text-ink", className)}>{money(value)}</span>
}

/** Sticky "unsaved changes" bar pinned to the bottom of the content column. */
export function SaveBar({ show, message = "You have unsaved changes", onSave, onDiscard, saving, label = "Save changes" }) {
	if (!show) return null
	return (
		<div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur lg:bottom-0 lg:left-[264px]">
			<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
				<span className="flex items-center gap-2 text-sm text-ink-muted">
					<span className="h-2 w-2 rounded-full bg-amber-500" /> {message}
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
