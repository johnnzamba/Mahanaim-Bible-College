import { Link } from "react-router-dom"
import {
	AlarmClock,
	ArrowRight,
	BadgePercent,
	Banknote,
	CircleAlert,
	CreditCard,
	FileSpreadsheet,
	FileText,
	HandCoins,
	Layers,
	ReceiptText,
	RefreshCw,
	Smartphone,
	TrendingUp,
	Undo2,
	UserSearch,
	Wallet,
} from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Donut, PageHeader, Panel, QueryState, SkeletonRows, StatCard, Tile } from "@/shared/components/ui"
import { BarRow, DataTable } from "@/shared/components/kit"
import { BarsChart, DonutChart, Legendary, TrendChart } from "@/shared/components/Charts"
import { ago, date, money, num, pct } from "@/shared/utils/format"
import { F, M, useFinanceRole } from "../lib"

export const monthLabel = (m) => {
	if (!m) return ""
	const d = new Date(`${String(m).slice(0, 7)}-01T00:00:00`)
	return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
}

export default function Overview() {
	const { canWrite } = useFinanceRole()
	const q = useApi(`${F}finance_dashboard`)
	const d = q.data
	return (
		<div className="space-y-5">
			<PageHeader
				eyebrow={d?.term?.academic_term ? `Finance · ${d.term.academic_term}` : "Finance"}
				title="Finance overview"
				subtitle="Billing, collections and balances across the college, updated as payments arrive."
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => q.refetch()} loading={q.isFetching && !q.isLoading}>
							Refresh
						</Button>
						{canWrite ? (
							<>
								<Link to="/admin/finance/invoices?new=1" className="btn btn-secondary btn-sm">
									<FileText size={14} /> New invoice
								</Link>
								<Link to="/admin/finance/payments?new=1" className="btn btn-primary btn-sm">
									<Banknote size={14} /> Record payment
								</Link>
							</>
						) : null}
					</>
				}
			/>
			<QueryState query={q} skeleton={<OverviewSkeleton />}>
				{(data) => <Body d={data} />}
			</QueryState>
		</div>
	)
}

function OverviewSkeleton() {
	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
				{Array.from({ length: 6 }).map((_, i) => (
					<StatCard key={i} label="Loading" loading />
				))}
			</div>
			<div className="card p-5">
				<SkeletonRows rows={6} />
			</div>
		</div>
	)
}

function Body({ d }) {
	const term = d.term || {}
	const trend = (d.trend || []).map((t) => ({ ...t, label: monthLabel(t.month) }))
	const modes = (d.collections_by_mode || []).map((x) => ({ label: x.mode, value: x.amount, count: x.count }))
	const aging = (d.aging || []).map((a) => ({ label: `${a.bucket} days`, value: a.amount, invoices: a.invoices, students: a.students }))
	const maxProg = Math.max(1, ...(d.top_programmes || []).map((p) => p.outstanding || 0))
	const rate = Number(term.collection_rate || 0)
	const lastTwo = trend.slice(-2)
	const delta = lastTwo.length === 2 && lastTwo[0].collected ? ((lastTwo[1].collected - lastTwo[0].collected) / lastTwo[0].collected) * 100 : null
	return (
		<>
			{d.unmatched_mpesa ? (
				<Alert
					tone="warning"
					title={`${num(d.unmatched_mpesa)} M-Pesa payment${d.unmatched_mpesa === 1 ? "" : "s"} could not be matched to a student`}
					action={
						<Link to="/admin/finance/mpesa?tab=unmatched" className="btn btn-secondary btn-sm">
							Reconcile
						</Link>
					}
				>
					Money has arrived but isn't on any student account yet. Match each payment to the right student.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
				<StatCard label="Collected today" value={money(d.collected?.today, { compact: true })} icon={Wallet} tone="green" hint={`${money(d.collected?.week, { compact: true })} this week`} to="/admin/finance/payments" />
				<StatCard label="This month" value={money(d.collected?.month, { compact: true })} icon={TrendingUp} tone="brand" delta={delta != null ? Math.round(delta) : undefined} hint={delta != null ? "vs last month" : "collections"} to="/admin/finance/defaulters?tab=collections" />
				<StatCard label="Outstanding" value={money(d.total_outstanding, { compact: true })} icon={HandCoins} tone="orange" hint={`${num(d.students_owing)} students owing`} to="/admin/finance/defaulters" />
				<StatCard label="Overdue invoices" value={num(d.overdue_invoices)} icon={AlarmClock} tone={d.overdue_invoices ? "red" : "gray"} hint="past their due date" to="/admin/finance/invoices?status=Overdue" />
				<StatCard label="Unmatched M-Pesa" value={num(d.unmatched_mpesa)} icon={Smartphone} tone={d.unmatched_mpesa ? "red" : "green"} hint={d.matched_unallocated_mpesa ? `${num(d.matched_unallocated_mpesa)} awaiting allocation` : "all reconciled"} to="/admin/finance/mpesa?tab=unmatched" />
				<StatCard label="Pending refunds" value={num(d.pending_refunds)} icon={Undo2} tone={d.pending_refunds ? "purple" : "gray"} hint={d.total_credit ? `${money(d.total_credit, { compact: true })} in credit` : "awaiting decision"} to="/admin/finance/refunds" />
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Panel title="Billed vs collected" subtitle="Last 12 months" icon={TrendingUp} className="lg:col-span-2">
					{trend.some((t) => t.billed || t.collected) ? (
						<TrendChart
							data={trend}
							xKey="label"
							height={260}
							format={(v) => money(v)}
							series={[
								{ key: "billed", label: "Billed", color: "#c99a43" },
								{ key: "collected", label: "Collected", color: "#1d4d3a" },
							]}
						/>
					) : (
						<p className="py-16 text-center text-sm text-ink-soft">No invoices or payments in the last 12 months.</p>
					)}
				</Panel>
				<Panel title="This term" subtitle={term.academic_term || "Current term"} icon={BadgePercent}>
					<div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
						<Donut value={rate} size={112} stroke={11} tone={rate >= 75 ? "green" : rate >= 40 ? "gold" : "red"}>
							<div className="text-center">
								<div className="text-xl font-bold text-ink">{pct(rate)}</div>
								<div className="text-[10px] uppercase tracking-wide text-ink-soft">collected</div>
							</div>
						</Donut>
						<div className="w-full min-w-0 flex-1 space-y-2 text-sm">
							<Row label="Billed" value={money(term.billed)} />
							<Row label="Collected" value={money(term.collected)} tone="text-emerald-700" />
							<Row label="Outstanding" value={money(term.outstanding)} tone="text-amber-700" />
						</div>
					</div>
					<div className="mt-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line text-center">
						{[
							["Today", d.collected?.today],
							["This week", d.collected?.week],
							["This month", d.collected?.month],
						].map(([label, v]) => (
							<div key={label} className="min-w-0 px-2 py-2.5">
								<div className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
								<div className="truncate text-sm font-bold text-ink" title={money(v)}>
									{money(v, { compact: true })}
								</div>
							</div>
						))}
					</div>
				</Panel>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Panel title="Balances by programme" subtitle="Where outstanding fees sit" icon={Layers}>
					{(d.top_programmes || []).length ? (
						<div className="space-y-3.5">
							{d.top_programmes.map((p) => (
								<BarRow key={p.programme} label={p.programme_name || p.programme} value={p.outstanding} max={maxProg} caption={money(p.outstanding, { compact: true })} tone="bg-gold-500" />
							))}
							<Link to="/admin/finance/defaulters" className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-brand-700 hover:underline">
								See students with balances <ArrowRight size={13} />
							</Link>
						</div>
					) : (
						<p className="py-10 text-center text-sm text-ink-soft">No outstanding balances.</p>
					)}
				</Panel>
				<Panel title="Receivables aging" subtitle="By days past due" icon={AlarmClock} actions={<Link to="/admin/finance/defaulters?tab=aging" className="text-xs font-semibold text-brand-700 hover:underline">Aging report</Link>}>
					{aging.some((a) => a.value) ? (
						<BarsChart data={aging} xKey="label" height={210} format={(v) => money(v)} series={[{ key: "value", label: "Outstanding", color: "#c99a43" }]} />
					) : (
						<p className="py-10 text-center text-sm text-ink-soft">Nothing overdue — every balance is current.</p>
					)}
				</Panel>
				<Panel title="Collections by mode" subtitle="This month" icon={CreditCard}>
					{modes.length ? (
						<div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 lg:grid-cols-1">
							<DonutChart data={modes} height={170} center={money(modes.reduce((a, m) => a + Number(m.value || 0), 0), { compact: true }).replace(/^KES\s*/, "")} centerLabel="KES total" />
							<Legendary data={modes} format={(v) => money(v, { compact: true })} />
						</div>
					) : (
						<p className="py-10 text-center text-sm text-ink-soft">No payments received this month yet.</p>
					)}
				</Panel>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<RecentPayments className="lg:col-span-2" />
				<MpesaHealth unmatched={d.unmatched_mpesa} unallocated={d.matched_unallocated_mpesa} />
			</div>

			<div>
				<h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">More finance tools</h2>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
					<Tile icon={BadgePercent} label="Adjustments" sub="Waivers, scholarships, penalties" to="/admin/finance/adjustments" tone="purple" />
					<Tile icon={Undo2} label="Refunds" sub="Approve and pay out" to="/admin/finance/refunds" tone="blue" badge={d.pending_refunds ? <Badge tone="orange">{d.pending_refunds}</Badge> : null} />
					<Tile icon={CircleAlert} label="Defaulters" sub="Balances & reminders" to="/admin/finance/defaulters" tone="red" />
					<Tile icon={AlarmClock} label="Aging" sub="Receivables by age" to="/admin/finance/defaulters?tab=aging" tone="orange" />
					<Tile icon={FileSpreadsheet} label="Collections" sub="By day, mode, programme" to="/admin/finance/defaulters?tab=collections" tone="green" />
					<Tile icon={UserSearch} label="Statements" sub="Student account lookup" to="/admin/finance/students" tone="gold" />
				</div>
			</div>
		</>
	)
}

function Row({ label, value, tone }) {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-ink-soft">{label}</span>
			<span className={`font-semibold tabular-nums ${tone || "text-ink"}`}>{value}</span>
		</div>
	)
}

function RecentPayments({ className }) {
	const q = useApi(`${F}list_payments`, { page_length: 8 })
	return (
		<Panel
			title="Recent payments"
			subtitle="Latest receipts from every channel"
			icon={ReceiptText}
			className={className}
			bodyClass="p-0"
			actions={
				<Link to="/admin/finance/payments" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
					All payments <ArrowRight size={13} />
				</Link>
			}
		>
			<DataTable
				query={q}
				className="!rounded-none !border-0 !shadow-none"
				dense
				rowTo={(r) => `/admin/finance/payments/${encodeURIComponent(r.name)}`}
				empty="No payments recorded yet"
				cols={[
					{ key: "payer_name", label: "Payer", render: (r) => <span className="font-medium text-ink">{r.payer_name || r.student || "—"}</span> },
					{ key: "mode_of_payment", label: "Mode", render: (r) => <Badge tone={r.mode_of_payment === "M-Pesa" ? "green" : "gray"}>{r.mode_of_payment}</Badge> },
					{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date), hideOnMobile: true },
					{ key: "status", label: "Status", render: (r) => <Badge status={r.status}>{r.status}</Badge>, hideOnMobile: true },
					{ key: "amount", label: "Amount", align: "right", render: (r) => <span className="font-semibold">{money(r.amount)}</span> },
				]}
			/>
		</Panel>
	)
}

function MpesaHealth({ unmatched, unallocated }) {
	const s = useApi(`${M}mpesa_settings_status`)
	const tx = useApi(`${M}list_transactions`, { page_length: 1 })
	const last = tx.data?.data?.[0]
	const st = s.data
	const state = !st ? null : st.simulation ? ["Simulation", "orange"] : st.enabled && st.configured ? ["Live", "green"] : st.enabled ? ["Incomplete", "red"] : ["Disabled", "gray"]
	return (
		<Panel
			title="M-Pesa health"
			subtitle={st ? `${st.environment || "—"} · ${st.transaction_type === "CustomerBuyGoodsOnline" ? `Till ${st.till_number || "—"}` : `Paybill ${st.business_shortcode || "—"}`}` : "Daraja integration"}
			icon={Smartphone}
			actions={state ? <Badge tone={state[1]} dot>{state[0]}</Badge> : null}
			footer={
				<Link to="/admin/finance/mpesa" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
					Open M-Pesa desk <ArrowRight size={13} />
				</Link>
			}
		>
			{s.isLoading ? (
				<SkeletonRows rows={4} />
			) : s.isError ? (
				<p className="text-sm text-ink-soft">{s.error?.message}</p>
			) : (
				<div className="space-y-2.5 text-sm">
					{st.simulation ? (
						<Alert tone="warning" className="!px-3 !py-2 text-xs">
							Simulation mode: STK pushes are simulated and no money moves.
						</Alert>
					) : null}
					<Line label="Credentials" ok={st.has_consumer_key && st.has_consumer_secret && st.has_passkey} okText="Saved" badText="Missing" />
					<Line label="Callback token" ok={st.has_callback_token} okText="Set" badText="Missing" />
					<Line label="Auto-allocate to invoices" ok={st.auto_allocate} okText="On" badText="Off" neutral />
					<div className="flex items-center justify-between">
						<span className="text-ink-soft">Unmatched payments</span>
						<Badge tone={unmatched ? "red" : "green"}>{num(unmatched)}</Badge>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-ink-soft">Matched, not allocated</span>
						<Badge tone={unallocated ? "orange" : "gray"}>{num(unallocated)}</Badge>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-ink-soft">Last transaction</span>
						<span className="font-medium text-ink">{last ? ago(last.trans_time) : "None yet"}</span>
					</div>
				</div>
			)}
		</Panel>
	)
}

function Line({ label, ok, okText, badText, neutral }) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-ink-soft">{label}</span>
			<Badge tone={ok ? "green" : neutral ? "gray" : "red"}>{ok ? okText : badText}</Badge>
		</div>
	)
}
