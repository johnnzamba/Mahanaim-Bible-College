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
	["/students", [R.REGISTRAR, R.ADMISSIONS, R.DEAN, R.FINANCE, R.CHAPLAIN, R.AUDITOR]],
	["/academics", [R.REGISTRAR, R.DEAN]],
	["/exams", [R.REGISTRAR, R.DEAN]],
	["/results", [R.REGISTRAR, R.DEAN, R.AUDITOR]],
	["/credentials", [R.REGISTRAR, R.DEAN]],
	["/finance", [R.FINANCE, R.AUDITOR]],
	["/church", [R.FINANCE, R.CHAPLAIN, R.COMMS]],
	["/communication", [R.COMMS, R.REGISTRAR, R.ADMISSIONS, R.DEAN]],
	["/website", [R.COMMS]],
	["/library", [R.LIBRARY, R.DEAN]],
	["/staff", [R.REGISTRAR, R.DEAN]],
	["/alumni", [R.REGISTRAR, R.COMMS, R.CHAPLAIN]],
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
