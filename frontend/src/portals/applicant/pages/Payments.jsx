import { useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, Banknote, CheckCircle2, CircleDollarSign, Clock, FilePlus2, Receipt, ShieldCheck, Smartphone, Wallet } from "lucide-react"
import { DataTable } from "@/shared/components/kit"
import { Alert, Button, Empty, ErrorState, InfoRow, PageHeader, Panel, Skeleton, StatCard } from "@/shared/components/ui"
import { date, money } from "@/shared/utils/format"
import { CLOSED_STATUSES, FEE_PAYABLE_STATUSES, receiptUrl, since } from "../lib"
import { useFeeStatuses, useMyApplications } from "../hooks"
import { AppStatus, FeeBadge } from "../components/AppStatus"
import { PayFeeDialog } from "../components/PayFeeDialog"
import { Amount, Resp } from "../components/Amount"

export default function Payments() {
	const list = useMyApplications()
	const apps = list.data?.data || []
	const fees = useFeeStatuses(apps.map((a) => a.name))
	const loading = list.isLoading || fees.some((f) => f.isLoading)
	const failed = list.isError ? list : fees.find((f) => f.isError)

	return (
		<>
			<PageHeader eyebrow="Admissions" title="Payments" subtitle="Application fees, M-Pesa payments and receipts for all your applications." />
			{loading ? (
				<div className="space-y-5">
					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						{[0, 1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-24" />
						))}
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<Skeleton className="h-56" />
						<Skeleton className="h-56" />
					</div>
				</div>
			) : failed ? (
				<ErrorState error={failed.error} onRetry={() => (list.isError ? list.refetch() : fees.forEach((f) => f.isError && f.refetch()))} />
			) : apps.length === 0 ? (
				<div className="card">
					<Empty
						icon={Wallet}
						title="No payments yet"
						subtitle="Once you start an application, its application fee and M-Pesa receipts will appear here."
						action={
							<Link to="/applicant/apply" className="btn btn-primary">
								<FilePlus2 size={16} /> Start an application
							</Link>
						}
					/>
				</div>
			) : (
				<PaymentsBody apps={apps} fees={fees.map((f) => f.data)} />
			)}
		</>
	)
}

function PaymentsBody({ apps, fees }) {
	const [paying, setPaying] = useState(null)
	const rows = apps.map((a, i) => ({ app: a, fee: fees[i] || {} }))
	const payable = (r) => !r.fee.paid && r.fee.application_fee > 0 && FEE_PAYABLE_STATUSES.includes(r.app.status)
	const paidRows = rows.filter((r) => r.fee.payment)
	const totalPaid = paidRows.reduce((s, r) => s + Number(r.fee.payment.amount || 0), 0)
	const due = rows.filter(payable)
	const outstanding = due.reduce((s, r) => s + Number(r.fee.application_fee || 0), 0)
	const pending = rows.reduce((n, r) => n + (r.fee.pending_requests?.length || 0), 0)
	const mpesa = fees.find((f) => f?.mpesa)?.mpesa
	const urgent = due.find((r) => r.app.status === "Submitted")

	const history = paidRows.map(({ app, fee }) => ({
		...fee.payment,
		application: app.name,
		programme_name: app.programme_name,
	}))
	const cols = [
		{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date), sortValue: (r) => r.posting_date },
		{
			key: "application",
			label: "Application",
			render: (r) => (
				<div>
					<div className="font-medium text-ink">{r.programme_name}</div>
					<div className="text-xs text-ink-soft">{r.application}</div>
				</div>
			),
			sortValue: (r) => r.application,
		},
		{ key: "mode_of_payment", label: "Method", hideOnMobile: true },
		{ key: "reference_no", label: "Reference", render: (r) => <span className="font-mono text-xs">{r.reference_no || "—"}</span> },
		{ key: "amount", label: "Amount", align: "right", render: (r) => <span className="font-semibold text-ink">{money(r.amount)}</span>, sortValue: (r) => r.amount },
		{
			key: "receipt",
			label: "Receipt",
			align: "right",
			sortable: false,
			render: (r) => (
				<a href={receiptUrl(r.name)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()}>
					<Receipt size={14} /> {r.name}
				</a>
			),
		},
	]

	return (
		<div className="space-y-5">
			{urgent ? (
				<Alert
					tone="warning"
					title={`${urgent.app.name} is waiting for its application fee`}
					action={
						<Button variant="gold" size="sm" icon={Smartphone} onClick={() => setPaying(urgent.app)}>
							Pay {money(urgent.fee.application_fee)}
						</Button>
					}
				>
					The admissions team starts reviewing as soon as the fee is paid.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label={<Resp short="Paid">Total paid</Resp>} value={<Amount value={totalPaid} />} icon={CheckCircle2} tone="green" hint={`${paidRows.length} payment${paidRows.length === 1 ? "" : "s"}`} />
				<StatCard label={<Resp short="To pay">Outstanding</Resp>} value={<Amount value={outstanding} />} icon={CircleDollarSign} tone={outstanding ? "orange" : "green"} hint={outstanding ? `${due.length} fee${due.length === 1 ? "" : "s"} due` : <Resp short="all paid up">You're all paid up</Resp>} />
				<StatCard label="Pending" value={pending} icon={Clock} tone="blue" hint={<Resp short="on M-Pesa">awaiting M-Pesa</Resp>} />
				<StatCard label={<Resp short="Apps">Applications</Resp>} value={apps.length} icon={Banknote} tone="brand" hint={`${apps.filter((a) => !CLOSED_STATUSES.includes(a.status)).length} open`} />
			</div>

			<section>
				<h2 className="mb-3 font-serif text-lg text-ink">Application fees</h2>
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{rows.map((r) => (
						<FeeCard key={r.app.name} app={r.app} fee={r.fee} canPay={payable(r)} onPay={() => setPaying(r.app)} />
					))}
				</div>
			</section>

			<section>
				<h2 className="mb-3 font-serif text-lg text-ink">Payment history</h2>
				<DataTable cols={cols} rows={history} empty="No payments yet — receipts will appear here once you pay" emptyIcon={Receipt} initialSort={{ key: "posting_date", dir: "desc" }} />
			</section>

			<Panel title="Paying by M-Pesa" icon={ShieldCheck}>
				<div className="grid gap-4 text-sm text-ink-muted md:grid-cols-3">
					<div>
						<div className="mb-1 font-semibold text-ink">1. Tap Pay</div>
						Enter your Safaricom number and we'll send a payment prompt to your phone.
					</div>
					<div>
						<div className="mb-1 font-semibold text-ink">2. Enter your PIN</div>
						Confirm the amount and enter your M-Pesa PIN on your phone.
					</div>
					<div>
						<div className="mb-1 font-semibold text-ink">3. Get your receipt</div>
						Your application updates automatically and the receipt appears above.
					</div>
				</div>
				{mpesa?.paybill ? (
					<p className="mt-4 rounded-xl bg-cream/70 px-3 py-2 text-xs text-ink-muted">
						Prefer the M-Pesa menu? Use Paybill <span className="font-mono font-semibold text-ink">{mpesa.paybill}</span> with your application number as the
						account number.
					</p>
				) : null}
			</Panel>

			<PayFeeDialog app={paying} open={Boolean(paying)} onClose={() => setPaying(null)} />
		</div>
	)
}

function FeeCard({ app, fee, canPay, onPay }) {
	const payment = fee.payment
	const pending = fee.pending_requests || []
	const free = !(fee.application_fee > 0)
	return (
		<div className={clsx("card flex flex-col p-4", canPay && "ring-1 ring-gold-300")}>
			<div className="min-w-0">
				<Link to={`/applicant/application/${app.name}`} className="block truncate font-semibold text-ink hover:text-brand-700">
					{app.programme_name}
				</Link>
				<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
					{app.name} <AppStatus status={app.status} size="xs" />
					{free ? null : <FeeBadge status={fee.fee_status} appStatus={app.status} size="xs" />}
				</div>
			</div>
			<div className="mt-4 text-2xl font-bold text-ink">{free ? "No fee" : money(fee.application_fee)}</div>
			<div className="mt-3 flex-1 divide-y divide-line text-sm">
				{payment ? (
					<>
						<InfoRow label="Paid" value={date(payment.posting_date)} />
						<InfoRow label="Method" value={payment.mode_of_payment} />
						{payment.reference_no ? <InfoRow label="Reference" value={<span className="font-mono text-xs">{payment.reference_no}</span>} /> : null}
					</>
				) : fee.fee_status === "Waived" ? (
					<p className="py-2 text-ink-muted">The application fee was waived.</p>
				) : pending.length ? (
					<p className="py-2 text-ink-muted">
						Payment prompt sent {since(pending[0].creation)} — waiting for confirmation from M-Pesa.
					</p>
				) : canPay ? (
					<p className="py-2 text-ink-muted">{app.status === "Draft" ? "Pay now or right after you submit." : "Pay to start the review of your application."}</p>
				) : free ? (
					<p className="py-2 text-ink-muted">This programme has no application fee.</p>
				) : (
					<p className="py-2 text-ink-muted">No payment is due for this application.</p>
				)}
			</div>
			<div className="mt-4 flex flex-wrap gap-2">
				{payment ? (
					<a href={receiptUrl(payment.name)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
						<Receipt size={14} /> Download receipt
					</a>
				) : null}
				{canPay ? (
					<Button variant="gold" size="sm" icon={Smartphone} onClick={onPay}>
						{pending.length ? "Try again" : `Pay ${money(fee.application_fee)}`}
					</Button>
				) : null}
				<Link to={`/applicant/application/${app.name}`} className="btn btn-ghost btn-sm ml-auto">
					Details <ArrowRight size={14} />
				</Link>
			</div>
		</div>
	)
}
