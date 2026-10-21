import { useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { ago, dateTime, parseServerDate, siteWallClock } from "@/shared/utils/format"

export { plainText }

/** Method prefixes, used for cache invalidation after a write. */
export const P = {
	lec: "mahanaim.api.lecturer.",
	acad: "mahanaim.api.academics.",
	learn: "mahanaim.api.learning.",
	asg: "mahanaim.api.assessments.",
	exam: "mahanaim.api.exams.",
	res: "mahanaim.api.results.",
	comm: "mahanaim.api.communication.",
}

export const M = {
	myOfferings: `${P.lec}my_offerings`,
	dashboard: `${P.lec}lecturer_dashboard`,
	overview: `${P.lec}offering_overview`,
	rosterCsv: `${P.lec}roster_csv`,

	getOffering: `${P.acad}get_offering`,
	listSessions: `${P.acad}list_sessions`,
	createSession: `${P.acad}create_session`,
	updateSession: `${P.acad}update_session`,
	cancelSession: `${P.acad}cancel_session`,
	sessionRoster: `${P.acad}session_roster`,
	takeAttendance: `${P.acad}take_attendance`,
	attendanceReport: `${P.acad}attendance_report`,

	listModules: `${P.learn}list_modules`,
	saveModule: `${P.learn}save_module`,
	deleteModule: `${P.learn}delete_module`,
	reorderModules: `${P.learn}reorder_modules`,
	saveResource: `${P.learn}save_resource`,
	deleteResource: `${P.learn}delete_resource`,
	reorderResources: `${P.learn}reorder_resources`,
	publishToggle: `${P.learn}publish_toggle`,
	downloadResource: `${P.learn}download_resource`,

	listAssignments: `${P.asg}list_assignments`,
	getAssignment: `${P.asg}get_assignment`,
	saveAssignment: `${P.asg}save_assignment`,
	publishAssignment: `${P.asg}publish_assignment`,
	closeAssignment: `${P.asg}close_assignment`,
	deleteAssignment: `${P.asg}delete_assignment`,
	listSubmissions: `${P.asg}list_submissions`,
	gradeSubmission: `${P.asg}grade_submission`,
	bulkGrade: `${P.asg}bulk_grade`,
	releaseGrades: `${P.asg}release_grades`,
	assignmentStats: `${P.asg}assignment_stats`,
	downloadAssignmentFile: `${P.asg}download_assignment_file`,

	listExams: `${P.exam}list_exams`,
	getExam: `${P.exam}get_exam`,
	saveExam: `${P.exam}save_exam`,
	scheduleExam: `${P.exam}schedule_exam`,
	unscheduleExam: `${P.exam}unschedule_exam`,
	cancelExam: `${P.exam}cancel_exam`,
	closeExam: `${P.exam}close_exam`,
	deleteExam: `${P.exam}delete_exam`,
	questionBank: `${P.exam}question_bank`,
	getQuestion: `${P.exam}get_question`,
	saveQuestion: `${P.exam}save_question`,
	deleteQuestion: `${P.exam}delete_question`,
	importQuestions: `${P.exam}import_questions`,
	markingQueue: `${P.exam}marking_queue`,
	attemptForMarking: `${P.exam}get_attempt_for_marking`,
	markAnswer: `${P.exam}mark_answer`,
	finaliseAttempt: `${P.exam}finalise_attempt`,
	voidAttempt: `${P.exam}void_attempt`,
	releaseResults: `${P.exam}release_results`,
	examStats: `${P.exam}exam_stats`,
	examMonitor: `${P.exam}exam_monitor`,

	getMarkSheet: `${P.res}get_mark_sheet`,
	recomputeMarkSheet: `${P.res}recompute_mark_sheet`,
	saveEntries: `${P.res}save_mark_sheet_entries`,
	updateWeights: `${P.res}update_mark_sheet_weights`,
	submitMarkSheet: `${P.res}submit_mark_sheet`,
	gradeDistribution: `${P.res}grade_distribution`,

	myAnnouncements: `${P.comm}my_announcements`,
	listAnnouncements: `${P.comm}list_announcements`,
	saveAnnouncement: `${P.comm}save_announcement`,
	sendAnnouncementNow: `${P.comm}send_announcement_now`,
	archiveAnnouncement: `${P.comm}archive_announcement`,
	deleteAnnouncement: `${P.comm}delete_announcement`,
	previewAudience: `${P.comm}preview_audience`,
	sendDirect: `${P.comm}send_direct_message`,
}

export const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Excused"]
export const QUESTION_TYPES = ["Multiple Choice", "Multiple Select", "True or False", "Short Answer", "Fill in the Blank", "Matching", "Essay"]
export const MANUAL_TYPES = ["Essay"]
export const DIFFICULTIES = ["Easy", "Medium", "Hard"]
export const EXAM_TYPES = ["CAT", "Quiz", "Main Exam", "Supplementary", "Special"]
export const EXAM_COMPONENTS = ["CAT", "Exam", "Practical", "Participation"]
export const ASSIGNMENT_COMPONENTS = ["Assignment", "CAT", "Project", "Practical", "Participation"]
export const SUBMISSION_TYPES = ["File Upload", "Text", "File and Text"]
export const SESSION_MODES = ["In Person", "Online", "Hybrid"]
export const RESOURCE_TYPES = ["PDF", "Document", "Video", "Audio", "Image", "Link", "Embed", "Text"]
export const FILE_RESOURCE_TYPES = ["PDF", "Document", "Audio", "Image"]
/** Mark-sheet components in display order: [key, weight field, score field, label]. */
export const COMPONENTS = [
	["cat", "cat_weight", "cat_score", "CAT"],
	["assignment", "assignment_weight", "assignment_score", "Assignment"],
	["exam", "exam_weight", "exam_score", "Exam"],
	["other", "other_weight", "other_score", "Other"],
]
export const EDITABLE_SHEET = ["Draft", "Returned"]
export const PAPER_EDITABLE = ["Draft", "Scheduled"]

const TONES = {
	exam: { Draft: "gray", Scheduled: "blue", Open: "green", Closed: "orange", Marking: "purple", Released: "brand", Cancelled: "red" },
	assignment: { Draft: "gray", Published: "green", Closed: "orange", Graded: "brand" },
	submission: { Draft: "gray", Submitted: "orange", Late: "red", Graded: "blue", Returned: "green", "Not Submitted": "gray", Missing: "red" },
	attempt: { "In Progress": "orange", Submitted: "blue", "Auto Submitted": "blue", Marking: "purple", Marked: "brand", Released: "green", Void: "red" },
	sheet: { "Not Started": "gray", Draft: "gray", Submitted: "orange", Approved: "blue", Published: "green", Returned: "red" },
	session: { Scheduled: "blue", Held: "green", Cancelled: "red", Rescheduled: "orange" },
	announcement: { Draft: "gray", Scheduled: "blue", Sent: "green", Archived: "gray" },
	attendance: { Present: "green", Absent: "red", Late: "orange", Excused: "blue" },
	question: { Easy: "green", Medium: "orange", Hard: "red" },
}
export const toneOf = (kind, status) => TONES[kind]?.[status]

/** Offerings I teach: term "" = current term, "all" = every term. */
export function useMyOfferings(term = "") {
	return useApi(M.myOfferings, { term: term || "" }, { staleTime: 60_000 })
}

export function offeringLabel(o) {
	if (!o) return ""
	return `${o.course} · ${o.course_title}${o.section && o.section !== "A" ? ` (${o.section})` : ""}`
}

/* ───────────── dates & times (server strings are site-local "YYYY-MM-DD HH:mm:ss") ───────────── */

export const pad = (n) => String(n).padStart(2, "0")

export function ymd(d = siteWallClock()) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseYmd(s) {
	const [y, m, d] = String(s).slice(0, 10).split("-").map(Number)
	return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(d, n) {
	const x = new Date(d)
	x.setDate(x.getDate() + n)
	return x
}

export function mondayOf(d = siteWallClock()) {
	const x = new Date(d)
	x.setHours(0, 0, 0, 0)
	return addDays(x, -((x.getDay() + 6) % 7))
}

/** "8:00:00" → "08:00" */
export function hm(t) {
	if (!t) return ""
	const [h, m] = String(t).split(":")
	return `${pad(Number(h) || 0)}:${pad(Number(m) || 0)}`
}

export function minutesOf(t) {
	const [h, m] = String(t || "0:0").split(":").map(Number)
	return (h || 0) * 60 + (m || 0)
}

/** Server datetime → value for <input type="datetime-local">. */
export function toLocalInput(v) {
	return v ? String(v).replace(" ", "T").slice(0, 16) : ""
}

export function fromLocalInput(v) {
	return v ? `${v.replace("T", " ")}:00`.slice(0, 19) : null
}

export function isPast(v) {
	if (!v) return false
	return (parseServerDate(v)?.getTime() ?? Infinity) < Date.now()
}

export function dayLabel(s) {
	const d = parseYmd(s)
	if (s === ymd()) return "Today"
	if (s === ymd(addDays(siteWallClock(), 1))) return "Tomorrow"
	if (s === ymd(addDays(siteWallClock(), -1))) return "Yesterday"
	return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })
}

export function duration(seconds) {
	const s = Math.max(0, Math.round(Number(seconds) || 0))
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const sec = s % 60
	return h ? `${h}h ${pad(m)}m` : `${m}:${pad(sec)}`
}

/* ───────────── numbers & files ───────────── */

export function score(v, digits = 2) {
	if (v === null || v === undefined || v === "") return "—"
	return Number(v).toLocaleString("en-KE", { maximumFractionDigits: digits })
}

export function pctTone(p) {
	const n = Number(p) || 0
	return n >= 75 ? "green" : n >= 50 ? "orange" : "red"
}

export function fileName(url) {
	return url ? decodeURIComponent(String(url).split("/").pop().split("?")[0]) : ""
}

/** Open a GET download endpoint or file URL. */
export function download(url) {
	const a = document.createElement("a")
	a.href = url
	a.rel = "noopener"
	a.target = "_blank"
	document.body.appendChild(a)
	a.click()
	a.remove()
}

/* ───────────── plain text ⇄ simple HTML (for Text Editor fields edited in a textarea) ───────────── */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function toHtml(text) {
	const t = String(text || "").trim()
	if (!t) return ""
	return t
		.split(/\n{2,}/)
		.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
		.join("")
}

export function fromHtml(html) {
	if (!html) return ""
	const marked = String(html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
		.replace(/<li[^>]*>/gi, "• ")
	return plainText(marked).replace(/\n{3,}/g, "\n\n").trim()
}

// get_mark_sheet saves (recomputes) on read, so two concurrent reads can collide with a
// TimestampMismatchError (HTTP 417). Retry those a few times; anything else fails fast.
export const CONFLICT_RETRY = {
	retry: (n, err) => n < 3 && (err?.status === 417 || err?.exc_type === "TimestampMismatchError"),
	retryDelay: (n) => 300 + n * 400,
}

/** Relative time for something that already happened; a timestamp in the future (clock skew) shows the date. */
export function since(v) {
	if (!v) return "—"
	const d = parseServerDate(v)
	return d && d.getTime() > Date.now() + 60000 ? dateTime(v) : ago(v)
}
