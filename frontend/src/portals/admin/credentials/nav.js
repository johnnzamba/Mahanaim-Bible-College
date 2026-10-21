import { Award, ScrollText } from "lucide-react"
import { ROLES } from "@/shared/access"

/** Rail section for /admin/credentials (owned by the credentials area). Paths are absolute. */
export default {
	section: "Credentials",
	icon: Award,
	items: [
		{
			to: "/admin/credentials",
			label: "Transcripts & certificates",
			icon: ScrollText,
			keywords: "transcript certificate credentials issue revoke verification log print pdf requests",
		},
		{
			to: "/admin/credentials/issue",
			label: "Issue certificates",
			icon: Award,
			// issue_certificates: Registrar only (admins pass).
			roles: [ROLES.REGISTRAR],
			keywords: "issue certificates graduates eligible award serial",
		},
	],
}
