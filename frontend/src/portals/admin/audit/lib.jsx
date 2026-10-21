import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { Ban, Download, FileText, GraduationCap, HandCoins, Lock, Settings2, UserCog } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { canAccess } from "@/shared/access"
import { useSession } from "@/shared/session"
import { Empty, Pagination } from "@/shared/components/ui"
import { useDebounced } from "@/shared/components/kit"
import { ago, dateTime, parseServerDate } from "@/shared/utils/format"

export const A = "mahanaim.api.audit."

/** Lists from this module return {rows, total}; most others return {data, total}. */
export const rowsOf = (d) => (Array.isArray(d) ? d : d?.rows || d?.data || [])

const compact = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== "" && v != null))

const pad = (n) => String(n).padStart(2, "0")
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const ahead = (v) => {
	const t = (parseServerDate(v)?.getTime() ?? NaN)
	return Number.isFinite(t) && t > Date.now() + 60_000
}
/** Server clocks can run ahead of the browser; show the exact time instead of "in 3 hours". */
export const since = (v) => (ahead(v) ? dateTime(v) : ago(v))
/** Relative time, or null when it would only repeat the timestamp. */
export const relative = (v) => (ahead(v) ? null : ago(v))

/** `/admin/audit?tab=…&…` with empty values dropped. */
export const auditLink = (params) => {
	const s = new URLSearchParams(compact(params)).toString()
	return `/admin/audit${s ? `?${s}` : ""}`
}

/** Filters kept in the query string so views can be linked and survive reloads. */
export function useUrlFilters(keys) {
	const [params, setParams] = useSearchParams()
	const values = Object.fromEntries(keys.map((k) => [k, params.get(k) || ""]))
	const apply = (patch, base = params) => {
		const next = new URLSearchParams(base)
		for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k)
		setParams(next, { replace: true })
	}
	const tabOnly = () => new URLSearchParams(params.get("tab") ? { tab: params.get("tab") } : {})
	return {
		values,
		set: (k, v) => apply({ [k]: v }),
		/** Replace every filter at once (others are cleared). */
		only: (patch) => apply(patch, tabOnly()),
		clear: () => apply({}, tabOnly()),
		any: keys.some((k) => values[k]),
	}
}

/** Free-text search kept locally for typing and pushed to the URL once it settles. */
export function useUrlSearch(filters, key = "q") {
	const urlValue = filters.values[key]
	const [text, setText] = useState(urlValue)
	const settled = useDebounced(text, 350)
	useEffect(() => {
		if (settled !== urlValue) filters.set(key, settled)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [settled])
	useEffect(() => {
		if (!urlValue) setText((t) => (t && settled === t ? "" : t))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [urlValue])
	return [text, setText]
}

export function usePaged(method, filters = {}, pageSize = 20) {
	const [page, setPage] = useState(1)
	const clean = compact(filters)
	const sig = JSON.stringify(clean)
	useEffect(() => setPage(1), [sig])
	const query = useApi(method, { ...clean, start: (page - 1) * pageSize, page_length: pageSize }, { placeholderData: (prev) => prev })
	return { query, page, setPage, pageSize, rows: rowsOf(query.data), total: query.data?.total || 0, filters: clean }
}

export function Pager({ list }) {
	return <Pagination className="mt-4" page={list.page} pageSize={list.pageSize} total={list.total} onChange={list.setPage} />
}

export function exportHref(kind, filters) {
	return frappe.downloadUrl(`${A}export_audit`, { kind, filters: JSON.stringify(compact(filters)) })
}

export function ExportButton({ kind, filters, disabled }) {
	const cls = "btn btn-secondary btn-sm"
	if (disabled) {
		return (
			<span className={clsx(cls, "pointer-events-none opacity-50")} aria-disabled="true">
				<Download size={14} /> Export CSV
			</span>
		)
	}
	return (
		<a className={cls} href={exportHref(kind, filters)} download title="Up to 5,000 rows with the current filters">
			<Download size={14} /> Export CSV
		</a>
	)
}

export function FilterSelect({ value, onChange, children, className, label }) {
	return (
		<select aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} className={clsx("input h-10 w-full py-0 text-sm sm:w-auto", className)}>
			{children}
		</select>
	)
}

export function DateRange({ from, to, onFrom, onTo, className }) {
	return (
		<div className={clsx("flex items-center gap-1.5", className)}>
			<input type="date" aria-label="From date" value={from || ""} max={to || undefined} onChange={(e) => onFrom(e.target.value)} className="input h-10 w-full min-w-0 py-0 text-sm lg:w-[8.9rem]" />
			<span className="text-xs text-ink-soft">to</span>
			<input type="date" aria-label="To date" value={to || ""} min={from || undefined} onChange={(e) => onTo(e.target.value)} className="input h-10 w-full min-w-0 py-0 text-sm lg:w-[8.9rem]" />
		</div>
	)
}

const e = encodeURIComponent

/** Doctype → admin screen (relative to /admin). Records without a dedicated screen land on their list. */
const ROUTES = {
	Student: (n) => `/students/${e(n)}`,
	"Staff Member": (n) => `/staff/${e(n)}`,
	"Programme Application": (n) => `/admissions/${e(n)}`,
	"Semester Registration": (n) => `/students/registrations/${e(n)}`,
	"Student Request": (n) => `/students/requests/${e(n)}`,
	Programme: (n) => `/academics/programmes/${e(n)}`,
	Course: (n) => `/academics/courses/${e(n)}`,
	"Course Offering": (n) => `/academics/offerings/${e(n)}`,
	Exam: (n) => `/academics/exams/${e(n)}`,
	"Mark Sheet": (n) => `/academics/mark-sheets/${e(n)}`,
	"Course Result": () => "/academics/results",
	"Academic Term": () => "/academics/calendar",
	"Academic Year": () => "/academics/calendar",
	Intake: () => "/academics/calendar",
	"Grading Scale": () => "/academics/grading",
	Transcript: () => "/credentials",
	Certificate: () => "/credentials",
	"Student Invoice": (n) => `/finance/invoices/${e(n)}`,
	"Student Payment": (n) => `/finance/payments/${e(n)}`,
	"Fee Structure": (n) => `/finance/setup/structures/${e(n)}`,
	"Fee Component": () => "/finance/setup?tab=components",
	Scholarship: () => "/finance/setup?tab=scholarships",
	"Fee Adjustment": () => "/finance/adjustments",
	"Refund Request": () => "/finance/refunds",
	"M-Pesa Transaction": () => "/finance/mpesa",
	"M-Pesa Request": () => "/finance/mpesa?tab=requests",
	"M-Pesa Settings": () => "/settings/integrations",
	"LMS Bridge Settings": () => "/settings/integrations?tab=lms",
	"Mahanaim Settings": () => "/settings",
	Campus: () => "/settings/master-data",
	Department: () => "/settings/master-data?tab=departments",
	"Study Mode": () => "/settings/master-data?tab=study_modes",
	Sponsor: (n) => `/church/sponsors/${e(n)}`,
	Sponsorship: () => "/church/sponsorships",
	"Giving Record": () => "/church/giving",
	"Giving Type": () => "/church/giving",
	"Partner Church": () => "/church/churches",
	"Chapel Service": (n) => `/church/chapel/${e(n)}`,
	"Ministry Group": () => "/church/ministry-groups",
	Announcement: (n) => `/communication/announcements/${e(n)}`,
	"Message Template": (n) => `/communication/templates/${e(n)}`,
	"Message Log": () => "/communication/messages",
	"News Post": (n) => `/website/news/${e(n)}`,
	"Campus Event": (n) => `/website/events/${e(n)}`,
	"Contact Enquiry": (n) => `/website/enquiries/${e(n)}`,
	"Campus Website Settings": () => "/website/content",
	FAQ: () => "/website/content",
	Testimonial: () => "/website/content",
	"Library Item": (n) => `/library/catalogue/${e(n)}`,
	"Library Loan": () => "/library/loans",
}

/** Returns a function giving the absolute admin route for a record, or null when unknown or not allowed. */
export function useRecordRoute() {
	const { roles } = useSession()
	return (doctype, name) => {
		const fn = ROUTES[doctype]
		if (!fn || !name) return null
		const rel = fn(name)
		return canAccess(roles, rel.split("?")[0]) ? `/admin${rel}` : null
	}
}

export function RecordLink({ doctype, name, className, children }) {
	const route = useRecordRoute()(doctype, name)
	const body = children ?? name
	return route ? (
		<Link to={route} onClick={(ev) => ev.stopPropagation()} className={clsx("font-semibold text-brand-700 hover:underline", className)}>
			{body}
		</Link>
	) : (
		<span className={clsx("font-semibold text-ink", className)}>{body}</span>
	)
}

export const KIND = {
	student_status: { label: "Student status", tone: "blue", icon: GraduationCap },
	application_decision: { label: "Admission decision", tone: "brand", icon: FileText },
	cancellation: { label: "Cancellation", tone: "red", icon: Ban },
	refund_decision: { label: "Refund decision", tone: "orange", icon: HandCoins },
	revocation: { label: "Revocation", tone: "red", icon: Lock },
	settings_update: { label: "Settings change", tone: "purple", icon: Settings2 },
}
export const kindOf = (k) => KIND[k] || { label: String(k || "Event").replace(/_/g, " "), tone: "gray", icon: UserCog }

export function NoAccess() {
	return (
		<div className="card mx-auto mt-6 max-w-lg">
			<Empty icon={Lock} title="You don't have access here" subtitle="The audit log is for Auditors and College Administrators. Ask a College Administrator if you need it." />
		</div>
	)
}
