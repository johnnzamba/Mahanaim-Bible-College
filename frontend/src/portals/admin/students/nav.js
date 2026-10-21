import { CalendarCheck, GraduationCap, ScrollText } from "lucide-react"
import { ROLES } from "@/shared/access"

/** STAFF_READ in mahanaim/api/students.py; other roles with /students access get a 403 from every endpoint. */
const READ = [ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE]

/** Rail section for /admin/students (owned by the students area). Paths are absolute. */
export default {
	section: "Students",
	icon: GraduationCap,
	items: [
		{
			to: "/admin/students",
			label: "Students",
			icon: GraduationCap,
			roles: READ,
			keywords: "student directory 360 profile learners enrolled admitted active deferred withdrawn new student",
		},
		{
			to: "/admin/students/registrations",
			label: "Registrations",
			icon: CalendarCheck,
			roles: READ,
			keywords: "semester registration course registration approve approval queue units term",
		},
		{
			to: "/admin/students/requests",
			label: "Requests",
			icon: ScrollText,
			roles: READ,
			keywords: "student requests deferment withdrawal resumption transfer course drop clearance transcript request",
		},
	],
}
