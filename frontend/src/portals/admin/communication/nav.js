import { FileText, Inbox, Megaphone } from "lucide-react"
import { ROLES } from "@/shared/access"

/** Rail section for /admin/communication. Paths are absolute. */
export default {
	section: "Communication",
	icon: Megaphone,
	items: [
		{ to: "/admin/communication", label: "Announcements", icon: Megaphone, end: true, keywords: "notice broadcast bulk sms email send message" },
		{ to: "/admin/communication/templates", label: "Templates", icon: FileText, roles: [ROLES.COMMS], keywords: "message template wording notification email sms" },
		{ to: "/admin/communication/messages", label: "Message log", icon: Inbox, roles: [ROLES.COMMS, ROLES.AUDITOR], keywords: "delivery sms email failed retry outbox" },
	],
}
