import { Settings } from "lucide-react"

/** Rail section for /admin/settings (owned by the settings area). Paths are absolute. */
export default {
	section: "System",
	icon: Settings,
	items: [{ to: "/admin/settings", label: "Settings", icon: Settings }],
}
