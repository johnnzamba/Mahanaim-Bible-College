import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"
import { daysUntil } from "@/shared/utils/format"
import { SubTabs } from "./kit"

export const API = "mahanaim.api.library."
export const INVALIDATE = [API]

export const ITEM_TYPES = ["Book", "E-Book", "Journal", "Thesis", "Audio", "Video", "Commentary", "Reference", "Periodical"]
export const SUBJECTS = ["Biblical Studies", "Theology", "Church History", "Pastoral Ministry", "Missions", "Christian Education", "Biblical Languages", "Leadership", "Counselling", "General"]
export const ACCESS_LEVELS = [
	{ value: "Public", label: "Public", description: "Anyone, including website visitors" },
	{ value: "Students", label: "Students", description: "Signed-in students and staff" },
	{ value: "Staff", label: "Staff", description: "Staff only" },
]
export const LOAN_STATUSES = ["Requested", "Issued", "Overdue", "Returned", "Lost", "Cancelled"]
export const DIGITAL_TYPES = new Set(["E-Book", "Audio", "Video"])

const TONES = {
	Requested: "orange",
	Issued: "blue",
	Overdue: "red",
	Returned: "green",
	Lost: "red",
	Cancelled: "gray",
	Public: "green",
	Students: "blue",
	Staff: "purple",
}
export const toneOf = (s) => TONES[s]

/** Mirrors READ_ROLES / LIBRARY_ROLES in mahanaim/api/library.py. */
export function useLibRoles() {
	const { hasRole } = useSession()
	return {
		canRead: hasRole(ROLES.LIBRARY, ROLES.REGISTRAR, ROLES.AUDITOR, ROLES.FINANCE),
		canManage: hasRole(ROLES.LIBRARY),
	}
}

export function LibTabs() {
	return (
		<SubTabs
			label="Library sections"
			links={[
				{ to: "/admin/library", label: "Overview", end: true },
				{ to: "/admin/library/catalogue", label: "Catalogue" },
				{ to: "/admin/library/loans", label: "Loans" },
			]}
		/>
	)
}

/** "Due in 3 days" / "4 days overdue" for an open loan. */
export function dueText(loan) {
	if (!loan?.due_date || !["Issued", "Overdue"].includes(loan.status)) return ""
	const d = daysUntil(loan.due_date)
	if (d == null) return ""
	if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`
	if (d === 0) return "Due today"
	return `Due in ${d} day${d === 1 ? "" : "s"}`
}

/** "today" / "yesterday" / "5 days ago" for a date (no time part). */
export function sinceText(d) {
	const n = daysUntil(d)
	if (n == null) return ""
	if (n >= 0) return "today"
	if (n === -1) return "yesterday"
	return `${-n} days ago`
}

export const isOpen = (loan) => ["Issued", "Overdue"].includes(loan?.status)

export function NoAccess({ title = "Library" }) {
	return (
		<div className="card p-8 text-center">
			<h1 className="font-serif text-xl text-ink">{title}</h1>
			<p className="mt-2 text-sm text-ink-soft">The library is run by the Library Officer. Registrar, Finance and Audit can view it.</p>
		</div>
	)
}
