import { LayoutDashboard } from "lucide-react"

/** Rail section for /admin/ (owned by the dashboard area). Paths are absolute. */
export default {
	section: "Overview",
	icon: LayoutDashboard,
	items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true }],
}
