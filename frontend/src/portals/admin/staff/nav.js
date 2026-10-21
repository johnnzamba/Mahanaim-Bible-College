import { UserCog } from "lucide-react"

/** Rail section for /admin/staff (owned by the staff area). Paths are absolute. */
export default {
	section: "People",
	icon: UserCog,
	items: [
		{
			to: "/admin/staff",
			label: "Staff",
			icon: UserCog,
			keywords: "staff directory lecturers faculty employees people team new staff member deactivate on leave",
		},
	],
}
