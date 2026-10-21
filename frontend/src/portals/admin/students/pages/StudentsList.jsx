import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { Download, GraduationCap, PauseCircle, Plus, RefreshCw, UserCheck, UserPlus, Users, X } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { AvatarCell, Button, PageHeader, Pagination, Panel, Select, StatCard } from "@/shared/components/ui"
import { BarRow, DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { DonutChart, Legendary } from "@/shared/components/Charts"
import { money, num } from "@/shared/utils/format"
import { API, CAN, GENDERS, NoAccess, STANDINGS, STUDENTS_FORBIDDEN, STUDENT_STATUSES, Standing, StudentStatus, compact, exportAll, isPermissionError, useLookups, useUrlFilters } from "../lib"

const PAGE = 25
const SORTS = [
	{ value: "", label: "Name A–Z" },
	{ value: "student_number asc", label: "Student number" },
	{ value: "creation desc", label: "Newest first" },
	{ value: "modified desc", label: "Recently updated" },
	{ value: "cgpa desc", label: "Highest CGPA" },
]
const EXPORT_COLS = [
	{ key: "student_number", label: "Student number" },
	{ key: "full_name", label: "Name" },
	{ key: "email", label: "Email" },
	{ key: "phone", label: "Phone" },
	{ key: "gender", label: "Gender" },
	{ key: "programme_name", label: "Programme" },
	{ key: "campus", label: "Campus" },
	{ key: "study_mode", label: "Study mode" },
	{ key: "intake", label: "Intake" },
	{ key: "year_of_study", label: "Year" },
	{ key: "current_term", label: "Current term" },
	{ key: "cgpa", label: "CGPA" },
	{ key: "academic_standing", label: "Standing" },
	{ key: "fee_balance", label: "Fee balance" },
	{ key: "status", label: "Status" },
]
const FILTER_KEYS = ["status", "programme", "campus", "intake", "mode", "year", "gender", "standing", "term"]

export default function StudentsList() {
	const { hasRole } = useSession()
	const canWrite = hasRole(...CAN.write)
	const canRead = hasRole(...CAN.read)
	const [get, set] = useUrlFilters()
	const page = Number(get("page") || 1)
	const [search, setSearch] = useState(get("q"))
	const q = useDebounced(search.trim(), 350)
	const [exporting, setExporting] = useState(false)
	const invalidate = useInvalidate()

	useEffect(() => {
		if (q !== get("q")) set({ q })
	}, [q, get, set])

	const lookups = useLookups()
	const L = lookups.data || {}
	const filters = compact({
		programme: get("programme"),
		campus: get("campus"),
		intake: get("intake"),
		study_mode: get("mode"),
		year_of_study: get("year"),
		gender: get("gender"),
		academic_standing: get("standing"),
		current_term: get("term"),
		search: q,
		order_by: get("sort"),
	})
	const list = useApi(`${API}list_students`, { ...filters, status: get("status") || undefined, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData, enabled: canRead })
	const stats = useApi(`${API}student_stats`, {}, { enabled: canRead })

	if (!canRead || isPermissionError(list.error)) return <><PageHeader eyebrow="Students" title="Students" /><NoAccess message={STUDENTS_FORBIDDEN} /></>

	const data = list.data || {}
	const rows = data.data || []
	const counts = data.counts_by_status || {}
	const s = stats.data || {}
	const bs = s.by_status || {}
	const filtered = FILTER_KEYS.some((k) => get(k))
	const progMax = Math.max(1, ...(s.by_programme || []).map((r) => r.count))

	const chips = [
		{ id: "", label: "All", count: Object.values(counts).reduce((a, b) => a + b, 0) },
		...STUDENT_STATUSES.filter((st) => counts[st] || st === get("status")).map((st) => ({ id: st, label: st, count: counts[st] || 0 })),
	]

	const cols = [
		{
			key: "full_name",
			label: "Student",
			render: (r) => <AvatarCell name={r.full_name} image={r.photo} sub={[r.student_number || r.name, r.email].filter(Boolean).join(" · ")} />,
		},
		{
			key: "programme_name",
			label: "Programme",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-medium text-ink">{r.programme_name || r.programme}</div>
					<div className="truncate text-xs text-ink-soft">{[r.campus, r.study_mode].filter(Boolean).join(" · ")}</div>
				</div>
			),
			sortValue: (r) => r.programme_name,
		},
		{ key: "year_of_study", label: "Year", align: "right", hideOnMobile: true, render: (r) => r.year_of_study || "—" },
		{
			key: "cgpa",
			label: "CGPA",
			align: "right",
			hideOnMobile: true,
			render: (r) => (
				<div className="flex flex-col items-end gap-0.5">
					<span className="font-semibold tabular-nums">{r.cgpa ? Number(r.cgpa).toFixed(2) : "—"}</span>
					<Standing value={r.academic_standing} />
				</div>
			),
			sortValue: (r) => Number(r.cgpa || 0),
		},
		{
			key: "fee_balance",
			label: "Balance",
			align: "right",
			hideOnMobile: true,
			render: (r) => <span className={Number(r.fee_balance) > 0 ? "font-semibold text-red-600" : "text-ink-soft"}>{money(r.fee_balance || 0)}</span>,
			sortValue: (r) => Number(r.fee_balance || 0),
		},
		{ key: "status", label: "Status", render: (r) => <StudentStatus status={r.status} />, sortValue: (r) => r.status },
	]

	const campusData = (s.by_campus || []).map((r) => ({ label: (L.campuses || []).find((c) => c.name === r.key)?.campus_name || r.key || "Not set", value: r.count }))

	const runExport = async () => {
		setExporting(true)
		try {
			const n = await exportAll(`${API}list_students`, { ...filters, status: get("status") || undefined }, EXPORT_COLS, `students-${new Date().toISOString().slice(0, 10)}`)
			toast.success(`Exported ${num(n)} student${n === 1 ? "" : "s"}`)
		} catch (e) {
			toast.error(e?.message || "Export failed")
		} finally {
			setExporting(false)
		}
	}

	return (
		<>
			<PageHeader
				eyebrow="Students"
				title="Students"
				subtitle="Every student record, from admission to alumni."
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(API)}>
							Refresh
						</Button>
						<Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={runExport} disabled={!data.total}>
							Export
						</Button>
						{canWrite ? (
							<Link to="/admin/students/new" className="btn btn-primary btn-sm">
								<Plus size={14} /> New student
							</Link>
						) : null}
					</>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
				<StatCard label="All students" value={num(s.total)} icon={Users} loading={stats.isLoading} hint="All statuses" />
				<StatCard label="Active" value={num(s.active)} icon={UserCheck} tone="green" loading={stats.isLoading} hint="Incl. registered" />
				<StatCard label="Admitted" value={num(bs.Admitted || 0)} icon={UserPlus} tone="blue" loading={stats.isLoading} hint="To register" />
				<StatCard label="On hold" value={num((bs.Deferred || 0) + (bs.Suspended || 0))} icon={PauseCircle} tone="orange" loading={stats.isLoading} hint={`${num(bs.Suspended || 0)} suspended`} />
				<StatCard label="Graduates" value={num((bs.Completed || 0) + (bs.Alumni || 0))} icon={GraduationCap} tone="gold" loading={stats.isLoading} hint={`${num(bs.Completed || 0)} to graduate`} className="col-span-2 lg:col-span-1" />
			</div>

			<div className="mb-5 grid gap-4 lg:grid-cols-3">
				<Panel title="By programme" subtitle="All statuses" className="lg:col-span-2" bodyClass="space-y-3 p-5">
					{(s.by_programme || []).length ? (
						(s.by_programme || []).slice(0, 8).map((r) => (
							<button key={r.key || "none"} type="button" className="block w-full text-left" onClick={() => set({ programme: r.key || "" })}>
								<BarRow label={r.label || r.key || "No programme"} value={r.count} max={progMax} caption={num(r.count)} />
							</button>
						))
					) : (
						<p className="text-sm text-ink-soft">{stats.isLoading ? "Loading…" : "No students yet."}</p>
					)}
				</Panel>
				<Panel title="By campus" bodyClass="p-5">
					<DonutChart data={campusData} height={180} center={num(s.total)} centerLabel="students" />
					<Legendary data={campusData} />
				</Panel>
			</div>

			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, number, email, phone, ID…"
				chips={chips}
				active={get("status")}
				onChip={(id) => set({ status: id })}
			/>

			<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
				<Select aria-label="Programme" className="col-span-2 sm:col-span-1" value={get("programme")} onChange={(e) => set({ programme: e.target.value })} placeholder="All programmes" options={(L.programmes || []).map((p) => ({ value: p.name, label: p.programme_name }))} />
				<Select aria-label="Campus" value={get("campus")} onChange={(e) => set({ campus: e.target.value })} placeholder="All campuses" options={(L.campuses || []).map((c) => ({ value: c.name, label: c.campus_name }))} />
				<Select aria-label="Intake" value={get("intake")} onChange={(e) => set({ intake: e.target.value })} placeholder="All intakes" options={(L.intakes || []).map((i) => ({ value: i.name, label: i.intake_name || i.name }))} />
				<Select aria-label="Study mode" value={get("mode")} onChange={(e) => set({ mode: e.target.value })} placeholder="All study modes" options={(L.study_modes || []).map((m) => ({ value: m.name, label: m.study_mode_name || m.name }))} />
				<Select aria-label="Year of study" value={get("year")} onChange={(e) => set({ year: e.target.value })} placeholder="Any year" options={[1, 2, 3, 4].map((y) => ({ value: String(y), label: `Year ${y}` }))} />
				<Select aria-label="Gender" value={get("gender")} onChange={(e) => set({ gender: e.target.value })} placeholder="Any gender" options={GENDERS} />
				<Select aria-label="Academic standing" value={get("standing")} onChange={(e) => set({ standing: e.target.value })} placeholder="Any standing" options={STANDINGS} />
				<Select aria-label="Current term" value={get("term")} onChange={(e) => set({ term: e.target.value })} placeholder="Any current term" options={(L.terms || []).map((t) => ({ value: t.name, label: t.term_label || t.name }))} />
			</div>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
				<span className="text-xs text-ink-soft">
					{list.isFetching && !list.isLoading ? "Updating… " : ""}
					{num(data.total)} student{data.total === 1 ? "" : "s"}
				</span>
				<div className="flex items-center gap-2">
					<Select aria-label="Sort" className="w-44" value={get("sort")} onChange={(e) => set({ sort: e.target.value })} options={SORTS} />
					{filtered ? (
						<Button variant="ghost" size="sm" icon={X} onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))}>
							Clear
						</Button>
					) : null}
				</div>
			</div>

			<DataTable
				cols={cols}
				query={list}
				rows={list.isLoading ? undefined : rows}
				rowTo={(r) => `/admin/students/${encodeURIComponent(r.name)}`}
				empty={filtered || q ? "No students match these filters" : "No students yet"}
				emptyIcon={GraduationCap}
			/>
			<div className="mt-4">
				<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
			</div>
		</>
	)
}
