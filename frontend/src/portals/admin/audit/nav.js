import { ShieldCheck } from "lucide-react"

/** Rail section for /admin/audit (owned by the audit area). Paths are absolute. */
export default {
	section: "System",
	icon: ShieldCheck,
	items: [{ to: "/admin/audit", label: "Audit log", icon: ShieldCheck }],
}
