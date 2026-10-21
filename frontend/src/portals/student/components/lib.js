/** Student portal helpers: API names, server clock, countdown maths, small formatters. */
import { safeUrl } from "@/shared/utils/sanitize"
import { ago } from "@/shared/utils/format"

export { safeUrl }

/** Only absolute https URLs, for iframes and other embeds. */
export const httpsUrl = (url) => {
	const s = safeUrl(url)
	return s && /^https:\/\//i.test(s) ? s : undefined
}

export const API = {
	dashboard: "mahanaim.api.students.my_dashboard",
	profile: "mahanaim.api.students.my_profile",
	updateProfile: "mahanaim.api.students.update_my_profile",
	regOptions: "mahanaim.api.students.registration_options",
	submitReg: "mahanaim.api.students.submit_registration",
	cancelReg: "mahanaim.api.students.cancel_registration",
	myRegs: "mahanaim.api.students.my_registrations",
	enrolments: "mahanaim.api.students.my_courses",
	requests: "mahanaim.api.students.my_requests",
	createRequest: "mahanaim.api.students.create_request",
	cancelRequest: "mahanaim.api.students.cancel_request",
	courses: "mahanaim.api.learning.my_courses",
	course: "mahanaim.api.learning.my_course",
	markResource: "mahanaim.api.learning.mark_resource_complete",
	assignments: "mahanaim.api.assessments.my_assignments",
	assignment: "mahanaim.api.assessments.get_my_assignment",
	submitAssignment: "mahanaim.api.assessments.submit_assignment",
	exams: "mahanaim.api.exams.my_exams",
	startExam: "mahanaim.api.exams.start_exam",
	getAttempt: "mahanaim.api.exams.get_attempt",
	saveAnswer: "mahanaim.api.exams.save_answer",
	logEvent: "mahanaim.api.exams.log_exam_event",
	submitAttempt: "mahanaim.api.exams.submit_attempt",
	examResult: "mahanaim.api.exams.my_exam_result",
	results: "mahanaim.api.results.my_results",
	transcript: "mahanaim.api.results.my_transcript_preview",
	timetable: "mahanaim.api.academics.my_timetable",
	attendance: "mahanaim.api.academics.my_attendance",
	fees: "mahanaim.api.finance.my_fees",
	statement: "mahanaim.api.finance.my_statement",
	payFees: "mahanaim.api.finance.pay_fees",
	refund: "mahanaim.api.finance.request_refund",
	catalogue: "mahanaim.api.library.catalogue",
	libItem: "mahanaim.api.library.item",
	accessDigital: "mahanaim.api.library.access_digital",
	loans: "mahanaim.api.library.my_loans",
	requestLoan: "mahanaim.api.library.request_loan",
	cancelLoan: "mahanaim.api.library.cancel_loan_request",
	documents: "mahanaim.api.credentials.my_documents",
	requestTranscript: "mahanaim.api.credentials.request_transcript",
	announcements: "mahanaim.api.communication.my_announcements",
	alumni: "mahanaim.api.alumni.my_alumni_profile",
	updateAlumni: "mahanaim.api.alumni.update_my_alumni_profile",
	alumniDirectory: "mahanaim.api.alumni.alumni_directory",
	lookups: "mahanaim.api.website.apply_lookups",
}

/** Invalidation prefixes. */
export const INV = {
	students: "mahanaim.api.students.",
	learning: "mahanaim.api.learning.",
	assessments: "mahanaim.api.assessments.",
	exams: "mahanaim.api.exams.",
	finance: "mahanaim.api.finance.",
	library: "mahanaim.api.library.",
	credentials: "mahanaim.api.credentials.",
	results: "mahanaim.api.results.",
	alumni: "mahanaim.api.alumni.",
}

export const fileUrl = (method, args) => `/api/method/${method}?${new URLSearchParams(args).toString()}`

export const financePdf = (doctype, name, extra = {}) =>
	fileUrl("mahanaim.api.finance.download", { doctype, ...(name ? { name } : {}), ...extra })

export const credentialPdf = (doctype, name) => fileUrl("mahanaim.api.credentials.download_pdf", { doctype, name })
export const credentialPrint = (doctype, name) => fileUrl("mahanaim.api.credentials.print_view", { doctype, name })

/* ───────────────────────── Server clock ─────────────────────────
 * The site clock can differ from the device clock (time zone or drift), so due dates and exam windows
 * are compared against "server now" = Date.now() + offset, learned from any payload carrying server_time. */

export function toDate(v) {
	if (!v) return null
	if (v instanceof Date) return v
	const s = String(v)
	const d = new Date(s.includes(" ") ? s.replace(" ", "T").slice(0, 19) : s.length === 10 ? `${s}T00:00:00` : s)
	return Number.isNaN(d.getTime()) ? null : d
}

let offsetMs = 0
let known = false
const listeners = new Set()

/** `receivedAt` is when the payload arrived (react-query's dataUpdatedAt) so cached payloads don't skew the clock. */
export function syncServerTime(serverTime, receivedAt = Date.now()) {
	const d = toDate(serverTime)
	if (!d) return
	offsetMs = d.getTime() - (receivedAt || Date.now())
	known = true
	for (const fn of listeners) fn(offsetMs)
}

export const serverNow = () => Date.now() + offsetMs

/** ago() for a naive server-local timestamp, measured against the server clock rather than the device clock. */
export function since(v) {
	const d = toDate(v)
	return d ? ago(new Date(d.getTime() - offsetMs)) : "—"
}
export const serverClockKnown = () => known

export function onServerClock(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

/** "YYYY-MM-DD" for the server's today (falls back to the device clock until synced). */
export function serverToday() {
	return isoDate(new Date(serverNow()))
}

export function isoDate(d) {
	const x = d instanceof Date ? d : toDate(d)
	if (!x) return ""
	const p = (n) => String(n).padStart(2, "0")
	return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

export function addDays(d, n) {
	const x = new Date(toDate(d))
	x.setDate(x.getDate() + n)
	return x
}

export function startOfWeek(d) {
	const x = new Date(toDate(d))
	x.setHours(0, 0, 0, 0)
	const day = (x.getDay() + 6) % 7
	x.setDate(x.getDate() - day)
	return x
}

/** Milliseconds from server-now until `v` (negative when past). */
export function msUntil(v) {
	const d = toDate(v)
	return d ? d.getTime() - serverNow() : null
}

/** "3d 4h", "2h 15m", "12m", "45s". */
export function humanSpan(ms) {
	if (ms == null) return "—"
	const s = Math.max(0, Math.floor(Math.abs(ms) / 1000))
	const d = Math.floor(s / 86400)
	const h = Math.floor((s % 86400) / 3600)
	const m = Math.floor((s % 3600) / 60)
	if (d) return `${d}d ${h}h`
	if (h) return `${h}h ${m}m`
	if (m) return `${m}m`
	return `${s % 60}s`
}

/** "1:05:09" / "05:09" for an exam clock. */
export function clock(seconds) {
	const s = Math.max(0, Math.floor(seconds || 0))
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const r = s % 60
	const p = (n) => String(n).padStart(2, "0")
	return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`
}

/** Relative due label + tone for deadlines. */
export function dueInfo(due, { done } = {}) {
	const ms = msUntil(due)
	if (ms == null) return { label: "No due date", tone: "gray" }
	if (done) return { label: `Due ${shortDate(due)}`, tone: "gray" }
	if (ms < 0) return { label: `Overdue by ${humanSpan(ms)}`, tone: "red" }
	if (ms < 86400000) return { label: `Due in ${humanSpan(ms)}`, tone: "orange" }
	if (ms < 3 * 86400000) return { label: `Due in ${humanSpan(ms)}`, tone: "gold" }
	return { label: `Due in ${humanSpan(ms)}`, tone: "blue" }
}

export function shortDate(v) {
	const d = toDate(v)
	return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"
}

export function weekday(v, style = "short") {
	const d = toDate(v)
	return d ? d.toLocaleDateString("en-GB", { weekday: style }) : ""
}

export function hhmm(v) {
	if (!v) return ""
	const m = String(v).match(/(\d{1,2}):(\d{2})/)
	if (!m) return String(v)
	return `${m[1].padStart(2, "0")}:${m[2]}`
}

/** Minutes since midnight for "HH:mm:ss". */
export function minutesOf(v) {
	const m = String(v || "").match(/(\d{1,2}):(\d{2})/)
	return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

export const plural = (n, word, many) => `${n} ${Number(n) === 1 ? word : many || `${word}s`}`

export function gradeTone(points) {
	const p = Number(points)
	if (Number.isNaN(p)) return "gray"
	if (p >= 3.5) return "green"
	if (p >= 2.5) return "brand"
	if (p >= 1.5) return "orange"
	return "red"
}

export function pctTone(p, { good = 75, warn = 60 } = {}) {
	const n = Number(p || 0)
	return n >= good ? "green" : n >= warn ? "orange" : "red"
}

export const ASSIGNMENT_STATE = {
	pending: { label: "To do", tone: "blue" },
	overdue: { label: "Overdue", tone: "red" },
	submitted: { label: "Submitted", tone: "orange" },
	graded: { label: "Graded", tone: "green" },
}

export const isAnswered = (v) =>
	v != null &&
	v !== "" &&
	!(Array.isArray(v) && v.length === 0) &&
	!(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0)

export function readLocal(key, fallback) {
	try {
		const raw = localStorage.getItem(key)
		return raw ? JSON.parse(raw) : fallback
	} catch {
		return fallback
	}
}

export function writeLocal(key, value) {
	try {
		if (value === undefined) localStorage.removeItem(key)
		else localStorage.setItem(key, JSON.stringify(value))
	} catch {
		/* storage full or disabled */
	}
}
