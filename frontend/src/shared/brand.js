/** Institution identity. Runtime values (name, logo, motto) come from Mahanaim Settings via boot. */
const boot = () => (typeof window !== "undefined" ? window.mahanaim_boot || {} : {})
// session_info() carries the settings brief (api/session.py _settings_brief); the public site payload is a fallback.
const settings = () => boot().session?.settings || boot().site?.settings || {}

export const BRAND = {
	get full() {
		return settings().institution_name || "Mahanaim Bible College"
	},
	get short() {
		return settings().short_name || "MBC"
	},
	get motto() {
		return settings().motto || "Equipping servants for the harvest"
	},
	get logo() {
		return settings().logo || "/assets/mahanaim/images/logo.svg"
	},
	product: "Digital Campus",
	colors: { forest: "#14372a", forestSoft: "#1d4d3a", gold: "#c99a43", cream: "#f7f3ea" },
}

export const PORTALS = {
	admin: { label: "Administration", path: "/admin", tag: "Staff workspace" },
	lecturer: { label: "Lecturer", path: "/lecturer", tag: "Teaching workspace" },
	student: { label: "Student", path: "/student", tag: "Student portal" },
	applicant: { label: "Applicant", path: "/applicant", tag: "Admissions portal" },
	sponsor: { label: "Sponsor", path: "/sponsor", tag: "Sponsor & church partner portal" },
}
