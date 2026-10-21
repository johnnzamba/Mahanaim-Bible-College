import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Ban, CheckCircle2, Plus, Scale } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Input, Modal, PageHeader, Select, Textarea } from "@/shared/components/ui"
import { DataTable, Toolbar } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { ADJUSTMENT_TYPES, CREDIT_TYPES, DEBIT_TYPES, DateRange, F, FilterSelect, Pager, REFRESH, StudentLink, StudentPicker, today, useFinanceRole, useOptions, usePaged } from "../lib"

const DOCSTATUS = { 0: "Draft", 1: "Submitted", 2: "Cancelled" }

export default function Adjustments() {
	const { canWrite } = useFinanceRole()
	const [params, setParams] = useSearchParams()
	const [type, setType] = useState("")
	const [docstatus, setDocstatus] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const student = params.get("student") || ""
	const list = usePaged(`${F}list_adjustments`, { adjustment_type: type, docstatus, from_date: from, to_date: to, student })
	const [edit, setEdit] = useState(params.get("new") === "1" ? {} : null)
	const [cancelRow, setCancelRow] = useState(null)
	const [reason, setReason] = useState("")
	const submit = useAction(`${F}submit_adjustment`, { invalidate: REFRESH, success: "Adjustment submitted and posted to the ledger" })
	const cancel = useAction(`${F}cancel_adjustment`, { invalidate: REFRESH, success: "Adjustment cancelled" })

	return (
		<div>
			<PageHeader
				eyebrow="Finance"
				title="Fee adjustments"
				subtitle="Scholarships, bursaries, waivers and discounts reduce what a student owes; penalties add to it. Each posts to the ledger when submitted."
				back={{ to: "/admin/finance", label: "Finance overview" }}
				actions={canWrite ? <Button size="sm" icon={Plus} onClick={() => setEdit({})}>New adjustment</Button> : null}
			/>
			<Toolbar
				chips={[
					{ id: "", label: "All" },
					{ id: "0", label: "Drafts" },
					{ id: "1", label: "Submitted" },
					{ id: "2", label: "Cancelled" },
				]}
				active={docstatus}
				onChip={setDocstatus}
			/>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<FilterSelect value={type} onChange={setType} options={ADJUSTMENT_TYPES} placeholder="All types" />
				<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
				{student ? (
					<Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
						Student: {student} ✕
					</Button>
				) : null}
				<span className="text-xs text-ink-soft lg:ml-auto">{num(list.total)} adjustments</span>
			</div>
			<DataTable
				query={list.query}
				empty="No adjustments match these filters"
				emptyIcon={Scale}
				onRow={canWrite ? (r) => r.docstatus === 0 && setEdit(r) : undefined}
				cols={[
					{ key: "name", label: "Adjustment", render: (r) => (
						<span>
							<span className="block whitespace-nowrap font-semibold text-ink">{r.name}</span>
							<span className="block text-xs text-ink-soft">{date(r.posting_date)}</span>
						</span>
					) },
					{ key: "student", label: "Student", render: (r) => <StudentLink id={r.student} name={r.student_name} /> },
					{ key: "adjustment_type", label: "Type", render: (r) => (
						<span>
							<Badge tone={CREDIT_TYPES.includes(r.adjustment_type) ? "green" : "red"}>{r.adjustment_type}</Badge>
							{r.scholarship || r.sponsor ? <span className="mt-0.5 block text-[11px] text-ink-soft">{r.scholarship || r.sponsor}</span> : null}
						</span>
					) },
					{ key: "invoice", label: "Invoice / term", hideOnMobile: true, render: (r) => (
						<span className="text-xs">
							<span className="block">{r.invoice || "Account"}</span>
							<span className="block text-ink-soft">{r.academic_term}</span>
						</span>
					) },
					{ key: "reason", label: "Reason", hideOnMobile: true, render: (r) => <span className="line-clamp-2 max-w-[16rem] text-xs text-ink-muted">{r.reason || "—"}</span> },
					{ key: "docstatus", label: "Status", render: (r) => <Badge tone={["orange", "green", "red"][r.docstatus]}>{DOCSTATUS[r.docstatus]}</Badge> },
					{ key: "amount", label: "Amount", align: "right", render: (r) => <b className={CREDIT_TYPES.includes(r.adjustment_type) ? "text-emerald-700" : "text-red-700"}>{CREDIT_TYPES.includes(r.adjustment_type) ? "−" : "+"}{money(r.amount)}</b> },
					...(canWrite
						? [{ key: "_act", label: "", align: "right", render: (r) => (
							r.docstatus === 0 ? (
								<Button size="sm" variant="secondary" icon={CheckCircle2} loading={submit.isPending && submit.variables?.name === r.name} onClick={(e) => { e.stopPropagation(); submit.mutate({ name: r.name }) }}>
									Submit
								</Button>
							) : r.docstatus === 1 ? (
								<Button size="sm" variant="ghost" icon={Ban} onClick={(e) => { e.stopPropagation(); setCancelRow(r) }}>
									Cancel
								</Button>
							) : null
						) }]
						: []),
				]}
			/>
			<Pager list={list} />
			{canWrite ? <AdjustmentModal value={edit} onClose={() => setEdit(null)} /> : null}
			<ConfirmDialog
				open={Boolean(cancelRow)}
				onClose={() => { setCancelRow(null); setReason("") }}
				tone="danger"
				title={`Cancel ${cancelRow?.name || ""}?`}
				confirmLabel="Cancel adjustment"
				loading={cancel.isPending}
				onConfirm={() => cancel.mutate({ name: cancelRow.name, reason: reason.trim() || undefined }, { onSuccess: () => { setCancelRow(null); setReason("") } })}
			>
				<p className="mb-3 text-sm text-ink-soft">
					The {cancelRow?.adjustment_type?.toLowerCase()} of {money(cancelRow?.amount)} for {cancelRow?.student_name} is reversed in the ledger.
				</p>
				<Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being cancelled?" />
			</ConfirmDialog>
		</div>
	)
}

function AdjustmentModal({ value, onClose }) {
	const open = Boolean(value)
	const opts = useOptions()
	const [student, setStudent] = useState(null)
	const [form, setForm] = useState({})
	const [submitNow, setSubmitNow] = useState(false)
	const [errors, setErrors] = useState({})
	const save = useAction(`${F}save_adjustment`, { invalidate: REFRESH, success: (d) => (d.docstatus === 1 ? `${d.name} submitted` : `${d.name} saved as draft`) })
	const invoices = useApi(`${F}list_invoices`, { student: student?.name, page_length: 100 }, { enabled: open && Boolean(student) })
	const scholarships = useApi(`${F}list_scholarships`, { is_active: 1, page_length: 200 }, { enabled: open })
	const openInvoices = useMemo(() => (invoices.data?.data || []).filter((i) => i.docstatus === 1 && i.outstanding_amount > 0), [invoices.data])

	useEffect(() => {
		if (!open) return
		setStudent(value.student ? { name: value.student, full_name: value.student_name } : null)
		setForm({
			name: value.name,
			adjustment_type: value.adjustment_type || "Waiver",
			amount: value.amount ? String(value.amount) : "",
			posting_date: value.posting_date || today(),
			invoice: value.invoice || "",
			academic_term: value.academic_term || opts.currentTerm || "",
			scholarship: value.scholarship || "",
			sponsor: value.sponsor || "",
			reason: value.reason || "",
		})
		setSubmitNow(false)
		setErrors({})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value])

	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const credit = CREDIT_TYPES.includes(form.adjustment_type)
	const usesScholarship = ["Scholarship", "Bursary"].includes(form.adjustment_type)
	const inv = openInvoices.find((i) => i.name === form.invoice)
	const sch = (scholarships.data?.data || []).find((s) => s.name === form.scholarship)

	const go = () => {
		const e = {}
		if (!student) e.student = "Choose a student"
		if (!(Number(form.amount) > 0) && !(usesScholarship && form.scholarship)) e.amount = "Enter an amount"
		if (credit && inv && Number(form.amount) > inv.outstanding_amount) e.amount = `Only ${money(inv.outstanding_amount)} is outstanding on ${inv.name}`
		if (form.adjustment_type === "Sponsor Credit" && !form.sponsor.trim()) e.sponsor = "Enter the sponsor ID"
		if (!form.reason.trim()) e.reason = "Explain why, for the audit trail"
		setErrors(e)
		if (Object.keys(e).length) return
		save.mutate(
			{
				data: {
					...form,
					student: student.name,
					amount: form.amount ? Number(form.amount) : undefined,
					invoice: form.invoice || undefined,
					scholarship: usesScholarship ? form.scholarship || undefined : undefined,
					sponsor: form.sponsor.trim() || undefined,
					academic_term: form.academic_term || undefined,
					submit: submitNow ? 1 : 0,
				},
			},
			{ onSuccess: onClose }
		)
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title={form.name ? `Edit ${form.name}` : "New fee adjustment"}
			subtitle={credit ? "A credit reduces the student's balance." : "A debit increases the student's balance."}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
					<Button onClick={go} loading={save.isPending} icon={submitNow ? CheckCircle2 : undefined}>{submitNow ? "Save & submit" : "Save draft"}</Button>
				</>
			}
		>
			{open ? (
				<div className="space-y-4">
					<StudentPicker value={student} onChange={(s) => { setStudent(s); setForm((f) => ({ ...f, invoice: "" })) }} required error={errors.student} />
					<div className="grid gap-3 sm:grid-cols-2">
						<Select label="Type" value={form.adjustment_type} onChange={set("adjustment_type")}>
							<optgroup label="Credits (reduce the balance)">
								{CREDIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
							</optgroup>
							<optgroup label="Debits (add to the balance)">
								{DEBIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
							</optgroup>
						</Select>
						<Input label="Amount" type="number" min="0" step="0.01" required={!usesScholarship} value={form.amount} onChange={set("amount")} error={errors.amount} hint={usesScholarship && form.scholarship ? "Leave blank to use the scholarship's amount" : inv ? `${money(inv.outstanding_amount)} outstanding on this invoice` : undefined} />
					</div>
					{usesScholarship ? (
						<Select label="Scholarship" value={form.scholarship} onChange={set("scholarship")} placeholder="Not linked to a scholarship" options={(scholarships.data?.data || []).map((s) => ({ value: s.name, label: `${s.scholarship_name}${s.amount_type === "Percentage" ? ` (${s.percentage}%)` : s.amount ? ` (${money(s.amount)})` : ""}` }))} hint={sch && sch.total_budget ? `${money(sch.total_budget - (sch.utilised_amount || 0))} of ${money(sch.total_budget)} budget left` : undefined} />
					) : null}
					{form.adjustment_type === "Sponsor Credit" ? <Input label="Sponsor ID" required value={form.sponsor} onChange={set("sponsor")} error={errors.sponsor} placeholder="e.g. SPN-0001" /> : null}
					<div className="grid gap-3 sm:grid-cols-3">
						<Select label="Apply to invoice" value={form.invoice} onChange={set("invoice")} placeholder={student ? (openInvoices.length ? "Student account (no invoice)" : "No open invoices") : "Choose a student first"} options={openInvoices.map((i) => ({ value: i.name, label: `${i.name} · ${money(i.outstanding_amount)}` }))} disabled={!student} />
						<Select label="Term" value={form.academic_term} onChange={set("academic_term")} placeholder="Current term" options={opts.terms} />
						<Input label="Posting date" type="date" value={form.posting_date} onChange={set("posting_date")} />
					</div>
					<Textarea label="Reason" required rows={2} value={form.reason} onChange={set("reason")} error={errors.reason} placeholder={credit ? "e.g. Hardship waiver approved by the Principal" : "e.g. Late registration penalty"} />
					<Checkbox checked={submitNow} onChange={(e) => setSubmitNow(Boolean(e))} label="Submit now" description="Post it to the ledger immediately. Drafts can be reviewed and submitted later." />
					{save.isError ? <Alert tone="error">{save.error?.message}</Alert> : null}
				</div>
			) : null}
		</Modal>
	)
}
