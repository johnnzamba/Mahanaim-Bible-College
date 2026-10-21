import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { BookOpen, Plus } from "lucide-react"
import { Badge, PageHeader, Pagination, Select } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { num } from "@/shared/utils/format"
import { ACAD, BASE, PAGE, fmtScore, nameOptions, rowsOf, useAcademicRoles, useLookups } from "../lib"
import { SubNav } from "../components/common"

export default function Courses() {
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const [params, setParams] = useSearchParams()
	const [search, setSearch] = useState(params.get("q") || "")
	const debounced = useDebounced(search)
	const active = params.get("active") ?? "1"
	const department = params.get("department") || ""
	const [page, setPage] = useState(1)
	const set = (k, v) => {
		setPage(1)
		setParams(
			(p) => {
				const n = new URLSearchParams(p)
				if (v !== "" && v != null) n.set(k, v)
				else n.delete(k)
				return n
			},
			{ replace: true }
		)
	}
	const q = useApi(
		`${ACAD}list_courses`,
		{
			search: debounced || undefined,
			is_active: active === "" || active === "all" ? undefined : active,
			department: department || undefined,
			start: (page - 1) * PAGE,
			page_length: PAGE,
		},
		{ placeholderData: keepPreviousData }
	)
	const rows = rowsOf(q.data)
	const cols = [
		{
			key: "course_code",
			label: "Course",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.course_title}</div>
					<div className="text-xs text-ink-soft">{r.course_code}</div>
				</div>
			),
			sortValue: (r) => r.course_code,
			exportValue: (r) => `${r.course_code} ${r.course_title}`,
		},
		{ key: "department", label: "Department", hideOnMobile: true, render: (r) => r.department || "—" },
		{ key: "credits", label: "Credits", align: "right", render: (r) => fmtScore(r.credits), sortValue: (r) => Number(r.credits || 0) },
		{ key: "contact_hours", label: "Contact hrs", align: "right", hideOnMobile: true, render: (r) => (r.contact_hours ? num(r.contact_hours) : "—") },
		{ key: "pass_mark", label: "Pass mark", align: "right", render: (r) => `${num(r.pass_mark)}%`, sortValue: (r) => Number(r.pass_mark || 0) },
		{
			key: "prerequisites",
			label: "Prerequisites",
			hideOnMobile: true,
			render: (r) =>
				r.prerequisites?.length ? (
					<div className="flex flex-wrap gap-1">
						{r.prerequisites.map((p) => (
							<Badge key={p} tone="gray" size="xs">
								{p}
							</Badge>
						))}
					</div>
				) : (
					<span className="text-ink-soft">None</span>
				),
			exportValue: (r) => (r.prerequisites || []).join(" "),
		},
		{
			key: "is_active",
			label: "Status",
			render: (r) => <Badge tone={r.is_active ? "green" : "gray"} size="xs">{r.is_active ? "Active" : "Inactive"}</Badge>,
			exportValue: (r) => (r.is_active ? "Active" : "Inactive"),
		},
	]
	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Programmes & courses"
				subtitle="Courses carry the credits, pass mark and assessment weights that offerings inherit."
				actions={
					roles.admin ? (
						<Link to={`${BASE}/courses/new`} className="btn btn-primary">
							<Plus size={16} /> New course
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
				placeholder="Search by code or title…"
				chips={[
					{ id: "1", label: "Active" },
					{ id: "0", label: "Inactive" },
					{ id: "all", label: "All" },
				]}
				active={active}
				onChip={(v) => set("active", v)}
				right={
					<>
						<Select aria-label="Department" value={department} onChange={(e) => set("department", e.target.value)} placeholder="All departments" options={nameOptions(lookups.data?.departments, "department_name")} />
						<ExportButton filename="courses" cols={cols} rows={rows} />
					</>
				}
			/>
			<DataTable query={q} cols={cols} rowTo={(r) => `${BASE}/courses/${encodeURIComponent(r.name)}`} empty="No courses match these filters" emptyIcon={BookOpen} />
			<Pagination page={page} pageSize={PAGE} total={q.data?.total || 0} onChange={setPage} />
		</>
	)
}
