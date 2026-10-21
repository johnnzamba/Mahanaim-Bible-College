import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { CheckCircle2, Link2, PlugZap, RefreshCw, Settings2, Smartphone, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Alert, Badge, Button, Drawer, ErrorState, Input, KeyValueGrid, Modal, PageHeader, RadioCards, SkeletonRows, Tabs } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { dateTime, money, num } from "@/shared/utils/format"
import { DateRange, FilterSelect, M, Pager, REFRESH, REQUEST_PURPOSES, REQUEST_STATUSES, StudentLink, StudentPicker, TRANSACTION_SOURCES, useFinanceRole, usePaged } from "../lib"

const TX_TONE = { Unmatched: "red", Matched: "orange", Allocated: "green", Reversed: "gray" }
export const TxBadge = ({ status }) => <Badge tone={TX_TONE[status] || "gray"}>{status}</Badge>
const REQ_TONE = { Completed: "green", Initiated: "blue", Pending: "orange", Failed: "red", Cancelled: "gray", Timeout: "red" }

export default function Mpesa() {
	const [params, setParams] = useSearchParams()
	const tab = params.get("tab") || "transactions"
	const { canWrite, isSuper } = useFinanceRole()
	const status = useApi(`${M}mpesa_settings_status`)
	const unmatched = useApi(`${M}list_transactions`, { status: "Unmatched", page_length: 1 })
	const test = useAction(`${M}test_connection`, { error: true })
	const [testResult, setTestResult] = useState(null)
	const s = status.data || {}
	const setTab = (id) => setParams(id === "transactions" ? {} : { tab: id }, { replace: true })

	return (
		<div>
			<PageHeader
				eyebrow="Finance"
				title="M-Pesa"
				subtitle={s.business_shortcode ? `${s.transaction_type === "CustomerBuyGoodsOnline" ? "Till" : "Paybill"} ${s.transaction_type === "CustomerBuyGoodsOnline" ? s.till_number || s.business_shortcode : s.business_shortcode} · ${s.environment || "Sandbox"}` : "STK push requests, paybill (C2B) receipts and reconciliation"}
				back={{ to: "/admin/finance", label: "Finance overview" }}
				actions={
					<>
						{status.data ? <Badge tone={s.simulation ? "purple" : s.enabled ? (s.configured ? "green" : "orange") : "gray"} dot>{s.simulation ? "Simulation" : s.enabled ? (s.configured ? "Live" : "Incomplete setup") : "Disabled"}</Badge> : null}
						{canWrite ? (
							<Button size="sm" variant="secondary" icon={PlugZap} loading={test.isPending} onClick={() => test.mutate({}, { onSuccess: setTestResult })}>
								Test connection
							</Button>
						) : null}
						{isSuper ? (
							<Link className="btn btn-secondary btn-sm" to="/admin/settings/integrations">
								<Settings2 size={15} /> Settings
							</Link>
						) : null}
					</>
				}
			/>
			{s.simulation ? (
				<Alert tone="brand" className="mb-4" title="Simulation mode">
					M-Pesa is disabled on this developer site, so STK prompts aren't sent to phones. Simulated requests can be completed from the Requests tab.
				</Alert>
			) : status.data && !s.enabled ? (
				<Alert tone="warning" className="mb-4" title="M-Pesa is switched off">
					Students can't pay by STK push until an administrator enables it in Settings → Integrations.
				</Alert>
			) : status.data && !s.configured ? (
				<Alert tone="warning" className="mb-4" title="Setup incomplete">
					Credentials or the callback address are missing, so callbacks may not reach the college.
				</Alert>
			) : null}
			{testResult ? (
				<Alert tone={testResult.ok ? "success" : "error"} className="mb-4" icon={testResult.ok ? CheckCircle2 : XCircle} title={testResult.ok ? "Connection OK" : "Connection failed"} action={<Button size="sm" variant="ghost" onClick={() => setTestResult(null)}>Dismiss</Button>}>
					{testResult.message} {testResult.environment ? `(${testResult.environment})` : ""}
				</Alert>
			) : null}
			<Tabs
				className="mb-4 overflow-y-hidden"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "transactions", label: "Transactions" },
					{ id: "unmatched", label: "Unmatched", count: unmatched.data?.total || undefined },
					{ id: "requests", label: "STK requests" },
				]}
			/>
			{tab === "requests" ? <Requests /> : tab === "unmatched" ? <Transactions key="u" unmatchedOnly /> : <Transactions key="t" initialSearch={params.get("q") || ""} />}
		</div>
	)
}

function Transactions({ unmatchedOnly, initialSearch = "" }) {
	const { canWrite } = useFinanceRole()
	const [search, setSearch] = useState(initialSearch)
	const [status, setStatus] = useState(unmatchedOnly ? "Unmatched" : "")
	const [source, setSource] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [open, setOpen] = useState(null)
	const [reconcile, setReconcile] = useState(null)
	const q = useDebounced(search, 300)
	const list = usePaged(`${M}list_transactions`, { search: q, status, source, from_date: from, to_date: to })
	const canReconcile = (r) => canWrite && (r.status === "Unmatched" || (r.status === "Matched" && !r.payment))

	return (
		<>
			{unmatchedOnly ? (
				<Alert tone="info" className="mb-4">
					These paybill payments arrived with an account number that didn't match any student or application. Find who paid, then reconcile to post the receipt to their account.
				</Alert>
			) : null}
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search M-Pesa code, phone, payer, account…"
				chips={unmatchedOnly ? undefined : [{ id: "", label: "All" }, { id: "Allocated", label: "Allocated" }, { id: "Matched", label: "Matched" }, { id: "Unmatched", label: "Unmatched" }, { id: "Reversed", label: "Reversed" }]}
				active={status}
				onChip={setStatus}
			/>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<FilterSelect value={source} onChange={setSource} options={TRANSACTION_SOURCES} placeholder="Any source" />
				<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
				<span className="text-xs text-ink-soft lg:ml-auto">{num(list.total)} transactions</span>
			</div>
			<DataTable
				query={list.query}
				onRow={(r) => setOpen(r.name)}
				empty={unmatchedOnly ? "Nothing to reconcile. Every M-Pesa payment is matched." : "No M-Pesa transactions match these filters"}
				emptyIcon={unmatchedOnly ? CheckCircle2 : Smartphone}
				cols={[
					{ key: "trans_id", label: "M-Pesa code", render: (r) => (
						<span>
							<span className="block font-mono font-semibold text-ink">{r.trans_id}</span>
							<span className="block text-xs text-ink-soft">{dateTime(r.trans_time)}</span>
						</span>
					) },
					{ key: "payer_name", label: "Payer", render: (r) => (
						<span>
							<span className="block font-medium text-ink">{r.payer_name || "—"}</span>
							<span className="block text-xs text-ink-soft">{r.msisdn}</span>
						</span>
					) },
					{ key: "bill_ref_number", label: "Account no.", render: (r) => <span className="font-mono text-xs">{r.bill_ref_number || "—"}</span> },
					{ key: "source", label: "Source", hideOnMobile: true },
					{ key: "student", label: "Matched to", hideOnMobile: true, render: (r) => (r.student ? <StudentLink id={r.student} /> : r.programme_application || <span className="text-ink-soft">—</span>) },
					{ key: "status", label: "Status", render: (r) => <TxBadge status={r.status} /> },
					{ key: "amount", label: "Amount", align: "right", render: (r) => <b>{money(r.amount)}</b> },
					{ key: "_act", label: "", align: "right", render: (r) => (canReconcile(r) ? (
						<Button size="sm" variant={unmatchedOnly ? "primary" : "secondary"} icon={Link2} onClick={(e) => { e.stopPropagation(); setReconcile(r) }}>
							Reconcile
						</Button>
					) : r.payment ? (
						<Link className="text-xs font-semibold text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()} to={`/admin/finance/payments/${encodeURIComponent(r.payment)}`}>
							{r.payment}
						</Link>
					) : null) },
				]}
			/>
			<Pager list={list} />
			<TransactionDrawer name={open} onClose={() => setOpen(null)} onReconcile={(t) => { setOpen(null); setReconcile(t) }} canReconcile={canReconcile} />
			<ReconcileModal tx={reconcile} onClose={() => setReconcile(null)} />
		</>
	)
}

function TransactionDrawer({ name, onClose, onReconcile, canReconcile }) {
	const q = useApi(`${M}get_transaction`, { name }, { enabled: Boolean(name) })
	const t = q.data || {}
	let raw = t.raw_payload
	try {
		raw = raw ? JSON.stringify(JSON.parse(raw), null, 2) : ""
	} catch {
		/* keep the raw text */
	}
	return (
		<Drawer
			open={Boolean(name)}
			onClose={onClose}
			title={t.trans_id || name}
			subtitle={t.trans_time ? `${t.source} · ${dateTime(t.trans_time)}` : undefined}
			footer={
				q.data && canReconcile(t) ? (
					<Button icon={Link2} onClick={() => onReconcile(t)}>
						Reconcile
					</Button>
				) : null
			}
		>
			{q.isLoading ? <SkeletonRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
				<div className="space-y-5">
					<div className="flex items-center justify-between">
						<TxBadge status={t.status} />
						<span className="font-serif text-2xl text-ink">{money(t.amount)}</span>
					</div>
					<KeyValueGrid
						items={[
							{ label: "Payer", value: t.payer_name || "—" },
							{ label: "Phone", value: t.msisdn || "—" },
							{ label: "Account no. entered", value: t.bill_ref_number || "—" },
							{ label: "Shortcode", value: t.business_shortcode || "—" },
							t.student && { label: "Student", value: <StudentLink id={t.student} /> },
							t.programme_application && { label: "Application", value: t.programme_application },
							t.payment && { label: "Receipt", value: <Link className="font-medium text-brand-700 hover:underline" to={`/admin/finance/payments/${encodeURIComponent(t.payment)}`}>{t.payment}</Link> },
							t.request && { label: "STK request", value: t.request },
							t.remarks && { label: "Remarks", value: t.remarks },
						]}
					/>
					{raw ? (
						<div>
							<div className="eyebrow mb-1.5">Payload from Safaricom</div>
							<pre className="max-h-72 overflow-auto rounded-lg bg-cream p-3 text-[11px] leading-relaxed text-ink-muted">{raw}</pre>
						</div>
					) : null}
				</div>
			)}
		</Drawer>
	)
}

function ReconcileModal({ tx, onClose }) {
	const [target, setTarget] = useState("student")
	const [student, setStudent] = useState(null)
	const [application, setApplication] = useState("")
	const [error, setError] = useState("")
	const [done, setDone] = useState(null)
	const act = useAction(`${M}reconcile_transaction`, { invalidate: REFRESH, success: "Payment reconciled and receipted" })
	const close = () => {
		setStudent(null)
		setApplication("")
		setError("")
		setDone(null)
		setTarget("student")
		onClose()
	}
	const save = () => {
		if (target === "student" && !student) return setError("Choose the student who paid")
		if (target === "application" && !application.trim()) return setError("Enter the application number")
		setError("")
		act.mutate({ trans_id: tx.name, student: target === "student" ? student.name : undefined, application: target === "application" ? application.trim() : undefined }, { onSuccess: setDone })
	}
	return (
		<Modal
			open={Boolean(tx)}
			onClose={close}
			title={done ? "Reconciled" : `Reconcile ${tx?.trans_id || ""}`}
			subtitle={done ? undefined : "Post this M-Pesa payment to the right account. A receipt is created and applied to their oldest invoices."}
			footer={
				done ? (
					<>
						{done.payment ? (
							<Link className="btn btn-secondary" to={`/admin/finance/payments/${encodeURIComponent(done.payment)}`} onClick={close}>
								Open receipt
							</Link>
						) : null}
						<Button onClick={close}>Done</Button>
					</>
				) : (
					<>
						<Button variant="secondary" onClick={close} disabled={act.isPending}>
							Cancel
						</Button>
						<Button icon={Link2} onClick={save} loading={act.isPending}>
							Reconcile {tx ? money(tx.amount) : ""}
						</Button>
					</>
				)
			}
		>
			{tx ? (
				done ? (
					<Alert tone="success" icon={CheckCircle2} title={`${money(tx.amount)} posted`}>
						{done.payment ? `Receipt ${done.payment} was created` : "The transaction was recorded"}{student ? ` for ${student.full_name}` : application ? ` for application ${application}` : ""}.
					</Alert>
				) : (
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-3 rounded-xl bg-cream p-3 text-sm">
							<Fact label="Amount" value={money(tx.amount)} strong />
							<Fact label="Phone" value={tx.msisdn || "—"} />
							<Fact label="Payer" value={tx.payer_name || "—"} />
							<Fact label="Account entered" value={tx.bill_ref_number || "—"} mono />
						</div>
						<RadioCards
							value={target}
							onChange={(v) => { setTarget(v); setError("") }}
							options={[
								{ value: "student", label: "A student", description: "School fees for an enrolled student" },
								{ value: "application", label: "An application", description: "Application fee from an applicant" },
							]}
						/>
						{target === "student" ? (
							<StudentPicker value={student} onChange={(v) => { setStudent(v); setError("") }} required error={error} autoFocus hint={!student && tx.payer_name ? `Try searching "${tx.payer_name.split(" ")[0]}"${tx.msisdn && !String(tx.msisdn).includes("*") ? ` or the phone ${tx.msisdn}` : ""}` : undefined} />
						) : (
							<Input label="Application number" required value={application} onChange={(e) => setApplication(e.target.value)} error={error} placeholder="e.g. APP-2026-00012" />
						)}
						{act.isError ? <Alert tone="error">{act.error?.message}</Alert> : null}
					</div>
				)
			) : null}
		</Modal>
	)
}

function Fact({ label, value, strong, mono }) {
	return (
		<div className="min-w-0">
			<div className="text-[11px] uppercase tracking-wide text-ink-soft">{label}</div>
			<div className={`truncate ${strong ? "font-semibold text-ink" : "text-ink-muted"} ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
		</div>
	)
}

function Requests() {
	const { canWrite } = useFinanceRole()
	const { hasRole } = useSession()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [purpose, setPurpose] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const q = useDebounced(search, 300)
	const list = usePaged(`${M}list_requests`, { search: q, status, purpose, from_date: from, to_date: to })
	const check = useAction(`${M}query_stk_status`, { invalidate: REFRESH })
	const sim = useAction(`${M}simulate_callback`, { invalidate: REFRESH, success: "Simulated callback processed" })
	const [busy, setBusy] = useState(null)
	const staff = canWrite || hasRole("Finance Officer")
	const open = (r) => ["Initiated", "Pending"].includes(r.status)
	const isSim = (r) => String(r.checkout_request_id || "").startsWith("SIM-")

	return (
		<>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search phone, student, receipt, request…"
				chips={[{ id: "", label: "All" }, ...REQUEST_STATUSES.map((s) => ({ id: s, label: s }))]}
				active={status}
				onChip={setStatus}
			/>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<FilterSelect value={purpose} onChange={setPurpose} options={REQUEST_PURPOSES} placeholder="Any purpose" />
				<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
				<span className="text-xs text-ink-soft lg:ml-auto">{num(list.total)} requests</span>
			</div>
			<DataTable
				query={list.query}
				empty="No STK push requests match these filters"
				emptyIcon={Smartphone}
				cols={[
					{ key: "name", label: "Request", render: (r) => (
						<span>
							<span className="block whitespace-nowrap font-semibold text-ink">{r.name}</span>
							<span className="block text-xs text-ink-soft">{dateTime(r.creation)}</span>
						</span>
					) },
					{ key: "phone_number", label: "Phone", render: (r) => <span className="font-mono text-xs">{r.phone_number}</span> },
					{ key: "student", label: "For", render: (r) => (
						<span>
							{r.student ? <StudentLink id={r.student} /> : <span className="block font-medium text-ink">{r.programme_application || r.sponsor || r.account_reference || "—"}</span>}
							<span className="block text-xs text-ink-soft">{r.purpose}</span>
						</span>
					) },
					{ key: "status", label: "Status", render: (r) => (
						<span>
							<Badge tone={REQ_TONE[r.status] || "gray"}>{r.status}</Badge>
							{r.result_desc && r.status !== "Completed" ? <span className="mt-0.5 block max-w-[14rem] truncate text-[11px] text-ink-soft" title={r.result_desc}>{r.result_desc}</span> : null}
						</span>
					) },
					{ key: "mpesa_receipt_number", label: "Receipt", hideOnMobile: true, render: (r) => (r.payment ? <Link className="font-mono text-xs text-brand-700 hover:underline" to={`/admin/finance/payments/${encodeURIComponent(r.payment)}`}>{r.mpesa_receipt_number || r.payment}</Link> : <span className="font-mono text-xs">{r.mpesa_receipt_number || "—"}</span>) },
					{ key: "amount", label: "Amount", align: "right", render: (r) => <b>{money(r.amount)}</b> },
					{ key: "_act", label: "", align: "right", render: (r) => (open(r) && staff ? (
						<span className="inline-flex flex-wrap justify-end gap-1">
							{isSim(r) ? (
								<>
									<Button size="sm" variant="secondary" loading={busy === `${r.name}:1`} onClick={() => { setBusy(`${r.name}:1`); sim.mutate({ request: r.name, success: 1 }, { onSettled: () => setBusy(null) }) }}>
										Simulate paid
									</Button>
									<Button size="sm" variant="ghost" loading={busy === `${r.name}:0`} onClick={() => { setBusy(`${r.name}:0`); sim.mutate({ request: r.name, success: 0 }, { onSettled: () => setBusy(null) }) }}>
										Fail
									</Button>
								</>
							) : (
								<Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === r.name} onClick={() => { setBusy(r.name); check.mutate({ request: r.name }, { onSettled: () => setBusy(null) }) }}>
									Check status
								</Button>
							)}
						</span>
					) : null) },
				]}
			/>
			<Pager list={list} />
		</>
	)
}
