import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { BookOpen, Download, PauseCircle, Plus, RefreshCw, UserCheck, UserCog, UserX, Users, X } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { Avatar, Badge, Button, PageHeader, Pagination, Panel, Select, StatCard } from "@/shared/components/ui"
import { BarRow, DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { DonutChart, Legendary } from "@/shared/components/Charts"
import { date, num } from "@/shared/utils/format"
import { API, CAN, STAFF_STATUSES, STAFF_TYPES, StaffStatus, StaffType, campusName, compact, displayName, exportAll, isPermissionError, NoAccess, useLookups, useUrlFilters } from "../lib"

const PAGE = 25
const EXPORT_COLS = [
	{ key: "staff_number", label: "Staff number" },
	{ key: "salutation", label: "Title" },
	{ key: "full_name", label: "Name" },
	{ key: "email", label: "Email" },
	{ key: "phone", label: "Phone" },
	{ key: "designation", label: "Designation" },
	{ key: "staff_type", label: "Type" },
	{ key: "department", label: "Department" },
	{ key: "campus", label: "Campus" },
	{ key: "is_lecturer", label: "Lecturer" },
	{ key: "date_joined", label: "Joined" },
	{ key: "status", label: "Status" },
]
const FILTER_KEYS = ["type", "department", "campus", "lecturer"]
const TYPE_COLORS = ["#1f4d3a", "#c9973f", "#5b9a7d", "#7c6bb0", "#d07a3c"]

export default function StaffList() {
	const { hasRole } = useSession()
	const canWrite = hasRole(...CAN.write)
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
		staff_type: get("type"),
		department: get("department"),
		campus: get("campus"),
		is_lecturer: get("lecturer"),
		search: q,
	})
	const list = useApi(`${API}list_staff`, { ...filters, status: get("status") || undefined, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData })
	// No stats endpoint for staff: the whole register (one page of 200) feeds the KPIs and breakdowns.
	const all = useApi(`${API}list_staff`, { page_length: 200 }, { staleTime: 60_000 })

	const everyone = all.data?.data || []
	const stats = useMemo(() => {
		const by = (key) => everyone.reduce((acc, r) => ((acc[r[key] || ""] = (acc[r[key] || ""] || 0) + 1), acc), {})
		return {
			status: by("status"),
			type: by("staff_type"),
			department: by("department"),
			lecturers: everyone.filter((r) => Number(r.is_lecturer) && r.status !== "Inactive").length,
			noLogin: everyone.filter((r) => !r.user && r.status !== "Inactive").length,
		}
	}, [everyone])

	if (isPermissionError(list.error)) return <><PageHeader eyebrow="People" title="Staff" /><NoAccess message="The staff register is open to college staff roles." /></>

	const data = list.data || {}
	const rows = data.data || []
	const filtered = FILTER_KEYS.some((k) => get(k))
	const total = all.data?.total || 0

	const chips = [
		{ id: "", label: "All", count: total },
		...STAFF_STATUSES.map((s) => ({ id: s, label: s, count: stats.status[s] || 0 })),
	]

	const deptRows = Object.entries(stats.department)
		.map(([k, v]) => ({ key: k, count: v }))
		.sort((a, b) => b.count - a.count)
	const deptMax = Math.max(1, ...deptRows.map((r) => r.count))
	const typeData = STAFF_TYPES.filter((t) => stats.type[t]).map((t, i) => ({ label: t, value: stats.type[t], color: TYPE_COLORS[i % TYPE_COLORS.length] }))

	const cols = [
		{
			key: "full_name",
			label: "Staff member",
			render: (r) => (
				<span className="flex min-w-0 max-w-[17rem] items-center gap-3">
					<Avatar name={r.full_name} src={r.photo || undefined} size={36} />
					<span className="min-w-0">
						<span className="block truncate font-semibold text-ink">{displayName(r)}</span>
						<span className="block truncate text-xs text-ink-soft">{[r.staff_number || r.name, r.email].filter(Boolean).join(" · ")}</span>
					</span>
				</span>
			),
			sortValue: (r) => r.full_name,
		},
		{
			key: "designation",
			label: "Role",
			render: (r) => (
				<div className="max-w-[12rem]">
					<div className="truncate font-medium text-ink">{r.designation || <span className="text-ink-soft">No designation</span>}</div>
					<div className="truncate text-xs text-ink-soft">{r.department || "No department"}</div>
				</div>
			),
			sortValue: (r) => r.designation,
		},
		{
			key: "staff_type",
			label: "Type",
			hideOnMobile: true,
			render: (r) => (
				<div className="flex flex-wrap items-center gap-1">
					<StaffType type={r.staff_type} />
					{Number(r.is_lecturer) ? (
						<Badge tone="blue" size="xs">
							Lecturer
						</Badge>
					) : null}
				</div>
			),
			sortValue: (r) => r.staff_type,
		},
		{ key: "campus", label: "Campus", hideOnMobile: true, render: (r) => <span className="block max-w-[9rem]">{campusName(L, r.campus) || "—"}</span> },
		{
			key: "status",
			label: "Status",
			render: (r) => (
				<div>
					<StaffStatus status={r.status} />
					{!r.user ? (
						<div className="mt-1 whitespace-nowrap text-[11px] font-semibold text-orange-600">No login</div>
					) : r.date_joined ? (
						<div className="mt-1 whitespace-nowrap text-[11px] text-ink-soft">Since {date(r.date_joined)}</div>
					) : null}
				</div>
			),
			sortValue: (r) => r.status,
		},
	]

	const runExport = async () => {
		setExporting(true)
		try {
			const n = await exportAll(`${API}list_staff`, { ...filters, status: get("status") || undefined }, EXPORT_COLS, `staff-${new Date().toISOString().slice(0, 10)}`)
			toast.success(`Exported ${num(n)} staff record${n === 1 ? "" : "s"}`)
		} catch (e) {
			toast.error(e?.message || "Export failed")
		} finally {
			setExporting(false)
		}
	}

	const opt = (rows, value, label) => (rows || []).map((r) => ({ value: r[value], label: r[label] || r[value] }))

	return (
		<>
			<PageHeader
				eyebrow="People"
				title="Staff"
				subtitle="Lecturers, administrators and support staff across every campus."
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(`${API}list_staff`)}>
							Refresh
						</Button>
						<Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={runExport} disabled={!data.total}>
							Export
						</Button>
						{canWrite ? (
							<Link to="/admin/staff/new" className="btn btn-primary btn-sm">
								<Plus size={14} /> New staff member
							</Link>
						) : null}
					</>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
				<StatCard label="All staff" value={num(total)} icon={Users} loading={all.isLoading} hint={`${num(stats.noLogin)} with no login`} />
				<StatCard label="Active" value={num(stats.status.Active || 0)} icon={UserCheck} tone="green" loading={all.isLoading} hint="Working now" />
				<StatCard label="Teaching" value={num(stats.lecturers)} icon={BookOpen} tone="blue" loading={all.isLoading} hint="Lecturers" />
				<StatCard label="On leave" value={num(stats.status["On Leave"] || 0)} icon={PauseCircle} tone="orange" loading={all.isLoading} hint="Can still sign in" />
				<StatCard label="Inactive" value={num(stats.status.Inactive || 0)} icon={UserX} tone="gray" loading={all.isLoading} hint="Cannot sign in" className="col-span-2 lg:col-span-1" />
			</div>

			<div className="mb-5 grid gap-4 lg:grid-cols-3">
				<Panel title="By department" subtitle="Click a department to filter" className="lg:col-span-2" bodyClass="space-y-3 p-5">
					{deptRows.length ? (
						deptRows.slice(0, 8).map((r) => (
							<button key={r.key || "none"} type="button" className="block w-full text-left" onClick={() => set({ department: r.key || "" })} disabled={!r.key}>
								<BarRow label={r.key || "No department"} value={r.count} max={deptMax} caption={num(r.count)} />
							</button>
						))
					) : (
						<p className="text-sm text-ink-soft">{all.isLoading ? "Loading…" : "No staff yet."}</p>
					)}
				</Panel>
				<Panel title="By type" bodyClass="p-5">
					<DonutChart data={typeData} height={180} center={num(total)} centerLabel="staff" />
					<Legendary data={typeData} />
				</Panel>
			</div>

			<Toolbar search={search} onSearch={setSearch} placeholder="Search name, number, email, phone, designation…" chips={chips} active={get("status")} onChip={(id) => set({ status: id })} />

			<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
				<Select aria-label="Type" value={get("type")} onChange={(e) => set({ type: e.target.value })} placeholder="All types" options={STAFF_TYPES} />
				<Select aria-label="Department" value={get("department")} onChange={(e) => set({ department: e.target.value })} placeholder="All departments" options={opt(L.departments, "name", "department_name")} />
				<Select aria-label="Campus" value={get("campus")} onChange={(e) => set({ campus: e.target.value })} placeholder="All campuses" options={opt(L.campuses, "name", "campus_name")} />
				<Select
					aria-label="Teaching"
					value={get("lecturer")}
					onChange={(e) => set({ lecturer: e.target.value })}
					placeholder="Teaching and non-teaching"
					options={[
						{ value: "1", label: "Lecturers only" },
						{ value: "0", label: "Non-teaching only" },
					]}
				/>
			</div>
			<div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
				<span>
					{num(data.total || 0)} staff member{data.total === 1 ? "" : "s"}
				</span>
				{filtered ? (
					<Button size="sm" variant="ghost" icon={X} onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, ""])))}>
						Clear filters
					</Button>
				) : null}
			</div>

			<DataTable
				cols={cols}
				rows={rows}
				query={list}
				rowTo={(r) => `/admin/staff/${encodeURIComponent(r.name)}`}
				empty={q || filtered || get("status") ? "No staff match these filters" : "No staff yet"}
				emptyIcon={UserCog}
			/>
			<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
		</>
	)
}
