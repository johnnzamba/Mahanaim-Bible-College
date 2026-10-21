import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { GraduationCap, Plus } from "lucide-react"
import { Badge, PageHeader, Pagination, Select } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { money, num } from "@/shared/utils/format"
import { ACAD, BASE, PAGE, PROGRAMME_STATUS, nameOptions, rowsOf, useAcademicRoles, useLookups } from "../lib"
import { SubNav } from "../components/common"

export default function Programmes() {
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const L = lookups.data
	const [params, setParams] = useSearchParams()
	const [search, setSearch] = useState(params.get("q") || "")
	const debounced = useDebounced(search)
	const status = params.get("status") || ""
	const level = params.get("level") || ""
	const department = params.get("department") || ""
	const [page, setPage] = useState(1)
	const set = (k, v) => {
		setPage(1)
		setParams(
			(p) => {
				const n = new URLSearchParams(p)
				if (v) n.set(k, v)
				else n.delete(k)
				return n
			},
			{ replace: true }
		)
	}
	const q = useApi(`${ACAD}list_programmes`, {
		search: debounced || undefined,
		status: status || undefined,
		level: level || undefined,
		department: department || undefined,
		start: (page - 1) * PAGE,
		page_length: PAGE,
	}, { placeholderData: keepPreviousData })
	const rows = rowsOf(q.data)

	const cols = [
		{
			key: "programme_name",
			label: "Programme",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.programme_name}</div>
					<div className="text-xs text-ink-soft">{r.code}</div>
				</div>
			),
			sortValue: (r) => r.programme_name,
			exportValue: (r) => r.programme_name,
		},
		{ key: "level", label: "Level" },
		{ key: "department", label: "Department", hideOnMobile: true },
		{
			key: "duration_years",
			label: "Duration",
			render: (r) => (r.duration_years ? `${num(r.duration_years, r.duration_years % 1 ? 1 : 0)} yr · ${r.terms_per_year || "—"} terms/yr` : "—"),
			sortValue: (r) => Number(r.duration_years || 0),
			hideOnMobile: true,
		},
		{ key: "course_count", label: "Courses", align: "right", sortValue: (r) => Number(r.course_count || 0) },
		{ key: "total_credits", label: "Credits", align: "right", render: (r) => num(r.total_credits), sortValue: (r) => Number(r.total_credits || 0) },
		{ key: "application_fee", label: "Application fee", align: "right", render: (r) => (r.application_fee ? money(r.application_fee) : "—"), sortValue: (r) => Number(r.application_fee || 0), hideOnMobile: true },
		{
			key: "status",
			label: "Status",
			render: (r) => (
				<div className="flex flex-wrap gap-1">
					<Badge status={r.status} size="xs" />
					{r.is_published ? <Badge tone="blue" size="xs">On website</Badge> : null}
				</div>
			),
			sortValue: (r) => r.status,
			exportValue: (r) => r.status,
		},
	]

	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Programmes & courses"
				subtitle="The programme catalogue, curricula and the courses they are built from."
				actions={
					roles.admin ? (
						<Link to={`${BASE}/programmes/new`} className="btn btn-primary">
							<Plus size={16} /> New programme
						</Link>
					) : null
				}
			/>
			<SubNav group="catalogue" />
			<Toolbar
				search={search}
				onSearch={(v) => {
					setSearch(v)
					setPage(1)
				}}
				placeholder="Search programmes or codes…"
				chips={[{ id: "", label: "All" }, ...PROGRAMME_STATUS.map((s) => ({ id: s, label: s }))]}
				active={status}
				onChip={(v) => set("status", v)}
				right={
					<>
						<Select aria-label="Level" value={level} onChange={(e) => set("level", e.target.value)} placeholder="All levels" options={L?.options?.programme_level || []} />
						<Select aria-label="Department" value={department} onChange={(e) => set("department", e.target.value)} placeholder="All departments" options={nameOptions(L?.departments, "department_name")} />
						<ExportButton filename="programmes" cols={cols} rows={rows} />
					</>
				}
			/>
			<DataTable
				query={q}
				cols={cols}
				rowTo={(r) => `${BASE}/programmes/${encodeURIComponent(r.code || r.name)}`}
				empty="No programmes match these filters"
				emptyIcon={GraduationCap}
			/>
			<Pagination page={page} pageSize={PAGE} total={q.data?.total || 0} onChange={setPage} />
		</>
	)
}
