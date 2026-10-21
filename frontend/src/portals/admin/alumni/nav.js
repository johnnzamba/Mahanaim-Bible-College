import { GraduationCap, Users } from "lucide-react"
import { ROLES } from "@/shared/access"

/** Rail section for /admin/alumni (owned by the alumni area). Paths are absolute. */
export default {
	section: "Alumni",
	icon: Users,
	items: [
		{
			to: "/admin/alumni",
			label: "Alumni directory",
			icon: Users,
			keywords: "alumni graduates directory class of ministry former students export",
		},
		{
			to: "/admin/alumni/graduation",
			label: "Graduation",
			icon: GraduationCap,
			// graduation_candidates / graduate_students: Registrar and Academic Dean (admins pass).
			roles: [ROLES.REGISTRAR, ROLES.DEAN],
			keywords: "graduate graduation completed students make alumni ceremony",
		},
	],
}
