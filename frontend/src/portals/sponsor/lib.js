import { frappe } from "@/shared/api/frappe"

const S = "mahanaim.api.sponsor."

export const M = {
	profile: `${S}my_sponsor_profile`,
	updateProfile: `${S}update_my_sponsor_profile`,
	students: `${S}my_students`,
	progress: `${S}student_progress`,
	contributions: `${S}my_contributions`,
	payForStudent: `${S}pay_for_student`,
	give: `${S}give_online`,
	report: `${S}sponsor_report`,
	givingOptions: "mahanaim.api.church.giving_options",
}

/** Every cached read a sponsor payment or profile change can affect. */
export const INVALIDATE = [S]

export const COMMUNICATION = ["Email", "SMS", "WhatsApp", "Phone"]
export const DEFAULT_AMOUNTS = [500, 1000, 2500, 5000]

/** The API throws PermissionError when the user has no Sponsor record. */
export const isNoProfile = (err) => /no sponsor profile/i.test(err?.message || "")

export const thisYear = () => String(new Date().getFullYear())

export const receiptUrl = (payment) => frappe.downloadUrl("mahanaim.api.finance.download", { doctype: "receipt", name: payment, format: "pdf" })

export function coverageLabel(sp, { short = false } = {}) {
	if (!sp) return "—"
	if (sp.coverage === "Percentage") return `${Number(sp.percentage || 0)}%${short ? "" : " of fees"}`
	if (sp.coverage === "Fixed Amount") return `Fixed amount`
	return sp.coverage
}

const STANDING = { good: "green", "good standing": "green", probation: "orange", warning: "orange", suspended: "red", "dean's list": "purple", honours: "purple" }
export const standingTone = (s) => STANDING[String(s || "").toLowerCase()] || "blue"

export const CONTRIBUTION_TONE = { "Fee Payment": "brand", "Sponsor Credit": "blue", Giving: "gold" }

export function contributionText(c) {
	if (c.type === "Giving") return [c.giving_type, c.purpose].filter(Boolean).join(" · ")
	return c.student_name || c.student
}

/** Billed / paid / outstanding from the latest invoices returned by student_progress. */
export function feeSummary(progress) {
	const invoices = progress?.fees?.invoices || []
	const billed = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0)
	const paid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0)
	const balance = Number(progress?.fees?.balance ?? billed - paid)
	return { billed, paid, balance, pct: billed > 0 ? Math.round((paid / billed) * 100) : balance > 0 ? 0 : 100, invoices }
}

/** Contributions grouped per year into fee/giving buckets, for the bar chart. */
export function byYear(items = []) {
	const map = {}
	for (const c of items) {
		const y = String(c.date || "").slice(0, 4)
		if (!y) continue
		map[y] ||= { year: y, fees: 0, giving: 0 }
		map[y][c.type === "Giving" ? "giving" : "fees"] += Number(c.amount || 0)
	}
	return Object.values(map).sort((a, b) => a.year.localeCompare(b.year))
}

export function byType(items = []) {
	const map = {}
	for (const c of items) {
		const k = c.type === "Giving" ? c.giving_type || "Giving" : c.type === "Sponsor Credit" ? "Sponsorship credits" : "Student fees"
		map[k] = (map[k] || 0) + Number(c.amount || 0)
	}
	return Object.entries(map)
		.map(([label, value]) => ({ label, value }))
		.sort((a, b) => b.value - a.value)
		.map((d, i) => ({ ...d, color: CHART_COLORS[i % CHART_COLORS.length] }))
}

// Theme tokens, so the brand series stays legible on the dark canvas.
export const CHART_COLORS = ["brand-600", "gold-500", "brand-400", "gold-700", "brand-300", "gold-300", "ink-soft", "brand-800"].map((t) => `rgb(var(--${t}))`)
