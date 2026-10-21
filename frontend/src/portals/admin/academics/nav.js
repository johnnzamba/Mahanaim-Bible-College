import { BookOpen, CalendarRange, ClipboardCheck, FileSpreadsheet, GraduationCap, LayoutGrid } from "lucide-react"

/** Rail section for /admin/academics. Sub-screens (courses, question bank, mark sheets, grading) are tabs. */
export default {
	section: "Academics",
	icon: BookOpen,
	items: [
		{ to: "/admin/academics", label: "Overview", icon: LayoutGrid, end: true, keywords: "academics term kpi" },
		{ to: "/admin/academics/programmes", label: "Programmes & courses", icon: GraduationCap, keywords: "curriculum course units credits prerequisites" },
		{ to: "/admin/academics/offerings", label: "Offerings", icon: BookOpen, keywords: "classes timetable sessions lecturers attendance" },
		{ to: "/admin/academics/calendar", label: "Calendar", icon: CalendarRange, keywords: "academic year term semester intake dates" },
		{ to: "/admin/academics/exams", label: "Exams", icon: ClipboardCheck, keywords: "question bank cat quiz monitor marking release" },
		{ to: "/admin/academics/results", label: "Mark sheets & results", icon: FileSpreadsheet, keywords: "mark sheet approve publish grades grading scale gpa" },
	],
}
