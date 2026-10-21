import {
	BookOpen,
	CalendarDays,
	ClipboardCheck,
	FileQuestion,
	LayoutDashboard,
	Library,
	Megaphone,
	NotebookPen,
	Sheet,
	UserCircle,
} from "lucide-react"

export const NAV = [
	{
		section: "Overview",
		icon: LayoutDashboard,
		items: [{ to: "/lecturer", label: "Dashboard", icon: LayoutDashboard, end: true, keywords: "home today" }],
	},
	{
		section: "Teaching",
		icon: BookOpen,
		items: [
			{ to: "/lecturer/courses", label: "My courses", icon: BookOpen, keywords: "offerings units classes content modules assignments" },
			{ to: "/lecturer/timetable", label: "Timetable", icon: CalendarDays, keywords: "schedule week sessions" },
			{ to: "/lecturer/attendance", label: "Attendance", icon: ClipboardCheck, keywords: "roll call register sessions" },
		],
	},
	{
		section: "Assessment",
		icon: NotebookPen,
		items: [
			{ to: "/lecturer/exams", label: "Exams & CATs", icon: NotebookPen, keywords: "online exam cat quiz marking monitor" },
			{ to: "/lecturer/question-bank", label: "Question bank", icon: FileQuestion, keywords: "questions import csv" },
			{ to: "/lecturer/gradebook", label: "Gradebook", icon: Sheet, keywords: "mark sheet results grades weights" },
		],
	},
	{
		section: "Communication",
		icon: Megaphone,
		items: [{ to: "/lecturer/announcements", label: "Announcements", icon: Megaphone, keywords: "message class notice" }],
	},
	{
		section: "Account",
		icon: UserCircle,
		items: [{ to: "/lecturer/account", label: "Account & security", icon: UserCircle, keywords: "password profile" }],
	},
]

export const TABS = [
	{ to: "/lecturer", label: "Home", icon: LayoutDashboard, end: true },
	{ to: "/lecturer/courses", label: "Courses", icon: Library },
	{ to: "/lecturer/attendance", label: "Attendance", icon: ClipboardCheck },
	{ to: "/lecturer/exams", label: "Exams", icon: NotebookPen },
]
