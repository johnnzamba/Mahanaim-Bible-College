import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ClipboardCheck, Clock, Send, Undo2 } from "lucide-react"
import { Alert, PageHeader, ProgressBar, StatCard } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { ago, dateTime } from "@/shared/utils/format"
import { ACAD, BASE, RESULTS, SHEET_STATUS, fmtScore, rate, rowsOf, useAcademicRoles, useLookups, useTermParam } from "../lib"
import { SheetBadge, SubNav, TermSelect } from "../components/common"

/** "mine" is the sheets awaiting the caller's own step (the endpoint's default when no status is sent). */
export default function MarkSheets() {
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const L = lookups.data
	const [term, setTerm] = useTermParam(L)
	const [params, setParams] = useSearchParams()
	const status = params.get("status") || "mine"
	const [search, setSearch] = useState("")
	const setStatus = (s) =>
		setParams(
			(p) => {
				const n = new URLSearchParams(p)
				if (s === "mine") n.delete("status")
				else n.set("status", s)
				return n
			},
			{ replace: true }
		)
	const stats = useApi(`${ACAD}academics_stats`, { term }, { enabled: Boolean(term) })
	const q = useApi(`${RESULTS}pending_mark_sheets`, { term: term || undefined, status: status === "mine" ? undefined : status }, { enabled: Boolean(L) })
	const rs = stats.data?.results_status || {}
	const mineLabel = roles.dean && roles.registrar ? "Awaiting me" : roles.dean ? "To approve" : roles.registrar ? "To publish" : "Awaiting me"
	const mineCount = (roles.dean ? rs.Submitted || 0 : 0) + (roles.registrar ? rs.Approved || 0 : 0)
	const chips = [{ id: "mine", label: mineLabel, count: stats.data ? mineCount : null }, ...SHEET_STATUS.map((s) => ({ id: s, label: s, count: stats.data ? rs[s] || 0 : null }))]

	const rows = useMemo(() => {
		const all = rowsOf(q.data)
		const s = search.trim().toLowerCase()
		if (!s) return all
		return all.filter((r) => [r.course_title, r.course_offering, r.name, r.campus, ...(r.lecturers || [])].some((v) => String(v || "").toLowerCase().includes(s)))
	}, [q.data, search])

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
		{ key: "lecturers", label: "Lecturer", hideOnMobile: true, render: (r) => (r.lecturers?.length ? r.lecturers.join(", ") : <span className="text-ink-soft">—</span>), exportValue: (r) => (r.lecturers || []).join("; ") },
		{ key: "student_count", label: "Students", align: "right", render: (r) => r.student_count || 0 },
		{
			key: "pass_count",
			label: "Pass rate",
			render: (r) => {
				const p = rate(r.pass_count, r.student_count)
				return p === null ? (
					"—"
				) : (
					<div className="flex min-w-[7rem] items-center gap-2">
						<ProgressBar value={p} tone={p >= 70 ? "green" : p >= 50 ? "orange" : "red"} className="flex-1" size="sm" />
						<span className="w-10 text-right text-xs tabular-nums text-ink-muted">{p}%</span>
					</div>
				)
			},
			sortValue: (r) => rate(r.pass_count, r.student_count) ?? -1,
			exportValue: (r) => rate(r.pass_count, r.student_count) ?? "",
		},
		{ key: "average_score", label: "Average", align: "right", hideOnMobile: true, render: (r) => fmtScore(r.average_score), sortValue: (r) => Number(r.average_score || 0) },
		{
			key: "submitted_on",
			label: "Submitted",
			hideOnMobile: true,
			render: (r) => (r.submitted_on ? <span title={dateTime(r.submitted_on)}>{ago(r.submitted_on)}</span> : "—"),
			sortValue: (r) => r.submitted_on || "",
			exportValue: (r) => r.submitted_on || "",
		},
		{ key: "status", label: "Status", render: (r) => <SheetBadge status={r.status} size="xs" /> },
	]

	return (
		<div>
			<PageHeader
				eyebrow="Academics"
				title="Mark sheets"
				subtitle="Lecturers submit; the Academic Dean approves; the Registrar publishes to students."
				actions={<TermSelect lookups={L} value={term} onChange={setTerm} allowAll className="min-w-[13rem]" />}
			/>
			<SubNav group="results" />
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Waiting for the Dean" value={rs.Submitted ?? "—"} icon={Clock} tone="orange" loading={stats.isLoading} hint="Submitted" />
				<StatCard label="Ready to publish" value={rs.Approved ?? "—"} icon={Send} tone="purple" loading={stats.isLoading} hint="Approved" />
				<StatCard label="Returned to lecturers" value={rs.Returned ?? "—"} icon={Undo2} tone="blue" loading={stats.isLoading} />
				<StatCard label="Published" value={rs.Published ?? "—"} icon={ClipboardCheck} tone="green" loading={stats.isLoading} to={`${BASE}/results${term ? `?term=${encodeURIComponent(term)}` : ""}`} />
			</div>
			{!term ? <Alert tone="info" className="mb-4" title="Showing every term">Counts above need a term; pick one to see them.</Alert> : null}
			<Toolbar search={search} onSearch={setSearch} placeholder="Search course, offering or lecturer…" chips={chips} active={status} onChip={setStatus} right={<ExportButton filename={`mark-sheets-${status}`} cols={cols} rows={rows} />} />
			<DataTable
				cols={cols}
				rows={q.isLoading || q.isError ? undefined : rows}
				query={q}
				rowKey={(r) => r.name}
				rowTo={(r) => `${BASE}/mark-sheets/${encodeURIComponent(r.name)}`}
				emptyIcon={ClipboardCheck}
				empty={status === "mine" ? "Nothing is waiting for you" : `No ${status.toLowerCase()} mark sheets${term ? " this term" : ""}`}
				initialSort={{ key: "submitted_on", dir: "asc" }}
			/>
		</div>
	)
}
