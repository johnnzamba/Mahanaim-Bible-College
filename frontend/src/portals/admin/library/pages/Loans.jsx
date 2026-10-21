import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { BookCheck, BookPlus, ClipboardList, History, Library } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Badge, Button, PageHeader, Select, SkeletonRows, Tabs } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { API, INVALIDATE, LibTabs, NoAccess, dueText, toneOf, useLibRoles } from "../components/common"
import { usePaged } from "../components/kit"
import { LoanDrawer } from "../components/LoanDrawer"
import { IssueLoanModal } from "../components/IssueLoan"

const TABS = {
	requests: { status: "Requested", empty: "No pending requests", icon: ClipboardList },
	active: { status: JSON.stringify(["Issued", "Overdue"]), empty: "Nothing is out on loan", icon: BookCheck },
	history: { status: JSON.stringify(["Returned", "Lost", "Cancelled"]), empty: "No closed loans yet", icon: History },
}

const itemCol = {
	key: "item_title",
	label: "Item",
	render: (r) => (
		<span className="block min-w-0">
			<span className="block truncate font-semibold text-ink">{r.item_title}</span>
			<span className="block truncate text-xs text-ink-soft">{r.name}</span>
		</span>
	),
}
const borrowerCol = {
	key: "borrower_name",
	label: "Borrower",
	render: (r) => (
		<span className="block min-w-0">
			<span className="block truncate text-ink">{r.borrower_name}</span>
			<span className="block truncate text-xs text-ink-soft">
				{r.borrower_type} · {r.student || r.staff_member}
			</span>
		</span>
	),
}
const fineCol = {
	key: "fine_amount",
	label: "Fine",
	align: "right",
	render: (r) =>
		Number(r.fine_amount) > 0 ? (
			<span className={r.fine_paid ? "text-ink-soft" : "font-semibold text-red-600"}>
				{money(r.fine_amount)}
				{r.fine_paid ? " paid" : ""}
			</span>
		) : (
			<span className="text-ink-soft">—</span>
		),
}
const statusCol = { key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" /> }

export default function Loans() {
	const { canRead, canManage } = useLibRoles()
	const [params, setParams] = useSearchParams()
	const dash = useApi(`${API}library_dashboard`, {}, { enabled: canRead })
	const counts = dash.data?.loans_by_status || {}
	const loanDays = dash.data?.settings?.loan_days || 14
	const tab = params.get("tab") || (dash.isLoading ? null : counts.Requested ? "requests" : "active")
	const loanName = params.get("loan")
	const [picked, setPicked] = useState(null)
	const [issuing, setIssuing] = useState(false)
	const setParam = (k, v) =>
		setParams(
			(p) => {
				const n = new URLSearchParams(p)
				if (v) n.set(k, v)
				else n.delete(k)
				return n
			},
			{ replace: k === "tab" }
		)
	const openLoan = (r) => {
		setPicked(r)
		setParam("loan", r.name)
	}
	if (!canRead) return <NoAccess title="Loans" />
	return (
		<>
			<LibTabs />
			<PageHeader
				title="Loans"
				subtitle="Requests from the portal, books out on loan, and the circulation history."
				actions={
					canManage ? (
						<Button icon={BookPlus} onClick={() => setIssuing(true)}>
							Issue a loan
						</Button>
					) : null
				}
			/>
			<Tabs
				className="mb-4"
				active={tab}
				onChange={(t) => setParam("tab", t)}
				tabs={[
					{ id: "requests", label: "Requests", count: counts.Requested || 0 },
					{ id: "active", label: "On loan", count: (counts.Issued || 0) + (counts.Overdue || 0) },
					{ id: "history", label: "History" },
				]}
			/>
			{tab ? <LoanList key={tab} tab={tab} counts={counts} canManage={canManage} onOpen={openLoan} /> : <SkeletonRows rows={6} />}
			<LoanDrawer
				name={loanName}
				initial={picked}
				loanDays={loanDays}
				onClose={() => {
					setPicked(null)
					setParam("loan", null)
				}}
			/>
			<IssueLoanModal open={issuing} onClose={() => setIssuing(false)} loanDays={loanDays} onIssued={() => setParam("tab", "active")} />
		</>
	)
}

function LoanList({ tab, counts, canManage, onOpen }) {
	const cfg = TABS[tab] || TABS.active
	const [search, setSearch] = useState("")
	const [chip, setChip] = useState("")
	const [type, setType] = useState("")
	const ds = useDebounced(search)
	const status = chip || cfg.status
	const { query, rows, total, pager } = usePaged(`${API}list_loans`, { status, search: ds, borrower_type: type }, 20)
	const issue = useAction(`${API}issue_loan`, { invalidate: INVALIDATE, success: (d) => `Issued to ${d.borrower_name}, due ${date(d.due_date)}` })

	const cols = (() => {
		if (tab === "requests") {
			return [
				itemCol,
				borrowerCol,
				{ key: "issue_date", label: "Requested", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-sm">{date(r.issue_date)}</span> },
				{ key: "remarks", label: "Note", hideOnMobile: true, render: (r) => <span className="line-clamp-2 max-w-xs text-xs text-ink-muted">{r.remarks || "—"}</span> },
				canManage
					? {
							key: "_act",
							label: "",
							align: "right",
							render: (r) => (
								<span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
									<Button size="sm" icon={BookCheck} loading={issue.isPending && issue.variables?.loan === r.name} onClick={() => issue.mutate({ loan: r.name })} data-issue={r.name}>
										Issue
									</Button>
									<Button size="sm" variant="ghost" onClick={() => onOpen(r)}>
										Review
									</Button>
								</span>
							),
						}
					: statusCol,
			]
		}
		if (tab === "active") {
			return [
				itemCol,
				borrowerCol,
				{ key: "issue_date", label: "Issued", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-sm">{date(r.issue_date)}</span> },
				{
					key: "due_date",
					label: "Due",
					sortValue: (r) => r.due_date,
					render: (r) => (
						<span className="block whitespace-nowrap">
							<span className="text-sm">{date(r.due_date)}</span>
							<span className={`block text-xs ${r.status === "Overdue" ? "font-semibold text-red-600" : "text-ink-soft"}`}>{dueText(r)}</span>
						</span>
					),
				},
				fineCol,
				statusCol,
			]
		}
		return [
			itemCol,
			borrowerCol,
			{ key: "issue_date", label: "Issued", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-sm">{date(r.issue_date)}</span> },
			{ key: "return_date", label: "Returned", render: (r) => <span className="whitespace-nowrap text-sm">{r.return_date ? date(r.return_date) : "—"}</span> },
			fineCol,
			statusCol,
		]
	})()

	const chips =
		tab === "active"
			? [
					{ id: "", label: "All on loan", count: (counts.Issued || 0) + (counts.Overdue || 0) },
					{ id: "Issued", label: "Within due date", count: counts.Issued || 0 },
					{ id: "Overdue", label: "Overdue", count: counts.Overdue || 0 },
				]
			: tab === "history"
				? [
						{ id: "", label: "All" },
						{ id: "Returned", label: "Returned", count: counts.Returned || 0 },
						{ id: "Lost", label: "Lost", count: counts.Lost || 0 },
						{ id: "Cancelled", label: "Declined / cancelled", count: counts.Cancelled || 0 },
					]
				: null
	const exportCols = [
		{ key: "name", label: "Loan" },
		{ key: "item_title", label: "Item" },
		{ key: "borrower_name", label: "Borrower" },
		{ key: "borrower_type", label: "Type" },
		{ key: "issue_date", label: "Issued" },
		{ key: "due_date", label: "Due" },
		{ key: "return_date", label: "Returned" },
		{ key: "status", label: "Status" },
		{ key: "fine_amount", label: "Fine" },
	]
	return (
		<>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search item, borrower or loan number…"
				chips={chips}
				active={chip}
				onChip={setChip}
				right={
					<div className="flex items-center gap-2">
						<Select aria-label="Borrower type" className="w-36" placeholder="All borrowers" options={["Student", "Staff"]} value={type} onChange={(e) => setType(e.target.value)} />
						<ExportButton filename={`library-loans-${tab}.csv`} cols={exportCols} rows={rows} />
					</div>
				}
			/>
			<DataTable
				cols={cols}
				query={query}
				onRow={onOpen}
				empty={ds || type || chip ? "No loans match" : cfg.empty}
				emptyIcon={cfg.icon || Library}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">
							{num(total)} loan{total === 1 ? "" : "s"}
						</span>
						{pager}
					</div>
				}
			/>
		</>
	)
}
