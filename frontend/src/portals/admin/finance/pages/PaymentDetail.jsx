import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Ban, Download, ReceiptText, Smartphone } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, ConfirmDialog, Button, ErrorState, KeyValueGrid, PageHeader, Panel, SkeletonRows, StatCard, Textarea } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, dateTime, money } from "@/shared/utils/format"
import { F, REFRESH, StudentLink, useFinanceRole } from "../lib"

export default function PaymentDetail() {
	const { name } = useParams()
	const { canWrite } = useFinanceRole()
	const q = useApi(`${F}get_payment`, { name })
	const [cancelOpen, setCancelOpen] = useState(false)
	const [reason, setReason] = useState("")
	const cancel = useAction(`${F}cancel_payment`, { invalidate: REFRESH, success: "Payment cancelled" })

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
				<PageHeader title={name} back={{ to: "/admin/finance/payments", label: "Payments" }} />
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't open this payment" />
				</div>
			</>
		)
	}
	const p = q.data || {}
	const allocations = p.allocations || []
	const cancelled = p.docstatus === 2
	const pdf = p.docstatus === 1 ? frappe.downloadUrl(`${F}download`, { doctype: "receipt", name: p.name }) : null

	return (
		<div>
			<PageHeader
				eyebrow={`Receipt · ${p.payment_for}`}
				title={
					<span className="flex flex-wrap items-center gap-2">
						{p.name} <Badge status={cancelled ? "Cancelled" : p.status} />
					</span>
				}
				subtitle={`${money(p.amount)} by ${p.mode_of_payment} on ${date(p.posting_date)}${p.payer_name ? ` · paid by ${p.payer_name}` : ""}`}
				back={{ to: "/admin/finance/payments", label: "Payments" }}
				actions={
					<>
						{pdf ? (
							<a className="btn btn-secondary btn-sm" href={pdf} target="_blank" rel="noreferrer">
								<Download size={15} /> Receipt PDF
							</a>
						) : null}
						{canWrite && p.docstatus === 1 ? (
							<Button size="sm" variant="danger" icon={Ban} onClick={() => setCancelOpen(true)}>
								Cancel payment
							</Button>
						) : null}
					</>
				}
			/>
			{cancelled ? (
				<Alert tone="error" className="mb-4" title="This payment was cancelled">
					Its ledger entries were reversed and any invoices it paid are open again.
				</Alert>
			) : null}
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Amount" value={money(p.amount)} icon={ReceiptText} />
				<StatCard label="Allocated" value={money(p.allocated_amount)} tone="green" />
				<StatCard label="On account" value={money(p.unallocated_amount)} tone={p.unallocated_amount > 0 ? "gold" : "brand"} hint={p.unallocated_amount > 0 ? "Credit for future invoices" : undefined} />
				{p.student ? <StatCard label="Student balance now" value={money(p.balance)} tone={p.balance > 0 ? "red" : "green"} hint={p.balance < 0 ? "In credit" : undefined} to={`/admin/finance/students?student=${encodeURIComponent(p.student)}`} /> : <StatCard label="Mode" value={p.mode_of_payment} />}
			</div>
			<div className="grid gap-5 lg:grid-cols-3 lg:items-start">
				<Panel title="Applied to invoices" subtitle={allocations.length ? `${allocations.length} invoice${allocations.length === 1 ? "" : "s"}` : undefined} className="lg:col-span-2" bodyClass="p-0">
					<DataTable
						rows={allocations}
						noCards
						empty={p.payment_for === "Student Fees" ? "Not applied to any invoice; the full amount sits on the student's account." : "Only student fee payments are applied to invoices."}
						rowTo={(r) => `/admin/finance/invoices/${encodeURIComponent(r.invoice)}`}
						cols={[
							{ key: "invoice", label: "Invoice", render: (r) => <span className="font-semibold text-brand-800">{r.invoice}</span> },
							{ key: "academic_term", label: "Term", render: (r) => r.academic_term || "—" },
							{ key: "allocated_amount", label: "Amount", align: "right", render: (r) => <b>{money(r.allocated_amount)}</b> },
						]}
					/>
				</Panel>
				<Panel title="Details">
					<KeyValueGrid
						cols={1}
						items={[
							p.student && { label: "Student", value: <StudentLink id={p.student} name={p.payer_name && p.payer_name !== p.student ? p.payer_name : p.student} sub={p.student_number} /> },
							p.programme_application && { label: "Application", value: p.programme_application },
							p.sponsor && { label: "Sponsor", value: p.sponsor },
							{ label: "Mode", value: p.mode_of_payment },
							p.reference_no && { label: "Reference", value: <span className="font-mono">{p.reference_no}</span> },
							p.reference_date && { label: "Reference date", value: date(p.reference_date) },
							p.msisdn && { label: "Phone", value: p.msisdn },
							p.mpesa_transaction && {
								label: "M-Pesa transaction",
								value: (
									<Link className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" to={`/admin/finance/mpesa?tab=transactions&q=${encodeURIComponent(p.mpesa_transaction)}`}>
										<Smartphone size={14} /> {p.mpesa_transaction}
									</Link>
								),
							},
							{
								label: "Recorded",
								value: (
									<span>
										{dateTime(p.creation)}
										{p.owner ? <span className="block break-all text-xs text-ink-soft">by {p.owner}</span> : null}
									</span>
								),
							},
							p.remarks && { label: "Remarks", value: p.remarks },
						]}
					/>
				</Panel>
			</div>
			<ConfirmDialog
				open={cancelOpen}
				onClose={() => setCancelOpen(false)}
				tone="danger"
				title={`Cancel ${p.name}?`}
				confirmLabel="Cancel payment"
				loading={cancel.isPending}
				onConfirm={() => {
					if (!reason.trim()) return
					cancel.mutate(
						{ name: p.name, reason: reason.trim() },
						{
							onSuccess: () => {
								setCancelOpen(false)
								setReason("")
								q.refetch()
							},
						}
					)
				}}
			>
				<p className="mb-3 text-sm text-ink-soft">The receipt is voided, its ledger credit is reversed and {allocations.length ? "the invoices it paid become outstanding again" : "the student's balance goes back up"}. This can't be undone.</p>
				<Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced, duplicate entry" error={cancel.isError ? cancel.error?.message : undefined} />
			</ConfirmDialog>
		</div>
	)
}
