/**
 * Role → screen access for the admin portal. Mirrors mahanaim/utils/__init__.py role names.
 * The server is the real gate (every endpoint calls require_roles); this only hides navigation
 * a user could not use anyway.
 */
export const ROLES = {
	SYS: "System Manager",
	ADMIN: "College Administrator",
	REGISTRAR: "Registrar",
	ADMISSIONS: "Admissions Officer",
	FINANCE: "Finance Officer",
	DEAN: "Academic Dean",
	LECTURER: "Lecturer",
	STUDENT: "Student",
	APPLICANT: "Applicant",
	LIBRARY: "Library Officer",
	SPONSOR: "Sponsor",
	ALUMNI: "Alumni",
	AUDITOR: "Auditor",
	COMMS: "Communications Officer",
	CHAPLAIN: "Chaplain",
}

const R = ROLES
const ALL_STAFF = [R.ADMIN, R.REGISTRAR, R.ADMISSIONS, R.FINANCE, R.DEAN, R.LIBRARY, R.AUDITOR, R.COMMS, R.CHAPLAIN]

/** Longest matching prefix wins. Paths are relative to /admin. */
export const ADMIN_ACCESS = [
	["/", ALL_STAFF],
	["/admissions", [R.ADMISSIONS, R.REGISTRAR, R.DEAN]],
	// Students, credentials and alumni mirror STAFF_READ / REQUEST_STAFF in api/students.py, READ_ROLES in
	// api/credentials.py and STAFF_ROLES in api/alumni.py.
	["/students", [R.REGISTRAR, R.DEAN, R.FINANCE]],
	["/students/requests", [R.REGISTRAR, R.DEAN, R.FINANCE, R.LIBRARY]],
	// Offerings, timetable, exams, mark sheets and results all live under /academics.
	["/academics", [R.REGISTRAR, R.DEAN]],
	["/academics/results", [R.REGISTRAR, R.DEAN, R.AUDITOR]],
	["/credentials", [R.REGISTRAR, R.DEAN, R.AUDITOR]],
	["/credentials/issue", [R.REGISTRAR]],
	["/finance", [R.FINANCE, R.AUDITOR]],
	// Church, communication, website and library mirror the require_roles() gates in api/church.py,
	// api/communication.py (messaging.ANNOUNCER_ROLES), api/website.py and api/library.py.
	["/church", [R.FINANCE, R.CHAPLAIN, R.AUDITOR, R.REGISTRAR]],
	["/church/churches", [R.FINANCE, R.CHAPLAIN, R.AUDITOR, R.REGISTRAR, R.ADMISSIONS, R.COMMS]],
	["/church/sponsors", [R.FINANCE, R.CHAPLAIN, R.AUDITOR, R.REGISTRAR, R.ADMISSIONS]],
	["/church/chapel", [R.CHAPLAIN, R.AUDITOR, R.REGISTRAR, R.DEAN]],
	["/church/ministry-groups", [R.CHAPLAIN, R.AUDITOR, R.REGISTRAR, R.DEAN]],
	["/communication", [R.COMMS, R.REGISTRAR, R.DEAN, R.FINANCE, R.CHAPLAIN]],
	["/communication/templates", [R.COMMS]],
	["/communication/messages", [R.COMMS, R.AUDITOR]],
	["/website", [R.COMMS, R.CHAPLAIN, R.ADMISSIONS]],
	["/website/news", [R.COMMS]],
	["/website/events", [R.COMMS, R.CHAPLAIN]],
	["/website/enquiries", [R.COMMS, R.ADMISSIONS]],
	["/website/content", [R.COMMS, R.ADMISSIONS]],
	["/library", [R.LIBRARY, R.REGISTRAR, R.AUDITOR, R.FINANCE]],
	["/staff", [R.REGISTRAR, R.DEAN]],
	["/alumni", [R.REGISTRAR, R.DEAN]],
	["/reports", [R.REGISTRAR, R.DEAN, R.FINANCE, R.AUDITOR]],
	["/settings", []],
	["/audit", [R.AUDITOR]],
]

export function isSuper(roles = []) {
	return roles.includes(R.SYS) || roles.includes(R.ADMIN)
}

export function canAccess(roles = [], path = "/") {
	if (isSuper(roles)) return true
	let best = null
	for (const [prefix, allowed] of ADMIN_ACCESS) {
		const hit = prefix === "/" ? true : path === prefix || path.startsWith(`${prefix}/`)
		if (hit && (!best || prefix.length > best[0].length)) best = [prefix, allowed]
	}
	if (!best) return false
	return best[1].some((r) => roles.includes(r))
}

export function hasRole(roles = [], ...want) {
	return isSuper(roles) || want.some((r) => roles.includes(r))
}
