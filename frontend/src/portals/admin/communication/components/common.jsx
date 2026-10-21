import { frappe } from "@/shared/api/frappe"
import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"
import { SubTabs } from "./kit"

export const API = "mahanaim.api.communication."
export const INVALIDATE = [API]

export const AUDIENCES = ["Everyone", "All Students", "All Staff", "Lecturers", "Programme", "Campus", "Course Offering", "Applicants", "Sponsors", "Alumni"]
export const AUDIENCE_HINT = {
	Everyone: "Students, staff, sponsors and alumni with an account.",
	"All Students": "Every current student.",
	"All Staff": "Every active staff member.",
	Lecturers: "Teaching staff only.",
	Programme: "Students in one programme.",
	Campus: "Students on one campus.",
	"Course Offering": "Students enrolled in one class.",
	Applicants: "People with an open application.",
	Sponsors: "Active sponsors.",
	Alumni: "Graduates in the alumni network.",
}
export const ANN_STATUSES = ["Draft", "Scheduled", "Sent", "Archived"]
export const CHANNELS = ["Email", "SMS", "In-App"]
export const LOG_STATUSES = ["Queued", "Sent", "Delivered", "Failed"]

const TONES = { Draft: "gray", Scheduled: "blue", Sent: "green", Archived: "gray", Queued: "blue", Delivered: "green", Failed: "red" }
export const toneOf = (status) => TONES[status]

/** Role checks mirroring the require_roles lists in mahanaim/api/communication.py. */
export function useCommsRoles() {
	const { hasRole } = useSession()
	return {
		canAnnounce: hasRole(ROLES.COMMS, ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE, ROLES.CHAPLAIN, ROLES.LECTURER),
		isComms: hasRole(ROLES.COMMS),
		canLog: hasRole(ROLES.COMMS, ROLES.AUDITOR),
		canDirect: hasRole(ROLES.COMMS, ROLES.REGISTRAR, ROLES.ADMISSIONS, ROLES.FINANCE, ROLES.DEAN),
	}
}

export function CommsTabs() {
	const { canAnnounce, isComms, canLog } = useCommsRoles()
	const links = [
		canAnnounce || !isComms ? { to: "/admin/communication", label: "Announcements", end: true } : null,
		isComms ? { to: "/admin/communication/templates", label: "Templates" } : null,
		canLog ? { to: "/admin/communication/messages", label: "Message log" } : null,
	].filter(Boolean)
	return <SubTabs label="Communication sections" links={links} />
}

const like = (q) => `%${q.trim()}%`
const settle = (promises) => Promise.allSettled(promises).then((rs) => rs.flatMap((r) => (r.status === "fulfilled" ? r.value : [])))
const EMAIL = /^\S+@\S+\.\S+$/
const PHONE = /^(\+?254|0)?[17]\d{8}$/

/** People the signed-in user may look up (each source quietly drops out if their role can't read it). */
export const searchRecipients = (q) => {
	const t = q.trim()
	const literal = []
	if (EMAIL.test(t)) literal.push({ value: `email:${t.toLowerCase()}`, type: "email", label: t.toLowerCase(), description: "Email address", spec: { email: t.toLowerCase() } })
	else if (PHONE.test(t.replace(/\s+/g, ""))) literal.push({ value: `phone:${t}`, type: "phone", label: t, description: "Phone number (SMS)", spec: { phone: t.replace(/\s+/g, "") } })
	return settle([
		frappe
			.call("frappe.client.get_list", {
				doctype: "Student",
				fields: ["name", "full_name", "student_number", "programme"],
				or_filters: [["full_name", "like", like(t)], ["student_number", "like", like(t)], ["email", "like", like(t)]],
				limit_page_length: 6,
			})
			.then((rows) => rows.map((s) => ({ value: `student:${s.name}`, type: "student", label: s.full_name, description: `Student · ${[s.student_number, s.programme].filter(Boolean).join(" · ")}`, spec: { student: s.name } }))),
		frappe
			.call("frappe.client.get_list", {
				doctype: "Staff Member",
				fields: ["name", "full_name", "designation"],
				or_filters: [["full_name", "like", like(t)], ["email", "like", like(t)]],
				limit_page_length: 6,
			})
			.then((rows) => rows.map((s) => ({ value: `staff:${s.name}`, type: "staff", label: s.full_name, description: `Staff · ${s.designation || s.name}`, spec: { staff_member: s.name } }))),
		frappe
			.call("frappe.client.get_list", {
				doctype: "Sponsor",
				fields: ["name", "sponsor_name", "sponsor_type"],
				or_filters: [["sponsor_name", "like", like(t)], ["email", "like", like(t)]],
				limit_page_length: 4,
			})
			.then((rows) => rows.map((s) => ({ value: `sponsor:${s.name}`, type: "sponsor", label: s.sponsor_name, description: `Sponsor · ${s.sponsor_type || ""}`, spec: { sponsor: s.name } }))),
	]).then((rows) => [...literal, ...rows])
}

export const searchOfferings = (q) =>
	frappe
		.call("mahanaim.api.academics.list_offerings", { search: q, page_length: 10 })
		.then((r) => (r?.data || []).map((o) => ({ value: o.name, label: o.course_title || o.course || o.name, description: [o.name, o.academic_term, o.campus].filter(Boolean).join(" · ") })))

/** The document type each template event is rendered against (null = no document; the recipient only). */
export const SAMPLE_DOCTYPE = {
	"Application Submitted": "Programme Application",
	"Application Fee Paid": "Programme Application",
	"Application Under Review": "Programme Application",
	"Interview Scheduled": "Programme Application",
	"Application Approved": "Programme Application",
	"Application Rejected": "Programme Application",
	"Offer Accepted": "Programme Application",
	"Student Created": "Student",
	"Registration Approved": "Semester Registration",
	"Invoice Issued": "Student Invoice",
	"Payment Received": "Student Payment",
	"Assignment Published": "Assignment",
	"Assignment Due Reminder": "Assignment",
	"Assignment Graded": "Assignment Submission",
	"Exam Scheduled": "Exam",
	"Exam Reminder": "Exam",
	"Transcript Ready": "Transcript",
	"Certificate Ready": "Certificate",
	"Student Request Update": "Student Request",
	Announcement: "Announcement",
	"Event Registration": "Event Registration",
	"Contact Enquiry": "Contact Enquiry",
	"Enquiry Response": "Contact Enquiry",
	"Library Loan Overdue": "Library Loan",
	"Giving Receipt": "Giving Record",
	"Event Waitlist": "Event Registration",
	"Event Cancelled": "Event Registration",
	"Registration Rejected": "Semester Registration",
	"Application Waitlisted": "Programme Application",
	"Offer Declined": "Programme Application",
	"Application Withdrawn": "Programme Application",
	"Sponsor Report": "Sponsor",
}

/** Title field shown when picking a sample document for each doctype. */
export const SAMPLE_TITLE = {
	"Programme Application": "full_name",
	Student: "full_name",
	"Student Invoice": "student_name",
	"Student Payment": "payer_name",
	Assignment: "title",
	"Assignment Submission": "student_name",
	Exam: "title",
	Transcript: "student_name",
	Certificate: "student_name",
	"Student Request": "student_name",
	Announcement: "title",
	"Event Registration": "full_name",
	"Contact Enquiry": "full_name",
	"Library Loan": "borrower_name",
	"Giving Record": "giver_name",
	"Semester Registration": "student_name",
	Sponsor: "sponsor_name",
}

/** Variables an event passes to its template on top of doc, settings, college, site_url and recipient. */
export const EVENT_EXTRAS = {
	Announcement: [["announcement", "The announcement (same as doc)"]],
	"Contact Enquiry": [["enquiry", "The enquiry (same as doc)"]],
	"Enquiry Response": [["enquiry", "The enquiry; the reply is enquiry.response"]],
	"Event Registration": [["registration", "The registration (same as doc)"]],
	"Event Waitlist": [["registration", "The registration (same as doc)"]],
	"Event Cancelled": [["event", "The cancelled event, e.g. event.title"]],
	"Invoice Issued": [["balance", "Student balance after this invoice (number)"]],
	"Payment Received": [["balance", "Student balance after the payment (number)"]],
	"Fee Reminder": [["balance", "Outstanding balance, already formatted"]],
	"Giving Receipt": [["giving", "The gift (same as doc)"], ["amount", "Amount, already formatted"]],
	"Library Loan Overdue": [["loan", "The loan (same as doc)"], ["fine", "Fine so far, already formatted"]],
	"Results Published": [["term", "Term label"], ["course_title", "Course title"]],
	"Transcript Ready": [["verification_code", "Code for verifying the transcript"]],
	"Certificate Ready": [["verification_code", "Code for verifying the certificate"]],
	"Sponsor Report": [["students", "Students sponsored now (number)"], ["outstanding", "Their combined fee balance, e.g. KES 12,500.00"]],
	"OTP Code": [["code", "The one-time code"], ["minutes", "Minutes until it expires"], ["purpose", "What the code is for"]],
	"Password Reset Link": [["reset_url", "The reset link"], ["hours", "Hours until it expires"]],
}
