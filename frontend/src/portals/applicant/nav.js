import { ClipboardList, FilePlus2, FolderOpen, Home, LayoutDashboard, Settings, Wallet } from "lucide-react"

export const NAV = [
	{
		section: "Admissions",
		icon: LayoutDashboard,
		items: [
			{ to: "/applicant", label: "Dashboard", icon: LayoutDashboard, end: true, keywords: "home status application progress" },
			{ to: "/applicant/application", label: "My applications", icon: ClipboardList, keywords: "applications status history draft submitted offer" },
			{ to: "/applicant/apply", label: "New application", icon: FilePlus2, keywords: "apply programme course start draft" },
			{ to: "/applicant/documents", label: "Documents", icon: FolderOpen, keywords: "upload id kcse certificate photo letter" },
			{ to: "/applicant/payments", label: "Payments", icon: Wallet, keywords: "fee mpesa receipt application fee" },
		],
	},
	{
		section: "Account",
		icon: Settings,
		items: [{ to: "/applicant/account", label: "Account settings", icon: Settings, keywords: "password profile phone email" }],
	},
]

export const TABS = [
	{ to: "/applicant", label: "Home", icon: Home, end: true },
	{ to: "/applicant/apply", label: "Apply", icon: FilePlus2 },
	{ to: "/applicant/documents", label: "Documents", icon: FolderOpen },
	{ to: "/applicant/payments", label: "Payments", icon: Wallet },
]
