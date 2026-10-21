import { CalendarDays, Globe, Inbox, LayoutGrid, Newspaper, PanelsTopLeft } from "lucide-react"
import { ROLES } from "@/shared/access"

/** Rail section for /admin/website. Paths are absolute. */
export default {
	section: "Website",
	icon: Globe,
	items: [
		{ to: "/admin/website", label: "Overview", icon: LayoutGrid, end: true, roles: [ROLES.COMMS, ROLES.CHAPLAIN, ROLES.ADMISSIONS], keywords: "cms public site dashboard" },
		{ to: "/admin/website/news", label: "News", icon: Newspaper, roles: [ROLES.COMMS], keywords: "articles blog posts publish" },
		{ to: "/admin/website/events", label: "Events", icon: CalendarDays, roles: [ROLES.COMMS, ROLES.CHAPLAIN], keywords: "conference registration check-in rsvp" },
		{ to: "/admin/website/enquiries", label: "Enquiries", icon: Inbox, roles: [ROLES.COMMS, ROLES.ADMISSIONS], keywords: "contact form messages inbox questions" },
		{ to: "/admin/website/content", label: "Content", icon: PanelsTopLeft, roles: [ROLES.COMMS, ROLES.ADMISSIONS], keywords: "faq testimonials home page hero contacts social settings" },
	],
}
