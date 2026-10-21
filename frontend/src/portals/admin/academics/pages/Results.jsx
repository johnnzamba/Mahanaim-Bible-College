import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Award, CheckCircle2, ClipboardCheck, Clock, FileSpreadsheet, Layers, Send } from "lucide-react"
import { Alert, Button, ConfirmDialog, Drawer, Empty, ErrorState, Modal, PageHeader, Panel, ProgressBar, SkeletonRows, StatCard } from "@/shared/components/ui"
import { BarRow, DataTable, ExportButton, Toolbar } from "@/shared/components/kit"
import { DonutChart, Legendary } from "@/shared/components/Charts"
import { useAction, useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { ACAD, BASE, RESULTS, RESULT_COLORS, SHEET_STATUS, fmtScore, rate, rowsOf, useAcademicRoles, useLookups, useTermParam } from "../lib"
import { SheetBadge, SubNav, TermSelect } from "../components/common"
import { EntriesTable, GradeBars, GradePanel, SheetKpis } from "../components/MarkSheetView"

const STATUSES = ["Not Started", ...SHEET_STATUS]
const LIST = "frappe.client.get_list"
const passTone = (p) => (p === null ? "gray" : p >= 70 ? "green" : p >= 50 ? "orange" : "red")

/**
 * Published Course Results grouped server-side. Open to the Auditor too (DocType read permission),
 * unlike results_overview / grade_distribution(term), which require an academic administrator.
 */
function useResultGroups(term) {
	const base = { doctype: "Course Result", filters: { academic_term: term, is_published: 1 }, limit_page_length: 500 }
	const byProgramme = useApi(LIST, { ...base, fields: ["programme", "result_status", { COUNT: "*", as: "count" }], group_by: "programme, result_status" }, { enabled: Boolean(term) })
	const byGrade = useApi(
		LIST,
		{ ...base, fields: ["grade", { COUNT: "*", as: "count" }, { AVG: "total_score", as: "avg" }, { MAX: "total_score", as: "high" }, { MIN: "total_score", as: "low" }], group_by: "grade" },
		{ enabled: Boolean(term) }
	)
	return { byProgramme, byGrade }
}

/** The Auditor can't call results_overview, so the same rows are rebuilt from offerings + Mark Sheet reads. */
function useAuditorSheets(term, enabled) {
	const offerings = useApi(`${ACAD}list_offerings`, { term, page_length: 200 }, { enabled: enabled && Boolean(term) })
	const sheets = useApi(
		LIST,
		{ doctype: "Mark Sheet", filters: { academic_term: term }, fields: ["name", "course_offering", "status", "student_count", "pass_count", "average_score"], limit_page_length: 500 },
		{ enabled: enabled && Boolean(term) }
	)
	const rows = useMemo(() => {
		if (!offerings.data || !sheets.data) return undefined
		const by = Object.fromEntries((sheets.data || []).map((s) => [s.course_offering, s]))
		return rowsOf(offerings.data)
			.filter((o) => o.status !== "Cancelled")
			.map((o) => {
				const s = by[o.name]
				return {
					course_offering: o.name,
					course_title: o.course_title,
					campus: o.campus,
					mark_sheet: s?.name || null,
					status: s?.status || "Not Started",
					student_count: s?.student_count || 0,
					pass_count: s?.pass_count || 0,
					average_score: s?.average_score || 0,
				}
			})
	}, [offerings.data, sheets.data])
	return { rows, isLoading: offerings.isLoading || sheets.isLoading, isError: offerings.isError || sheets.isError, error: offerings.error || sheets.error, refetch: () => (offerings.refetch(), sheets.refetch()), truncated: (offerings.data?.total || 0) > 200 }
}

function SheetDrawer({ name, onClose }) {
	const q = useApi(`${RESULTS}get_mark_sheet_by_name`, { name }, { enabled: Boolean(name) })
	const s = q.data
	return (
		<Drawer open={Boolean(name)} onClose={onClose} width="max-w-4xl" title={s ? s.course_title : "Mark sheet"} subtitle={s ? `${s.name} · ${s.course_offering} · ${s.status}` : name}>
			{q.isLoading ? (
				<SkeletonRows rows={8} />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={q.refetch} />
			) : s ? (
				<div className="space-y-5">
					<SheetKpis sheet={s} />
					<GradePanel sheet={s} height={170} />
					<EntriesTable sheet={s} dense />
				</div>
			) : null}
		</Drawer>
	)
}

export default function Results() {
	const roles = useAcademicRoles()
	const readOnly = !roles.admin
	const navigate = useNavigate()
	const lookups = useLookups()
	const L = lookups.data
	const [term, setTerm] = useTermParam(L)
	const [status, setStatus] = useState("all")
	const [search, setSearch] = useState("")
	const [drawer, setDrawer] = useState(null)
	const [confirmBulk, setConfirmBulk] = useState(false)
	const [bulkResult, setBulkResult] = useState(null)

	const overview = useApi(`${RESULTS}results_overview`, { term }, { enabled: Boolean(term) && !readOnly })
	const dist = useApi(`${RESULTS}grade_distribution`, { term }, { enabled: Boolean(term) && !readOnly })
	const auditor = useAuditorSheets(term, readOnly)
	const { byProgramme, byGrade } = useResultGroups(term)
	const bulk = useAction(`${RESULTS}bulk_publish`, {
		invalidate: [RESULTS, `${ACAD}academics_stats`, LIST, `${ACAD}list_offerings`],
		success: false,
		onSuccess: (r) => {
			setConfirmBulk(false)
			setBulkResult(r)
		},
	})

	const sheets = readOnly ? auditor.rows : overview.data?.sheets
	const sheetQuery = readOnly ? auditor : overview
	const totals = useMemo(() => {
		if (!readOnly) return overview.data?.totals || {}
		const t = {}
		for (const r of auditor.rows || []) t[r.status] = (t[r.status] || 0) + 1
		return t
	}, [readOnly, overview.data, auditor.rows])
	const offeringCount = (sheets || []).length
	const published = totals.Published || 0
	const approved = totals.Approved || 0

	const grades = useMemo(() => {
		if (!readOnly && dist.data) return { bars: (dist.data.grades || []).map((g) => ({ label: g.grade, value: g.count })), count: dist.data.count, average: dist.data.average, highest: dist.data.highest, lowest: dist.data.lowest, statuses: dist.data.statuses || {} }
		const rows = byGrade.data || []
		if (!rows.length) return { bars: [], count: 0, statuses: {} }
		const count = rows.reduce((a, r) => a + r.count, 0)
		const statuses = {}
		for (const r of byProgramme.data || []) statuses[r.result_status || "—"] = (statuses[r.result_status || "—"] || 0) + r.count
		return {
			bars: [...rows].sort((a, b) => b.avg - a.avg).map((r) => ({ label: r.grade || "—", value: r.count })),
			count,
			average: rows.reduce((a, r) => a + r.avg * r.count, 0) / count,
			highest: Math.max(...rows.map((r) => r.high)),
			lowest: Math.min(...rows.map((r) => r.low)),
			statuses,
		}
	}, [readOnly, dist.data, byGrade.data, byProgramme.data])
	const publishedPass = rate(grades.statuses.Pass, grades.count)

	const programmes = useMemo(() => {
		const names = Object.fromEntries((L?.programmes || []).map((p) => [p.name, p.programme_name]))
		const by = {}
		const row = (code) => (by[code] = by[code] || { programme: code, programme_name: code === "__none" ? "No programme" : names[code] || code, offerings: null, published_sheets: null, results: 0, pass: 0 })
		for (const p of overview.data?.programmes || []) {
			if (p.programme === "Unassigned") continue
			const r = row(p.programme)
			r.offerings = p.offerings
			r.published_sheets = p.Published || 0
		}
		for (const g of byProgramme.data || []) {
			const r = row(g.programme || "__none")
			r.results += g.count
			if (g.result_status === "Pass") r.pass += g.count
		}
		return Object.values(by).sort((a, b) => a.programme_name.localeCompare(b.programme_name))
	}, [overview.data, byProgramme.data, L])

	const rows = useMemo(() => {
		const s = search.trim().toLowerCase()
		return (sheets || []).filter((r) => (status === "all" || r.status === status) && (!s || [r.course_title, r.course_offering, r.campus].some((v) => String(v || "").toLowerCase().includes(s))))
	}, [sheets, status, search])

	const donut = STATUSES.map((s) => ({ label: s, value: totals[s] || 0, color: RESULT_COLORS[s] })).filter((d) => d.value)
	const cols = [
		{
			key: "course_title",
			label: "Course offering",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.course_title}</div>
					<div className="truncate text-xs text-ink-soft">
						{r.course_offering} · {r.campus}
					</div>
				</div>
			),
			exportValue: (r) => `${r.course_offering} ${r.course_title}`,
		},
		{ key: "student_count", label: "Students", align: "right", render: (r) => r.student_count || "—" },
		{
			key: "pass",
			label: "Pass rate",
			render: (r) => {
				const p = rate(r.pass_count, r.student_count)
				return p === null ? (
					<span className="text-ink-soft">—</span>
				) : (
					<div className="flex min-w-[7rem] items-center gap-2">
						<ProgressBar value={p} tone={passTone(p)} size="sm" className="flex-1" />
						<span className="w-10 text-right text-xs tabular-nums text-ink-muted">{p}%</span>
					</div>
				)
			},
			sortValue: (r) => rate(r.pass_count, r.student_count) ?? -1,
			exportValue: (r) => rate(r.pass_count, r.student_count) ?? "",
		},
		{ key: "average_score", label: "Average", align: "right", hideOnMobile: true, render: (r) => (r.student_count ? fmtScore(r.average_score) : "—"), sortValue: (r) => Number(r.average_score || 0) },
		{ key: "status", label: "Mark sheet", render: (r) => <SheetBadge status={r.status} size="xs" /> },
	]
	const chips = [{ id: "all", label: "All", count: offeringCount }, ...STATUSES.filter((s) => totals[s]).map((s) => ({ id: s, label: s, count: totals[s] }))]
	const openRow = (r) => {
		if (!r.mark_sheet) return
		if (readOnly) setDrawer(r.mark_sheet)
		else navigate(`${BASE}/mark-sheets/${encodeURIComponent(r.mark_sheet)}`)
	}

	return (
		<div>
			<PageHeader
				eyebrow="Academics"
				title="Term results"
				subtitle="Mark sheet progress, grade distribution and pass rates for a term."
				actions={
					<>
						<TermSelect lookups={L} value={term} onChange={setTerm} className="min-w-[13rem]" />
						{roles.registrar ? (
							<Button variant="gold" icon={Send} disabled={!approved} onClick={() => setConfirmBulk(true)} title={approved ? undefined : "No approved mark sheets to publish"}>
								Publish all approved{approved ? ` (${approved})` : ""}
							</Button>
						) : null}
					</>
				}
			/>
			<SubNav group="results" />
			{readOnly ? (
				<Alert className="mb-4" title="Read-only view">
					You can review mark sheets and published results. Approving and publishing are done by the Academic Dean and the Registrar.
				</Alert>
			) : null}
			{readOnly && auditor.truncated ? <Alert tone="warning" className="mb-4">Showing the first 200 offerings of this term.</Alert> : null}
			{!term ? (
				<Empty icon={Layers} title="Choose a term" subtitle="Results are reviewed one academic term at a time." />
			) : sheetQuery.isError ? (
				<ErrorState error={sheetQuery.error} onRetry={sheetQuery.refetch} />
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						<StatCard label="Offerings" value={sheets ? offeringCount : "—"} icon={Layers} loading={!sheets} hint="One mark sheet each" />
						<StatCard label="Published" value={sheets ? published : "—"} icon={ClipboardCheck} tone="green" loading={!sheets} hint={offeringCount ? `${rate(published, offeringCount)}% of offerings` : undefined} />
						<StatCard
							label="In review"
							value={sheets ? (totals.Submitted || 0) + approved : "—"}
							icon={approved ? Send : Clock}
							tone={approved ? "purple" : "orange"}
							loading={!sheets}
							hint={`${totals.Submitted || 0} to approve · ${approved} to publish`}
							to={readOnly ? undefined : `${BASE}/mark-sheets?status=${approved && !totals.Submitted ? "Approved" : "Submitted"}&term=${encodeURIComponent(term)}`}
						/>
						<StatCard
							label="With lecturers"
							value={sheets ? (totals["Not Started"] || 0) + (totals.Draft || 0) + (totals.Returned || 0) : "—"}
							icon={FileSpreadsheet}
							tone="gray"
							loading={!sheets}
							hint="Not yet submitted"
						/>
					</div>

					<div className="mt-5 grid gap-5 lg:grid-cols-2">
						<Panel title="Mark sheet progress" subtitle="One mark sheet per course offering">
							{donut.length ? (
								<div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
									<DonutChart data={donut} height={180} center={`${rate(published, offeringCount) ?? 0}%`} centerLabel="published" />
									<Legendary data={donut} />
								</div>
							) : (
								<SkeletonRows rows={4} />
							)}
						</Panel>
						<Panel title="Grade distribution" subtitle="Published results this term">
							{grades.bars.length ? (
								<>
									<GradeBars bars={grades.bars} height={170} />
									<div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
										{[
											["Results", grades.count],
											["Average", fmtScore(grades.average)],
											["Highest", fmtScore(grades.highest)],
											["Pass rate", publishedPass === null ? "—" : `${publishedPass}%`],
										].map(([l, v]) => (
											<div key={l} className="rounded-lg bg-cream/60 px-2 py-1.5 dark:bg-white/5">
												<div className="text-ink-soft">{l}</div>
												<div className="text-sm font-bold tabular-nums text-ink">{v}</div>
											</div>
										))}
									</div>
								</>
							) : dist.isLoading || byGrade.isLoading ? (
								<SkeletonRows rows={4} />
							) : (
								<Empty compact icon={Award} title="Nothing published yet" subtitle="Grades appear here once the Registrar publishes mark sheets." />
							)}
						</Panel>
					</div>

					<Panel className="mt-5" title="By programme" subtitle={readOnly ? "Pass rate of published results, by the student's programme" : "Offerings in each programme's curriculum, and the pass rate of published results"}>
						{programmes.length ? (
							<div className="space-y-3">
								{programmes.map((p) => {
									const pr = rate(p.pass, p.results)
									return (
										<div key={p.programme} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
											<BarRow
												label={
													<span>
														<span className="font-semibold text-ink">{p.programme_name}</span>
														{p.offerings != null ? <span className="text-ink-soft"> · {p.published_sheets}/{p.offerings} sheets published</span> : null}
													</span>
												}
												value={p.offerings ? p.published_sheets : 0}
												max={p.offerings || 1}
												caption={p.offerings != null ? `${rate(p.published_sheets, p.offerings)}%` : ""}
											/>
											<div className="flex items-center gap-2 text-xs">
												<span className="w-20 text-ink-soft">{p.results ? `${p.results} results` : "No results"}</span>
												<ProgressBar value={pr || 0} tone={passTone(pr)} size="sm" className="flex-1" />
												<span className="w-12 text-right font-semibold tabular-nums text-ink">{pr === null ? "—" : `${pr}%`}</span>
											</div>
										</div>
									)
								})}
							</div>
						) : byProgramme.isLoading || overview.isLoading ? (
							<SkeletonRows rows={3} />
						) : (
							<p className="py-4 text-center text-sm text-ink-soft">No programme data for this term.</p>
						)}
					</Panel>

					<Panel className="mt-5" title="By course offering" subtitle={readOnly ? "Open a row to read its mark sheet" : "Open a row to review or act on its mark sheet"} bodyClass="p-3 sm:p-4">
						<Toolbar search={search} onSearch={setSearch} placeholder="Search course or campus…" chips={chips} active={status} onChip={setStatus} right={<ExportButton filename={`results-${term}`} cols={cols} rows={rows} />} />
						<DataTable
							cols={cols}
							rows={sheets ? rows : undefined}
							query={{ isLoading: !sheets && sheetQuery.isLoading, isError: false }}
							rowKey={(r) => r.course_offering}
							onRow={openRow}
							emptyIcon={ClipboardCheck}
							empty="No offerings match"
							initialSort={{ key: "course_title", dir: "asc" }}
						/>
						{!readOnly ? (
							<p className="mt-3 text-xs text-ink-soft">
								Approvals queue:{" "}
								<Link to={`${BASE}/mark-sheets?term=${encodeURIComponent(term)}`} className="font-semibold text-brand-700 hover:underline">
									Mark sheets
								</Link>
							</p>
						) : null}
					</Panel>
				</>
			)}

			<ConfirmDialog
				open={confirmBulk}
				title={`Publish ${approved} approved mark sheet${approved === 1 ? "" : "s"}?`}
				message={`Every approved mark sheet in ${term} is published: course results and transcripts are updated and students are notified. Sheets still awaiting the Dean are not affected.`}
				confirmLabel="Publish all"
				loading={bulk.isPending}
				onConfirm={() => bulk.mutate({ term })}
				onClose={() => setConfirmBulk(false)}
			/>
			<Modal
				open={Boolean(bulkResult)}
				onClose={() => setBulkResult(null)}
				title="Bulk publish finished"
				subtitle={bulkResult?.term}
				footer={<Button onClick={() => setBulkResult(null)}>Done</Button>}
			>
				{bulkResult ? (
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-3">
							<StatCard label="Published" value={bulkResult.published_count} icon={CheckCircle2} tone="green" />
							<StatCard label="Failed" value={bulkResult.failed_count} icon={ClipboardCheck} tone={bulkResult.failed_count ? "red" : "gray"} />
						</div>
						{bulkResult.failed?.length ? (
							<ul className="space-y-2 text-sm">
								{bulkResult.failed.map((f) => (
									<li key={f.mark_sheet} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/40">
										<Link to={`${BASE}/mark-sheets/${encodeURIComponent(f.mark_sheet)}`} className="font-semibold text-red-800 hover:underline dark:text-red-200">
											{f.mark_sheet}
										</Link>
										<div className="text-xs text-red-700 dark:text-red-300">{plainText(f.error)}</div>
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</Modal>
			{readOnly ? <SheetDrawer name={drawer} onClose={() => setDrawer(null)} /> : null}
		</div>
	)
}
