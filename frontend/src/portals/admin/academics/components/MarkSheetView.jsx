import { useMemo, useState } from "react"
import clsx from "clsx"
import { Badge, Panel, StatCard } from "@/shared/components/ui"
import { DataTable, ExportButton, SearchInput, Toolbar } from "@/shared/components/kit"
import { Award, CheckCircle2, TrendingUp, Users } from "lucide-react"
import { fmtScore, rate } from "../lib"
import { ResultBadge } from "./common"

export const COMPONENT_LABEL = { cat: "CAT", assignment: "Assignments", exam: "Exam", other: "Other" }
const SHORT = { cat: "CAT", assignment: "Asgn", exam: "Exam", other: "Other" }
const RESULT_ORDER = ["Pass", "Fail", "Incomplete", "Absent"]

export function activeComponents(weights = {}) {
	return Object.keys(COMPONENT_LABEL).filter((c) => Number(weights[c] || 0) > 0)
}

/** Grades ordered from the best average total down, so the chart reads A → F whatever the scale. */
export function gradeBars(entries = []) {
	const by = {}
	for (const e of entries) {
		const g = e.grade || "—"
		by[g] = by[g] || { label: g, value: 0, sum: 0, fail: 0 }
		by[g].value += 1
		if (e.result_status === "Fail") by[g].fail += 1
		by[g].sum += Number(e.total || 0)
	}
	return Object.values(by)
		.sort((a, b) => b.sum / b.value - a.sum / a.value)
		.map(({ label, value, fail }) => ({ label, value, fail: fail === value }))
}

/** Small column chart of students per grade; failing grades in red. Counts sit above the bars. */
export function GradeBars({ bars, height }) {
	const max = Math.max(...bars.map((b) => b.value), 1)
	return (
		<div className="flex items-end gap-2" style={{ height }} role="img" aria-label={bars.map((b) => `${b.label}: ${b.value}`).join(", ")}>
			{bars.map((b) => (
				<div key={b.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${b.label}: ${b.value} student${b.value === 1 ? "" : "s"}`}>
					<span className="text-xs font-semibold tabular-nums text-ink">{b.value}</span>
					<div className={clsx("w-full max-w-[2.5rem] rounded-t-md", b.fail ? "bg-red-500/80" : "bg-brand-700")} style={{ height: `${Math.max((b.value / max) * 75, 4)}%` }} />
					<span className="max-w-full truncate text-xs font-semibold text-ink-muted">{b.label}</span>
				</div>
			))}
		</div>
	)
}

export function SheetKpis({ sheet }) {
	const passRate = rate(sheet.pass_count, sheet.student_count)
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<StatCard label="Students" value={sheet.student_count || 0} icon={Users} />
			<StatCard label="Pass rate" value={passRate === null ? "—" : `${passRate}%`} icon={CheckCircle2} tone={passRate === null ? "gray" : passRate >= 70 ? "green" : passRate >= 50 ? "orange" : "red"} hint={`${sheet.pass_count || 0} passed · pass mark ${fmtScore(sheet.pass_mark)}`} />
			<StatCard label="Average" value={fmtScore(sheet.average_score)} icon={TrendingUp} tone="blue" hint="out of 100" />
			<StatCard label="Highest" value={fmtScore(sheet.highest_score)} icon={Award} tone="gold" />
		</div>
	)
}

export function GradePanel({ sheet, height = 200 }) {
	const bars = useMemo(() => gradeBars(sheet.entries), [sheet.entries])
	const results = useMemo(() => {
		const c = {}
		for (const e of sheet.entries || []) c[e.result_status || "—"] = (c[e.result_status || "—"] || 0) + 1
		return c
	}, [sheet.entries])
	return (
		<Panel title="Grade distribution" subtitle={sheet.grading_scale ? `Scale: ${sheet.grading_scale}` : undefined}>
			{bars.length ? <GradeBars bars={bars} height={height} /> : <p className="py-8 text-center text-sm text-ink-soft">No students on this sheet.</p>}
			<div className="mt-3 flex flex-wrap gap-2">
				{RESULT_ORDER.filter((r) => results[r]).map((r) => (
					<span key={r} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
						<ResultBadge status={r} /> {results[r]}
					</span>
				))}
			</div>
		</Panel>
	)
}

export function WeightsPanel({ sheet }) {
	const comps = Object.keys(COMPONENT_LABEL)
	return (
		<Panel title="Weights" subtitle="Each component's share of the final mark">
			<div className="flex h-3 overflow-hidden rounded-full bg-line/60">
				{comps.map((c, i) =>
					Number(sheet.weights?.[c] || 0) > 0 ? <div key={c} className={clsx("h-full", ["bg-brand-700", "bg-gold-500", "bg-emerald-500", "bg-sky-500"][i])} style={{ width: `${sheet.weights[c]}%` }} title={`${COMPONENT_LABEL[c]} ${sheet.weights[c]}%`} /> : null
				)}
			</div>
			<dl className="mt-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2 xl:grid-cols-1">
				{comps.map((c, i) => (
					<div key={c} className={clsx("flex items-center justify-between rounded-lg px-2 py-1", Number(sheet.weights?.[c] || 0) > 0 ? "bg-cream/60 dark:bg-white/5" : "opacity-50")}>
						<dt className="flex min-w-0 items-center gap-1.5 truncate text-ink-muted">
							<span className={clsx("h-2 w-2 rounded-full", ["bg-brand-700", "bg-gold-500", "bg-emerald-500", "bg-sky-500"][i])} />
							{COMPONENT_LABEL[c]}
						</dt>
						<dd className="ml-2 font-semibold tabular-nums text-ink">{fmtScore(sheet.weights?.[c] || 0)}%</dd>
					</div>
				))}
			</dl>
		</Panel>
	)
}

function Score({ value, pending, overridden }) {
	if (pending) return <span className="text-xs font-semibold text-orange-600" title="Not marked yet">pending</span>
	return (
		<span className={clsx("tabular-nums", overridden && "underline decoration-dotted decoration-gold-500 underline-offset-2")} title={overridden ? "Entered by the lecturer" : undefined}>
			{fmtScore(value, 2)}
		</span>
	)
}

/** Read-only entries table: one column per weighted component, then total, grade and result. */
export function EntriesTable({ sheet, maxHeight, dense }) {
	const [search, setSearch] = useState("")
	const [result, setResult] = useState("all")
	const comps = activeComponents(sheet.weights)
	const entries = sheet.entries || []
	const counts = useMemo(() => {
		const c = {}
		for (const e of entries) c[e.result_status] = (c[e.result_status] || 0) + 1
		return c
	}, [entries])
	const rows = useMemo(() => {
		const s = search.trim().toLowerCase()
		return entries.filter((e) => (result === "all" || e.result_status === result) && (!s || [e.student_name, e.student_number, e.student].some((v) => String(v || "").toLowerCase().includes(s))))
	}, [entries, search, result])
	const cols = [
		{
			key: "student_name",
			label: "Student",
			render: (e) => (
				<div className="min-w-0">
					<div className="truncate font-medium text-ink">{e.student_name}</div>
					<div className="text-xs text-ink-soft">{e.student_number || e.student}</div>
				</div>
			),
			exportValue: (e) => e.student_name,
		},
		...comps.map((c) => ({
			key: `${c}_score`,
			label: `${SHORT[c]} /${fmtScore(sheet.weights[c])}`,
			align: "right",
			render: (e) => <Score value={e[`${c}_score`]} pending={e.pending_components?.includes(c)} overridden={e.overridden_components?.includes(c)} />,
			sortValue: (e) => Number(e[`${c}_score`] || 0),
		})),
		{ key: "total", label: "Total", align: "right", render: (e) => <span className="font-semibold tabular-nums text-ink">{fmtScore(e.total, 2)}</span>, sortValue: (e) => Number(e.total || 0) },
		{ key: "grade", label: "Grade", align: "center", render: (e) => <span className="font-bold text-ink">{e.grade || "—"}</span>, sortValue: (e) => Number(e.total || 0) },
		{ key: "result_status", label: "Result", render: (e) => (e.result_status ? <ResultBadge status={e.result_status} /> : "—") },
		{ key: "remarks", label: "Remarks", hideOnMobile: true, render: (e) => <span className="line-clamp-1 text-xs text-ink-muted">{e.remarks || ""}</span> },
	]
	const exportCols = [
		{ key: "student_number", label: "Student no." },
		{ key: "student_name", label: "Student" },
		...comps.map((c) => ({ key: `${c}_score`, label: `${COMPONENT_LABEL[c]} (/${sheet.weights[c]})` })),
		{ key: "total", label: "Total" },
		{ key: "grade", label: "Grade" },
		{ key: "grade_points", label: "Grade points" },
		{ key: "result_status", label: "Result" },
		{ key: "remarks", label: "Remarks" },
	]
	const chips = [{ id: "all", label: "All", count: entries.length }, ...RESULT_ORDER.filter((r) => counts[r]).map((r) => ({ id: r, label: r, count: counts[r] }))]
	return (
		<>
			<div className="mb-4 space-y-3">
				<div className="flex items-center gap-2">
					<SearchInput value={search} onChange={setSearch} placeholder="Search student…" className="min-w-0 flex-1" />
					<ExportButton filename={`${sheet.name}-entries`} cols={exportCols} rows={rows} />
				</div>
				<Toolbar className="!mb-0" chips={chips} active={result} onChip={setResult} />
			</div>
			<DataTable cols={cols} rows={rows} rowKey={(e) => e.student} dense={dense} maxHeight={maxHeight} initialSort={{ key: "total", dir: "desc" }} empty={entries.length ? "No students match" : "No students on this sheet"} />
			{entries.some((e) => e.overridden_components?.length) || entries.some((e) => e.pending_components?.length) ? (
				<p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
					<span>
						Scores are weighted points (e.g. CAT /{fmtScore(sheet.weights?.cat)} means out of {fmtScore(sheet.weights?.cat)}).
					</span>
					{entries.some((e) => e.overridden_components?.length) ? <span className="underline decoration-dotted decoration-gold-500 underline-offset-2">Dotted = entered by the lecturer</span> : null}
					{entries.some((e) => e.pending_components?.length) ? (
						<span>
							<Badge tone="orange" size="xs">
								pending
							</Badge>{" "}
							= not marked yet (grade I)
						</span>
					) : null}
				</p>
			) : null}
		</>
	)
}
