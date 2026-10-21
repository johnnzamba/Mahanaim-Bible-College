import { useMemo } from "react"
import { Link } from "react-router-dom"
import { ClipboardList, FileBarChart, GraduationCap, HandHeart, Library, Megaphone, ShieldAlert, Wallet } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { canAccess } from "@/shared/access"
import { useSession } from "@/shared/session"
import { Empty } from "@/shared/components/ui"
import { date, dateTime, money, num, pct } from "@/shared/utils/format"

export const M = "mahanaim.api.dashboard."

export const CATEGORY = {
	Academic: { icon: GraduationCap, tone: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
	Admissions: { icon: ClipboardList, tone: "bg-brand-50 text-brand-700" },
	Finance: { icon: Wallet, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
	Library: { icon: Library, tone: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
	"Church & Sponsors": { icon: HandHeart, tone: "bg-gold-50 text-gold-700" },
	Communication: { icon: Megaphone, tone: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
}
export const categoryOf = (c) => CATEGORY[c] || { icon: FileBarChart, tone: "bg-cream text-ink-muted" }

/** Plain-language blurbs for the catalog cards; unknown reports simply show their filters. */
export const BLURB = {
	enrolment_by_programme: "Students per programme, split by campus, study mode and intake.",
	admissions_funnel: "How applicants move from started to accepted, with conversion at each stage.",
	applications_list: "Every application with status, programme, funding and submission date.",
	student_list: "Current students with programme, year of study and fee standing.",
	fee_collections: "Payments received by day and by mode, with totals for the period.",
	outstanding_balances: "Students who still owe, largest balances first.",
	aging: "Unpaid balances bucketed by how long they have been overdue.",
	results_summary: "Grade distribution of published results by course.",
	pass_rates_by_course: "Sat, passed and failed per course, with pass rates.",
	attendance_summary: "Present, late, absent and excused per offering.",
	lms_engagement: "Active learners, completion and progress per offering on the LMS.",
	library_loans: "Loans issued and returned, overdue items and fines.",
	sponsorship_summary: "Sponsors, students supported, amounts committed and disbursed.",
	giving_summary: "Church and partner giving by month and giving type.",
	message_delivery: "SMS and email sent, delivered, queued and failed by channel.",
	payment_reconciliation: "M-Pesa receipts matched to student payments, plus unmatched money and payments with no M-Pesa record.",
	lecturer_workload: "Offerings, credit hours, students and grading backlog per lecturer for a term.",
	credentials_issued: "Transcripts and certificates issued, reissued or revoked, with verification counts.",
}

/** Server-side fallbacks that aren't declared as a filter `default` (so they never appear in applied_filters). */
export function implicitNote(report, applied = {}) {
	if (report === "student_list" && !applied.status) return "Current students only (Admitted, Registered, Active, Deferred, Suspended)"
	return null
}

/** "From Date" → "From", "Academic Term" → "Term" for the compact "Showing" line. */
export const shortLabel = (label) => String(label || "").replace(/ Date$/i, "").replace(/^Academic /i, "")

/** Non-blank catalog defaults for a report definition. */
export const filterDefaults = (def) => Object.fromEntries((def?.filters || []).filter((f) => f.default != null && f.default !== "").map((f) => [f.key, String(f.default)]))

export function useReportsAccess() {
	const s = useSession()
	return { roles: s.roles, allowed: canAccess(s.roles, "/reports") }
}

export function useCatalog() {
	return useApi(`${M}reports_catalog`, {}, { staleTime: 10 * 60_000 })
}

export function NoReports() {
	return (
		<div className="card">
			<Empty icon={ShieldAlert} title="Reports are not part of your role" subtitle="Ask a College Administrator if you need access to college reports." />
		</div>
	)
}

/** Options for Link-type filters. Doctypes without a source fall back to a free-text box. */
export function useLinkOptions(doctype, { term } = {}) {
	const lookups = useApi("mahanaim.api.setup.lookups", {}, { staleTime: 5 * 60_000, enabled: ["Campus", "Programme", "Academic Term", "Study Mode", "Intake", "Department", "Academic Year"].includes(doctype) })
	const offerings = useApi("mahanaim.api.academics.list_offerings", { term: term || undefined, page_length: 200 }, { enabled: doctype === "Course Offering", staleTime: 5 * 60_000, retry: false })
	const giving = useApi("mahanaim.api.church.list_giving_types", {}, { enabled: doctype === "Giving Type", staleTime: 10 * 60_000, retry: false })
	return useMemo(() => {
		const d = lookups.data || {}
		const list = (x) => (Array.isArray(x) ? x : x?.data || x?.rows || [])
		switch (doctype) {
			case "Campus":
				return { options: (d.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name })) }
			case "Programme":
				return { options: (d.programmes || []).map((p) => ({ value: p.name, label: `${p.programme_name || p.name} (${p.code || p.name})` })) }
			case "Academic Term":
				return { options: (d.terms || []).map((t) => ({ value: t.name, label: t.is_current ? `${t.name} (current)` : t.name })) }
			case "Study Mode":
				return { options: (d.study_modes || []).map((s) => ({ value: s.name, label: s.study_mode_name || s.name })) }
			case "Intake":
				return { options: (d.intakes || []).map((i) => ({ value: i.name, label: i.intake_name || i.name })) }
			case "Department":
				return { options: (d.departments || []).map((i) => ({ value: i.name, label: i.department_name || i.name })) }
			case "Academic Year":
				return { options: (d.academic_years || []).map((i) => ({ value: i.name, label: i.year_name || i.name })) }
			case "Course Offering":
				if (offerings.isError) return { free: true }
				return { options: list(offerings.data).map((o) => ({ value: o.name, label: [o.course_title || o.course, o.campus].filter(Boolean).join(" · ") || o.name })) }
			case "Giving Type":
				if (giving.isError) return { free: true }
				return { options: list(giving.data).map((g) => ({ value: g.name, label: g.giving_type_name || g.name })) }
			default:
				return { free: true }
		}
	}, [doctype, lookups.data, offerings.data, offerings.isError, giving.data, giving.isError])
}

const MONEY_KEY = /(amount|balance|billed|collected|outstanding|paid|giving|committed|disbursed|fines?|fees?|gap)$/i

/** Format one report cell from the column type (Currency, Percent, Int, Float, Date, Datetime, Check, Link, Data). */
export function fmtCell(value, type, key) {
	if (value == null || value === "") return "—"
	switch (type) {
		case "Currency":
			return money(value)
		case "Percent":
			return pct(value, 1)
		case "Int":
			return num(value)
		case "Float":
			return num(value, 2)
		case "Date":
			return date(value)
		case "Datetime":
			return dateTime(value)
		case "Check":
			return Number(value) ? "Yes" : "No"
		default:
			if (typeof value === "number" && MONEY_KEY.test(key || "")) return money(value)
			if (typeof value === "number") return num(value, Number.isInteger(value) ? 0 : 2)
			return String(value)
	}
}

export function fmtSummary(key, value, columns = []) {
	const col = columns.find((c) => c.key === key)
	if (col?.type === "Float" && Number.isInteger(Number(value))) return num(value)
	if (col) return fmtCell(value, col.type, key)
	if (typeof value !== "number") return /date|as_of/.test(key) ? date(value) : String(value)
	if (MONEY_KEY.test(key) || /^(total|committed|disbursed|fines)$/.test(key)) return money(value, { compact: Math.abs(value) >= 1e6 })
	if (/rate|pct|percent/.test(key)) return pct(value, 1)
	return num(value, Number.isInteger(value) ? 0 : 2)
}

export const humanise = (k) => String(k).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

/** Where a report's key column points inside the admin portal (only linked when the viewer can open it). */
export function cellRoute(report, key, value, row = {}) {
	if (!value) return null
	const v = encodeURIComponent(value)
	if (key === "matched_name") return typeof row.matched_route === "string" && /^\/admin\/[\w-]/.test(row.matched_route) ? row.matched_route : null
	if ((key === "staff_member" || key === "lecturer_name") && row.staff_member) return `/admin/staff/${encodeURIComponent(row.staff_member)}`
	if (key === "student") return `/admin/students/${v}`
	if (key === "name" && report === "applications_list") return `/admin/admissions/${v}`
	if (key === "name" && report === "student_list") return `/admin/students/${v}`
	if (key === "course_offering") return `/admin/academics/offerings/${v}`
	if (key === "programme") return `/admin/academics/programmes/${v}`
	if (key === "course") return `/admin/academics/courses/${v}`
	if (key === "sponsor" || key === "primary_sponsor") return `/admin/church/sponsors/${v}`
	if (key === "invoice") return `/admin/finance/invoices/${v}`
	if (key === "payment") return `/admin/finance/payments/${v}`
	return null
}

export function CellLink({ to, roles, children }) {
	const rel = to ? to.replace(/^\/admin/, "") || "/" : null
	if (!to || !canAccess(roles, rel)) return children
	return (
		<Link to={to} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
			{children}
		</Link>
	)
}

const RECENT_KEY = "mbc.reports.recent"
export function recentReports() {
	try {
		return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]")
	} catch {
		return []
	}
}
export function rememberReport(key) {
	try {
		const next = [key, ...recentReports().filter((k) => k !== key)].slice(0, 5)
		localStorage.setItem(RECENT_KEY, JSON.stringify(next))
	} catch {
		/* private mode */
	}
}
