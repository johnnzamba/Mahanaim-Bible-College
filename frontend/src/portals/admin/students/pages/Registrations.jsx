import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { AlertTriangle, CalendarCheck, CheckCircle2, ClipboardCheck, FileClock, RefreshCw, XCircle } from "lucide-react"
import { useAction, useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Alert, AvatarCell, Badge, Button, ConfirmDialog, PageHeader, Pagination, Select, StatCard } from "@/shared/components/ui"
import { DataTable, SelectionBar, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, num } from "@/shared/utils/format"
import { API, CAN, NoAccess, STUDENTS_FORBIDDEN, compact, exportAll, isPermissionError, useLookups, useUrlFilters } from "../lib"
import { toast } from "@/shared/components/toast"

const PAGE = 25
const REG_STATUSES = ["Submitted", "Approved", "Rejected", "Draft", "Cancelled"]
const EXPORT_COLS = [
	{ key: "name", label: "Registration" },
	{ key: "student", label: "Student" },
	{ key: "student_name", label: "Name" },
	{ key: "programme", label: "Programme" },
	{ key: "campus", label: "Campus" },
	{ key: "academic_term", label: "Term" },
	{ key: "year_of_study", label: "Year" },
	{ key: "study_mode", label: "Study mode" },
	{ key: "total_credits", label: "Credits" },
	{ key: "status", label: "Status" },
	{ key: "approved_by", label: "Approved by" },
	{ key: "approved_on", label: "Approved on" },
]

/** The term most likely being registered for: open for registration first, then the current term. */
function defaultTerm(L) {
	const terms = L.terms || []
	return terms.find((t) => t.status === "Registration Open")?.name || L.current_term || ""
}

/** /admin/students/registrations, the semester registration approval queue. */
/** The bulk API strips the <br> between validation lines; split them again on the course titles. */
export default function Registrations() {
	const { hasRole } = useSession()
	const canApprove = hasRole(...CAN.write)
	const [get, set] = useUrlFilters()
	const page = Number(get("page") || 1)
	const [search, setSearch] = useState(get("q"))
	const q = useDebounced(search.trim(), 350)
	const [selected, setSelected] = useState([])
	const [confirm, setConfirm] = useState(false)
	const [failures, setFailures] = useState([])
	const [exporting, setExporting] = useState(false)
	const invalidate = useInvalidate()
	const lookups = useLookups()
	const L = lookups.data || {}

	useEffect(() => {
		if (q !== get("q")) set({ q })
	}, [q, get, set])

	const termParam = get("term")
	const term = termParam === "all" ? "" : termParam || defaultTerm(L)
	const statusParam = get("status")
	const status = statusParam === "all" ? "" : statusParam || "Submitted"
	const filters = compact({
		term,
		programme: get("programme"),
		campus: get("campus"),
		study_mode: get("mode"),
		year_of_study: get("year"),
		search: q,
	})
	const list = useApi(`${API}list_registrations`, { ...filters, status: status || undefined, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData, enabled: !lookups.isLoading })

	useEffect(() => setSelected([]), [status, term, page, q])

	const bulk = useAction(`${API}bulk_approve_registrations`, {
		invalidate: [API, "mahanaim.api.academics.list_offerings"],
		onSuccess: (r) => {
			setConfirm(false)
			const ok = (r.updated || []).length
			if (ok) toast.success(`${num(ok)} registration${ok === 1 ? "" : "s"} approved`)
			setFailures(r.failed || [])
			setSelected((cur) => cur.filter((n) => !(r.updated || []).includes(n)))
		},
	})

	const data = list.data || {}
	const rows = data.data || []
	const counts = data.counts_by_status || {}
	const byName = useMemo(() => Object.fromEntries(rows.map((r) => [r.name, r])), [rows])
	const submittedSel = selected.filter((n) => byName[n]?.status === "Submitted")

	if (!hasRole(...CAN.read) || isPermissionError(list.error)) return <><PageHeader eyebrow="Students" title="Registrations" /><NoAccess message={STUDENTS_FORBIDDEN} /></>

	const termLabel = (L.terms || []).find((t) => t.name === term)?.term_label || term
	const chips = [
		...REG_STATUSES.map((st) => ({ id: st, label: st === "Submitted" ? "Awaiting approval" : st, count: counts[st] || 0 })),
		{ id: "all", label: "All", count: Object.values(counts).reduce((a, b) => a + b, 0) },
	]
	const filtered = ["programme", "campus", "mode", "year"].some((k) => get(k))

	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <AvatarCell name={r.student_name} sub={`${r.student} · ${r.name}`} /> },
		{
			key: "programme",
			label: "Programme",
			hideOnMobile: true,
			render: (r) => (
				<div className="max-w-[13rem]">
					<div className="truncate font-medium">{r.programme}</div>
					<div className="truncate text-xs text-ink-soft">{[r.campus, r.study_mode, r.year_of_study ? `Year ${r.year_of_study}` : null].filter(Boolean).join(" · ")}</div>
				</div>
			),
		},
		{
			key: "courses",
			label: "Courses",
			hideOnMobile: true,
			render: (r) => {
				const list = (r.courses || []).filter((c) => c.status !== "Dropped")
				return (
					<div className="max-w-[15rem]">
						<div className="text-sm font-medium text-ink">{list.length} course{list.length === 1 ? "" : "s"}</div>
						<div className="truncate font-mono text-[11px] text-ink-soft" title={list.map((c) => `${c.course} ${c.course_title || ""}`).join("\n")}>
							{list.map((c) => c.course).join(", ")}
						</div>
					</div>
				)
			},
		},
		{ key: "total_credits", label: "Credits", align: "right", render: (r) => <span className="tabular-nums">{num(r.total_credits || 0)}</span>, sortValue: (r) => Number(r.total_credits || 0) },
		{
			key: "status",
			label: "Status",
			render: (r) => (
				<div>
					<Badge status={r.status} />
					<div className="mt-1 whitespace-nowrap text-[11px] text-ink-soft">{date(r.modified)}</div>
				</div>
			),
			sortValue: (r) => r.modified,
		},
	]

	const runExport = async () => {
		setExporting(true)
		try {
			const n = await exportAll(`${API}list_registrations`, { ...filters, status: status || undefined }, EXPORT_COLS, `registrations-${term || "all"}`)
			toast.success(`Exported ${num(n)} registrations`)
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
				title="Semester registrations"
				subtitle={term ? `Course registrations for ${termLabel}. Approve to enrol students on their courses.` : "Course registrations for every term."}
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(`${API}list_registrations`)}>
							Refresh
						</Button>
						<Button variant="secondary" size="sm" loading={exporting} onClick={runExport} disabled={!data.total}>
							Export
						</Button>
					</>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Awaiting approval" value={num(counts.Submitted || 0)} icon={FileClock} tone="orange" hint="Submitted by students" />
				<StatCard label="Approved" value={num(counts.Approved || 0)} icon={CheckCircle2} tone="green" hint="Enrolled on courses" />
				<StatCard label="Drafts" value={num(counts.Draft || 0)} icon={ClipboardCheck} hint="Started, not submitted" />
				<StatCard label="Rejected" value={num(counts.Rejected || 0)} icon={XCircle} tone="red" hint={`${num(counts.Cancelled || 0)} cancelled`} />
			</div>

			{failures.length ? (
				<Alert tone="warning" className="mb-4" title={`${failures.length} registration${failures.length === 1 ? "" : "s"} could not be approved`} action={<Button size="sm" variant="ghost" onClick={() => setFailures([])}>Dismiss</Button>}>
					<ul className="mt-1 list-disc space-y-0.5 pl-4">
						{failures.map((f) => (
							<li key={f.name}>
								<b>{byName[f.name]?.student_name || f.name}</b>
								<div className="whitespace-pre-line">{f.error}</div>
								<div className="text-xs">
									<Link to={`/admin/students/registrations/${encodeURIComponent(f.name)}`} className="font-semibold underline">Open the registration</Link> to approve it with an override.
								</div>
							</li>
						))}
					</ul>
				</Alert>
			) : null}

			<Toolbar search={search} onSearch={setSearch} placeholder="Search student, number or registration…" chips={chips} active={statusParam || "Submitted"} onChip={(id) => set({ status: id === "Submitted" ? "" : id })} />

			<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
				<Select
					aria-label="Term"
					className="col-span-2 sm:col-span-1 lg:col-span-2"
					value={termParam || term}
					onChange={(e) => set({ term: e.target.value })}
					options={[{ value: "all", label: "All terms" }, ...(L.terms || []).map((t) => ({ value: t.name, label: `${t.term_label}${t.status === "Registration Open" ? " (open)" : t.is_current ? " (current)" : ""}` }))]}
				/>
				<Select aria-label="Programme" className="col-span-2 sm:col-span-1" value={get("programme")} onChange={(e) => set({ programme: e.target.value })} placeholder="All programmes" options={(L.programmes || []).map((p) => ({ value: p.name, label: p.programme_name }))} />
				<Select aria-label="Campus" value={get("campus")} onChange={(e) => set({ campus: e.target.value })} placeholder="All campuses" options={(L.campuses || []).map((c) => ({ value: c.name, label: c.campus_name }))} />
				<Select aria-label="Study mode" value={get("mode")} onChange={(e) => set({ mode: e.target.value })} placeholder="All modes" options={(L.study_modes || []).map((m) => ({ value: m.name, label: m.study_mode_name }))} />
				<Select aria-label="Year of study" value={get("year")} onChange={(e) => set({ year: e.target.value })} placeholder="All years" options={[1, 2, 3, 4].map((y) => ({ value: String(y), label: `Year ${y}` }))} />
			</div>
			<div className="mb-3 flex items-center justify-between gap-2 text-xs text-ink-soft">
				<span>{list.isFetching ? "Loading…" : `${num(data.total || 0)} registration${data.total === 1 ? "" : "s"}`}</span>
				{filtered ? (
					<button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => set({ programme: "", campus: "", mode: "", year: "" })}>
						Clear filters
					</button>
				) : null}
			</div>

			<DataTable
				cols={cols}
				rows={rows}
				query={list}
				rowTo={(r) => `/admin/students/registrations/${encodeURIComponent(r.name)}`}
				selectable={canApprove && status === "Submitted"}
				selected={selected}
				onSelect={setSelected}
				empty={status === "Submitted" ? "No registrations are waiting for approval" : "No registrations match these filters"}
				emptyIcon={CalendarCheck}
			/>
			<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />

			<SelectionBar count={selected.length} onClear={() => setSelected([])}>
				<Button size="sm" icon={CheckCircle2} onClick={() => setConfirm(true)} disabled={!submittedSel.length}>
					Approve
				</Button>
			</SelectionBar>

			<ConfirmDialog
				open={confirm}
				onClose={() => setConfirm(false)}
				title={`Approve ${submittedSel.length} registration${submittedSel.length === 1 ? "" : "s"}?`}
				message="Each student is enrolled on their courses (and invoiced if automatic invoicing is on) and notified. Registrations that break a rule (capacity, prerequisites, credit limit) are skipped and listed so you can review them one by one."
				confirmLabel="Approve"
				loading={bulk.isPending}
				onConfirm={() => bulk.mutate({ names: submittedSel })}
			>
				{submittedSel.length < selected.length ? (
					<p className="flex items-center gap-1.5 text-xs text-amber-700">
						<AlertTriangle size={14} /> {selected.length - submittedSel.length} selected registration(s) are not submitted and will be left as they are.
					</p>
				) : null}
			</ConfirmDialog>
		</>
	)
}
