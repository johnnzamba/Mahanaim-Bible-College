import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { BarChart3, CheckCircle2, ClipboardCheck, Download, FileText, Send, Users } from "lucide-react"
import { Alert, AvatarCell, Badge, Button, ConfirmDialog, ErrorState, Card, Html, Loading, PageHeader, Panel, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar } from "@/shared/components/kit"
import { BarsChart, DonutChart } from "@/shared/components/Charts"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { dateTime, daysUntil } from "@/shared/utils/format"
import { AssignmentDrawer } from "../components/AssignmentDrawer"
import { AssignmentActions } from "../components/course/AssignmentsTab"
import { BulkGradeTable } from "../components/BulkGradeTable"
import { GradeDrawer } from "../components/GradeDrawer"
import { StatusBadge } from "../components/bits"
import { M, P, isPast, score } from "../components/lib"

const GRADED = ["Graded", "Returned"]
const CHIPS = [
	{ id: "", label: "All" },
	{ id: "to_grade", label: "To grade" },
	{ id: "graded", label: "Graded" },
	{ id: "unreleased", label: "Not released" },
	{ id: "late", label: "Late" },
	{ id: "missing", label: "Not submitted" },
]
const MATCH = {
	to_grade: (r) => r.status === "Submitted" || r.status === "Late",
	graded: (r) => GRADED.includes(r.status),
	unreleased: (r) => GRADED.includes(r.status) && !r.released,
	late: (r) => Boolean(r.is_late),
	missing: (r) => r.status === "Not Submitted",
}

export default function AssignmentGrading() {
	const { assignment } = useParams()
	const subs = useApi(M.listSubmissions, { assignment })
	const stats = useApi(M.assignmentStats, { assignment })
	const [view, setView] = useState("submissions")
	const [chip, setChip] = useState("")
	const [search, setSearch] = useState("")
	const [queue, setQueue] = useState(null)
	const [edit, setEdit] = useState(false)
	const [confirmRelease, setConfirmRelease] = useState(false)
	const release = useAction(M.releaseGrades, {
		invalidate: [P.asg, P.lec, P.res],
		success: (d) => `${d.released} grade${d.released === 1 ? "" : "s"} released to students`,
		onSuccess: () => setConfirmRelease(false),
	})

	const a = subs.data?.assignment
	const rows = useMemo(() => subs.data?.data || [], [subs.data])
	const byStudent = useMemo(() => Object.fromEntries(rows.map((r) => [r.student, r])), [rows])
	const counts = useMemo(() => Object.fromEntries(CHIPS.map((c) => [c.id, c.id ? rows.filter(MATCH[c.id]).length : rows.length])), [rows])
	const q = search.trim().toLowerCase()
	const filtered = rows.filter((r) => (!chip || MATCH[chip](r)) && (!q || `${r.student_name} ${r.student_number}`.toLowerCase().includes(q)))
	const queueRows = queue ? queue.keys.map((k) => byStudent[k]).filter(Boolean) : []

	const openAt = (r) => {
		const keys = filtered.map((x) => x.student)
		setQueue({ keys, index: Math.max(keys.indexOf(r.student), 0) })
	}
	const startGrading = () => {
		const pending = rows.filter(MATCH.to_grade)
		if (pending.length) setQueue({ keys: pending.map((r) => r.student), index: 0 })
	}

	if (subs.isError) {
		return (
			<div className="space-y-6">
				<PageHeader title="Assignment" back={{ to: "/lecturer/courses", label: "My courses" }} />
				<Card>
					<ErrorState error={subs.error} onRetry={() => subs.refetch()} />
				</Card>
			</div>
		)
	}
	if (!a) return <Loading className="min-h-[50vh]" />

	const s = stats.data
	const max = Number(a.max_score) || 0
	const unreleased = counts.unreleased
	const due = daysUntil(a.due_date)

	const cols = [
		{
			key: "student_name",
			label: "Student",
			render: (r) => <AvatarCell name={r.student_name} sub={r.student_number} size={32} />,
			sortValue: (r) => r.student_name,
		},
		{ key: "status", label: "Status", render: (r) => <StatusBadge kind="submission" status={r.status} />, sortValue: (r) => r.status },
		{
			key: "submitted_on",
			label: "Submitted",
			render: (r) =>
				r.submitted_on ? (
					<span className="whitespace-nowrap">
						{dateTime(r.submitted_on)}
						{r.is_late ? <span className="ml-1.5 text-xs font-semibold text-red-600">+{r.days_late}d</span> : null}
					</span>
				) : (
					"—"
				),
			sortValue: (r) => r.submitted_on || "",
		},
		{
			key: "final_score",
			label: `Score /${score(max)}`,
			align: "right",
			render: (r) =>
				GRADED.includes(r.status) ? (
					<span className="font-semibold text-ink">
						{score(r.final_score)}
						{r.penalty ? <span className="ml-1 text-xs font-normal text-red-600">(−{score(r.penalty)})</span> : null}
					</span>
				) : (
					"—"
				),
			sortValue: (r) => (GRADED.includes(r.status) ? Number(r.final_score) : null),
		},
		{
			key: "released",
			label: "Released",
			align: "center",
			render: (r) => (GRADED.includes(r.status) ? r.released ? <CheckCircle2 size={16} className="mx-auto text-emerald-600" aria-label="Released" /> : <span className="text-xs text-ink-soft">Hidden</span> : "—"),
			sortValue: (r) => (r.released ? 1 : 0),
		},
		{
			key: "act",
			label: "",
			sortable: false,
			export: false,
			hideOnMobile: true,
			render: (r) => (
				<Button size="sm" variant={MATCH.to_grade(r) ? "primary" : "ghost"} onClick={(e) => (e.stopPropagation(), openAt(r))}>
					{MATCH.to_grade(r) ? "Grade" : GRADED.includes(r.status) ? "Review" : "Record mark"}
				</Button>
			),
		},
	]

	return (
		<div className="space-y-6">
			<PageHeader
				back={{ to: `/lecturer/courses/${a.course_offering}?tab=assignments`, label: a.course_title || "Course" }}
				eyebrow={`${a.assessment_component} · ${a.course_title || a.course_offering}`}
				title={a.title}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<StatusBadge kind="assignment" status={a.status} />
						<span>
							Due {dateTime(a.due_date)}
							{a.status === "Published" && !isPast(a.due_date) && due !== null ? ` · ${due === 0 ? "today" : `in ${due} day${due === 1 ? "" : "s"}`}` : ""}
						</span>
						<span>Out of {score(max)}</span>
						{a.allow_late ? <span>Late: −{score(a.late_penalty_percent_per_day)}%/day</span> : <span>No late work</span>}
					</span>
				}
				actions={
					<>
						{a.attachment ? (
							<a className="btn btn-ghost btn-sm" href={frappe.downloadUrl(M.downloadAssignmentFile, { name: a.name, kind: "brief" })} target="_blank" rel="noreferrer">
								<FileText size={14} /> Brief
							</a>
						) : null}
						<AssignmentActions a={{ ...a, submission_count: s?.submitted ?? a.submission_count }} onEdit={() => setEdit(true)} compact />
						{unreleased ? (
							<Button size="sm" variant="gold" icon={Send} onClick={() => setConfirmRelease(true)}>
								Release {unreleased}
							</Button>
						) : null}
						{counts.to_grade ? (
							<Button size="sm" icon={ClipboardCheck} onClick={startGrading}>
								Grade {counts.to_grade}
							</Button>
						) : null}
					</>
				}
			/>

			{a.status === "Draft" ? <Alert tone="info" title="This assignment is a draft">Students can't see it until you publish it.</Alert> : null}
			{counts.to_grade === 0 && unreleased > 0 ? (
				<Alert
					tone="brand"
					title="Everything is graded"
					action={
						<Button size="sm" variant="gold" icon={Send} onClick={() => setConfirmRelease(true)}>
							Release grades
						</Button>
					}
				>
					{unreleased} grade{unreleased === 1 ? " is" : "s are"} still hidden from students.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
				<StatCard label="Submitted" value={s ? `${s.submitted}/${s.enrolled}` : "—"} icon={Users} hint={s?.late ? `${s.late} late` : "None late"} loading={stats.isLoading} />
				<StatCard label="To grade" value={s?.to_grade ?? "—"} icon={ClipboardCheck} tone={s?.to_grade ? "orange" : "green"} loading={stats.isLoading} />
				<StatCard label="Graded" value={s ? s.graded : "—"} icon={CheckCircle2} tone="blue" hint={s ? `${s.released} released` : undefined} loading={stats.isLoading} />
				<StatCard label="Average" value={s?.graded ? `${score(s.average, 1)}/${score(max)}` : "—"} icon={BarChart3} tone="gold" hint={s?.graded ? `High ${score(s.highest)} · Low ${score(s.lowest)}` : "No grades yet"} loading={stats.isLoading} />
			</div>

			<Tabs
				className="overflow-y-hidden pb-px"
				active={view}
				onChange={setView}
				tabs={[
					{ id: "submissions", label: "Submissions", count: rows.length },
					{ id: "bulk", label: "Quick grade" },
					{ id: "insights", label: "Insights" },
					{ id: "brief", label: "Brief" },
				]}
			/>

			{view === "submissions" ? (
				<>
					<Toolbar
						search={search}
						onSearch={setSearch}
						placeholder="Search students…"
						chips={CHIPS.map((c) => ({ ...c, count: counts[c.id] }))}
						active={chip}
						onChip={setChip}
						right={<ExportButton filename={`${a.name}-grades`} cols={cols} rows={filtered} />}
					/>
					<DataTable
						cols={cols}
						rows={filtered}
						rowKey="student"
						onRow={openAt}
						initialSort={{ key: "student_name", dir: "asc" }}
						empty={chip ? "No submissions in this view" : "No students enrolled"}
						emptyIcon={ClipboardCheck}
					/>
				</>
			) : null}

			{view === "bulk" ? (
				<>
					<p className="text-sm text-ink-muted">
						Enter raw scores out of {score(max)}; late penalties are applied automatically. Students without an online submission get a paper hand-in record.
					</p>
					<BulkGradeTable assignment={a} rows={rows} />
				</>
			) : null}

			{view === "insights" ? (
				<div className="grid gap-6 lg:grid-cols-5">
					<Panel title="Score distribution" subtitle="Graded submissions, % of max score" className="lg:col-span-3">
						{s?.graded ? (
							<BarsChart data={s.distribution} xKey="range" series={[{ key: "count", label: "Students" }]} height={260} />
						) : (
							<p className="py-10 text-center text-sm text-ink-soft">The chart appears once you've graded some work.</p>
						)}
					</Panel>
					<Panel title="Submission status" className="lg:col-span-2">
						{s ? (
							<DonutChart
								height={240}
								center={`${s.enrolled ? Math.round((s.submitted / s.enrolled) * 100) : 0}%`}
								centerLabel="submitted"
								data={[
									{ label: "On time", value: s.submitted - s.late, color: "#10b981" },
									{ label: "Late", value: s.late, color: "#f59e0b" },
									{ label: "Not submitted", value: s.not_submitted, color: "#94a3b8" },
								]}
							/>
						) : null}
					</Panel>
				</div>
			) : null}

			{view === "brief" ? (
				<Panel title="Instructions">
					{a.instructions ? <Html html={a.instructions} /> : <p className="text-sm text-ink-soft">No instructions.</p>}
					<dl className="mt-5 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
						<div>
							<dt className="text-xs text-ink-soft">Opens</dt>
							<dd className="text-ink">{a.open_date ? dateTime(a.open_date) : "On publish"}</dd>
						</div>
						<div>
							<dt className="text-xs text-ink-soft">Submission</dt>
							<dd className="text-ink">{a.submission_type}</dd>
						</div>
						<div>
							<dt className="text-xs text-ink-soft">Late policy</dt>
							<dd className="text-ink">
								{a.allow_late ? `−${score(a.late_penalty_percent_per_day)}%/day, max −${score(a.max_late_penalty_percent)}%${a.late_cutoff ? `, until ${dateTime(a.late_cutoff)}` : ""}` : "Not accepted"}
							</dd>
						</div>
					</dl>
					{a.attachment ? (
						<a className="btn btn-secondary btn-sm mt-4" href={frappe.downloadUrl(M.downloadAssignmentFile, { name: a.name, kind: "brief" })} target="_blank" rel="noreferrer">
							<Download size={14} /> Download brief
						</a>
					) : null}
				</Panel>
			) : null}

			{queue ? (
				<GradeDrawer
					open
					onClose={() => setQueue(null)}
					assignment={a}
					rows={queueRows}
					index={Math.min(queue.index, Math.max(queueRows.length - 1, 0))}
					onIndex={(i) => setQueue((x) => ({ ...x, index: i }))}
				/>
			) : null}
			<AssignmentDrawer open={edit} onClose={() => setEdit(false)} offering={a.course_offering} assignment={a} />
			<ConfirmDialog
				open={confirmRelease}
				onClose={() => setConfirmRelease(false)}
				title={`Release ${unreleased} grade${unreleased === 1 ? "" : "s"}?`}
				message="Students are notified and can see their score and feedback. Closed assignments move to Graded."
				confirmLabel="Release grades"
				loading={release.isPending}
				onConfirm={() => release.mutate({ assignment: a.name })}
			>
				{counts.to_grade ? (
					<Badge tone="orange" className="mt-3">
						{counts.to_grade} submission{counts.to_grade === 1 ? " is" : "s are"} still ungraded
					</Badge>
				) : null}
			</ConfirmDialog>
		</div>
	)
}
