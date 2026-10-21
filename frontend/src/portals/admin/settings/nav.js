import { Settings } from "lucide-react"

/** Rail section for /admin/settings (owned by the settings area). Paths are absolute. */
export default {
	section: "System",
	icon: Settings,
	items: [
		{
			to: "/admin/settings",
			label: "Settings",
			icon: Settings,
			keywords: "configuration branding logo institution academic term admissions numbering finance clearance sms gateway otp mfa security campuses departments study modes master data mpesa daraja callback lms bridge integrations",
		},
	],
}
