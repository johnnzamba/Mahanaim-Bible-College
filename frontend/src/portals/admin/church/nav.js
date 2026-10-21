import { Building2, Church, HandCoins, HandHeart, LayoutGrid, Music } from "lucide-react"
import { ROLES } from "@/shared/access"

const READ = [ROLES.CHAPLAIN, ROLES.FINANCE, ROLES.AUDITOR, ROLES.REGISTRAR]
const CHAPEL = [ROLES.CHAPLAIN, ROLES.AUDITOR, ROLES.REGISTRAR, ROLES.DEAN]

/** Rail section for /admin/church. Sponsorships and ministry groups open from the area's sub-tabs. */
export default {
	section: "Church & sponsors",
	icon: Church,
	items: [
		{ to: "/admin/church", label: "Overview", icon: LayoutGrid, end: true, roles: READ, keywords: "church dashboard sponsorships ministry groups" },
		{ to: "/admin/church/sponsors", label: "Sponsors", icon: HandHeart, roles: READ, keywords: "sponsorship donors students supported" },
		{ to: "/admin/church/giving", label: "Giving", icon: HandCoins, roles: READ, keywords: "offering tithe donation gift receipt" },
		{ to: "/admin/church/chapel", label: "Chapel", icon: Music, roles: CHAPEL, keywords: "chapel service attendance worship ministry groups" },
		{ to: "/admin/church/churches", label: "Partner churches", icon: Building2, keywords: "denomination parish branches" },
	],
}
