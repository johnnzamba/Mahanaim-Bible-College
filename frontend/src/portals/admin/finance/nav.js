import { CreditCard, FileText, LayoutGrid, Settings2, Smartphone, UserSearch, Wallet } from "lucide-react"

/** Rail section for /admin/finance. Adjustments, refunds and defaulters open from the overview. */
export default {
	section: "Finance",
	icon: Wallet,
	items: [
		{ to: "/admin/finance", label: "Overview", icon: LayoutGrid, end: true, keywords: "finance dashboard collections adjustments refunds defaulters aging" },
		{ to: "/admin/finance/invoices", label: "Invoices", icon: FileText, keywords: "billing bulk invoice fees" },
		{ to: "/admin/finance/payments", label: "Payments", icon: CreditCard, keywords: "receipts record payment cash bank cheque" },
		{ to: "/admin/finance/mpesa", label: "M-Pesa", icon: Smartphone, keywords: "mpesa stk c2b paybill reconcile unmatched" },
		{ to: "/admin/finance/students", label: "Student accounts", icon: UserSearch, keywords: "statement balance ledger" },
		{ to: "/admin/finance/setup", label: "Fee setup", icon: Settings2, keywords: "fee structures components scholarships" },
	],
}
