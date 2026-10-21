import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import clsx from "clsx"
import {
	CalendarClock,
	CheckCircle2,
	Download,
	FileText,
	HandCoins,
	Lock,
	Printer,
	Receipt,
	ScrollText,
	Smartphone,
	Undo2,
	Unlock,
} from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi, useInvalidate } from "@/shared/api/hooks"
import {
	Alert,
	Badge,
	Button,
	Drawer,
	Empty,
	Input,
	KeyValueGrid,
	Modal,
	PageHeader,
	Panel,
	ProgressBar,
	QueryState,
	Select,
	Skeleton,
	Tabs,
	Textarea,
} from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { MpesaPay } from "@/shared/components/MpesaPay"
import { date, money, pct } from "@/shared/utils/format"
import { GOLD_BTN, Hero, HeroStat } from "../components/bits"
import { API, INV, financePdf, isoDate, since } from "../components/lib"

const TABS = [
	{ id: "invoices", label: "Invoices" },
	{ id: "payments", label: "Payments" },
	{ id: "statement", label: "Statement" },
]

export default function Fees({ pay = false }) {
	const navigate = useNavigate()
	const invalidate = useInvalidate()
	const q = useApi(API.fees)
	const [tab, setTab] = useState("invoices")
	const [payOpen, setPayOpen] = useState(false)
	const [payInvoice, setPayInvoice] = useState("")
	const [invoice, setInvoice] = useState(null)
	const [refund, setRefund] = useState(false)
	const open = pay || payOpen

	const openPay = (inv = "") => {
		setPayInvoice(inv)
		setPayOpen(true)
	}
	const closePay = () => {
		setPayOpen(false)
		if (pay) navigate("/student/fees", { replace: true })
	}

	return (
		<>
			<PageHeader
				eyebrow="Finance"
				title="Fees & payments"
				subtitle="Your fee balance, invoices, receipts and statement."
				actions={
					<>
						<a className="btn btn-secondary btn-sm" href={financePdf("statement")} target="_blank" rel="noreferrer">
							<Download size={15} /> Statement
						</a>
						<Button size="sm" icon={Smartphone} onClick={() => openPay()}>
							Pay fees
						</Button>
					</>
				}
			/>
			<QueryState
				query={q}
				skeleton={
					<div className="space-y-4">
						<Skeleton className="h-44 rounded-2xl" />
						<Skeleton className="h-72 rounded-2xl" />
					</div>
				}
			>
				{(d) => (
					<div className="space-y-5">
						<BalanceHero d={d} onPay={() => openPay()} onRefund={() => setRefund(true)} />
						{(d.pending_requests || []).length ? (
							<Alert tone="info" icon={Smartphone} title="M-Pesa payment in progress">
								{d.pending_requests.map((r) => (
									<div key={r.name}>
										{money(r.amount)} from {r.phone_number} · {r.status} · {since(r.creation)}
									</div>
								))}
								<div className="mt-1 text-xs">If you completed the prompt on your phone, your balance updates within a minute.</div>
							</Alert>
						) : null}
						{(d.installments || []).length ? <Installments rows={d.installments} onPay={openPay} /> : null}
						<Tabs className="pb-px" tabs={TABS} active={tab} onChange={setTab} />
						{tab === "invoices" ? (
							<DataTable
								rows={d.invoices || []}
								onRow={setInvoice}
								empty="No invoices yet"
								emptyIcon={FileText}
								cols={[
									{ key: "name", label: "Invoice", render: (r) => <span className="font-semibold text-ink">{r.name}</span> },
									{ key: "academic_term", label: "Term", render: (r) => r.academic_term || "—" },
									{ key: "due_date", label: "Due", render: (r) => (r.due_date ? date(r.due_date) : "—"), sortable: true },
									{ key: "total_amount", label: "Amount", align: "right", render: (r) => money(r.total_amount), sortable: true },
									{
										key: "outstanding_amount",
										label: "Outstanding",
										align: "right",
										render: (r) => <span className={clsx("font-semibold", Number(r.outstanding_amount) > 0 ? "text-red-600" : "text-ink-soft")}>{money(r.outstanding_amount)}</span>,
									},
									{ key: "status", label: "Status", render: (r) => <Badge status={r.status} dot /> },
								]}
							/>
						) : null}
						{tab === "payments" ? (
							<DataTable
								rows={d.payments || []}
								empty="No payments yet"
								emptyIcon={Receipt}
								cols={[
									{ key: "name", label: "Receipt", render: (r) => <span className="font-semibold text-ink">{r.name}</span> },
									{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date), sortable: true },
									{ key: "mode_of_payment", label: "Method", render: (r) => r.mode_of_payment || "—" },
									{ key: "reference_no", label: "Reference", render: (r) => <span className="font-mono text-xs">{r.reference_no || "—"}</span>, hideOnMobile: true },
									{ key: "amount", label: "Amount", align: "right", render: (r) => <span className="font-semibold text-emerald-600">{money(r.amount)}</span> },
									{
										key: "pdf",
										label: "",
										align: "right",
										render: (r) => (
											<a className="btn btn-ghost btn-sm" href={financePdf("receipt", r.name)} target="_blank" rel="noreferrer" aria-label={`Download receipt ${r.name}`}>
												<Download size={14} /> PDF
											</a>
										),
									},
								]}
							/>
						) : null}
						{tab === "statement" ? <Statement /> : null}
					</div>
				)}
			</QueryState>

			<InvoiceDrawer inv={invoice} onClose={() => setInvoice(null)} onPay={(n) => (setInvoice(null), openPay(n))} />
			{q.data ? (
				<PayDialog
					key={`${payInvoice}-${open}`}
					open={open}
					d={q.data}
					invoice={payInvoice}
					setInvoice={setPayInvoice}
					onClose={closePay}
					onDone={() => invalidate(INV.finance, INV.students, INV.exams)}
				/>
			) : null}
			{q.data ? <RefundModal open={refund} onClose={() => setRefund(false)} credit={-Number(q.data.balance || 0)} phone={q.data.student?.phone} /> : null}
		</>
	)
}

function BalanceHero({ d, onPay, onRefund }) {
	const bal = Number(d.balance || 0)
	const billed = Number(d.total_billed || 0)
	const paid = Number(d.total_paid || 0)
	const paidPct = billed ? Math.min(100, (paid / billed) * 100) : 0
	const nextDue = (d.invoices || []).filter((i) => Number(i.outstanding_amount) > 0 && i.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0]
	const clear = d.clearance || {}
	return (
		<Hero>
			<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase tracking-wider text-white/60">{bal < 0 ? "Credit balance" : "Fee balance"}</div>
					<div className="mt-1 font-serif text-4xl font-bold tabular-nums sm:text-5xl">{money(Math.abs(bal), { currency: d.currency })}</div>
					<p className="mt-1 text-sm text-white/75">
						{bal > 0
							? nextDue
								? `Next due ${date(nextDue.due_date)} · ${nextDue.name}`
								: "Outstanding on your account"
							: bal < 0
								? "You've paid more than you were billed."
								: "You're fully paid up. Thank you!"}
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<ClearChip label="Exams" c={clear.exam} />
						<ClearChip label="E-learning" c={clear.lms} />
					</div>
				</div>
				<div className="flex flex-col gap-4 lg:items-end">
					<div className="grid grid-cols-2 gap-6">
						<HeroStat label="Billed" value={money(billed)} />
						<HeroStat label="Paid" value={money(paid)} sub={billed ? `${pct(paidPct)} of fees` : null} />
					</div>
					<div className="flex flex-wrap gap-2">
						{bal > 0 ? (
							<button type="button" className={GOLD_BTN} onClick={onPay}>
								<Smartphone size={16} /> Pay with M-Pesa
							</button>
						) : null}
						{bal < 0 ? (
							<button type="button" className="btn bg-white/15 text-white ring-1 ring-white/30 hover:bg-white/25" onClick={onRefund}>
								<Undo2 size={16} /> Request refund
							</button>
						) : null}
					</div>
				</div>
			</div>
			{billed ? (
				<div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={Math.round(paidPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Fees paid">
					<div className="h-full rounded-full bg-gold-400 transition-all duration-700" style={{ width: `${paidPct}%` }} />
				</div>
			) : null}
			{d.mpesa?.paybill ? (
				<p className="mt-3 text-xs text-white/70">
					Or pay via M-Pesa Paybill <b className="text-white">{d.mpesa.paybill}</b>, account <b className="text-white">{d.mpesa.account}</b>.
				</p>
			) : d.mpesa?.till ? (
				<p className="mt-3 text-xs text-white/70">
					Or pay via M-Pesa Till <b className="text-white">{d.mpesa.till}</b>.
				</p>
			) : null}
		</Hero>
	)
}

function ClearChip({ label, c }) {
	if (!c) return null
	const ok = c.cleared
	return (
		<span
			title={c.message}
			className={clsx(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
				ok ? "bg-emerald-400/15 text-emerald-100 ring-emerald-300/30" : "bg-red-400/20 text-red-100 ring-red-300/40"
			)}
		>
			{ok ? <Unlock size={12} /> : <Lock size={12} />}
			{label}: {ok ? "cleared" : `${pct(c.paid_percent)} of ${pct(c.required_percent)} paid`}
		</span>
	)
}

function Installments({ rows, onPay }) {
	return (
		<Panel title="Upcoming instalments" icon={CalendarClock} bodyClass="divide-y divide-line">
			{rows.slice(0, 5).map((r, i) => {
				const left = Number(r.amount || 0) - Number(r.paid_amount || 0)
				return (
					<div key={`${r.invoice}-${i}`} className="flex items-center gap-3 px-5 py-3">
						<div className="min-w-0 flex-1">
							<div className="text-sm font-semibold text-ink">{r.label || `Instalment ${i + 1}`}</div>
							<div className="text-xs text-ink-soft">
								{r.invoice} · due {date(r.due_date)}
							</div>
						</div>
						<div className="text-right">
							<div className="text-sm font-bold text-ink">{money(left)}</div>
							<Badge status={r.status} size="xs" />
						</div>
						<Button size="sm" variant="secondary" onClick={() => onPay(r.invoice)}>
							Pay
						</Button>
					</div>
				)
			})}
		</Panel>
	)
}

function InvoiceDrawer({ inv, onClose, onPay }) {
	const out = Number(inv?.outstanding_amount || 0)
	return (
		<Drawer
			open={Boolean(inv)}
			onClose={onClose}
			title={inv ? `Invoice ${inv.name}` : ""}
			subtitle={inv?.academic_term}
			footer={
				inv ? (
					<div className="flex flex-wrap justify-end gap-2">
						<a className="btn btn-secondary" href={financePdf("invoice", inv.name, { format: "html" })} target="_blank" rel="noreferrer">
							<Printer size={15} /> Print
						</a>
						<a className="btn btn-secondary" href={financePdf("invoice", inv.name)} target="_blank" rel="noreferrer">
							<Download size={15} /> PDF
						</a>
						{out > 0 ? (
							<Button icon={Smartphone} onClick={() => onPay(inv.name)}>
								Pay {money(out)}
							</Button>
						) : null}
					</div>
				) : null
			}
		>
			{inv ? (
				<div className="space-y-5">
					<div className="flex items-center justify-between">
						<Badge status={inv.status} dot />
						<span className="text-sm text-ink-soft">Issued {date(inv.posting_date)}</span>
					</div>
					<KeyValueGrid
						items={[
							{ label: "Programme", value: inv.programme },
							{ label: "Campus", value: inv.campus },
							{ label: "Due date", value: inv.due_date ? date(inv.due_date) : "—" },
							{ label: "Fee structure", value: inv.fee_structure || "—" },
						]}
					/>
					<div>
						<h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Items</h4>
						<div className="overflow-hidden rounded-xl border border-line">
							{(inv.items || []).map((it, i) => (
								<div key={i} className="flex justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0">
									<span className="text-ink">{it.description || it.fee_component}</span>
									<span className="font-medium tabular-nums text-ink">{money(it.amount)}</span>
								</div>
							))}
							<div className="flex justify-between bg-cream px-4 py-2.5 text-sm font-bold text-ink">
								<span>Total</span>
								<span className="tabular-nums">{money(inv.total_amount)}</span>
							</div>
						</div>
						<div className="mt-3 space-y-1 text-sm">
							<Line label="Paid" value={money(inv.paid_amount)} tone="text-emerald-600" />
							{Number(inv.credit_applied) ? <Line label="Credit applied" value={money(inv.credit_applied)} tone="text-emerald-600" /> : null}
							<Line label="Outstanding" value={money(out)} tone={out > 0 ? "text-red-600 font-bold" : "text-ink font-bold"} />
						</div>
						<ProgressBar className="mt-3" size="sm" value={Number(inv.total_amount) ? ((Number(inv.total_amount) - out) / Number(inv.total_amount)) * 100 : 0} tone="green" />
					</div>
					{(inv.installments || []).length ? (
						<div>
							<h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Instalment plan</h4>
							<ol className="space-y-2">
								{inv.installments.map((r, i) => (
									<li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-2.5 text-sm">
										<span className="min-w-0">
											<span className="block font-semibold text-ink">{r.label || `Instalment ${i + 1}`}</span>
											<span className="text-xs text-ink-soft">
												Due {date(r.due_date)}
												{r.percent ? ` · ${pct(r.percent)}` : ""}
											</span>
										</span>
										<span className="text-right">
											<span className="block font-semibold tabular-nums text-ink">{money(r.amount)}</span>
											<Badge status={r.status} size="xs" />
										</span>
									</li>
								))}
							</ol>
						</div>
					) : null}
				</div>
			) : null}
		</Drawer>
	)
}

function Line({ label, value, tone }) {
	return (
		<div className="flex justify-between">
			<span className="text-ink-soft">{label}</span>
			<span className={clsx("tabular-nums", tone)}>{value}</span>
		</div>
	)
}

function Statement() {
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const args = useMemo(() => ({ from_date: from || undefined, to_date: to || undefined }), [from, to])
	const q = useApi(API.statement, args, { placeholderData: (prev) => prev })
	const presets = [
		{ label: "All time", from: "", to: "" },
		{ label: "This year", from: `${new Date().getFullYear()}-01-01`, to: "" },
		{ label: "Last 90 days", from: isoDate(new Date(Date.now() - 90 * 864e5)), to: "" },
	]
	const extra = { ...(from ? { from_date: from } : {}), ...(to ? { to_date: to } : {}) }
	return (
		<div className="space-y-4">
			<div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
				<div className="grid flex-1 grid-cols-2 gap-3">
					<Input type="date" label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
					<Input type="date" label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
				</div>
				<div className="flex flex-wrap gap-2">
					{presets.map((p) => (
						<button
							key={p.label}
							type="button"
							onClick={() => (setFrom(p.from), setTo(p.to))}
							className={clsx("chip", from === p.from && to === p.to && "chip-active")}
						>
							{p.label}
						</button>
					))}
					<a className="btn btn-secondary btn-sm" href={financePdf("statement", null, extra)} target="_blank" rel="noreferrer">
						<Download size={14} /> PDF
					</a>
				</div>
			</div>
			{q.data ? (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					<Mini label="Opening" value={money(q.data.opening_balance)} />
					<Mini label="Charges" value={money(q.data.total_debit)} />
					<Mini label="Payments" value={money(q.data.total_credit)} tone="text-emerald-600" />
					<Mini label="Closing" value={money(q.data.closing_balance)} tone={Number(q.data.closing_balance) > 0 ? "text-red-600" : "text-ink"} />
				</div>
			) : null}
			<DataTable
				query={q}
				rows={q.data ? q.data.lines || [] : undefined}
				rowKey={(r) => `${r.voucher_no}-${r.date}-${r.debit}-${r.credit}`}
				empty="No transactions in this period"
				emptyIcon={ScrollText}
				pageSize={25}
				cols={[
					{ key: "description", label: "Description", render: (r) => <span className="font-medium text-ink">{r.description}</span> },
					{ key: "date", label: "Date", render: (r) => date(r.date) },
					{ key: "academic_term", label: "Term", render: (r) => r.academic_term || "—", hideOnMobile: true },
					{ key: "debit", label: "Charge", align: "right", render: (r) => (Number(r.debit) ? money(r.debit) : "—") },
					{ key: "credit", label: "Payment", align: "right", render: (r) => (Number(r.credit) ? <span className="text-emerald-600">{money(r.credit)}</span> : "—") },
					{ key: "balance", label: "Balance", align: "right", render: (r) => <span className="font-semibold">{money(r.balance)}</span> },
				]}
			/>
		</div>
	)
}

function Mini({ label, value, tone = "text-ink" }) {
	return (
		<div className="card px-4 py-3">
			<div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{label}</div>
			<div className={clsx("mt-0.5 text-lg font-bold tabular-nums", tone)}>{value}</div>
		</div>
	)
}

function PayDialog({ open, d, invoice, setInvoice, onClose, onDone }) {
	const unpaid = (d.invoices || []).filter((i) => Number(i.outstanding_amount) > 0)
	const inv = unpaid.find((i) => i.name === invoice)
	const bal = Math.max(0, Number(d.balance || 0))
	const amount = inv ? Number(inv.outstanding_amount) : bal || undefined
	return (
		<MpesaPay
			open={open}
			onClose={onClose}
			title="Pay fees with M-Pesa"
			subtitle={`${d.student?.student_number || ""} · balance ${money(d.balance)}`}
			amount={amount}
			minAmount={1}
			start={({ phone, amount: amt }) => frappe.call(API.payFees, { amount: amt, phone, invoice: invoice || undefined })}
			onDone={onDone}
		>
			{unpaid.length ? (
				<Select
					label="Apply payment to"
					value={invoice}
					onChange={(e) => setInvoice(e.target.value)}
					options={[{ value: "", label: `Whole balance (${money(bal)})` }, ...unpaid.map((i) => ({ value: i.name, label: `${i.name} · ${i.academic_term || ""} · ${money(i.outstanding_amount)} due` }))]}
				/>
			) : null}
			{!bal ? (
				<Alert tone="info" icon={CheckCircle2} className="mt-2">
					You have no outstanding balance. Any amount you pay is kept as credit on your account.
				</Alert>
			) : null}
		</MpesaPay>
	)
}

const REFUND_MODES = ["M-Pesa", "Bank Transfer", "Cheque", "Cash"]

function RefundModal({ open, onClose, credit, phone }) {
	const [f, setF] = useState({ amount: "", refund_mode: "M-Pesa", account_details: "", reason: "" })
	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
	const act = useAction(API.refund, {
		invalidate: [INV.finance],
		success: "Refund request submitted. Finance will contact you.",
		onSuccess: () => {
			setF({ amount: "", refund_mode: "M-Pesa", account_details: "", reason: "" })
			onClose()
		},
	})
	const amt = Number(f.amount)
	const err = f.amount && (amt <= 0 ? "Enter an amount above zero" : amt > credit ? `You can request up to ${money(credit)}` : null)
	const valid = amt > 0 && amt <= credit && f.reason.trim().length >= 5
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Request a refund"
			subtitle={`Available credit ${money(credit)}`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button icon={HandCoins} disabled={!valid} loading={act.isPending} onClick={() => act.mutate({ ...f, amount: amt, account_details: f.account_details || phone })}>
						Submit request
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Input
					label="Amount"
					type="number"
					inputMode="decimal"
					min={1}
					max={credit}
					value={f.amount}
					onChange={set("amount")}
					error={err}
					hint={
						<button type="button" className="link" onClick={() => setF((x) => ({ ...x, amount: String(credit) }))}>
							Use full credit
						</button>
					}
					required
				/>
				<Select label="Refund via" value={f.refund_mode} onChange={set("refund_mode")} options={REFUND_MODES} />
				<Input
					label={f.refund_mode === "M-Pesa" ? "M-Pesa number" : f.refund_mode === "Bank Transfer" ? "Bank, branch and account number" : "Payee details"}
					value={f.account_details}
					onChange={set("account_details")}
					placeholder={f.refund_mode === "M-Pesa" ? phone || "07XX XXX XXX" : ""}
				/>
				<Textarea label="Reason" rows={3} value={f.reason} onChange={set("reason")} required hint="e.g. overpayment, withdrawal, scholarship credit" />
			</div>
		</Modal>
	)
}

