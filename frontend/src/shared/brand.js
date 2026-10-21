/** Institution identity. Runtime values (name, logo, motto) come from Mahanaim Settings via boot. */
const boot = () => (typeof window !== "undefined" ? window.mahanaim_boot || {} : {})

export const BRAND = {
	get full() {
		return boot().settings?.institution_name || "Mahanaim Bible College"
	},
	get short() {
		return boot().settings?.short_name || "MBC"
	},
	get motto() {
		return boot().settings?.motto || "Equipping servants for the harvest"
	},
	get logo() {
		return boot().settings?.logo || "/assets/mahanaim/images/logo.svg"
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
