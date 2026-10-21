import { ArrowLeftRight, BookOpen, LayoutGrid, Library } from "lucide-react"

/** Rail section for /admin/library. Paths are absolute. */
export default {
	section: "Library",
	icon: Library,
	items: [
		{ to: "/admin/library", label: "Overview", icon: LayoutGrid, end: true, keywords: "library dashboard overdue fines" },
		{ to: "/admin/library/catalogue", label: "Catalogue", icon: BookOpen, keywords: "books items e-library ebooks journals isbn" },
		{ to: "/admin/library/loans", label: "Loans", icon: ArrowLeftRight, keywords: "issue return renew borrow requests circulation" },
	],
}
