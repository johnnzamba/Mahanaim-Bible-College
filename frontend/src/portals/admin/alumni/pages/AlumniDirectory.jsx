import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { Briefcase, Church, Download, GraduationCap, LayoutGrid, List, MapPin, RefreshCw, ShieldCheck, Sparkles, Users, X } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { Alert, Avatar, Badge, Button, Card, Empty, ErrorState, PageHeader, Pagination, Panel, Select, SkeletonRows, StatCard } from "@/shared/components/ui"
import { BarRow, DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { BarsChart, DonutChart, PALETTE } from "@/shared/components/Charts"
import { date, num, pct } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { API, CAN, campusName, compact, exportAll, isPermissionError, ministryLine, NoAccess, useLookups, useUrlFilters } from "../lib"

const PAGE = 24
const FILTER_KEYS = ["programme", "year", "campus"]
const EXPORT_COLS = [
	{ key: "full_name", label: "Name" },
	{ key: "programme_name", label: "Programme" },
	{ key: "graduation_date", label: "Graduated" },
	{ key: "campus_name", label: "Campus" },
	{ key: "current_position", label: "Current position" },
	{ key: "current_ministry", label: "Current ministry" },
	{ key: "home_church", label: "Home church" },
	{ key: "county", label: "County" },
]

export default function AlumniDirectory() {
	const { hasRole } = useSession()
	const isStaff = hasRole(...CAN.staff)
	const can360 = hasRole(...CAN.student360)
	const [get, set] = useUrlFilters()
	const page = Number(get("page") || 1)
	const view = get("view") === "table" ? "table" : "cards"
	const [search, setSearch] = useState(get("q"))
	const q = useDebounced(search.trim(), 350)
	const [exporting, setExporting] = useState(false)
	const invalidate = useInvalidate()

	useEffect(() => {
		if (q !== get("q")) set({ q })
	}, [q, get, set])

	const lookups = useLookups()
	const L = lookups.data || {}
	const filters = compact({ programme: get("programme"), year: get("year"), campus: get("campus"), search: q })
	const list = useApi(`${API}alumni_directory`, { ...filters, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData })
	const stats = useApi(`${API}alumni_stats`, {}, { enabled: isStaff, staleTime: 60_000 })

	const data = list.data || {}
	const rows = useMemo(() => data.data || [], [data.data])
	const facets = data.facets || {}
	const filtered = FILTER_KEYS.some((k) => get(k))
	const S = stats.data

	if (isPermissionError(list.error)) {
		return (
			<>
				<PageHeader eyebrow="Alumni" title="Alumni" />
				<NoAccess message="Sign in with a staff account to open the alumni directory." />
			</>
		)
	}

	const toStudent = (r) => (can360 ? `/admin/students/${encodeURIComponent(r.name)}` : undefined)

	const runExport = async () => {
		setExporting(true)
		try {
			const n = await exportAll(`${API}alumni_directory`, filters, EXPORT_COLS, `alumni-${new Date().toISOString().slice(0, 10)}`)
			toast.success(`Exported ${num(n)} alumni`)
		} catch (e) {
			toast.error(e?.message || "Export failed")
		} finally {
			setExporting(false)
		}
	}

	const programmeOptions = (facets.programmes?.length ? facets.programmes : L.programmes || []).map((p) => ({
		value: p.programme || p.name,
		label: `${p.programme_name || p.programme || p.name}${p.count != null ? ` (${p.count})` : ""}`,
	}))
	const yearOptions = (facets.years || []).map((y) => ({ value: String(y), label: `Class of ${y}` }))
	const campusOptions = (L.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))

	const cols = [
		{
			key: "full_name",
			label: "Graduate",
			render: (r) => (
				<span className="flex min-w-0 max-w-[16rem] items-center gap-3">
					<Avatar name={r.full_name} src={safeUrl(r.photo)} size={36} />
					<span className="min-w-0">
						<span className="block truncate font-semibold text-ink">{r.full_name}</span>
						<span className="block truncate text-xs text-ink-soft">{r.home_church || "Home church not given"}</span>
					</span>
				</span>
			),
		},
		{
			key: "programme_name",
			label: "Programme",
			render: (r) => (
				<div className="max-w-[14rem]">
					<div className="truncate font-medium text-ink">{r.programme_name || r.programme}</div>
					<div className="text-xs text-ink-soft">{r.graduation_year ? `Class of ${r.graduation_year}` : "Graduation date not set"}</div>
				</div>
			),
			sortValue: (r) => r.programme_name,
		},
		{
			key: "current_ministry",
			label: "Serving at",
			render: (r) => <span className="block max-w-[16rem] truncate">{ministryLine(r) || <span className="text-ink-soft">Not shared</span>}</span>,
		},
		{ key: "campus_name", label: "Campus", hideOnMobile: true, render: (r) => <span className="block max-w-[9rem]">{r.campus_name || "—"}</span> },
		{ key: "graduation_date", label: "Graduated", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap">{r.graduation_date ? date(r.graduation_date) : "—"}</span>, sortValue: (r) => r.graduation_date },
	]

	return (
		<>
			<PageHeader
				eyebrow="Alumni"
				title="Alumni"
				subtitle="Graduates of the college and where they serve today."
				actions={
					<>
						<Button
							variant="ghost"
							size="sm"
							icon={RefreshCw}
							onClick={() => {
								invalidate(`${API}alumni_directory`)
								invalidate(`${API}alumni_stats`)
							}}
						>
							Refresh
						</Button>
						<Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={runExport} disabled={!data.total}>
							Export
						</Button>
						{isStaff ? (
							<Link to="/admin/alumni/graduation" className="btn btn-primary btn-sm">
								<GraduationCap size={14} /> Graduate students
							</Link>
						) : null}
					</>
				}
			/>

			{isStaff ? <AlumniStats stats={stats} L={L} onProgramme={(p) => set({ programme: p })} onCampus={(c) => set({ campus: c })} onYear={(y) => set({ year: y })} /> : null}

			{isStaff && S && S.total > S.with_consent ? (
				<Alert tone="info" className="mb-4" icon={ShieldCheck}>
					The directory lists only alumni who opted in. {num(S.total - S.with_consent)} of {num(S.total)} graduates have not given consent, so they are hidden here and from other alumni.
				</Alert>
			) : null}

			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, ministry, position or county…"
				right={
					<div className="flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="View">
						<button type="button" aria-pressed={view === "cards"} onClick={() => set({ view: "" })} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${view === "cards" ? "bg-brand-800 text-white" : "text-ink-muted"}`}>
							<LayoutGrid size={14} /> Cards
						</button>
						<button type="button" aria-pressed={view === "table"} onClick={() => set({ view: "table" })} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${view === "table" ? "bg-brand-800 text-white" : "text-ink-muted"}`}>
							<List size={14} /> Table
						</button>
					</div>
				}
			/>
			<div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
				<Select aria-label="Programme" value={get("programme")} onChange={(e) => set({ programme: e.target.value })} placeholder="All programmes" options={programmeOptions} />
				<Select aria-label="Class" value={get("year")} onChange={(e) => set({ year: e.target.value })} placeholder="Every class" options={yearOptions} />
				<Select aria-label="Campus" value={get("campus")} onChange={(e) => set({ campus: e.target.value })} placeholder="All campuses" options={campusOptions} />
			</div>
			<div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
				<span>
					{num(data.total || 0)} graduate{data.total === 1 ? "" : "s"} in the directory
				</span>
				{filtered ? (
					<Button size="sm" variant="ghost" icon={X} onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))}>
						Clear filters
					</Button>
				) : null}
			</div>

			{view === "table" ? (
				<DataTable cols={cols} rows={rows} query={list} rowTo={toStudent} empty={q || filtered ? "No alumni match these filters" : "No alumni in the directory yet"} emptyIcon={Users} />
			) : list.isLoading ? (
				<Panel>
					<SkeletonRows rows={6} />
				</Panel>
			) : list.isError ? (
				<Panel>
					<ErrorState error={list.error} onRetry={() => list.refetch()} />
				</Panel>
			) : rows.length ? (
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{rows.map((r) => (
						<AlumnusCard key={r.name} r={r} to={toStudent(r)} />
					))}
				</div>
			) : (
				<Panel>
					<Empty icon={Users} title={q || filtered ? "No alumni match these filters" : "No alumni in the directory yet"} subtitle="Graduates appear here once they are marked as alumni and opt in to the directory from their alumni profile." />
				</Panel>
			)}
			<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
		</>
	)
}

function AlumnusCard({ r, to }) {
	const serving = ministryLine(r)
	const body = (
		<>
			<div className="flex items-start gap-3">
				<Avatar name={r.full_name} src={safeUrl(r.photo)} size={48} />
				<div className="min-w-0 flex-1">
					<div className="truncate font-semibold text-ink">{r.full_name}</div>
					<div className="truncate text-xs text-ink-soft">{r.programme_name || r.programme}</div>
					{r.graduation_year ? (
						<Badge tone="gold" size="xs" className="mt-1.5">
							Class of {r.graduation_year}
						</Badge>
					) : null}
				</div>
			</div>
			<dl className="mt-3 space-y-1.5 text-xs text-ink-muted">
				<div className="flex items-start gap-2">
					<Briefcase size={13} className="mt-0.5 shrink-0 text-ink-soft" />
					<dd className="min-w-0 break-words">{serving || <span className="text-ink-soft">Ministry not shared</span>}</dd>
				</div>
				{r.home_church ? (
					<div className="flex items-start gap-2">
						<Church size={13} className="mt-0.5 shrink-0 text-ink-soft" />
						<dd className="min-w-0 truncate">{r.home_church}</dd>
					</div>
				) : null}
				<div className="flex items-start gap-2">
					<MapPin size={13} className="mt-0.5 shrink-0 text-ink-soft" />
					<dd className="min-w-0 truncate">{[r.campus_name, r.county].filter(Boolean).join(" · ") || "—"}</dd>
				</div>
			</dl>
		</>
	)
	return to ? (
		<Card as={Link} to={to} interactive className="block p-4">
			{body}
		</Card>
	) : (
		<Card className="p-4">{body}</Card>
	)
}

function AlumniStats({ stats, L, onProgramme, onCampus, onYear }) {
	const S = stats.data
	if (isPermissionError(stats.error)) return null
	const loading = stats.isLoading
	const byYear = (S?.by_year || []).slice(-10).map((r) => ({ label: String(r.year), value: r.count }))
	const latest = S?.by_year?.length ? S.by_year[S.by_year.length - 1] : null
	const progMax = Math.max(1, ...(S?.by_programme || []).map((r) => r.count))
	const campusData = (S?.by_campus || []).map((r, i) => ({ label: campusName(L, r.campus) || "No campus", value: r.count, color: PALETTE[i % PALETTE.length], key: r.campus }))

	return (
		<>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Alumni" value={num(S?.total || 0)} icon={GraduationCap} loading={loading} hint={latest ? `${num(latest.count)} in the class of ${latest.year}` : "Graduates on record"} />
				<StatCard label="In directory" value={num(S?.with_consent || 0)} icon={ShieldCheck} tone="green" loading={loading} hint={`${pct(S?.consent_pct || 0)} opted in`} />
				<StatCard label="In ministry" value={num(S?.in_ministry || 0)} icon={Church} tone="gold" loading={loading} hint={`${pct(S?.in_ministry_pct || 0)} of alumni`} />
				<StatCard label="To graduate" value={num(S?.awaiting_graduation || 0)} icon={Sparkles} tone="blue" loading={loading} hint="Completed students" to="/admin/alumni/graduation" />
			</div>
			<div className="mb-5 grid gap-4 lg:grid-cols-3">
				<Panel title="Graduates by year" subtitle={S?.by_year?.length ? `${num(S.by_year.length)} classes since ${S.by_year[0].year}. Click a year to filter` : "Click a year to filter"} bodyClass="p-5">
					{byYear.length ? (
						<>
							<BarsChart data={byYear} series={[{ key: "value", label: "Graduates" }]} height={170} integer />
							<div className="mt-2 flex flex-wrap gap-1.5">
								{byYear.map((y) => (
									<button key={y.label} type="button" className="chip" onClick={() => onYear(y.label)}>
										{y.label}
									</button>
								))}
							</div>
						</>
					) : (
						<p className="text-sm text-ink-soft">{loading ? "Loading…" : "No graduation dates recorded yet."}</p>
					)}
				</Panel>
				<Panel title="By programme" subtitle="Click a programme to filter" bodyClass="space-y-3 p-5">
					{(S?.by_programme || []).length ? (
						S.by_programme.slice(0, 6).map((r) => (
							<button key={r.programme || "none"} type="button" className="block w-full text-left" onClick={() => onProgramme(r.programme || "")} disabled={!r.programme}>
								<BarRow label={r.programme_name || r.programme || "No programme"} value={r.count} max={progMax} caption={num(r.count)} />
							</button>
						))
					) : (
						<p className="text-sm text-ink-soft">{loading ? "Loading…" : "No alumni yet."}</p>
					)}
				</Panel>
				<Panel title="By campus" bodyClass="p-5">
					{campusData.length ? (
						<>
							<DonutChart data={campusData} height={150} center={num(S?.total || 0)} centerLabel="alumni" />
							<div className="mt-2 space-y-1">
								{campusData.map((c) => (
									<button key={c.label} type="button" className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left text-sm hover:bg-cream" onClick={() => c.key && onCampus(c.key)}>
										<span className="flex min-w-0 items-center gap-2">
											<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
											<span className="truncate text-ink-muted">{c.label}</span>
										</span>
										<span className="font-semibold text-ink">{num(c.value)}</span>
									</button>
								))}
							</div>
						</>
					) : (
						<p className="text-sm text-ink-soft">{loading ? "Loading…" : "No alumni yet."}</p>
					)}
				</Panel>
			</div>
		</>
	)
}
