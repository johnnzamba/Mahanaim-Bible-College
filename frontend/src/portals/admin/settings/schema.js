import { BookOpenCheck, Building2, Calculator, FileSignature, Hash, KeyRound, Landmark, MessageSquareText, Phone, ReceiptText, ShieldCheck, UserPlus } from "lucide-react"

const NUMBER_TOKENS = ["programme_code", "campus_code", "year", "yy", "short_name"]

function numberFormatError(v) {
	const fmt = String(v || "").trim()
	if (!fmt) return null
	if (!/\{#+\}/.test(fmt)) return "Include a sequence token such as {####}."
	const bad = [...fmt.matchAll(/\{([^}#]+)\}/g)].map((m) => m[1]).filter((t) => !NUMBER_TOKENS.includes(t))
	return bad.length ? `Unknown token ${bad.map((t) => `{${t}}`).join(", ")}.` : null
}

const emailError = (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? "Enter a valid email address." : null)
const urlError = (v) => (v && !/^https?:\/\/\S+$/i.test(String(v).trim()) ? "Start the address with https://" : null)

/** Sample student number for the live preview next to the numbering rule. */
export function previewNumber(fmt, shortName) {
	const now = new Date()
	const sample = { programme_code: "DTH", campus_code: "NRB", year: String(now.getFullYear()), yy: String(now.getFullYear()).slice(2), short_name: shortName || "MBC" }
	return String(fmt || "")
		.replace(/\{(#+)\}/g, (_, h) => "7".padStart(h.length, "0"))
		.replace(/\{([^}#]+)\}/g, (m, t) => sample[t] ?? m)
}

export const NUMBER_TOKEN_HELP = [
	["{programme_code}", "Programme code, e.g. DTH"],
	["{campus_code}", "Campus code, e.g. NRB"],
	["{year}", "Intake year, e.g. 2026"],
	["{yy}", "Two-digit year, e.g. 26"],
	["{short_name}", "College short name"],
	["{####}", "Running number, zero-padded"],
]

/**
 * Mahanaim Settings, regrouped from the doctype's tab/section breaks into the admin tabs.
 * `when` mirrors the doctype's depends_on.
 */
export const FORM_TABS = {
	general: {
		sections: [
			{
				title: "Institution",
				icon: Building2,
				subtitle: "Shown in the portal header, on letters, receipts and the public website.",
				fields: [
					{ key: "institution_name", label: "Institution name", required: true },
					{ key: "short_name", label: "Short name", required: true, hint: "Used in SMS, receipts and the {short_name} numbering token." },
					{ key: "motto", label: "Motto", wide: true },
					{ key: "country", label: "Country" },
					{ key: "currency", label: "Currency", type: "link", source: "currencies", placeholder: undefined },
					{ key: "logo", label: "Logo", type: "image", wide: true, hint: "PNG or SVG on a transparent background works best." },
				],
			},
			{
				title: "Contact",
				icon: Phone,
				subtitle: "Printed on documents and shown to applicants.",
				fields: [
					{ key: "email", label: "Email", inputType: "email", validate: emailError },
					{ key: "phone", label: "Phone", inputType: "tel" },
					{ key: "website", label: "Website", inputType: "url", placeholder: "https://", validate: urlError },
					{ key: "address", label: "Postal address", type: "text", rows: 2 },
				],
			},
			{
				title: "Documents & signatures",
				icon: FileSignature,
				subtitle: "Used on admission letters, transcripts and certificates. Signatures and the seal are stored privately.",
				fields: [
					{ key: "verification_base_url", label: "Verification base URL", wide: true, placeholder: "https://mahanaim.ac.ke/verify", hint: "Public URL encoded in document QR codes.", validate: urlError },
					{ key: "registrar_name", label: "Registrar name" },
					{ key: "principal_name", label: "Principal name" },
					{ key: "registrar_signature", label: "Registrar signature", type: "image", private: true },
					{ key: "principal_signature", label: "Principal signature", type: "image", private: true },
					{ key: "college_seal", label: "College seal", type: "image", private: true },
				],
			},
		],
	},
	academic: {
		sections: [
			{
				title: "Academic year",
				icon: BookOpenCheck,
				subtitle: "The current term drives registration windows, timetables, invoices and dashboards.",
				fields: [
					{ key: "current_academic_term", label: "Current academic term", type: "link", source: "terms", hint: "Saving a new term makes it current everywhere." },
					{ key: "current_academic_year", label: "Current academic year", type: "link", source: "years", disabled: true, hint: "Follows the current term automatically." },
					{ key: "default_grading_scale", label: "Default grading scale", type: "link", source: "scales" },
					{ key: "max_credits_per_term", label: "Maximum credits per term", type: "float", min: 0.5, hint: "Upper limit when students register for courses." },
				],
			},
		],
	},
	admissions: {
		sections: [
			{
				title: "Student numbering",
				icon: Hash,
				subtitle: "Applied when an accepted applicant becomes a student.",
				fields: [{ key: "student_number_format", label: "Student number format", required: true, wide: true, validate: numberFormatError }],
				preview: true,
			},
			{
				title: "Applications & offers",
				icon: UserPlus,
				fields: [
					{ key: "application_fee_required", label: "Charge an application fee", type: "check", hint: "Applicants pay before their application is reviewed." },
					{ key: "application_fee", label: "Application fee", type: "currency", min: 0, when: (v) => Number(v.application_fee_required) },
					{ key: "offer_expiry_days", label: "Offer expiry (days)", type: "int", min: 0, hint: "How long an admission offer stays open." },
					{ key: "auto_create_student_on_acceptance", label: "Create the student record on acceptance", type: "check", hint: "Otherwise the registrar enrols accepted applicants manually." },
				],
			},
		],
	},
	finance: {
		sections: [
			{
				title: "Billing",
				icon: ReceiptText,
				fields: [
					{ key: "auto_invoice_on_registration", label: "Invoice on registration", type: "check", hint: "Raise the term invoice when a semester registration is approved." },
					{ key: "payment_terms_days", label: "Payment terms (days)", type: "int", min: 0, hint: "Days until an invoice falls due." },
					{ key: "overdue_reminder_days", label: "Overdue reminder interval (days)", type: "int", min: 0 },
				],
			},
			{
				title: "Fee clearance",
				icon: Calculator,
				subtitle: "Minimum share of the term invoice that must be paid before access is granted.",
				fields: [
					{ key: "exam_fee_clearance_percent", label: "Online exams (% paid)", type: "percent", min: 0, max: 100 },
					{ key: "lms_fee_clearance_percent", label: "LMS course access (% paid)", type: "percent", min: 0, max: 100, hint: "0 means no restriction." },
					{ key: "transcript_requires_fee_clearance", label: "Transcripts require fee clearance", type: "check" },
				],
			},
			{
				title: "ERPNext accounting (optional)",
				icon: Landmark,
				subtitle: "Post invoices and payments to ERPNext as journal entries. Requires ERPNext on this site.",
				collapsible: true,
				fields: [
					{ key: "post_to_erpnext", label: "Post to ERPNext", type: "check" },
					{ key: "company", label: "Company", when: (v) => Number(v.post_to_erpnext) },
					{ key: "receivable_account", label: "Receivable account", when: (v) => Number(v.post_to_erpnext) },
					{ key: "income_account", label: "Income account", when: (v) => Number(v.post_to_erpnext) },
					{ key: "cash_account", label: "Cash account", when: (v) => Number(v.post_to_erpnext) },
					{ key: "cost_center", label: "Cost centre", when: (v) => Number(v.post_to_erpnext) },
				],
			},
		],
	},
	communication: {
		sections: [
			{
				title: "SMS gateway",
				icon: MessageSquareText,
				subtitle: "OTP codes, receipts, reminders and announcements go out through this gateway.",
				fields: [
					{ key: "sms_enabled", label: "Send SMS", type: "check", hint: "When off, messages are logged but not sent." },
					{ key: "sms_provider", label: "Provider", type: "select", options: ["None", "Africa's Talking", "Generic HTTP"], validate: (v, all) => (Number(all.sms_enabled) && (!v || v === "None") ? "Choose a provider or turn SMS off." : null) },
					{ key: "sms_sender_id", label: "Sender ID", hint: "Alphanumeric sender name approved by your provider." },
					{ key: "sms_username", label: "Username", when: (v) => v.sms_provider === "Africa's Talking", validate: (x, all) => (Number(all.sms_enabled) && !x ? "Africa's Talking needs a username." : null) },
					{ key: "sms_api_key", label: "API key", type: "password" },
					{ key: "sms_generic_url", label: "Gateway URL", inputType: "url", wide: true, when: (v) => v.sms_provider === "Generic HTTP", validate: (x, all) => (Number(all.sms_enabled) && !x ? "Generic HTTP SMS needs a gateway URL." : urlError(x)) },
					{
						key: "sms_generic_payload",
						label: "Request body template",
						type: "text",
						mono: true,
						rows: 4,
						wide: true,
						when: (v) => v.sms_provider === "Generic HTTP",
						placeholder: '{"to": "{to}", "message": "{message}", "from": "{sender}"}',
						hint: "JSON body. {to}, {message} and {sender} are replaced when sending.",
					},
				],
			},
		],
	},
	security: {
		sections: [
			{
				title: "Staff sign-in",
				icon: ShieldCheck,
				fields: [{ key: "admin_mfa_required", label: "Require a one-time code for staff sign-in", type: "check", hint: "Staff receive an emailed code after their password on the admin portal." }],
			},
			{
				title: "One-time passwords",
				icon: KeyRound,
				subtitle: "Applies to applicant, student and staff verification codes.",
				cols: 2,
				fields: [
					{ key: "otp_length", label: "Code length (digits)", type: "int", min: 4, max: 8 },
					{ key: "otp_expiry_minutes", label: "Code expiry (minutes)", type: "int", min: 1, max: 60 },
					{ key: "otp_max_attempts", label: "Attempts before lock-out", type: "int", min: 1, max: 10, hint: "Wrong codes allowed before a new code is needed." },
					{ key: "otp_resend_cooldown_seconds", label: "Resend cooldown (seconds)", type: "int", min: 0, max: 3600 },
				],
			},
		],
	},
}

export const ALL_FIELDS = Object.values(FORM_TABS).flatMap((t) => t.sections.flatMap((s) => s.fields))

/** Which tab owns a field, so a save error can point at it. */
export const TAB_OF = Object.fromEntries(Object.entries(FORM_TABS).flatMap(([tab, t]) => t.sections.flatMap((s) => s.fields.map((f) => [f.key, tab]))))
