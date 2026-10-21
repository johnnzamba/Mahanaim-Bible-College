import { BarChart3, FileText, GraduationCap, HandHeart, Home, LayoutDashboard, Settings, UserRound } from "lucide-react"

export const NAV = [
	{
		section: "Partnership",
		icon: LayoutDashboard,
		items: [
			{ to: "/sponsor", label: "Dashboard", icon: LayoutDashboard, end: true, keywords: "home overview summary" },
			{ to: "/sponsor/students", label: "My students", icon: GraduationCap, keywords: "sponsored students progress results fees balance" },
			{ to: "/sponsor/giving", label: "Giving", icon: HandHeart, keywords: "give donate offering contributions mpesa history" },
			{ to: "/sponsor/reports", label: "Statements", icon: FileText, keywords: "report statement print export csv" },
		],
	},
	{
		section: "Account",
		icon: Settings,
		items: [
			{ to: "/sponsor/profile", label: "Sponsor profile", icon: UserRound, keywords: "contact person phone address communication" },
			{ to: "/sponsor/account", label: "Account settings", icon: Settings, keywords: "password login email" },
		],
	},
]

export const TABS = [
	{ to: "/sponsor", label: "Home", icon: Home, end: true },
	{ to: "/sponsor/students", label: "Students", icon: GraduationCap },
	{ to: "/sponsor/giving", label: "Giving", icon: HandHeart },
	{ to: "/sponsor/reports", label: "Reports", icon: BarChart3 },
]
