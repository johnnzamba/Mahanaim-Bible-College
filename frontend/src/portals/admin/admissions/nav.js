import { ClipboardList } from "lucide-react"

/** Rail section for /admin/admissions (owned by the admissions area). Paths are absolute. */
export default {
	section: "Admissions",
	icon: ClipboardList,
	items: [
		{
			to: "/admin/admissions",
			label: "Applications",
			icon: ClipboardList,
			keywords: "admissions applicants pipeline review interview admit waitlist reject offer letter application fee intake",
		},
	],
}
