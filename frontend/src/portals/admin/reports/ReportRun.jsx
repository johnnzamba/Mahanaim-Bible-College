import { useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { BarChart3, Download, Play, Printer, RotateCcw, Table2 } from "lucide-react"
import { useApi, useAction } from "@/shared/api/hooks"
import { Badge, Button, Empty, ErrorState, Input, PageHeader, Panel, Select, SkeletonRows } from "@/shared/components/ui"
import { BarRow, DataTable, SearchInput } from "@/shared/components/kit"
import { BarsChart, DonutChart, Legendary, TrendChart } from "@/shared/components/Charts"
import { money, num } from "@/shared/utils/format"
import { BLURB, CellLink, M, NoReports, categoryOf, cellRoute, defaultNote, fmtCell, fmtSummary, humanise, rememberReport, useCatalog, useLinkOptions, useReportsAccess } from "./lib"

const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== "" && v != null))

function download({ content, filename, mimetype }) {
	const blob = new Blob([content ?? ""], { type: mimetype || "text/csv" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename || "report.csv"
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** /admin/reports/:report: dynamic filters from the catalog definition → run_report → summary, chart, table, CSV. */
export default function ReportRun() {
	const { report } = useParams()
	const { allowed, roles } = useReportsAccess()
	const cat = useCatalog()
	const def = (Array.isArray(cat.data) ? cat.data : []).find((r) => r.key === report)
	const [params, setParams] = useSearchParams()
	const keys = useMemo(() => (def?.filters || []).map((f) => f.key), [def])
	const applied = useMemo(() => clean(Object.fromEntries(keys.map((k) => [k, params.get(k) || ""]))), [keys, params])
	const [draft, setDraft] = useState(applied)
	const appliedKey = JSON.stringify(applied)
	useEffect(() => setDraft(JSON.parse(appliedKey)), [appliedKey])
	const dirty = JSON.stringify(clean(draft)) !== appliedKey

	const q = useApi(`${M}run_report`, { report, filters: appliedKey }, { enabled: Boolean(def) && allowed, placeholderData: (prev) => prev, staleTime: 30_000 })
	useEffect(() => {
		if (q.data && def) rememberReport(def.key)
	}, [q.data, def])
	const exp = useAction(`${M}export_report`, {
		success: (d) => `Exported ${num(d.rows)} rows`,
		onSuccess: (d) => download(d),
	})

	const run = () => setParams(clean(draft))
	const reset = () => {
		setDraft({})
		setParams({})
	}

	if (!allowed) {
		return (
			<>
				<PageHeader title="Reports" back={{ to: "/admin/reports", label: "Reports" }} />
				<NoReports />
			</>
		)
	}
	if (cat.isLoading) {
		return (
			<div className="card p-5">
				<SkeletonRows rows={8} />
			</div>
		)
	}
	if (!def) {
		return (
			<>
				<PageHeader title="Report not available" back={{ to: "/admin/reports", label: "Reports" }} />
				<div className="card">
					{cat.isError ? (
						<ErrorState error={cat.error} onRetry={() => cat.refetch()} />
					) : (
						<Empty icon={BarChart3} title="This report is not available to you" subtitle="It may have been renamed, or your role cannot run it." action={<Link to="/admin/reports" className="btn btn-secondary btn-sm">All reports</Link>} />
					)}
				</div>
			</>
		)
	}
	const meta = categoryOf(def.category)
	const d = q.data
	return (
		<div className="space-y-5">
			<PageHeader
				back={{ to: "/admin/reports", label: "Reports" }}
				eyebrow={def.category}
				title={def.label}
				subtitle={BLURB[def.key]}
				actions={
					<>
						<Button variant="ghost" size="sm" icon={Printer} onClick={() => window.print()} disabled={!d?.rows?.length}>
							Print
						</Button>
						<Button variant="secondary" size="sm" icon={Download} loading={exp.isPending} disabled={!d?.rows?.length} onClick={() => exp.mutate({ report, filters: appliedKey })}>
							Export CSV
						</Button>
					</>
				}
			/>

			{def.filters?.length ? (
				<div className="card no-print p-4 sm:p-5">
					<form
						onSubmit={(e) => {
							e.preventDefault()
							run()
						}}
						className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
					>
						{def.filters.map((f) => (
							<FilterControl key={f.key} f={f} value={draft[f.key] ?? ""} term={draft.academic_term} onChange={(v) => setDraft((x) => ({ ...x, [f.key]: v }))} />
						))}
						<div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
							<Button type="submit" icon={Play} size="sm" loading={q.isFetching && !q.isLoading}>
								{dirty ? "Run report" : "Run again"}
							</Button>
							{Object.keys(applied).length || Object.keys(clean(draft)).length ? (
								<Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>
									Clear filters
								</Button>
							) : null}
							{dirty ? (
								<span className="text-xs text-amber-700">Filters changed. Run the report to update the results.</span>
							) : defaultNote(report, applied, d?.summary) ? (
								<span className="text-xs text-ink-soft">{defaultNote(report, applied, d?.summary)}</span>
							) : null}
						</div>
					</form>
				</div>
			) : null}

			{q.isLoading ? (
				<div className="card p-5">
					<SkeletonRows rows={8} />
				</div>
			) : q.isError ? (
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} title="This report couldn't run" />
				</div>
			) : d ? (
				<Results d={d} roles={roles} report={report} icon={meta.icon} />
			) : null}
		</div>
	)
}

function FilterControl({ f, value, onChange, term }) {
	if (f.type === "Link") return <LinkFilter f={f} value={value} onChange={onChange} term={term} />
	if (f.type === "Select") {
		const options = String(f.options || "")
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean)
		return <Select label={f.label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder="Any" />
	}
	if (f.type === "Date") return <Input type="date" label={f.label} value={value} onChange={(e) => onChange(e.target.value)} />
	if (f.type === "Int" || f.type === "Currency" || f.type === "Float") {
		return <Input type="number" min="0" step={f.type === "Int" ? 1 : "any"} label={f.label} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Any" />
	}
	if (f.type === "Check") {
		return <Select label={f.label} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: "1", label: "Yes" }, { value: "0", label: "No" }]} placeholder="Any" />
	}
	return <Input label={f.label} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Any" />
}

function LinkFilter({ f, value, onChange, term }) {
	const { options, free } = useLinkOptions(f.options, { term })
	if (free) return <Input label={f.label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${f.options || f.label} ID`} />
	const opts = options || []
	const withValue = value && !opts.some((o) => o.value === value) ? [{ value, label: value }, ...opts] : opts
	return <Select label={f.label} value={value} onChange={(e) => onChange(e.target.value)} options={withValue} placeholder="All" />
}

const MONEY_SERIES = /collect|amount|outstanding|committed|disbursed|giving|balance|billed|paid/i

function Results({ d, roles, report, icon }) {
	const [search, setSearch] = useState("")
	const columns = d.columns || []
	const rows = d.rows || []
	const filtered = useMemo(() => {
		const s = search.trim().toLowerCase()
		if (!s) return rows
		return rows.filter((r) => columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(s)))
	}, [rows, columns, search])
	const cols = useMemo(
		() =>
			columns.map((c, i) => ({
				key: c.key,
				label: c.label,
				align: ["Currency", "Int", "Float", "Percent"].includes(c.type) ? "right" : undefined,
				hideOnMobile: i > 3,
				sortValue: (r) => r[c.key],
				render: (r) => {
					const text = fmtCell(r[c.key], c.type, c.key)
					if (c.type === "Percent" && r[c.key] != null) {
						const v = Number(r[c.key])
						return <span className={v >= 75 ? "text-emerald-700 dark:text-emerald-400" : v >= 50 ? "text-amber-700" : "text-red-600"}>{text}</span>
					}
					if (c.key === "status" || c.key === "fee_status" || c.key === "lms_sync_status") return r[c.key] ? <Badge status={r[c.key]}>{r[c.key]}</Badge> : "—"
					return <CellLink to={cellRoute(report, c.key, r[c.key], r)} roles={roles}>{text}</CellLink>
				},
			})),
		[columns, report, roles]
	)
	const summary = d.summary || {}
	const scalars = Object.entries(summary).filter(([, v]) => v == null || typeof v !== "object")
	const nested = rows.length ? Object.entries(summary).filter(([k, v]) => v && typeof v === "object" && k !== "stages" && hasNumbers(v)) : []
	const chart = rows.length && d.chart?.labels?.length ? d.chart : null
	return (
		<>
			{scalars.length ? (
				<div className="grid grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
					<SummaryTile label="Rows" value={num(rows.length)} />
					{scalars.map(([k, v]) => (
						<SummaryTile key={k} label={columns.find((c) => c.key === k)?.label || humanise(k)} value={fmtSummary(k, v, columns)} wide={typeof v === "string" && v.length > 10} />
					))}
				</div>
			) : null}

			{chart || nested.length ? (
				<div className={`grid gap-5 ${chart && nested.length ? "lg:grid-cols-3" : ""}`}>
					{chart ? (
						<Panel title="Chart" subtitle={(chart.datasets || []).map((x) => x.name).join(" · ")} icon={BarChart3} className={nested.length ? "lg:col-span-2" : ""}>
							<ReportChart chart={chart} />
						</Panel>
					) : null}
					{nested.length ? (
						<Panel title="Breakdown" icon={icon}>
							<div className="space-y-5">
								{nested.map(([k, v]) => (
									<Breakdown key={k} name={k} value={v} />
								))}
							</div>
						</Panel>
					) : null}
				</div>
			) : null}

			<Panel
				title="Results"
				subtitle={search ? `${num(filtered.length)} of ${num(rows.length)} rows` : `${num(rows.length)} row${rows.length === 1 ? "" : "s"}${rows.length >= 5000 ? " (first 5,000)" : ""}`}
				icon={Table2}
				bodyClass="p-0"
				actions={rows.length > 10 ? <SearchInput value={search} onChange={setSearch} placeholder="Filter rows…" className="hidden w-56 sm:block" /> : null}
			>
				{rows.length > 10 ? (
					<div className="border-b border-line p-3 sm:hidden">
						<SearchInput value={search} onChange={setSearch} placeholder="Filter rows…" />
					</div>
				) : null}
				<DataTable cols={cols} rows={filtered} rowKey={(r) => JSON.stringify(r).slice(0, 200)} pageSize={25} dense className="rounded-none border-0 shadow-none" empty={<Empty compact icon={Table2} title="No rows for these filters" subtitle="Widen the filters or clear them and run again." />} />
			</Panel>
		</>
	)
}

/** A breakdown is only worth drawing when at least one of its values is non-zero. */
function hasNumbers(v) {
	const vals = Array.isArray(v) ? v.flatMap((o) => (o && typeof o === "object" ? Object.values(o) : [])) : Object.values(v)
	return vals.some((x) => typeof x === "number" && x !== 0)
}

function SummaryTile({ label, value, wide }) {
	return (
		<div className={`card min-w-0 px-4 py-3 ${wide ? "col-span-2" : ""}`}>
			<div className="line-clamp-2 text-[11px] font-semibold uppercase leading-snug tracking-wide text-ink-soft" title={label}>
				{label}
			</div>
			<div className="mt-0.5 truncate text-lg font-bold text-ink" title={String(value)}>
				{value}
			</div>
		</div>
	)
}

/** Summary values that are objects or lists, e.g. by_status {Admitted: 3} or by_mode [{mode, amount}]. */
function Breakdown({ name, value }) {
	let items = []
	if (Array.isArray(value)) {
		items = value
			.map((o) => {
				if (o == null || typeof o !== "object") return null
				const label = Object.values(o).find((x) => typeof x === "string")
				const numKey = Object.keys(o).find((k) => typeof o[k] === "number")
				return label != null && numKey ? { label, value: o[numKey], money: MONEY_SERIES.test(numKey) } : null
			})
			.filter(Boolean)
	} else {
		items = Object.entries(value).map(([label, v]) => ({ label, value: Number(v) || 0, money: MONEY_SERIES.test(name) }))
	}
	const max = Math.max(1, ...items.map((i) => i.value))
	return (
		<div>
			<div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{humanise(name)}</div>
			<div className="space-y-2.5">
				{items.length ? (
					items.map((i) => <BarRow key={i.label} label={i.label} value={i.value} max={max} caption={i.money ? money(i.value) : num(i.value)} />)
				) : (
					<p className="text-sm text-ink-soft">Nothing to break down.</p>
				)}
			</div>
		</div>
	)
}

function ReportChart({ chart }) {
	const sets = chart.datasets || []
	const isMoney = sets.some((s) => MONEY_SERIES.test(s.name || ""))
	const format = isMoney ? (v) => money(v, { compact: true }) : (v) => num(v)
	const data = (chart.labels || []).map((label, i) => {
		const row = { label: String(label) }
		sets.forEach((s, j) => {
			row[`s${j}`] = Number(s.values?.[i] || 0)
		})
		return row
	})
	const series = sets.map((s, j) => ({ key: `s${j}`, label: s.name || `Series ${j + 1}` }))
	if (chart.type === "pie" || chart.type === "donut" || chart.type === "percentage") {
		const pie = data.map((r) => ({ label: r.label, value: r.s0 })).filter((r) => r.value > 0)
		if (!pie.length) return <Empty compact title="Nothing to chart" />
		return (
			<div className="grid items-center gap-5 sm:grid-cols-2">
				<DonutChart data={pie} height={220} format={format} center={format(pie.reduce((a, r) => a + r.value, 0))} centerLabel="total" />
				<Legendary data={pie} format={format} />
			</div>
		)
	}
	if (chart.type === "funnel") {
		const top = Math.max(1, data[0]?.s0 || 0)
		return (
			<div className="space-y-3">
				{data.map((r) => (
					<BarRow key={r.label} label={r.label} value={r.s0} max={top} caption={`${format(r.s0)} · ${Math.round((r.s0 / top) * 100)}%`} />
				))}
			</div>
		)
	}
	if (!data.some((r) => series.some((s) => r[s.key]))) return <Empty compact title="Nothing to chart for these filters" />
	if (chart.type === "line") return <TrendChart data={data} series={series} height={260} format={format} />
	const horizontal = data.length > 8 && data.length <= 25 && data.some((r) => r.label.length > 12)
	return <BarsChart data={data} series={series} height={horizontal ? Math.max(260, data.length * 28) : 260} format={format} horizontal={horizontal} />
}
