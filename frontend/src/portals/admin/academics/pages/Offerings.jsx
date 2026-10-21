import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { CalendarRange, UserX, Wand2 } from "lucide-react"
import { Badge, Button, PageHeader, Pagination, ProgressBar, Select } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { num } from "@/shared/utils/format"
import { ACAD, BASE, OFFERING_STATUS, PAGE, fmtScore, nameOptions, rowsOf, useAcademicRoles, useLookups, useTermParam } from "../lib"
import { SheetBadge, TermSelect } from "../components/common"
import { GenerateOfferings } from "../components/GenerateOfferings"

export default function Offerings() {
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const L = lookups.data
	const [term] = useTermParam(L)
	const [params, setParams] = useSearchParams()
	const [search, setSearch] = useState(params.get("q") || "")
	const debounced = useDebounced(search)
	const [page, setPage] = useState(1)
	const get = (k) => params.get(k) || ""
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
	const [generating, setGenerating] = useState(false)
	useEffect(() => {
		if (params.get("generate") && roles.admin) {
			setGenerating(true)
			set("generate", "")
		}
	}, []) // eslint-disable-line react-hooks/exhaustive-deps

	const termArg = get("term") === "all" ? undefined : term || undefined
	const filters = {
		term: termArg,
		campus: get("campus") || undefined,
		programme: get("programme") || undefined,
		lecturer: get("lecturer") || undefined,
		status: get("status") || undefined,
		search: debounced || undefined,
	}
	const q = useApi(`${ACAD}list_offerings`, { ...filters, start: (page - 1) * PAGE, page_length: PAGE }, { enabled: Boolean(L), placeholderData: keepPreviousData })
	const stats = useApi(`${ACAD}academics_stats`, { term: termArg }, { enabled: Boolean(termArg) })
	const byStatus = stats.data?.offerings?.by_status || {}
	const rows = rowsOf(q.data)

	const cols = [
		{
			key: "course",
			label: "Course",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.course_title}</div>
					<div className="text-xs text-ink-soft">
						{r.course} · Section {r.section || "A"} · {fmtScore(r.credits)} cr
					</div>
				</div>
			),
			sortValue: (r) => r.course,
			exportValue: (r) => `${r.course} ${r.course_title}`,
		},
		...(termArg ? [] : [{ key: "academic_term", label: "Term", hideOnMobile: true }]),
		{ key: "campus", label: "Campus", hideOnMobile: true, render: (r) => `${r.campus}${r.study_mode ? ` · ${r.study_mode}` : ""}`, exportValue: (r) => r.campus },
		{
			key: "lecturers",
			label: "Lecturers",
			render: (r) =>
				r.lecturers?.length ? (
					<span className="text-sm">{r.lecturers.map((l) => l.staff_name).join(", ")}</span>
				) : (
					<span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600">
						<UserX size={13} /> Unassigned
					</span>
				),
			exportValue: (r) => (r.lecturers || []).map((l) => l.staff_name).join("; "),
		},
		{
			key: "enrolled_count",
			label: "Enrolled",
			width: "9rem",
			render: (r) =>
				r.capacity ? (
					<div className="w-28">
						<div className="mb-1 text-xs text-ink-muted">
							{num(r.enrolled_count)} / {num(r.capacity)}
						</div>
						<ProgressBar size="sm" value={Math.min(100, (r.enrolled_count / r.capacity) * 100)} tone={r.enrolled_count >= r.capacity ? "red" : "brand"} />
					</div>
				) : (
					num(r.enrolled_count)
				),
			sortValue: (r) => Number(r.enrolled_count || 0),
			exportValue: (r) => r.enrolled_count,
		},
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" />, exportValue: (r) => r.status },
		{ key: "results_status", label: "Mark sheet", hideOnMobile: true, render: (r) => <SheetBadge status={r.results_status} size="xs" />, exportValue: (r) => r.results_status },
	]

	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Course offerings"
				subtitle="Each offering is one course taught at one campus in one term, with its lecturers, timetable and mark sheet."
				actions={
					roles.admin ? (
						<Button icon={Wand2} onClick={() => setGenerating(true)}>
							Generate offerings
						</Button>
					) : null
				}
			/>
			<div className="mb-4 flex flex-wrap items-end gap-3">
				<TermSelect lookups={L} value={get("term") === "all" ? "" : term} onChange={(t) => set("term", t || "all")} allowAll className="w-full sm:w-60" />
				<Select aria-label="Campus" className="w-full sm:w-44" value={get("campus")} onChange={(e) => set("campus", e.target.value)} placeholder="All campuses" options={nameOptions(L?.campuses, "campus_name")} />
				<Select aria-label="Programme" className="w-full sm:w-56" value={get("programme")} onChange={(e) => set("programme", e.target.value)} placeholder="All programmes" options={(L?.programmes || []).map((p) => ({ value: p.name, label: p.programme_name }))} />
				<Select aria-label="Lecturer" className="w-full sm:w-52" value={get("lecturer")} onChange={(e) => set("lecturer", e.target.value)} placeholder="Any lecturer" options={nameOptions(L?.lecturers, "full_name")} />
			</div>
			<Toolbar
				search={search}
				onSearch={(v) => {
					setSearch(v)
					setPage(1)
				}}
				placeholder="Search course code or title…"
				chips={[{ id: "", label: "All", count: termArg ? stats.data?.offerings?.total : undefined }, ...OFFERING_STATUS.map((s) => ({ id: s, label: s, count: termArg ? byStatus[s] || 0 : undefined }))]}
				active={get("status")}
				onChip={(v) => set("status", v)}
				right={<ExportButton filename={`offerings-${termArg || "all"}`} cols={cols} rows={rows} />}
			/>
			<DataTable
				query={q}
				cols={cols}
				rowTo={(r) => `${BASE}/offerings/${encodeURIComponent(r.name)}`}
				empty={termArg ? "No offerings for this term and filter" : "No offerings match these filters"}
				emptyIcon={CalendarRange}
				emptyAction={
					roles.admin && termArg && !get("status") ? (
						<Button size="sm" icon={Wand2} onClick={() => setGenerating(true)}>
							Generate from curricula
						</Button>
					) : null
				}
			/>
			<Pagination page={page} pageSize={PAGE} total={q.data?.total || 0} onChange={setPage} />
			<GenerateOfferings open={generating} onClose={() => setGenerating(false)} lookups={L} defaults={{ term: termArg, campus: get("campus"), programme: get("programme") }} />
		</>
	)
}
