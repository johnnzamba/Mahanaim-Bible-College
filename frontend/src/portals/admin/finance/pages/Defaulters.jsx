import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { AlarmClock, BellRing, Download, ShieldCheck, TrendingUp } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { Button, Checkbox, ConfirmDialog, Input, PageHeader, Panel, Select, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable, exportCsv, SelectionBar } from "@/shared/components/kit"
import { BarsChart, TrendChart } from "@/shared/components/Charts"
import { date, money, num } from "@/shared/utils/format"
import { DateRange, F, FilterSelect, Pager, StudentLink, daysAgo, today, useFinanceRole, useOptions, usePaged } from "../lib"
import { monthLabel } from "./Overview"

export default function Defaulters() {
	const [params, setParams] = useSearchParams()
	const tab = params.get("tab") || "defaulters"
	return (
		<div>
			<PageHeader eyebrow="Finance" title="Defaulters & receivables" subtitle="Who owes what, how long it has been owed, and what has been collected." back={{ to: "/admin/finance", label: "Finance overview" }} />
			<Tabs
				className="mb-4 overflow-y-hidden"
				active={tab}
				onChange={(id) => setParams(id === "defaulters" ? {} : { tab: id }, { replace: true })}
				tabs={[
					{ id: "defaulters", label: "Defaulters" },
					{ id: "aging", label: "Aging" },
					{ id: "collections", label: "Collections" },
				]}
			/>
			{tab === "aging" ? <Aging /> : tab === "collections" ? <Collections /> : <DefaulterList />}
		</div>
	)
}

const DEFAULTER_COLS = [
	{ key: "full_name", label: "Student", render: (r) => <StudentLink id={r.student} name={r.full_name} sub={`${r.student_number || r.student}${r.phone ? ` · ${r.phone}` : ""}`} />, exportValue: (r) => r.full_name },
	{ key: "student_number", label: "Admission no.", hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.student_number}</span> },
	{ key: "programme", label: "Programme", hideOnMobile: true, render: (r) => <span className="text-xs">{r.programme_name || r.programme}<span className="block text-ink-soft">{r.campus}</span></span>, exportValue: (r) => r.programme },
	{ key: "days_overdue", label: "Overdue", render: (r) => (r.days_overdue ? <span className={r.days_overdue > 60 ? "font-semibold text-red-700" : "text-amber-700"}>{r.days_overdue} days</span> : <span className="text-ink-soft">Not yet due</span>), sortValue: (r) => r.days_overdue },
	{ key: "last_payment", label: "Last paid", hideOnMobile: true, render: (r) => (r.last_payment ? date(r.last_payment) : <span className="text-ink-soft">Never</span>) },
	{ key: "phone", label: "Phone", hideOnMobile: true, export: true, render: (r) => r.phone || "—" },
	{ key: "balance", label: "Balance", align: "right", render: (r) => <b className="text-red-700">{money(r.balance)}</b>, sortValue: (r) => r.balance },
]

function DefaulterList() {
	const { canWrite } = useFinanceRole()
	const opts = useOptions()
	const [threshold, setThreshold] = useState("")
	const [programme, setProgramme] = useState("")
	const [campus, setCampus] = useState("")
	const [overdue, setOverdue] = useState(false)
	const [selected, setSelected] = useState([])
	const [confirmAll, setConfirmAll] = useState(false)
	const [exporting, setExporting] = useState(false)
	const filters = { threshold: Number(threshold) || 0, programme, campus, overdue_only: overdue ? 1 : 0 }
	const list = usePaged(`${F}defaulters`, filters, 50)
	const remind = useAction(`${F}send_reminders`, { success: (d) => `Sent ${d.sent} reminder${d.sent === 1 ? "" : "s"}` })

	const doExport = async () => {
		setExporting(true)
		try {
			const all = await frappe.call(`${F}defaulters`, { ...filters, page_length: 1000 })
			exportCsv(`fee-defaulters-${today()}`, [...DEFAULTER_COLS, { key: "email", label: "Email" }], all.data || [])
		} finally {
			setExporting(false)
		}
	}

	return (
		<>
			<div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
				<StatCard label="Students owing" value={num(list.total)} icon={AlarmClock} tone="red" loading={list.query.isLoading} />
				<StatCard label="Total owed" value={money(list.query.data?.total_balance)} tone="gold" loading={list.query.isLoading} />
				<StatCard className="col-span-2 lg:col-span-1" label="Average balance" value={list.total ? money(Math.round((list.query.data?.total_balance || 0) / list.total)) : "—"} loading={list.query.isLoading} />
			</div>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<Input className="lg:w-44" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Owing more than…" aria-label="Minimum balance" />
				<FilterSelect value={programme} onChange={setProgramme} options={opts.programmes} placeholder="All programmes" />
				<FilterSelect value={campus} onChange={setCampus} options={opts.campuses} placeholder="All campuses" />
				<Checkbox label="Overdue invoices only" checked={overdue} onChange={(v) => setOverdue(Boolean(v))} />
				<span className="flex gap-2 lg:ml-auto">
					<Button size="sm" variant="secondary" icon={Download} onClick={doExport} loading={exporting} disabled={!list.total}>Export</Button>
					{canWrite ? <Button size="sm" variant="secondary" icon={BellRing} onClick={() => setConfirmAll(true)}>Remind overdue</Button> : null}
				</span>
			</div>
			{canWrite && selected.length ? (
				<SelectionBar count={selected.length} onClear={() => setSelected([])}>
					<Button size="sm" icon={BellRing} loading={remind.isPending} onClick={() => remind.mutate({ students: selected }, { onSuccess: () => setSelected([]) })}>
						Send fee reminder
					</Button>
				</SelectionBar>
			) : null}
			<DataTable
				query={list.query}
				rowKey="student"
				selectable={canWrite}
				selected={selected}
				onSelect={setSelected}
				empty="No students owe more than this. Well done!"
				emptyIcon={ShieldCheck}
				cols={DEFAULTER_COLS.filter((c) => c.key !== "phone" && c.key !== "student_number")}
			/>
			<Pager list={list} />
			<ConfirmDialog
				open={confirmAll}
				onClose={() => setConfirmAll(false)}
				title="Send overdue reminders?"
				confirmLabel="Send reminders"
				loading={remind.isPending}
				onConfirm={() => remind.mutate({}, { onSuccess: () => setConfirmAll(false) })}
				message="Every student with an overdue invoice who hasn't been reminded recently gets an SMS and email with their balance and how to pay. Students reminded in the last few days are skipped."
			/>
		</>
	)
}

function Aging() {
	const opts = useOptions()
	const [programme, setProgramme] = useState("")
	const [campus, setCampus] = useState("")
	const list = usePaged(`${F}aging_report`, { programme, campus }, 100)
	const summary = list.query.data?.summary || []
	const total = summary.reduce((a, b) => a + Number(b.amount || 0), 0)
	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <StudentLink id={r.student} name={r.student_name} sub={r.student_number} />, exportValue: (r) => r.student_name },
		{ key: "student_number", label: "Admission no.", hideOnMobile: true },
		{ key: "programme", label: "Programme", hideOnMobile: true },
		{ key: "b0_30", label: "0–30", align: "right", render: (r) => money(r.b0_30), sortValue: (r) => r.b0_30 },
		{ key: "b31_60", label: "31–60", align: "right", hideOnMobile: true, render: (r) => money(r.b31_60), sortValue: (r) => r.b31_60 },
		{ key: "b61_90", label: "61–90", align: "right", hideOnMobile: true, render: (r) => money(r.b61_90), sortValue: (r) => r.b61_90 },
		{ key: "b90", label: "90+", align: "right", render: (r) => <span className={r.b90 > 0 ? "font-semibold text-red-700" : ""}>{money(r.b90)}</span>, sortValue: (r) => r.b90 },
		{ key: "total", label: "Total", align: "right", render: (r) => <b>{money(r.total)}</b>, sortValue: (r) => r.total },
	]
	const rows = list.query.data?.data || []
	return (
		<>
			<div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
				{summary.map((b) => (
					<StatCard key={b.bucket} label={`${b.bucket} days`} value={money(b.amount)} tone={b.bucket === "90+" ? "red" : b.bucket === "61-90" ? "orange" : b.bucket === "31-60" ? "gold" : "brand"} hint={`${b.invoices} invoices · ${total ? Math.round((100 * b.amount) / total) : 0}%`} loading={list.query.isLoading} />
				))}
			</div>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:items-center">
				<FilterSelect value={programme} onChange={setProgramme} options={opts.programmes} placeholder="All programmes" />
				<FilterSelect value={campus} onChange={setCampus} options={opts.campuses} placeholder="All campuses" />
				<Button className="lg:ml-auto" size="sm" variant="secondary" icon={Download} disabled={!rows.length} onClick={() => exportCsv(`receivables-aging-${today()}`, cols, rows)}>Export</Button>
			</div>
			<DataTable query={list.query} rowKey="student" empty="No outstanding invoices" emptyIcon={ShieldCheck} initialSort={{ key: "total", dir: "desc" }} cols={cols} footer={rows.length ? (
				<div className="flex justify-end gap-6 text-sm"><span className="text-ink-soft">Total outstanding <b className="text-ink">{money(total)}</b></span></div>
			) : null} />
		</>
	)
}

const GROUPS = [
	{ value: "day", label: "By day" },
	{ value: "month", label: "By month" },
	{ value: "mode", label: "By payment mode" },
	{ value: "programme", label: "By programme" },
	{ value: "payment_for", label: "By purpose" },
]

function Collections() {
	const [from, setFrom] = useState(daysAgo(30))
	const [to, setTo] = useState(today())
	const [group, setGroup] = useState("day")
	const q = useApi(`${F}collections_report`, { from_date: from || undefined, to_date: to || undefined, group_by: group }, { placeholderData: (p) => p })
	const d = q.data || {}
	const label = (r) => (group === "day" ? date(r.key, { day: "numeric", month: "short" }) : group === "month" ? monthLabel(r.key) : r.label || r.key || "Unassigned")
	const rows = (d.data || []).map((r) => ({ ...r, name: r.key, display: label(r) }))
	const cols = [
		{ key: "display", label: GROUPS.find((g) => g.value === group)?.label.replace("By ", "").replace(/^./, (c) => c.toUpperCase()) },
		{ key: "count", label: "Payments", align: "right", render: (r) => num(r.count) },
		{ key: "amount", label: "Collected", align: "right", render: (r) => <b>{money(r.amount)}</b>, sortValue: (r) => r.amount },
		{ key: "share", label: "Share", align: "right", hideOnMobile: true, render: (r) => `${d.total ? Math.round((100 * r.amount) / d.total) : 0}%`, exportValue: (r) => (d.total ? ((100 * r.amount) / d.total).toFixed(1) : 0) },
	]
	return (
		<>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
				<Select value={group} onChange={(e) => setGroup(e.target.value)} options={GROUPS} aria-label="Group by" className="lg:w-48" />
				<Button className="lg:ml-auto" size="sm" variant="secondary" icon={Download} disabled={!rows.length} onClick={() => exportCsv(`collections-${group}-${d.from_date}-${d.to_date}`, cols, rows)}>Export</Button>
			</div>
			<div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
				<StatCard label="Collected" value={money(d.total)} icon={TrendingUp} tone="green" loading={q.isLoading} hint={d.from_date ? `${date(d.from_date)} – ${date(d.to_date)}` : undefined} />
				<StatCard label="Payments" value={num(d.count)} loading={q.isLoading} />
				<StatCard className="col-span-2 lg:col-span-1" label="Average payment" value={d.count ? money(d.total / d.count) : "—"} loading={q.isLoading} />
			</div>
			{rows.length ? (
				<Panel title="Collections" subtitle={GROUPS.find((g) => g.value === group)?.label} className="mb-4">
					{group === "day" || group === "month" ? (
						<TrendChart data={rows} xKey="display" series={[{ key: "amount", label: "Collected" }]} height={240} format={(v) => money(v)} />
					) : (
						<BarsChart data={rows} xKey="display" series={[{ key: "amount", label: "Collected", color: "#c99a43" }]} height={Math.max(180, rows.length * 38)} horizontal format={(v) => money(v)} />
					)}
				</Panel>
			) : null}
			<DataTable query={q} rows={q.data ? rows : undefined} empty="No payments in this period" emptyIcon={TrendingUp} cols={cols} />
		</>
	)
}
