import { frappe } from "@/shared/api/frappe"
import { useAction } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Card, Empty, PageHeader } from "@/shared/components/ui"
import { useSession } from "@/shared/session"
import { Lock } from "lucide-react"
import { ROLES } from "@/shared/access"
import { SubTabs } from "./kit"

export const API = "mahanaim.api.church."
export const INVALIDATE = [API]

export const CHURCH_TYPES = ["Headquarters", "Region", "Parish", "Local Church", "Ministry", "Organisation"]
export const PARTNERSHIP_STATUSES = ["Prospect", "Active", "Inactive"]
export const SPONSOR_TYPES = ["Individual", "Church", "Organisation", "Foundation", "Alumni"]
export const SPONSOR_STATUSES = ["Active", "Inactive"]
export const PREFERRED_COMMS = ["Email", "SMS", "WhatsApp", "Phone"]
export const SPONSORSHIP_STATUSES = ["Proposed", "Active", "Suspended", "Completed", "Cancelled"]
export const COVERAGES = ["Full Fees", "Tuition Only", "Fixed Amount", "Percentage", "Upkeep"]
export const REPORTING = ["Termly", "Annually", "None"]
export const GIVER_TYPES = ["Sponsor", "Partner Church", "Student", "Staff", "Anonymous", "Other"]
export const PAYMENT_MODES = ["M-Pesa", "Bank", "Cash", "Cheque", "Card"]
export const SERVICE_TYPES = ["Chapel", "Morning Devotion", "Evening Prayer", "Communion", "Fellowship", "Special Service", "Revival"]
export const CHAPEL_STATUSES = ["Scheduled", "Held", "Cancelled"]
export const GROUP_TYPES = ["Fellowship", "Choir", "Worship Team", "Prayer Group", "Missions Team", "Evangelism", "Ushering", "Media", "Intercessory", "Class Group"]
export const MEMBER_ROLES = ["Member", "Leader", "Assistant Leader", "Secretary", "Treasurer"]
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** Statuses the generic Badge palette would leave grey. */
const TONES = { Prospect: "blue", Proposed: "blue", Held: "green", Suspended: "orange" }
export const toneOf = (status) => TONES[status]

/** send_sponsor_reports: one sponsor now (sponsor=…) or every active sponsor as a background job. */
export function useSendSponsorReports(onDone) {
	return useAction(`${API}send_sponsor_reports`, {
		onSuccess: (r) => {
			if (r?.queued || r?.sent) toast.success(r.message)
			else toast.warning(r?.message || "No report was sent")
			onDone?.(r)
		},
	})
}

/** Role checks mirroring the require_roles lists in mahanaim/api/church.py. */
export function useChurchRoles() {
	const { hasRole } = useSession()
	return {
		canRead: hasRole(ROLES.CHAPLAIN, ROLES.FINANCE, ROLES.AUDITOR, ROLES.REGISTRAR),
		canManage: hasRole(ROLES.CHAPLAIN, ROLES.FINANCE),
		canEditChurch: hasRole(ROLES.CHAPLAIN, ROLES.FINANCE, ROLES.ADMISSIONS, ROLES.COMMS),
		isChaplain: hasRole(ROLES.CHAPLAIN),
		// Finance passes require_roles on chapel endpoints but has no doctype read on Chapel Service / Ministry Group.
		canChapel: hasRole(ROLES.CHAPLAIN, ROLES.AUDITOR, ROLES.REGISTRAR),
	}
}

const LINKS = [
	{ to: "/admin/church", label: "Overview", end: true, read: true },
	{ to: "/admin/church/sponsors", label: "Sponsors", read: true },
	{ to: "/admin/church/sponsorships", label: "Sponsorships", read: true },
	{ to: "/admin/church/giving", label: "Giving", read: true },
	{ to: "/admin/church/chapel", label: "Chapel", read: true, chapel: true },
	{ to: "/admin/church/ministry-groups", label: "Ministry groups", read: true, chapel: true },
	{ to: "/admin/church/churches", label: "Partner churches" },
]

export function ChurchTabs() {
	const { canRead, canChapel } = useChurchRoles()
	return <SubTabs label="Church sections" links={LINKS.filter((l) => (canRead || !l.read) && (canChapel || !l.chapel))} />
}

const GATE_NOTE = {
	church: "Partner churches are kept by the Chaplain's office, Finance, Admissions and Communications. Ask them or a college administrator for these records.",
	read: "Sponsors, sponsorships and giving are handled by the Chaplain's office and Finance. Ask them or a college administrator for these records.",
	chapel: "Chapel services and ministry groups are kept by the Chaplain's office. Ask them or a college administrator for these records.",
}

/** Renders a church screen only for roles whose records it reads (`need`: "read", "chapel" or "church"). */
export function RoleGate({ need = "read", title, children }) {
	const { canRead, canChapel, canEditChurch } = useChurchRoles()
	const allowed = { read: canRead, chapel: canChapel, church: canRead || canEditChurch }[need]
	if (allowed) return children
	return (
		<>
			<ChurchTabs />
			<PageHeader title={title} />
			<Card>
				<Empty icon={Lock} title="Not available for your role" subtitle={GATE_NOTE[need]} />
			</Card>
		</>
	)
}

const like = (q) => `%${q.trim()}%`

export const searchStudents = (q) =>
	frappe
		.call("frappe.client.get_list", {
			doctype: "Student",
			fields: ["name", "full_name", "student_number", "programme", "status"],
			or_filters: [["full_name", "like", like(q)], ["student_number", "like", like(q)], ["name", "like", like(q)]],
			order_by: "full_name asc",
			limit_page_length: 10,
		})
		.then((rows) =>
			(rows || []).map((s) => ({ value: s.name, label: s.full_name, description: [s.student_number, s.programme, s.status].filter(Boolean).join(" · ") }))
		)

export const searchStaff = (q) =>
	frappe
		.call("frappe.client.get_list", {
			doctype: "Staff Member",
			fields: ["name", "full_name", "designation"],
			or_filters: [["full_name", "like", like(q)], ["name", "like", like(q)], ["email", "like", like(q)]],
			order_by: "full_name asc",
			limit_page_length: 10,
		})
		.then((rows) => (rows || []).map((s) => ({ value: s.name, label: s.full_name, description: s.designation || s.name })))

export const searchSponsors = (q) =>
	frappe
		.call(`${API}list_sponsors`, { search: q, page_length: 10 })
		.then((r) => (r?.data || []).map((s) => ({ value: s.name, label: s.sponsor_name, description: [s.sponsor_type, s.email].filter(Boolean).join(" · ") })))

export const searchChurches = (q) =>
	frappe
		.call(`${API}list_churches`, { tree: 0, search: q, page_length: 10 })
		.then((r) => (r?.data || []).map((c) => ({ value: c.name, label: c.church_name, description: [c.church_type, c.town].filter(Boolean).join(" · ") })))

/** Students on a campus, for loading a chapel roll in one go. */
export const studentsOnCampus = (campus) =>
	frappe.call("frappe.client.get_list", {
		doctype: "Student",
		fields: ["name", "full_name", "student_number", "programme"],
		filters: { status: ["in", ["Registered", "Active"]], ...(campus ? { campus } : {}) },
		order_by: "full_name asc",
		limit_page_length: 500,
	})
