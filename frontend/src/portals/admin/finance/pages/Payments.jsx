import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Banknote, Plus, ReceiptText, Wand2 } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Input, Modal, PageHeader, RadioCards, Select, Textarea } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { DateRange, F, FilterSelect, MANUAL_MODES, PAYMENT_FOR, PAYMENT_MODES, Pager, REFRESH, StudentLink, StudentPicker, today, useFinanceRole, usePaged } from "../lib"

export default function Payments() {
	const { canWrite } = useFinanceRole()
	const [params, setParams] = useSearchParams()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [mode, setMode] = useState(params.get("mode") || "")
	const [paymentFor, setPaymentFor] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const q = useDebounced(search, 300)
	const list = usePaged(`${F}list_payments`, { search: q, status, mode_of_payment: mode, payment_for: paymentFor, from_date: from, to_date: to })
	const open = params.get("new") === "1"
	const close = () => {
		const next = new URLSearchParams(params)
		for (const k of ["new", "student", "invoice"]) next.delete(k)
		setParams(next, { replace: true })
	}
	const pageTotal = list.rows.filter((r) => r.status !== "Cancelled").reduce((a, r) => a + Number(r.amount || 0), 0)

	return (
		<div>
			<PageHeader
				eyebrow="Finance"
				title="Payments"
				subtitle="Receipts from M-Pesa, bank, cash and cheque. Payments are applied to the oldest open invoices unless you allocate them."
				back={{ to: "/admin/finance", label: "Finance overview" }}
				actions={
					canWrite ? (
						<Button size="sm" icon={Plus} onClick={() => setParams({ new: "1" }, { replace: true })}>
							Record payment
						</Button>
					) : null
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search receipt, payer, reference…"
				chips={[
					{ id: "", label: "All" },
					{ id: "Confirmed", label: "Confirmed" },
					{ id: "Cancelled", label: "Cancelled" },
				]}
				active={status}
				onChip={setStatus}
			/>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<FilterSelect value={mode} onChange={setMode} options={PAYMENT_MODES} placeholder="All modes" />
				<FilterSelect value={paymentFor} onChange={setPaymentFor} options={PAYMENT_FOR} placeholder="Any purpose" />
				<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
				<span className="text-xs text-ink-soft lg:ml-auto">
					{num(list.total)} payments{list.rows.length ? ` · ${money(pageTotal)} on this page` : ""}
				</span>
			</div>
			<DataTable
				query={list.query}
				rowTo={(r) => `/admin/finance/payments/${encodeURIComponent(r.name)}`}
				empty="No payments match these filters"
				emptyIcon={ReceiptText}
				cols={[
					{ key: "name", label: "Receipt", render: (r) => (
						<span>
							<span className="block whitespace-nowrap font-semibold text-ink">{r.name}</span>
							<span className="block text-xs text-ink-soft">{date(r.posting_date)}</span>
						</span>
					) },
					{ key: "payer_name", label: "Student / payer", render: (r) => (r.student ? <StudentLink id={r.student} name={r.payer_name} inRow /> : <span className="font-medium text-ink">{r.payer_name || r.programme_application || "—"}</span>) },
					{ key: "payment_for", label: "For", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap">{r.payment_for}</span> },
					{ key: "mode_of_payment", label: "Mode", render: (r) => (
						<span>
							<span className="block">{r.mode_of_payment}</span>
							{r.reference_no ? <span className="block font-mono text-[11px] text-ink-soft">{r.reference_no}</span> : null}
						</span>
					) },
					{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					{ key: "unallocated_amount", label: "Unallocated", align: "right", hideOnMobile: true, render: (r) => (r.unallocated_amount > 0 ? <span className="whitespace-nowrap text-amber-700">{money(r.unallocated_amount)}</span> : <span className="text-ink-soft">—</span>) },
					{ key: "amount", label: "Amount", align: "right", render: (r) => <span className={r.status === "Cancelled" ? "whitespace-nowrap text-ink-soft line-through" : "whitespace-nowrap font-semibold"}>{money(r.amount)}</span>, sortValue: (r) => r.amount },
				]}
			/>
			<Pager list={list} />
			{canWrite ? <RecordPayment open={open} onClose={close} studentId={params.get("student")} invoice={params.get("invoice")} /> : null}
		</div>
	)
}

function useOpenInvoices(student) {
	const q = useApi(`${F}list_invoices`, { student, page_length: 100 }, { enabled: Boolean(student) })
	return { query: q, rows: useMemo(() => (q.data?.data || []).filter((i) => i.docstatus === 1 && i.outstanding_amount > 0).sort((a, b) => String(a.posting_date).localeCompare(String(b.posting_date))), [q.data]) }
}

export function RecordPayment({ open, onClose, studentId, invoice }) {
	const nav = useNavigate()
	const blank = { payment_for: "Student Fees", mode_of_payment: "Cash", amount: "", reference_no: "", reference_date: "", posting_date: today(), payer_name: "", msisdn: "", remarks: "", programme_application: "" }
	const [student, setStudent] = useState(null)
	const [form, setForm] = useState(blank)
	const [allocMode, setAllocMode] = useState("auto")
	const [alloc, setAlloc] = useState({})
	const [errors, setErrors] = useState({})
	const preset = useApi(`${F}student_account`, { student: studentId }, { enabled: open && Boolean(studentId) && !student })
	const invoices = useOpenInvoices(form.payment_for === "Student Fees" ? student?.name : null)
	const record = useAction(`${F}record_payment`, { invalidate: REFRESH })

	useEffect(() => {
		if (open) {
			setStudent(null)
			setForm({ ...blank, posting_date: today() })
			setAllocMode(invoice ? "manual" : "auto")
			setAlloc({})
			setErrors({})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])
	useEffect(() => {
		const s = preset.data?.student || preset.data
		if (open && studentId && s && !student) setStudent({ name: studentId, full_name: s.full_name || s.student_name, student_number: s.student_number, programme: s.programme })
	}, [preset.data, open, studentId, student])
	useEffect(() => {
		if (invoice && invoices.rows.length) {
			const inv = invoices.rows.find((i) => i.name === invoice)
			if (inv) {
				setAlloc({ [inv.name]: String(inv.outstanding_amount) })
				setForm((f) => ({ ...f, amount: f.amount || String(inv.outstanding_amount) }))
			}
		}
	}, [invoice, invoices.rows])

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const amount = Number(form.amount || 0)
	const allocated = Object.values(alloc).reduce((a, v) => a + Number(v || 0), 0)
	const owed = invoices.rows.reduce((a, i) => a + Number(i.outstanding_amount || 0), 0)
	const fees = form.payment_for === "Student Fees"
	const needsRef = ["M-Pesa", "Bank Deposit", "Bank Transfer", "Cheque"].includes(form.mode_of_payment)

	const autoFill = () => {
		let left = amount
		const next = {}
		for (const i of invoices.rows) {
			if (left <= 0) break
			const take = Math.min(left, Number(i.outstanding_amount))
			next[i.name] = String(Math.round(take * 100) / 100)
			left -= take
		}
		setAlloc(next)
	}

	const save = () => {
		const e = {}
		if (fees && !student) e.student = "Choose the student who paid"
		if (form.payment_for === "Application Fee" && !form.programme_application.trim()) e.programme_application = "Enter the application number"
		if (!(amount > 0)) e.amount = "Enter the amount received"
		if (needsRef && !form.reference_no.trim()) e.reference_no = `Enter the ${form.mode_of_payment} reference`
		if (!fees && !student && !form.payer_name.trim() && form.payment_for === "Other") e.payer_name = "Who paid?"
		if (fees && allocMode === "manual") {
			if (allocated > amount + 0.001) e.alloc = `You've allocated ${money(allocated)}, more than the ${money(amount)} received`
			const over = invoices.rows.find((i) => Number(alloc[i.name] || 0) > Number(i.outstanding_amount) + 0.001)
			if (over) e.alloc = `${over.name} only has ${money(over.outstanding_amount)} outstanding`
		}
		setErrors(e)
		if (Object.keys(e).length) return
		const allocations = fees && allocMode === "manual" ? Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([inv, v]) => ({ invoice: inv, allocated_amount: Number(v) })) : undefined
		record.mutate(
			{
				data: {
					payment_for: form.payment_for,
					student: student?.name,
					programme_application: form.payment_for === "Application Fee" ? form.programme_application.trim() : undefined,
					mode_of_payment: form.mode_of_payment,
					amount,
					reference_no: form.reference_no.trim() || undefined,
					reference_date: form.reference_date || undefined,
					posting_date: form.posting_date || undefined,
					payer_name: form.payer_name.trim() || undefined,
					msisdn: form.msisdn.trim() || undefined,
					remarks: form.remarks.trim() || undefined,
					allocations,
				},
			},
			{
				onSuccess: (p) => {
					onClose()
					nav(`/admin/finance/payments/${encodeURIComponent(p.name)}`)
				},
			}
		)
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Record a payment"
			subtitle="For money received at the cashier or in the bank. M-Pesa payments arrive on their own."
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={record.isPending}>
						Cancel
					</Button>
					<Button icon={Banknote} onClick={save} loading={record.isPending}>
						Record {amount > 0 ? money(amount) : "payment"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-2">
					<Select label="Payment for" value={form.payment_for} onChange={set("payment_for")} options={PAYMENT_FOR} />
					<Select label="Mode of payment" value={form.mode_of_payment} onChange={set("mode_of_payment")} options={MANUAL_MODES} />
				</div>
				{form.payment_for === "Application Fee" ? (
					<Input label="Application number" required value={form.programme_application} onChange={set("programme_application")} error={errors.programme_application} placeholder="e.g. APP-2026-00012" />
				) : (
					<StudentPicker value={student} onChange={setStudent} required={fees} error={errors.student} label={fees ? "Student" : "Student (optional)"} />
				)}
				<div className="grid gap-3 sm:grid-cols-3">
					<Input label="Amount received" required type="number" min="0" step="0.01" value={form.amount} onChange={set("amount")} error={errors.amount} />
					<Input label={form.mode_of_payment === "Cheque" ? "Cheque number" : "Reference no."} required={needsRef} value={form.reference_no} onChange={set("reference_no")} error={errors.reference_no} placeholder={form.mode_of_payment === "Cash" ? "Optional" : form.mode_of_payment === "M-Pesa" ? "e.g. SGH7K2L9QP" : "Slip / transfer ref"} />
					<Input label="Date received" type="date" value={form.posting_date} onChange={set("posting_date")} />
				</div>
				<div className="grid gap-3 sm:grid-cols-3">
					{form.mode_of_payment === "Cheque" || form.mode_of_payment.startsWith("Bank") ? <Input label={form.mode_of_payment === "Cheque" ? "Cheque date" : "Bank date"} type="date" value={form.reference_date} onChange={set("reference_date")} /> : null}
					<Input label="Paid by" value={form.payer_name} onChange={set("payer_name")} error={errors.payer_name} placeholder={student ? student.full_name : "Name on the slip"} />
					{form.mode_of_payment === "M-Pesa" ? <Input label="Phone number" value={form.msisdn} onChange={set("msisdn")} placeholder="07XX XXX XXX" /> : null}
				</div>

				{fees && student ? (
					<div className="rounded-xl border border-line p-3">
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<div>
								<div className="text-sm font-semibold text-ink">Apply to invoices</div>
								<div className="text-xs text-ink-soft">{invoices.query.isLoading ? "Loading open invoices…" : invoices.rows.length ? `${invoices.rows.length} open invoice${invoices.rows.length === 1 ? "" : "s"} · ${money(owed)} owed` : "No open invoices; the payment stays on account as credit."}</div>
							</div>
						</div>
						{invoices.rows.length ? (
							<>
								<RadioCards
									value={allocMode}
									onChange={setAllocMode}
									options={[
										{ value: "auto", label: "Oldest first", description: "Clear the oldest balances automatically" },
										{ value: "manual", label: "Choose invoices", description: "Split the amount yourself" },
									]}
								/>
								{allocMode === "manual" ? (
									<div className="mt-3 space-y-2">
										{invoices.rows.map((i) => (
											<div key={i.name} className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3">
												<div className="min-w-0 text-sm">
													<div className="truncate font-medium text-ink">{i.name}</div>
													<div className="truncate text-xs text-ink-soft">
														{i.academic_term || "No term"} · due {date(i.due_date)} · {money(i.outstanding_amount)} owed
													</div>
												</div>
												<input className="input text-right" type="number" min="0" step="0.01" aria-label={`Allocate to ${i.name}`} value={alloc[i.name] || ""} onChange={(e) => setAlloc((a) => ({ ...a, [i.name]: e.target.value }))} placeholder="0" />
											</div>
										))}
										<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
											<Button variant="ghost" size="sm" icon={Wand2} onClick={autoFill} disabled={!(amount > 0)}>
												Fill oldest first
											</Button>
											<span className="text-ink-soft">
												Allocated <b className="text-ink">{money(allocated)}</b> · left on account <b className={amount - allocated < 0 ? "text-red-600" : "text-ink"}>{money(Math.max(0, amount - allocated))}</b>
											</span>
										</div>
										{errors.alloc ? <p className="text-xs font-medium text-red-600">{errors.alloc}</p> : null}
									</div>
								) : null}
							</>
						) : null}
					</div>
				) : null}
				{!fees ? <Alert tone="info">Only student fee payments are applied to invoices.</Alert> : null}
				<Textarea label="Remarks" rows={2} value={form.remarks} onChange={set("remarks")} placeholder="Optional note kept with the receipt" />
			</div>
		</Modal>
	)
}
