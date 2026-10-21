import { useMemo, useState } from "react"
import { AlertTriangle, Award, CheckCircle2, ClipboardList, Clock } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, PageHeader, StatCard } from "@/shared/components/ui"
import { DataTable, Toolbar } from "@/shared/components/kit"
import { date, num, pct } from "@/shared/utils/format"
import { API, ASSIGNMENT_STATE, msUntil, pctTone } from "../components/lib"
import { DueBadge, useTick } from "../components/bits"

const CHIPS = [
	{ id: "todo", label: "To do" },
	{ id: "submitted", label: "Submitted" },
	{ id: "graded", label: "Graded" },
	{ id: "all", label: "All" },
]

export default function Assignments() {
	const q = useApi(API.assignments)
	const [chip, setChip] = useState("todo")
	const [search, setSearch] = useState("")
	const rows = q.data?.data || []
	const now = useTick(60_000)
	const counts = useMemo(() => {
		const c = { todo: 0, submitted: 0, graded: 0, overdue: 0, all: rows.length }
		for (const r of rows) {
			if (r.state === "pending" || r.state === "overdue") c.todo++
			// The API only reports "overdue" when late work is refused; past-due work that can still go in late counts too.
			if (r.state === "overdue" || (r.state === "pending" && msUntil(r.due_date) < 0)) c.overdue++
			if (r.state === "submitted") c.submitted++
			if (r.state === "graded") c.graded++
		}
		return c
	}, [rows, now]) // eslint-disable-line react-hooks/exhaustive-deps
	const avg = useMemo(() => {
		const g = rows.filter((r) => r.submission?.released && r.max_score)
		if (!g.length) return null
		return g.reduce((a, r) => a + (r.submission.final_score / r.max_score) * 100, 0) / g.length
	}, [rows])
	const list = useMemo(() => {
		const s = search.trim().toLowerCase()
		return rows
			.filter((r) => chip === "all" || (chip === "todo" ? ["pending", "overdue"].includes(r.state) : r.state === chip))
			.filter((r) => !s || `${r.title} ${r.course_title}`.toLowerCase().includes(s))
	}, [rows, chip, search])

	return (
		<>
			<PageHeader eyebrow="Learning" title="Assignments" subtitle="Coursework across all your courses: briefs, deadlines, submissions and feedback." />
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="To do" value={counts.todo} icon={Clock} tone="blue" loading={q.isLoading} />
				<StatCard label="Overdue" value={counts.overdue} icon={AlertTriangle} tone={counts.overdue ? "red" : "gray"} loading={q.isLoading} />
				<StatCard label="Submitted" value={counts.submitted + counts.graded} icon={CheckCircle2} tone="green" loading={q.isLoading} />
				<StatCard label="Average score" value={avg == null ? "—" : pct(avg)} icon={Award} tone="gold" loading={q.isLoading} hint="Released grades" />
			</div>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search assignments…"
				chips={CHIPS.map((c) => ({ ...c, count: counts[c.id] }))}
				active={chip}
				onChip={setChip}
			/>
			<DataTable
				query={q}
				rows={q.data ? list : undefined}
				rowTo={(r) => `/student/assignments/${encodeURIComponent(r.name)}`}
				empty={chip === "todo" ? "Nothing to do. You're all caught up" : "No assignments here"}
				emptyIcon={ClipboardList}
				pageSize={20}
				cols={[
					{
						key: "title",
						label: "Assignment",
						render: (r) => (
							<span className="block min-w-0">
								<span className="block font-semibold text-ink">{r.title}</span>
								<span className="block text-xs text-ink-soft">{r.course_title}</span>
							</span>
						),
						sortValue: (r) => r.title,
					},
					{ key: "assessment_component", label: "Type", hideOnMobile: true },
					{
						key: "due_date",
						label: "Due",
						sortValue: (r) => r.due_date,
						render: (r) => (
							<span className="flex flex-col items-start gap-1">
								<span className="text-xs text-ink-muted">{date(r.due_date, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
								{["pending", "overdue"].includes(r.state) ? <DueBadge due={r.due_date} size="xs" /> : null}
							</span>
						),
					},
					{
						key: "state",
						label: "Status",
						render: (r) => (
							<span className="flex flex-wrap gap-1">
								<Badge tone={ASSIGNMENT_STATE[r.state]?.tone}>{ASSIGNMENT_STATE[r.state]?.label || r.state}</Badge>
								{r.submission?.is_late ? <Badge tone="orange" size="xs">Late</Badge> : null}
							</span>
						),
					},
					{
						key: "score",
						label: "Score",
						align: "right",
						sortValue: (r) => (r.submission?.released ? r.submission.final_score / (r.max_score || 1) : -1),
						render: (r) =>
							r.submission?.released ? (
								<span className="inline-flex items-center gap-2">
									<span className="font-semibold tabular-nums">
										{num(r.submission.final_score, 1)}/{num(r.max_score)}
									</span>
									<Badge size="xs" tone={pctTone((r.submission.final_score / (r.max_score || 1)) * 100, { good: 70, warn: 50 })}>
										{pct((r.submission.final_score / (r.max_score || 1)) * 100)}
									</Badge>
								</span>
							) : (
								<span className="text-ink-soft">{num(r.max_score)} marks</span>
							),
					},
				]}
			/>
		</>
	)
}
