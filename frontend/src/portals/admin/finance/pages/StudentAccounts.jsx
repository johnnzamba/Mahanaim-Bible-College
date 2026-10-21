import { useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Banknote, CalendarClock, Download, FilePlus2, GraduationCap, Phone, ReceiptText, ShieldCheck, Smartphone, UserRound, Wallet } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Card, Empty, ErrorState, PageHeader, Panel, ProgressBar, SkeletonRows, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable, PersonRow } from "@/shared/components/kit"
import { date, dateTime, money } from "@/shared/utils/format"
import { DateRange, F, StudentPicker, useFinanceRole } from "../lib"
import { CreateInvoice } from "./Invoices"

export default function StudentAccounts() {
	const { student: routeStudent } = useParams()
	const [params] = useSearchParams()
	const nav = useNavigate()
	const student = routeStudent || params.get("student")
	const pick = (s) => s && nav(`/admin/finance/students/${encodeURIComponent(s.name)}`)

	return (
		<div>
			<PageHeader eyebrow="Finance" title="Student accounts" subtitle="Look up any student's fee balance, statement, invoices and receipts." back={student ? { to: "/admin/finance/students", label: "All accounts" } : { to: "/admin/finance", label: "Finance overview" }} />
			{student ? (
				<Account student={student} key={student} />
			) : (
				<div className="grid gap-5 lg:grid-cols-5">
					<Card className="p-5 lg:col-span-3">
						<div className="mb-4 flex items-center gap-3">
							<span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
								<UserRound size={20} />
							</span>
							<div>
								<div className="font-semibold text-ink">Find a student</div>
								<div className="text-sm text-ink-soft">Search by name, admission number or phone.</div>
							</div>
						</div>
						<StudentPicker value={null} onChange={pick} label="Student" autoFocus />
					</Card>
					<TopBalances />
				</div>
			)}
		</div>
	)
}

function TopBalances() {
	const q = useApi(`${F}defaulters`, { page_length: 6 })
	const rows = q.data?.data || []
	return (
		<Panel title="Largest balances" subtitle={q.data ? `${q.data.total} students owe ${money(q.data.total_balance)}` : undefined} className="lg:col-span-2" actions={<Link className="text-xs font-semibold text-brand-700 hover:underline" to="/admin/finance/defaulters">All defaulters</Link>}>
			{q.isLoading ? <SkeletonRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : rows.length ? (
				<div className="-my-1 divide-y divide-line">
					{rows.map((r) => (
						<PersonRow key={r.student} name={r.full_name} sub={`${r.student_number || r.student} · ${r.programme || ""}`} to={`/admin/finance/students/${encodeURIComponent(r.student)}`} right={<span className="text-sm font-semibold text-red-700">{money(r.balance)}</span>} />
					))}
				</div>
			) : (
				<Empty compact icon={ShieldCheck} title="No one owes fees" subtitle="Every student account is settled." />
			)}
		</Panel>
	)
}

function Account({ student }) {
	const { canWrite } = useFinanceRole()
	const nav = useNavigate()
	const q = useApi(`${F}student_account`, { student })
	const [tab, setTab] = useState("statement")
	const [invoiceOpen, setInvoiceOpen] = useState(false)

	if (q.isLoading) {
		return (
			<div className="card p-5">
				<SkeletonRows rows={8} />
			</div>
		)
	}
	if (q.isError) return <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't open this account" /></div>
	const a = q.data || {}
	const s = a.student || {}
	const picked = { name: s.name, full_name: s.full_name, student_number: s.student_number, programme: s.programme }
	const installments = a.installments || []
	const pending = a.pending_requests || []

	return (
		<>
			<Card className="mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-4">
					<span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-700 font-serif text-lg text-white">{(s.full_name || "?").slice(0, 1)}</span>
					<div className="min-w-0">
						<div className="truncate font-serif text-xl text-ink">{s.full_name}</div>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
							<span className="font-mono">{s.student_number}</span>
							{s.programme_name || s.programme ? <span className="inline-flex items-center gap-1"><GraduationCap size={14} /> {s.programme_name || s.programme}</span> : null}
							{s.phone ? <span className="inline-flex items-center gap-1"><Phone size={14} /> {s.phone}</span> : null}
						</div>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<a className="btn btn-secondary btn-sm" href={frappe.downloadUrl(`${F}download`, { doctype: "statement", name: student })} target="_blank" rel="noreferrer">
						<Download size={15} /> Statement PDF
					</a>
					{canWrite ? (
						<>
							<Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => setInvoiceOpen(true)}>
								New invoice
							</Button>
							<Button size="sm" icon={Banknote} onClick={() => nav(`/admin/finance/payments?new=1&student=${encodeURIComponent(student)}`)}>
								Record payment
							</Button>
						</>
					) : null}
				</div>
			</Card>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label={a.balance < 0 ? "In credit" : "Balance due"} value={money(Math.abs(a.balance || 0))} icon={Wallet} tone={a.balance > 0 ? "red" : "green"} />
				<StatCard label="Total billed" value={money(a.total_billed)} icon={ReceiptText} />
				<StatCard label="Total paid" value={money(a.total_paid)} icon={Banknote} tone="green" />
				<StatCard label="Next instalment" value={installments[0] ? money(installments[0].amount - (installments[0].paid_amount || 0)) : "—"} icon={CalendarClock} tone="gold" hint={installments[0] ? `${installments[0].label || "Due"} · ${date(installments[0].due_date)}` : "Nothing scheduled"} />
			</div>
			<div className="mb-5 grid gap-3 sm:grid-cols-2">
				{Object.entries(a.clearance || {}).map(([k, c]) => (
					<Card key={k} className="p-4">
						<div className="mb-2 flex items-center justify-between gap-2">
							<span className="text-sm font-semibold text-ink">{k === "exam" ? "Exam clearance" : k === "lms" ? "E-learning access" : k}</span>
							<Badge tone={c.cleared ? "green" : "red"} dot>{c.cleared ? "Cleared" : "Not cleared"}</Badge>
						</div>
						<ProgressBar value={c.paid_percent} tone={c.cleared ? "green" : "red"} />
						<p className="mt-2 text-xs text-ink-soft">{c.message}</p>
					</Card>
				))}
			</div>
			{pending.length ? (
				<Alert tone="info" icon={Smartphone} className="mb-4" title={`${pending.length} M-Pesa prompt${pending.length === 1 ? "" : "s"} awaiting the student`} action={<Link className="btn btn-secondary btn-sm" to="/admin/finance/mpesa?tab=requests">View requests</Link>}>
					{pending.map((p) => `${money(p.amount)} to ${p.phone_number} (${p.status}, ${dateTime(p.creation)})`).join("; ")}
				</Alert>
			) : null}
			<Tabs
				className="mb-4 overflow-y-hidden"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "statement", label: "Statement" },
					{ id: "invoices", label: "Invoices", count: (a.invoices || []).length },
					{ id: "payments", label: "Payments", count: (a.payments || []).length },
					{ id: "installments", label: "Instalments", count: installments.length || undefined },
				]}
			/>
			{tab === "statement" ? <Statement student={student} /> : null}
			{tab === "invoices" ? (
				<DataTable
					rows={a.invoices || []}
					rowTo={(r) => `/admin/finance/invoices/${encodeURIComponent(r.name)}`}
					empty="No submitted invoices yet"
					cols={[
						{ key: "name", label: "Invoice", render: (r) => <span><span className="block font-semibold text-ink">{r.name}</span><span className="block text-xs text-ink-soft">{(r.items || []).map((i) => i.fee_component).join(", ")}</span></span> },
						{ key: "academic_term", label: "Term", render: (r) => r.academic_term || "—" },
						{ key: "due_date", label: "Due", render: (r) => date(r.due_date) },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
						{ key: "grand_total", label: "Total", align: "right", render: (r) => money(r.grand_total) },
						{ key: "outstanding_amount", label: "Outstanding", align: "right", render: (r) => <b className={r.outstanding_amount > 0 ? "text-red-700" : "text-emerald-700"}>{money(r.outstanding_amount)}</b> },
					]}
				/>
			) : null}
			{tab === "payments" ? (
				<DataTable
					rows={a.payments || []}
					rowTo={(r) => `/admin/finance/payments/${encodeURIComponent(r.name)}`}
					empty="No payments received yet"
					cols={[
						{ key: "name", label: "Receipt", render: (r) => <span><span className="block font-semibold text-ink">{r.name}</span><span className="block text-xs text-ink-soft">{date(r.posting_date)}</span></span> },
						{ key: "mode_of_payment", label: "Mode", render: (r) => <span><span className="block">{r.mode_of_payment}</span>{r.reference_no ? <span className="block font-mono text-[11px] text-ink-soft">{r.reference_no}</span> : null}</span> },
						{ key: "allocations", label: "Applied to", hideOnMobile: true, render: (r) => ((r.allocations || []).length ? r.allocations.map((x) => x.invoice).join(", ") : <span className="text-ink-soft">On account</span>) },
						{ key: "amount", label: "Amount", align: "right", render: (r) => <b>{money(r.amount)}</b> },
					]}
				/>
			) : null}
			{tab === "installments" ? (
				<DataTable
					rows={installments}
					rowTo={(r) => `/admin/finance/invoices/${encodeURIComponent(r.invoice)}`}
					empty="No unpaid instalments"
					cols={[
						{ key: "label", label: "Instalment", render: (r) => <span><span className="block font-medium text-ink">{r.label || "Instalment"}</span><span className="block text-xs text-ink-soft">{r.invoice}</span></span> },
						{ key: "due_date", label: "Due", render: (r) => date(r.due_date) },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
						{ key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount) },
						{ key: "paid_amount", label: "Paid", align: "right", render: (r) => money(r.paid_amount) },
					]}
				/>
			) : null}
			{canWrite ? <CreateInvoice open={invoiceOpen} onClose={() => setInvoiceOpen(false)} student={picked} /> : null}
		</>
	)
}

const VOUCHER_ROUTE = {
	"Student Invoice": "invoices",
	"Student Payment": "payments",
}

function Statement({ student }) {
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const q = useApi(`${F}student_statement`, { student, from_date: from || undefined, to_date: to || undefined }, { placeholderData: (p) => p })
	const st = q.data || {}
	const pdf = frappe.downloadUrl(`${F}download`, { doctype: "statement", name: student, from_date: from || undefined, to_date: to || undefined })
	return (
		<Panel
			title="Account statement"
			subtitle={from || to ? `${from ? date(from) : "Start"} – ${to ? date(to) : "today"}` : "All transactions"}
			bodyClass="p-0"
			actions={
				<div className="flex flex-wrap items-center gap-2">
					<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
					<a className="btn btn-secondary btn-sm" href={pdf} target="_blank" rel="noreferrer">
						<Download size={15} /> PDF
					</a>
				</div>
			}
			footer={
				q.data ? (
					<div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
						<span className="text-ink-soft">Charges <b className="text-ink">{money(st.total_debit)}</b></span>
						<span className="text-ink-soft">Payments & credits <b className="text-ink">{money(st.total_credit)}</b></span>
						<span className="text-ink-soft">Closing balance <b className={st.closing_balance > 0 ? "text-red-700" : "text-emerald-700"}>{money(st.closing_balance)}</b></span>
					</div>
				) : null
			}
		>
			<DataTable
				query={q}
				rows={q.data ? [...(from ? [{ _opening: true, description: "Opening balance", balance: st.opening_balance, date: from }] : []), ...(st.lines || [])].map((r, i) => ({ ...r, _k: i })) : undefined}
				rowKey="_k"
				noCards
				dense
				empty="No transactions in this period"
				cols={[
					{ key: "date", label: "Date", render: (r) => date(r.date) },
					{ key: "description", label: "Description", render: (r) => r._opening ? <i className="text-ink-soft">Opening balance</i> : (
						<span>
							<span className="block text-ink">{r.description}</span>
							<span className="block text-xs text-ink-soft">
								{VOUCHER_ROUTE[r.voucher_type] ? <Link className="hover:text-brand-700 hover:underline" to={`/admin/finance/${VOUCHER_ROUTE[r.voucher_type]}/${encodeURIComponent(r.voucher_no)}`}>{r.voucher_no}</Link> : r.voucher_no}
								{r.academic_term ? ` · ${r.academic_term}` : ""}
							</span>
						</span>
					) },
					{ key: "debit", label: "Charge", align: "right", render: (r) => (r.debit ? money(r.debit) : "") },
					{ key: "credit", label: "Credit", align: "right", render: (r) => (r.credit ? <span className="text-emerald-700">{money(r.credit)}</span> : "") },
					{ key: "balance", label: "Balance", align: "right", render: (r) => <b>{money(r.balance)}</b> },
				]}
			/>
		</Panel>
	)
}
