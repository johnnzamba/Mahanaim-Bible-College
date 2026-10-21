import { useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Ban, Banknote, CheckCircle2, Download, FileText, Printer, ReceiptText, UserRound } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, ConfirmDialog, ErrorState, KeyValueGrid, PageHeader, Panel, SkeletonRows, StatCard, Tabs, Textarea } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, dateTime, money } from "@/shared/utils/format"
import { F, REFRESH, useFinanceRole } from "../lib"

export default function InvoiceDetail() {
	const { name } = useParams()
	const q = useApi(`${F}get_invoice`, { name })
	if (q.isLoading) {
		return (
			<div className="card p-5">
				<SkeletonRows rows={8} />
			</div>
		)
	}
	if (q.isError) {
		return (
			<>
				<PageHeader title={name} back={{ to: "/admin/finance/invoices", label: "Invoices" }} />
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't open this invoice" />
				</div>
			</>
		)
	}
	return <Invoice inv={q.data} />
}

function Invoice({ inv }) {
	const nav = useNavigate()
	const { canWrite } = useFinanceRole()
	const [tab, setTab] = useState("lines")
	const [cancelOpen, setCancelOpen] = useState(false)
	const [submitOpen, setSubmitOpen] = useState(false)
	const [reason, setReason] = useState("")
	const submit = useAction(`${F}submit_invoice`, { invalidate: REFRESH, success: "Invoice submitted and posted to the student's account", onSuccess: () => setSubmitOpen(false) })
	const cancel = useAction(`${F}cancel_invoice`, {
		invalidate: REFRESH,
		success: "Invoice cancelled",
		onSuccess: () => {
			setCancelOpen(false)
			setReason("")
		},
	})
	const pdf = frappe.downloadUrl(`${F}download`, { doctype: "invoice", name: inv.name })
	const html = frappe.downloadUrl(`${F}download`, { doctype: "invoice", name: inv.name, format: "html" })
	const draft = inv.docstatus === 0
	const live = inv.docstatus === 1
	const items = inv.items || []
	const payments = inv.payments || []
	const adjustments = inv.adjustments || []
	const installments = inv.installments || []

	return (
		<div className="space-y-5">
			<PageHeader
				eyebrow="Invoice"
				title={inv.name}
				back={{ to: "/admin/finance/invoices", label: "Invoices" }}
				actions={
					<>
						{live || inv.docstatus === 2 ? (
							<>
								<a href={html} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
									<Printer size={14} /> Print
								</a>
								<a href={pdf} className="btn btn-secondary btn-sm">
									<Download size={14} /> PDF
								</a>
							</>
						) : null}
						{canWrite && live ? (
							<Button variant="ghost" size="sm" icon={Ban} className="text-red-600" onClick={() => setCancelOpen(true)}>
								Cancel invoice
							</Button>
						) : null}
						{canWrite && live && inv.outstanding_amount > 0 ? (
							<Button size="sm" icon={Banknote} onClick={() => nav(`/admin/finance/payments?new=1&student=${encodeURIComponent(inv.student)}&invoice=${encodeURIComponent(inv.name)}`)}>
								Record payment
							</Button>
						) : null}
						{canWrite && draft ? (
							<Button size="sm" icon={CheckCircle2} onClick={() => setSubmitOpen(true)}>
								Submit invoice
							</Button>
						) : null}
					</>
				}
			>
				<div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
					<Badge status={inv.status} dot />
					<Link to={`/admin/finance/students/${encodeURIComponent(inv.student)}`} className="inline-flex items-center gap-1 font-medium text-ink hover:text-brand-700">
						<UserRound size={14} /> {inv.student_name || inv.student}
					</Link>
					<span className="text-ink-soft">{inv.student_number || inv.student}</span>
					{inv.academic_term ? <span className="text-ink-soft">· {inv.academic_term}</span> : null}
				</div>
			</PageHeader>

			{draft ? (
				<Alert tone="warning" title="Draft invoice">
					It isn't on the student's account yet. Check the lines, then submit it to bill the student.
				</Alert>
			) : null}
			{inv.docstatus === 2 ? <Alert tone="error" title="This invoice was cancelled">Its charges were reversed from the student's account.</Alert> : null}

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Invoice total" value={money(inv.total_amount)} icon={FileText} tone="brand" hint={`${items.length} fee line${items.length === 1 ? "" : "s"}`} />
				<StatCard label="Paid" value={money(inv.paid_amount)} icon={ReceiptText} tone="green" hint={`${payments.length} payment${payments.length === 1 ? "" : "s"}`} />
				<StatCard label="Credits applied" value={money(inv.credit_applied)} icon={CheckCircle2} tone="purple" hint={adjustments.length ? `${adjustments.length} adjustment${adjustments.length === 1 ? "" : "s"}` : "none"} />
				<StatCard label="Balance due" value={money(inv.outstanding_amount)} icon={Banknote} tone={inv.outstanding_amount > 0 ? "orange" : "green"} hint={inv.due_date ? `due ${date(inv.due_date)}` : null} />
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<div className="min-w-0 space-y-4 lg:col-span-2">
					<Tabs
						className="overflow-y-hidden"
						active={tab}
						onChange={setTab}
						tabs={[
							{ id: "lines", label: "Fee lines", count: items.length },
							installments.length ? { id: "installments", label: "Instalments", count: installments.length } : null,
							{ id: "payments", label: "Payments", count: payments.length },
							{ id: "adjustments", label: "Adjustments", count: adjustments.length },
							{ id: "ledger", label: "Ledger" },
						].filter(Boolean)}
					/>
					{tab === "lines" ? (
						<DataTable
							rows={items}
							noCards
							dense
							footer={
								<div className="flex justify-between text-sm font-semibold">
									<span>Total</span>
									<span>{money(inv.total_amount)}</span>
								</div>
							}
							cols={[
								{ key: "fee_component", label: "Fee component", render: (r) => <span className="font-medium text-ink">{r.fee_component}</span> },
								{ key: "description", label: "Description", render: (r) => r.description || "—" },
								{ key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount) },
							]}
						/>
					) : tab === "installments" ? (
						<DataTable
							rows={installments}
							dense
							cols={[
								{ key: "label", label: "Instalment", render: (r) => <span className="font-medium text-ink">{r.label || `Instalment ${r.idx}`}</span> },
								{ key: "due_date", label: "Due", render: (r) => date(r.due_date) },
								{ key: "status", label: "Status", render: (r) => (r.status ? <Badge status={r.status} /> : "—") },
								{ key: "paid_amount", label: "Paid", align: "right", render: (r) => money(r.paid_amount) },
								{ key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount) },
							]}
						/>
					) : tab === "payments" ? (
						<DataTable
							rows={payments}
							dense
							empty="No payments allocated to this invoice yet"
							rowTo={(r) => `/admin/finance/payments/${encodeURIComponent(r.name)}`}
							cols={[
								{ key: "name", label: "Receipt", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
								{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date) },
								{ key: "mode_of_payment", label: "Mode" },
								{ key: "reference_no", label: "Reference", hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.reference_no || "—"}</span> },
								{ key: "allocated_amount", label: "Allocated", align: "right", render: (r) => money(r.allocated_amount) },
							]}
						/>
					) : tab === "adjustments" ? (
						<DataTable
							rows={adjustments}
							dense
							empty="No waivers, scholarships or penalties on this invoice"
							cols={[
								{ key: "adjustment_type", label: "Type", render: (r) => <Badge tone={["Penalty", "Correction Debit"].includes(r.adjustment_type) ? "red" : "purple"}>{r.adjustment_type}</Badge> },
								{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date) },
								{ key: "reason", label: "Reason", render: (r) => r.reason || "—" },
								{ key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount) },
							]}
						/>
					) : (
						<LedgerExcerpt inv={inv} />
					)}
				</div>
				<Panel title="Details" icon={FileText}>
					<KeyValueGrid
						cols={1}
						items={[
							{ label: "Student", value: <Link className="text-brand-700 hover:underline" to={`/admin/students/${encodeURIComponent(inv.student)}`}>{inv.student_name || inv.student}</Link> },
							{ label: "Programme", value: inv.programme },
							{ label: "Campus", value: inv.campus },
							{ label: "Academic term", value: inv.academic_term },
							{ label: "Invoice date", value: date(inv.posting_date) },
							{ label: "Due date", value: date(inv.due_date) },
							{ label: "Fee structure", value: inv.fee_structure ? <Link className="text-brand-700 hover:underline" to={`/admin/finance/setup/structures/${encodeURIComponent(inv.fee_structure)}`}>{inv.fee_structure}</Link> : "Itemised" },
							inv.remarks ? { label: "Remarks", value: inv.remarks } : null,
							{ label: "Student's account balance", value: <span className={inv.balance > 0 ? "text-amber-700" : "text-emerald-700"}>{money(inv.balance)}</span> },
							{ label: "Last updated", value: dateTime(inv.modified) },
						]}
					/>
				</Panel>
			</div>

			<ConfirmDialog
				open={submitOpen}
				onClose={() => setSubmitOpen(false)}
				title="Submit this invoice?"
				message={`${inv.student_name || inv.student} will be billed ${money(inv.total_amount)}. Once submitted the invoice can only be cancelled, not edited.`}
				confirmLabel="Submit invoice"
				loading={submit.isPending}
				onConfirm={() => submit.mutate({ name: inv.name })}
			/>
			<ConfirmDialog
				open={cancelOpen}
				onClose={() => setCancelOpen(false)}
				title="Cancel this invoice?"
				tone="danger"
				confirmLabel="Cancel invoice"
				loading={cancel.isPending}
				onConfirm={() => cancel.mutate({ name: inv.name, reason: reason.trim() || undefined })}
				message={`The ${money(inv.total_amount)} charge is reversed from ${inv.student_name || inv.student}'s account. Payments already allocated must be cancelled or re-allocated first.`}
			>
				<Textarea className="mt-3" label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Raised against the wrong term" />
			</ConfirmDialog>
		</div>
	)
}

function LedgerExcerpt({ inv }) {
	const q = useApi(`${F}student_statement`, { student: inv.student })
	const related = useMemo(() => {
		const ids = new Set([inv.name, ...(inv.payments || []).map((p) => p.name), ...(inv.adjustments || []).map((a) => a.name)])
		return (q.data?.lines || []).filter((l) => ids.has(l.voucher_no))
	}, [q.data, inv])
	return (
		<div className="space-y-2">
			<DataTable
				query={q}
				rows={q.data ? related : undefined}
				dense
				noCards
				empty="No ledger entries for this invoice yet"
				cols={[
					{ key: "date", label: "Date", render: (r) => date(r.date) },
					{ key: "voucher_no", label: "Entry", render: (r) => (
						<span>
							<span className="block font-medium text-ink">{r.voucher_no}</span>
							<span className="block text-xs text-ink-soft">{r.description || r.voucher_type}</span>
						</span>
					) },
					{ key: "debit", label: "Debit", align: "right", render: (r) => (r.debit ? money(r.debit) : "") },
					{ key: "credit", label: "Credit", align: "right", render: (r) => (r.credit ? money(r.credit) : "") },
					{ key: "balance", label: "Running balance", align: "right", render: (r) => money(r.balance) },
				]}
			/>
			<Link to={`/admin/finance/students/${encodeURIComponent(inv.student)}`} className="inline-block text-xs font-semibold text-brand-700 hover:underline">
				Full statement for {inv.student_name || inv.student} →
			</Link>
		</div>
	)
}
