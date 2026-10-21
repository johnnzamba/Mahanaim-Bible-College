/** Field metadata for the application wizard (mirrors Programme Application). */

export const FIELDS = [
	"first_name", "middle_name", "last_name", "email", "phone", "gender", "date_of_birth", "marital_status", "national_id",
	"nationality", "county", "postal_address", "disability", "nok_name", "nok_relationship", "nok_phone", "programme",
	"campus", "study_mode", "intake", "sponsorship_type", "home_church", "denomination", "year_born_again", "pastor_name",
	"pastor_phone", "ministry_role", "testimony", "ministry_experience", "kcse_mean_grade", "kcse_year", "highest_qualification",
]
const INT_FIELDS = ["year_born_again", "kcse_year"]
const NULLABLE = ["date_of_birth", "intake", ...INT_FIELDS]

export const GENDERS = ["Male", "Female"]
export const MARITAL = ["Single", "Married", "Widowed", "Divorced", "Separated"]
export const SPONSORSHIP = [
	{ value: "Self", label: "Self-sponsored" },
	{ value: "Church", label: "My church" },
	{ value: "Sponsor", label: "A sponsor / partner" },
	{ value: "Scholarship", label: "Scholarship" },
	{ value: "Employer", label: "Employer" },
]
export const KCSE_GRADES = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "E", "Not Applicable"]
export const QUALIFICATIONS = ["KCSE", "KCE / KACE", "Certificate", "Diploma", "Bachelor's degree", "Master's degree", "Other"]
export const RELATIONSHIPS = ["Parent", "Mother", "Father", "Spouse", "Sibling", "Guardian", "Relative", "Friend", "Pastor"]
export const COUNTIES = [
	"Baringo", "Bomet", "Bungoma", "Busia", "Elgeyo-Marakwet", "Embu", "Garissa", "Homa Bay", "Isiolo", "Kajiado", "Kakamega",
	"Kericho", "Kiambu", "Kilifi", "Kirinyaga", "Kisii", "Kisumu", "Kitui", "Kwale", "Laikipia", "Lamu", "Machakos", "Makueni",
	"Mandera", "Marsabit", "Meru", "Migori", "Mombasa", "Murang'a", "Nairobi", "Nakuru", "Nandi", "Narok", "Nyamira", "Nyandarua",
	"Nyeri", "Samburu", "Siaya", "Taita-Taveta", "Tana River", "Tharaka-Nithi", "Trans Nzoia", "Turkana", "Uasin Gishu", "Vihiga",
	"Wajir", "West Pokot",
]

export const EMPTY_RECORD = { institution: "", qualification: "", year_completed: "", grade: "" }

/** Server doc → wizard form (strings for inputs). */
export function toForm(doc = {}) {
	const out = {}
	// Frappe returns unset Int fields as 0; show them as blank.
	for (const f of FIELDS) out[f] = doc[f] == null || (INT_FIELDS.includes(f) && !Number(doc[f])) ? "" : String(doc[f])
	if (!out.sponsorship_type) out.sponsorship_type = "Self"
	if (!out.nationality) out.nationality = "Kenyan"
	return out
}

export const toRecords = (rows = []) =>
	rows.map((r) => ({ institution: r.institution || "", qualification: r.qualification || "", year_completed: r.year_completed ? String(r.year_completed) : "", grade: r.grade || "" }))

const blankRecord = (r) => !String(r.institution || "").trim() && !String(r.qualification || "").trim() && !String(r.grade || "").trim() && !r.year_completed

/** Wizard form → save_application payload. */
export function toPayload(form, records) {
	const data = {}
	for (const f of FIELDS) {
		if (f === "email") continue
		let v = typeof form[f] === "string" ? form[f].trim() : form[f]
		if (INT_FIELDS.includes(f)) v = v === "" || v == null ? null : Number(v)
		else if (NULLABLE.includes(f) && !v) v = null
		data[f] = v
	}
	data.academic_records = records
		.filter((r) => !blankRecord(r))
		.map((r) => ({ institution: r.institution.trim(), qualification: r.qualification.trim(), year_completed: r.year_completed ? Number(r.year_completed) : null, grade: r.grade.trim() }))
	return data
}

const PHONE_RE = /^\+?[0-9][0-9\s-]{8,14}$/
const thisYear = new Date().getFullYear()

/** Per-step inline validation. Returns { field: message }. */
export function validateStep(step, form, records, options) {
	const e = {}
	const need = (f, msg = "This field is required") => {
		if (!String(form[f] ?? "").trim()) e[f] = msg
	}
	const phone = (f) => {
		if (form[f] && !PHONE_RE.test(String(form[f]).trim())) e[f] = "Enter a valid phone number, e.g. 0712 345 678"
	}
	if (step === 0) {
		need("programme", "Choose a programme")
		need("campus", "Choose a campus")
		need("study_mode", "Choose a study mode")
		if (options?.intakes?.length) need("intake", "Choose an intake")
	}
	if (step === 1) {
		;["first_name", "last_name", "phone", "gender", "date_of_birth", "national_id", "county", "nok_name", "nok_phone"].forEach((f) => need(f))
		phone("phone")
		phone("nok_phone")
		if (form.date_of_birth) {
			const dob = new Date(form.date_of_birth)
			const age = (Date.now() - dob.getTime()) / (365.25 * 86400000)
			if (Number.isNaN(age) || age < 15) e.date_of_birth = "Check your date of birth — applicants must be at least 15"
			else if (age > 100) e.date_of_birth = "Check your date of birth"
		}
	}
	if (step === 2) {
		need("home_church", "Tell us your home church")
		need("pastor_name", "Your pastor's name is required")
		need("pastor_phone", "Your pastor's phone is required")
		phone("pastor_phone")
		if (form.year_born_again && (Number(form.year_born_again) < 1920 || Number(form.year_born_again) > thisYear)) e.year_born_again = "Enter a valid year"
	}
	if (step === 3) {
		need("highest_qualification", "Tell us your highest qualification")
		if (form.kcse_year && (Number(form.kcse_year) < 1960 || Number(form.kcse_year) > thisYear)) e.kcse_year = "Enter a valid year"
		records.forEach((r, i) => {
			if (blankRecord(r)) return
			if (!String(r.institution).trim()) e[`records.${i}.institution`] = "Institution is required"
			if (!String(r.qualification).trim()) e[`records.${i}.qualification`] = "Qualification is required"
			if (r.year_completed && (Number(r.year_completed) < 1950 || Number(r.year_completed) > thisYear + 1)) e[`records.${i}.year_completed`] = "Enter a valid year"
		})
	}
	return e
}
