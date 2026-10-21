/** Formatting helpers. Currency defaults to the institution currency from the boot payload. */

const boot = () => (typeof window !== "undefined" ? window.mahanaim_boot || {} : {})

export function currencyCode() {
	return boot().settings?.currency || "KES"
}

export function money(value, { currency, decimals = 0, compact = false } = {}) {
	const n = Number(value || 0)
	const code = currency || currencyCode()
	if (compact && Math.abs(n) >= 1000) {
		return `${code} ${new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`
	}
	return `${code} ${n.toLocaleString("en-KE", { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) })}`
}

export function num(value, decimals = 0) {
	return Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function pct(value, decimals = 0) {
	return `${Number(value || 0).toFixed(decimals)}%`
}

function toDate(v) {
	if (!v) return null
	if (v instanceof Date) return v
	const s = String(v)
	// Frappe datetimes are "YYYY-MM-DD HH:mm:ss(.ffffff)" in site time; treat as local.
	const d = new Date(s.includes(" ") ? s.replace(" ", "T").slice(0, 19) : s.length === 10 ? `${s}T00:00:00` : s)
	return Number.isNaN(d.getTime()) ? null : d
}

export function date(v, opts = { day: "numeric", month: "short", year: "numeric" }) {
	const d = toDate(v)
	return d ? d.toLocaleDateString("en-GB", opts) : "—"
}

export function dateTime(v) {
	const d = toDate(v)
	return d
		? `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
		: "—"
}

export function time(v) {
	if (!v) return "—"
	const s = String(v)
	if (/^\d{1,2}:\d{2}/.test(s)) {
		const [h, m] = s.split(":").map(Number)
		const d = new Date()
		d.setHours(h, m, 0, 0)
		return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
	}
	const d = toDate(v)
	return d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"
}

export function ago(v) {
	const d = toDate(v)
	if (!d) return "—"
	const s = Math.round((Date.now() - d.getTime()) / 1000)
	const abs = Math.abs(s)
	const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
	if (abs < 60) return fmt.format(-s, "second")
	if (abs < 3600) return fmt.format(-Math.round(s / 60), "minute")
	if (abs < 86400) return fmt.format(-Math.round(s / 3600), "hour")
	if (abs < 86400 * 30) return fmt.format(-Math.round(s / 86400), "day")
	if (abs < 86400 * 365) return fmt.format(-Math.round(s / (86400 * 30)), "month")
	return fmt.format(-Math.round(s / (86400 * 365)), "year")
}

export function daysUntil(v) {
	const d = toDate(v)
	if (!d) return null
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const t = new Date(d)
	t.setHours(0, 0, 0, 0)
	return Math.round((t - today) / 86400000)
}

export function initials(name = "") {
	return (
		String(name)
			.split(/[\s@._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase())
			.join("") || "?"
	)
}

export function titleCase(s = "") {
	return String(s)
		.replace(/[_-]+/g, " ")
		.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

export function fileSize(bytes) {
	const n = Number(bytes || 0)
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function greeting() {
	const h = new Date().getHours()
	return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

/** Kenyan phone normaliser for M-Pesa: 07xx / 01xx / +2547xx → 2547xxxxxxxx */
export function normalisePhone(p = "") {
	let s = String(p).replace(/[^\d+]/g, "")
	if (s.startsWith("+")) s = s.slice(1)
	if (s.startsWith("0")) s = `254${s.slice(1)}`
	if (/^[17]\d{8}$/.test(s)) s = `254${s}`
	return s
}

export function isValidMpesaPhone(p = "") {
	return /^254(7|1)\d{8}$/.test(normalisePhone(p))
}
