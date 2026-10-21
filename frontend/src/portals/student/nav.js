import {
	Award,
	BookOpen,
	CalendarCheck,
	CalendarDays,
	Church,
	ClipboardList,
	FileText,
	GraduationCap,
	Inbox,
	LayoutDashboard,
	Library,
	ListChecks,
	Megaphone,
	NotebookPen,
	ShieldCheck,
	UserCircle,
	Users,
	Wallet,
} from "lucide-react"

export const NAV = [
	{
		section: "Overview",
		icon: LayoutDashboard,
		items: [{ to: "/student", label: "Dashboard", icon: LayoutDashboard, end: true, keywords: "home today next up" }],
	},
	{
		section: "Learning",
		icon: BookOpen,
		items: [
			{ to: "/student/courses", label: "My courses", icon: BookOpen, keywords: "units classes modules resources lms content" },
			{ to: "/student/assignments", label: "Assignments", icon: ClipboardList, keywords: "homework submit coursework papers" },
			{ to: "/student/exams", label: "Exams & CATs", icon: NotebookPen, keywords: "online exam cat quiz test" },
			{ to: "/student/timetable", label: "Timetable", icon: CalendarDays, keywords: "schedule classes week venue" },
			{ to: "/student/attendance", label: "Attendance", icon: CalendarCheck, keywords: "present absent sessions" },
		],
	},
	{
		section: "Academics",
		icon: GraduationCap,
		items: [
			{ to: "/student/registration", label: "Registration", icon: ListChecks, keywords: "register units semester term courses" },
			{ to: "/student/results", label: "Results", icon: Award, keywords: "grades gpa cgpa marks transcript" },
			{ to: "/student/documents", label: "Documents", icon: FileText, keywords: "transcript certificate verification" },
		],
	},
	{
		section: "Finance",
		icon: Wallet,
		items: [{ to: "/student/fees", label: "Fees & payments", icon: Wallet, keywords: "balance invoice receipt mpesa pay statement refund" }],
	},
	{
		section: "Campus life",
		icon: Church,
		items: [
			{ to: "/student/library", label: "Library", icon: Library, keywords: "books ebooks loans catalogue" },
			{ to: "/student/chapel", label: "Chapel & ministry", icon: Church, keywords: "chapel church ministry devotion" },
			{ to: "/student/announcements", label: "Announcements", icon: Megaphone, keywords: "news notices" },
		],
	},
	{
		section: "Me",
		icon: UserCircle,
		items: [
			{ to: "/student/requests", label: "Requests", icon: Inbox, keywords: "deferment withdrawal clearance letter transfer" },
			{ to: "/student/profile", label: "My profile", icon: UserCircle, keywords: "contact next of kin church details" },
			{ to: "/student/alumni", label: "Alumni", icon: Users, roles: ["Alumni"], keywords: "alumni network ministry" },
			{ to: "/student/account", label: "Account & security", icon: ShieldCheck, keywords: "password two factor sessions" },
		],
	},
]

export const TABS = [
	{ to: "/student", label: "Home", icon: LayoutDashboard, end: true },
	{ to: "/student/courses", label: "Courses", icon: BookOpen },
	{ to: "/student/exams", label: "Exams", icon: NotebookPen },
	{ to: "/student/fees", label: "Fees", icon: Wallet },
]
