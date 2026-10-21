import { useEffect, useState } from "react"
import { keepPreviousData } from "@tanstack/react-query"
import { CheckCircle2, Clock, FileQuestion, Inbox, RefreshCw, Search } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { AvatarCell, Badge, Button, PageHeader, Pagination, ProgressBar, Select, StatCard } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { toast } from "@/shared/components/toast"
import { date, num } from "@/shared/utils/format"
import { API, CAN, NoAccess, REQUEST_TYPES, compact, exportAll, isPermissionError, requestSummary, useLookups, useUrlFilters } from "../lib"

const PAGE = 25
const REQ_STATUSES = ["Pending", "Under Review", "Approved", "Completed", "Rejected", "Cancelled"]
const EXPORT_COLS = [
	{ key: "name", label: "Request" },
	{ key: "student", label: "Student" },
	{ key: "student_name", label: "Name" },
	{ key: "request_type", label: "Type" },
	{ key: "academic_term", label: "Term" },
	{ key: "status", label: "Status" },
	{ key: "from_date", label: "From" },
	{ key: "to_date", label: "To" },
	{ key: "reason", label: "Reason" },
	{ key: "reviewer", label: "Reviewer" },
	{ key: "decision_date", label: "Decided on" },
	{ key: "creation", label: "Raised on" },
]

/** /admin/students/requests */
export default function Requests() {
	const { hasRole } = useSession()
	const [get, set] = useUrlFilters()
	const page = Number(get("page") || 1)
	const [search, setSearch] = useState(get("q"))
	const q = useDebounced(search.trim(), 350)
	const [exporting, setExporting] = useState(false)
	const invalidate = useInvalidate()
	const lookups = useLookups()
	const L = lookups.data || {}

	useEffect(() => {
		if (q !== get("q")) set({ q })
	}, [q, get, set])

	const filters = compact({ request_type: get("type"), academic_term: get("term"), search: q })
	const list = useApi(`${API}list_requests`, { ...filters, status: get("status") || undefined, start: (page - 1) * PAGE, page_length: PAGE }, { placeholderData: keepPreviousData })
	const allowed = hasRole(...CAN.read, ...CAN.requestsRead)

	if (!allowed || isPermissionError(list.error)) return <><PageHeader eyebrow="Students" title="Student requests" /><NoAccess message="Student requests are handled by the registrar, the academic dean, finance and the library." /></>

	const data = list.data || {}
	const counts = data.counts_by_status || {}
	const total = Object.values(counts).reduce((a, b) => a + b, 0)
	const chips = [{ id: "", label: "All", count: total }, ...REQ_STATUSES.map((s) => ({ id: s, label: s, count: counts[s] || 0 }))]

	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <AvatarCell name={r.student_name} sub={r.student} /> },
		{
			key: "request_type",
			label: "Request",
			render: (r) => (
				<div className="min-w-0">
					<div className="font-semibold text-ink">{r.request_type}</div>
					<div className="truncate text-xs text-ink-soft">{[r.name, requestSummary(r)].filter(Boolean).join(" · ")}</div>
				</div>
			),
		},
		{
			key: "clearance_progress",
			label: "Clearance",
			hideOnMobile: true,
			render: (r) =>
				r.clearance_progress ? (
					<div className="w-28">
						<ProgressBar size="sm" value={(r.clearance_progress.cleared / (r.clearance_progress.total || 1)) * 100} tone={r.clearance_progress.cleared === r.clearance_progress.total ? "green" : "orange"} />
						<div className="mt-0.5 text-[11px] text-ink-soft">
							{r.clearance_progress.cleared} of {r.clearance_progress.total} cleared
						</div>
					</div>
				) : (
					<span className="text-ink-soft">—</span>
				),
		},
		{ key: "creation", label: "Raised", render: (r) => <span className="whitespace-nowrap">{date(r.creation)}</span>, sortValue: (r) => r.creation },
		{
			key: "status",
			label: "Status",
			render: (r) => (
				<div>
					<Badge status={r.status} />
					{r.decision_date ? <div className="mt-1 whitespace-nowrap text-[11px] text-ink-soft">Decided {date(r.decision_date)}</div> : null}
				</div>
			),
		},
	]

	const runExport = async () => {
		setExporting(true)
		try {
			const n = await exportAll(`${API}list_requests`, { ...filters, status: get("status") || undefined }, EXPORT_COLS, "student-requests")
			toast.success(`Exported ${num(n)} requests`)
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
				title="Student requests"
				subtitle="Deferment, withdrawal, resumption, transfers, course drops, documents and clearance."
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(`${API}list_requests`)}>
							Refresh
						</Button>
						<Button variant="secondary" size="sm" loading={exporting} onClick={runExport} disabled={!data.total}>
							Export
						</Button>
					</>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="New" value={num(counts.Pending || 0)} icon={Inbox} tone="orange" hint="Waiting for a first look" />
				<StatCard label="Under review" value={num(counts["Under Review"] || 0)} icon={Search} tone="blue" hint="Including clearance in progress" />
				<StatCard label="Approved" value={num(counts.Approved || 0)} icon={CheckCircle2} tone="green" hint={`${num(counts.Completed || 0)} completed`} />
				<StatCard label="Closed" value={num((counts.Rejected || 0) + (counts.Cancelled || 0))} icon={Clock} hint={`${num(counts.Rejected || 0)} rejected · ${num(counts.Cancelled || 0)} cancelled`} />
			</div>

			<Toolbar search={search} onSearch={setSearch} placeholder="Search student or request…" chips={chips} active={get("status")} onChip={(id) => set({ status: id })} />
			<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
				<Select aria-label="Request type" value={get("type")} onChange={(e) => set({ type: e.target.value })} placeholder="All request types" options={REQUEST_TYPES} />
				<Select aria-label="Term" value={get("term")} onChange={(e) => set({ term: e.target.value })} placeholder="All terms" options={(L.terms || []).map((t) => ({ value: t.name, label: t.term_label }))} />
				<div className="col-span-2 flex items-center justify-end gap-3 text-xs text-ink-soft">
					<span>{list.isFetching ? "Loading…" : `${num(data.total || 0)} request${data.total === 1 ? "" : "s"}`}</span>
					{get("type") || get("term") ? (
						<button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => set({ type: "", term: "" })}>
							Clear filters
						</button>
					) : null}
				</div>
			</div>

			<DataTable cols={cols} rows={data.data || []} query={list} rowTo={(r) => `/admin/students/requests/${encodeURIComponent(r.name)}`} empty="No requests match these filters" emptyIcon={FileQuestion} />
			<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
		</>
	)
}
