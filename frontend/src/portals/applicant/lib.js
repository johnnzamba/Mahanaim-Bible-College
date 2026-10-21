import { frappe } from "@/shared/api/frappe"
import { ago, date, dateTime, parseServerDate } from "@/shared/utils/format"

const A = "mahanaim.api.admissions."

export const M = {
	options: `${A}application_options`,
	list: `${A}my_applications`,
	get: `${A}get_my_application`,
	save: `${A}save_application`,
	upload: `${A}upload_application_document`,
	remove: `${A}remove_application_document`,
	submit: `${A}submit_application`,
	pay: `${A}pay_application_fee`,
	accept: `${A}accept_offer`,
	decline: `${A}decline_offer`,
	withdraw: `${A}withdraw_application`,
	letter: `${A}admission_letter`,
	feeStatus: "mahanaim.api.finance.application_fee_status",
}

/** Every cache entry an applicant action can change. */
export const INVALIDATE = [A, M.feeStatus]

export const DOC_UPLOAD_STATUSES = ["Draft", "Submitted", "Under Review", "Interview"]
export const MULTI_DOC_TYPES = ["Other", "Recommendation Letter", "Academic Certificate"]
export const CLOSED_STATUSES = ["Rejected", "Declined", "Withdrawn"]
export const FEE_PAYABLE_STATUSES = ["Draft", "Submitted"]
export const DEFAULT_REQUIRED_DOCS = [["National ID"], ["Passport Photo"], ["KCSE Certificate", "Academic Certificate"]]
export const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp"
export const MAX_FILE_MB = 10

export const DOC_HINTS = {
	"National ID": "National ID card or passport bio-data page",
	"Passport Photo": "Recent colour passport-size photo",
	"KCSE Certificate": "KCSE certificate or official result slip",
	"Academic Certificate": "Diplomas, degrees or other certificates",
	"Recommendation Letter": "From your pastor or a church leader",
	"Birth Certificate": "Copy of your birth certificate",
	Other: "Any other supporting document",
}

/** Applicant-facing status tone (overrides the shared mapping where it has no entry). */
const TONES = { Interview: "purple", Declined: "gray", Waitlisted: "orange", Admitted: "green", Accepted: "green" }
export const statusTone = (status) => TONES[status]

export const fileName = (url) => {
	const raw = String(url || "").split("?")[0].split("/").pop() || ""
	try {
		return decodeURIComponent(raw)
	} catch {
		return raw
	}
}
export const isImage = (url) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(url || "").split("?")[0])
export const isPdf = (url) => /\.pdf$/i.test(String(url || "").split("?")[0])

/** Staff flagged this document for a new copy: not verified and carrying the officer's remark. */
export const needsReupload = (d) => Boolean(d?.file) && (d.needs_reupload ?? (!d.verified && Boolean(String(d.remarks || "").trim())))
/** "verified" | "flagged" | "pending" (uploaded, awaiting check). */
export const docState = (d) => (d?.verified ? "verified" : needsReupload(d) ? "flagged" : "pending")
/** Number of flagged documents on an application (list rows carry the count, full records the rows). */
export const flaggedCount = (app) => app?.documents_flagged ?? (app?.documents || []).filter(needsReupload).length
export const flaggedLabel = (n) => `${n} document${n === 1 ? " needs" : "s need"} a new copy`

export const letterPdfUrl = (name) => frappe.downloadUrl(M.letter, { name, format: "pdf" })
export const receiptUrl = (payment) => frappe.downloadUrl("mahanaim.api.finance.download", { doctype: "receipt", name: payment, format: "pdf" })

export function validateFile(file) {
	if (!file) return "Choose a file."
	if (file.size > MAX_FILE_MB * 1024 * 1024) return `That file is larger than ${MAX_FILE_MB} MB. Please upload a smaller copy.`
	if (!/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) return "Upload a PDF or an image (JPG, PNG)."
	return ""
}

/** Required document groups (each group is satisfied by any one of its types) plus the recommended letter. */
export function docChecklist(app, options) {
	const groups = options?.required_documents?.length ? options.required_documents : DEFAULT_REQUIRED_DOCS
	const docs = (app?.documents || []).filter((d) => d.file)
	const items = groups.map((types) => {
		const matches = docs.filter((d) => types.includes(d.document_type))
		let doc = matches.find((d) => d.verified) || matches.find((d) => !needsReupload(d)) || matches[0]
		if (!doc && types.includes("Passport Photo") && app?.photo) doc = { document_type: "Passport Photo", file: app.photo }
		return { key: types.join("|"), types, label: types.join(" or "), required: true, doc, done: Boolean(doc), flagged: needsReupload(doc) }
	})
	const letters = docs.filter((d) => d.document_type === "Recommendation Letter")
	items.push({
		key: "Recommendation Letter",
		types: ["Recommendation Letter"],
		label: "Recommendation letter",
		required: false,
		doc: letters.find((d) => !needsReupload(d)) || letters[0],
		done: letters.length > 0,
		flagged: letters.length > 0 && letters.every(needsReupload),
	})
	const required = items.filter((i) => i.required)
	const done = required.filter((i) => i.done).length
	return {
		items,
		done,
		total: required.length,
		pct: required.length ? Math.round((done / required.length) * 100) : 100,
		missing: required.filter((i) => !i.done),
		flagged: items.filter((i) => i.flagged),
	}
}

/** Stages of the admissions journey with done/current/failed state, for Timeline and Stepper. */
export function journey(app) {
	if (!app) return { steps: [], current: 0 }
	const log = app.status_log || []
	const when = (...statuses) => log.find((l) => statuses.includes(l.to_status))?.timestamp
	const status = app.status
	const hasInterview = status === "Interview" || Boolean(app.interview_date) || log.some((l) => l.to_status === "Interview")
	const decisionLabel =
		status === "Rejected" ? "Not admitted" : status === "Waitlisted" ? "Waitlisted" : ["Admitted", "Accepted", "Declined"].includes(status) ? "Offer made" : "Decision"
	let stages = [
		{ key: "Draft", short: "Started", label: "Application started", date: app.creation },
		{ key: "Submitted", short: "Submitted", label: "Submitted", date: app.submitted_on || when("Submitted") },
		{ key: "Under Review", short: "Review", label: "Under review", date: when("Under Review") },
		hasInterview ? { key: "Interview", short: "Interview", label: "Interview", date: when("Interview") } : null,
		{ key: "Decision", short: "Decision", label: decisionLabel, date: app.decision_date || when("Admitted", "Waitlisted", "Rejected") },
		{
			key: "Accepted",
			short: "Acceptance",
			label: status === "Declined" ? "Offer declined" : "Offer accepted",
			date: app.accepted_on || when("Accepted", "Declined"),
		},
		{ key: "Enrolled", short: "Enrolled", label: "Enrolled as a student", date: app.student ? app.accepted_on : null },
	].filter(Boolean)
	const idx = (k) => stages.findIndex((s) => s.key === k)
	const STAGE_OF = { Draft: "Draft", Submitted: "Submitted", "Under Review": "Under Review", Interview: "Interview", Admitted: "Decision", Waitlisted: "Decision", Rejected: "Decision", Accepted: "Accepted", Declined: "Accepted" }
	let done = -1
	let cur = -1
	let fail = -1
	switch (status) {
		case "Draft":
			done = 0
			cur = 1
			break
		case "Submitted":
		case "Under Review":
			done = 1
			cur = 2
			break
		case "Interview":
		case "Waitlisted":
			cur = idx(STAGE_OF[status])
			done = cur - 1
			break
		case "Rejected":
			fail = idx("Decision")
			done = fail - 1
			break
		case "Admitted":
			done = idx("Decision")
			cur = done + 1
			break
		case "Accepted":
			done = app.student ? idx("Enrolled") : idx("Accepted")
			cur = app.student ? -1 : idx("Enrolled")
			break
		case "Declined":
			done = idx("Decision")
			fail = idx("Accepted")
			break
		case "Withdrawn": {
			const prev = [...log].reverse().find((l) => l.to_status === "Withdrawn")?.from_status || "Draft"
			done = Math.max(0, idx(STAGE_OF[prev] || "Draft"))
			if (prev === "Under Review") done = idx("Submitted")
			fail = done + 1
			stages = [...stages.slice(0, fail), { key: "Withdrawn", short: "Withdrawn", label: "Application withdrawn", date: when("Withdrawn") }]
			break
		}
		default:
			done = 0
	}
	const notes = {
		Submitted: app.submitted_on ? `Application number ${app.name}` : null,
		"Under Review":
			status === "Submitted" && app.awaiting_fee
				? "Review starts once your application fee is paid."
				: status === "Submitted"
					? "Waiting for the admissions team to pick it up."
					: status === "Under Review"
						? "The admissions team is reviewing your documents."
						: null,
		Interview: app.interview_date ? `Scheduled for ${dateTime(app.interview_date)}` : status === "Interview" ? "You'll be contacted with the details." : null,
		Decision:
			status === "Rejected"
				? app.rejection_reason || "Unfortunately we could not offer you a place this time."
				: status === "Waitlisted"
					? "You're on the waiting list. We'll notify you if a place opens."
					: status === "Admitted" && app.offer_expiry
						? `Respond by ${date(app.offer_expiry)}`
						: null,
		Enrolled: app.student_number ? `Student number ${app.student_number}` : status === "Accepted" && !app.student ? "Your student record is being set up." : null,
	}
	const steps = stages.map((s, i) => ({
		...s,
		date: s.date && (i <= done || i === fail) ? date(s.date) : null,
		note: notes[s.key] || null,
		status: i === fail ? "failed" : i <= done ? "done" : i === cur ? "current" : "pending",
	}))
	const current = fail >= 0 ? fail : cur >= 0 ? cur : steps.length
	return { steps, current, closed: fail >= 0 }
}

export const WIZARD_STEPS = ["Programme", "Personal", "Church", "Academic", "Documents", "Review"]

/** Rough progress of a Draft through the wizard, for "continue" prompts. */
export function draftProgress(app, options) {
	if (!app) return 0
	const fields = options?.required_fields || ["gender", "date_of_birth", "national_id", "county", "nok_name", "nok_phone", "home_church", "pastor_name", "pastor_phone"]
	const filled = fields.filter((f) => app[f]).length
	const docs = docChecklist(app, options)
	const parts = [app.programme && app.campus && app.study_mode ? 1 : 0, filled / fields.length, docs.done / (docs.total || 1)]
	return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100)
}

/** ago() that never says "in N hours": server timestamps can run ahead of the browser clock when time zones differ. */
export function since(v) {
	const t = parseServerDate(v)?.getTime() ?? NaN
	if (Number.isFinite(t) && t > Date.now()) return "just now"
	return ago(v)
}
