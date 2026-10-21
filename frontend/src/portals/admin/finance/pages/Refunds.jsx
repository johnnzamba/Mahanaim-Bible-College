import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, HandCoins, Plus, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Input, Modal, PageHeader, Select, Textarea } from "@/shared/components/ui"
import { DataTable, Toolbar } from "@/shared/components/kit"
import { date, dateTime, money, num } from "@/shared/utils/format"
import { F, Pager, REFRESH, REFUND_MODES, REFUND_STATUSES, StudentLink, StudentPicker, today, useFinanceRole, usePaged } from "../lib"

const REFUND_TONE = { Pending: "orange", Approved: "blue", Rejected: "red", Paid: "green" }

export default function Refunds() {
	const { canWrite } = useFinanceRole()
	const [status, setStatus] = useState("")
	const list = usePaged(`${F}list_refunds`, { status })
	const counts = useApi(`${F}list_refunds`, { status: "Pending", page_length: 1 })
	const approved = useApi(`${F}list_refunds`, { status: "Approved", page_length: 1 })
	const [creating, setCreating] = useState(false)
	const [deciding, setDeciding] = useState(null)

	return (
		<div>
			<PageHeader
				eyebrow="Finance"
				title="Refunds"
				subtitle="Refunds pay back a student's credit balance. Requests are approved, then marked paid once the money has gone out."
				back={{ to: "/admin/finance", label: "Finance overview" }}
				actions={canWrite ? <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New refund request</Button> : null}
			/>
			<Toolbar
				chips={[
					{ id: "", label: "All" },
					...REFUND_STATUSES.map((s) => ({ id: s, label: s, count: s === "Pending" ? counts.data?.total : s === "Approved" ? approved.data?.total : undefined })),
				]}
				active={status}
				onChip={setStatus}
				right={<span className="text-xs text-ink-soft">{num(list.total)} requests</span>}
			/>
			<DataTable
				query={list.query}
				empty={status === "Pending" ? "No refunds waiting for a decision" : "No refund requests yet"}
				emptyIcon={HandCoins}
				onRow={canWrite ? (r) => ["Pending", "Approved"].includes(r.status) && setDeciding(r) : undefined}
				cols={[
					{ key: "name", label: "Request", render: (r) => (
						<span>
							<span className="block whitespace-nowrap font-semibold text-ink">{r.name}</span>
							<span className="block text-xs text-ink-soft">{date(r.creation)}</span>
						</span>
					) },
					{ key: "student", label: "Student", render: (r) => <StudentLink id={r.student} name={r.student_name} /> },
					{ key: "refund_mode", label: "Pay by", hideOnMobile: true, render: (r) => (
						<span className="text-xs">
							<span className="block font-medium text-ink">{r.refund_mode || "—"}</span>
							<span className="block max-w-[12rem] truncate text-ink-soft">{r.account_details}</span>
						</span>
					) },
					{ key: "reason", label: "Reason", hideOnMobile: true, render: (r) => <span className="line-clamp-2 max-w-[16rem] text-xs text-ink-muted">{r.reason || "—"}</span> },
					{ key: "status", label: "Status", render: (r) => (
						<span>
							<Badge tone={REFUND_TONE[r.status]}>{r.status}</Badge>
							<span className="mt-0.5 block text-[11px] text-ink-soft">
								{r.status === "Paid" ? `${date(r.paid_on)}${r.reference_no ? ` · ${r.reference_no}` : ""}` : r.approved_on ? `${r.status === "Rejected" ? "Rejected" : "Approved"} ${date(r.approved_on)}` : ""}
							</span>
						</span>
					) },
					{ key: "amount", label: "Amount", align: "right", render: (r) => <b>{money(r.amount)}</b> },
					...(canWrite
						? [{ key: "_act", label: "", align: "right", render: (r) => (["Pending", "Approved"].includes(r.status) ? (
							<Button size="sm" variant={r.status === "Approved" ? "primary" : "secondary"} onClick={(e) => { e.stopPropagation(); setDeciding(r) }}>
								{r.status === "Approved" ? "Mark paid" : "Decide"}
							</Button>
						) : null) }]
						: []),
				]}
			/>
			<Pager list={list} />
			{canWrite ? (
				<>
					<NewRefund open={creating} onClose={() => setCreating(false)} />
					<Decide refund={deciding} onClose={() => setDeciding(null)} />
				</>
			) : null}
		</div>
	)
}

function NewRefund({ open, onClose }) {
	const [student, setStudent] = useState(null)
	const [form, setForm] = useState({})
	const [errors, setErrors] = useState({})
	const account = useApi(`${F}student_account`, { student: student?.name }, { enabled: open && Boolean(student) })
	const save = useAction(`${F}save_refund`, { invalidate: REFRESH, success: (d) => `Refund request ${d.name} created` })
	useEffect(() => {
		if (open) {
			setStudent(null)
			setForm({ amount: "", payment: "", refund_mode: "M-Pesa", account_details: "", reason: "" })
			setErrors({})
		}
	}, [open])
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const credit = account.data ? Math.max(0, -Number(account.data.balance || 0)) : null
	const payments = useMemo(() => (account.data?.payments || []).map((p) => ({ value: p.name, label: `${p.name} · ${money(p.amount)} · ${date(p.posting_date)}` })), [account.data])

	const go = () => {
		const e = {}
		if (!student) e.student = "Choose a student"
		if (!(Number(form.amount) > 0)) e.amount = "Enter the amount to refund"
		else if (credit != null && Number(form.amount) > credit) e.amount = `The student only has ${money(credit)} in credit`
		if (!form.reason.trim()) e.reason = "Give a reason"
		setErrors(e)
		if (Object.keys(e).length) return
		save.mutate({ data: { ...form, student: student.name, amount: Number(form.amount), payment: form.payment || undefined } }, { onSuccess: onClose })
	}
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="New refund request"
			subtitle="Refunds can only come from a credit balance (overpayment)."
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
					<Button onClick={go} loading={save.isPending}>Create request</Button>
				</>
			}
		>
			<div className="space-y-4">
				<StudentPicker value={student} onChange={setStudent} required error={errors.student} />
				{student && account.data ? (
					<Alert tone={credit > 0 ? "success" : "warning"}>
						{credit > 0 ? `${student.full_name} has ${money(credit)} in credit available to refund.` : `${student.full_name} has no credit balance (owes ${money(account.data.balance)}), so nothing can be refunded.`}
					</Alert>
				) : null}
				<div className="grid gap-3 sm:grid-cols-2">
					<Input label="Amount" required type="number" min="0" step="0.01" value={form.amount} onChange={set("amount")} error={errors.amount} />
					<Select label="Refund by" value={form.refund_mode} onChange={set("refund_mode")} options={REFUND_MODES} />
				</div>
				<Input label={form.refund_mode === "M-Pesa" ? "M-Pesa number" : form.refund_mode === "Cash" ? "Collected by" : "Bank / account details"} value={form.account_details} onChange={set("account_details")} placeholder={form.refund_mode === "M-Pesa" ? "07XX XXX XXX" : form.refund_mode === "Bank Transfer" ? "Bank, branch, account no." : ""} />
				<Select label="Original payment (optional)" value={form.payment} onChange={set("payment")} placeholder={payments.length ? "Not linked" : "No payments"} options={payments} disabled={!payments.length} />
				<Textarea label="Reason" required rows={2} value={form.reason} onChange={set("reason")} error={errors.reason} placeholder="e.g. Overpaid term 1 fees; student withdrew" />
				{save.isError ? <Alert tone="error">{save.error?.message}</Alert> : null}
			</div>
		</Modal>
	)
}

function Decide({ refund, onClose }) {
	const [remarks, setRemarks] = useState("")
	const [ref, setRef] = useState("")
	const [paidOn, setPaidOn] = useState(today())
	const [err, setErr] = useState("")
	const act = useAction(`${F}decide_refund`, { invalidate: REFRESH, success: (d) => `${d.name} ${String(d.status).toLowerCase()}` })
	useEffect(() => {
		setRemarks("")
		setRef("")
		setPaidOn(today())
		setErr("")
	}, [refund])
	if (!refund) return null
	const approved = refund.status === "Approved"
	const decide = (decision) => {
		if (decision === "Paid" && refund.refund_mode !== "Cash" && !ref.trim()) return setErr("Enter the transaction reference")
		if (decision === "Rejected" && !remarks.trim()) return setErr("Say why it was rejected")
		act.mutate({ name: refund.name, decision, remarks: remarks.trim() || undefined, reference_no: ref.trim() || undefined, paid_on: decision === "Paid" ? paidOn : undefined }, { onSuccess: onClose })
	}
	return (
		<Modal
			open
			onClose={onClose}
			title={approved ? `Pay out ${refund.name}` : `Decide ${refund.name}`}
			subtitle={`${money(refund.amount)} to ${refund.student_name} by ${refund.refund_mode || "—"}`}
			footer={
				<>
					<Button variant="ghost" onClick={onClose} disabled={act.isPending}>Close</Button>
					<Button variant="danger" icon={XCircle} onClick={() => decide("Rejected")} loading={act.isPending && act.variables?.decision === "Rejected"}>Reject</Button>
					{approved ? (
						<Button icon={CheckCircle2} onClick={() => decide("Paid")} loading={act.isPending && act.variables?.decision === "Paid"}>Mark paid</Button>
					) : (
						<Button icon={CheckCircle2} onClick={() => decide("Approved")} loading={act.isPending && act.variables?.decision === "Approved"}>Approve</Button>
					)}
				</>
			}
		>
			<div className="space-y-4">
				<div className="rounded-xl bg-cream p-3 text-sm">
					<div className="font-medium text-ink">{refund.reason || "No reason given"}</div>
					{refund.account_details ? <div className="mt-1 text-xs text-ink-soft">Pay to: {refund.account_details}</div> : null}
					{refund.approved_on ? <div className="mt-1 text-xs text-ink-soft">Approved {dateTime(refund.approved_on)}{refund.approved_by ? ` by ${refund.approved_by}` : ""}</div> : null}
				</div>
				{approved ? (
					<div className="grid gap-3 sm:grid-cols-2">
						<Input label="Transaction reference" required={refund.refund_mode !== "Cash"} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={refund.refund_mode === "M-Pesa" ? "M-Pesa code" : "Transfer / cheque no."} />
						<Input label="Paid on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
					</div>
				) : null}
				<Textarea label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={approved ? "Optional" : "Required if rejecting"} />
				{err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
			</div>
		</Modal>
	)
}
