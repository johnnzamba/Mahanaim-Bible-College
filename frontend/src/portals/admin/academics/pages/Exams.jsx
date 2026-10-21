import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { AlarmClock, CheckCheck, FileSpreadsheet, PenLine, Radio } from "lucide-react"
import { Alert, Badge, PageHeader, StatCard } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar } from "@/shared/components/kit"
import { dateTime, num } from "@/shared/utils/format"
import { BASE, fmtScore, useLookups, useTermParam } from "../lib"
import { SubNav, TermSelect } from "../components/common"
import { useTermExams } from "../components/useTerm"

const STATUSES = ["Draft", "Scheduled", "Open", "Closed", "Marking", "Released", "Cancelled"]

export default function Exams() {
	const lookups = useLookups()
	const [term, setTerm] = useTermParam(lookups.data)
	const [status, setStatus] = useState("")
	const [search, setSearch] = useState("")
	const t = useTermExams(term)
	const counts = useMemo(() => {
		const c = {}
		for (const e of t.exams) c[e.status] = (c[e.status] || 0) + 1
		return c
	}, [t.exams])
	const rows = useMemo(() => {
		const s = search.trim().toLowerCase()
		return t.exams
			.filter((e) => !status || e.status === status)
			.filter((e) => !s || `${e.title} ${e.course} ${e.course_title} ${e.campus}`.toLowerCase().includes(s))
			.sort((a, b) => String(b.start_datetime || "").localeCompare(String(a.start_datetime || "")))
	}, [t.exams, status, search])
	const toMark = t.exams.reduce((a, e) => a + Number(e.to_mark || 0), 0)
	const now = new Date().toISOString().slice(0, 16).replace("T", " ")
	const upcoming = t.exams.filter((e) => e.status === "Scheduled" && e.start_datetime && e.start_datetime >= now).length

	const cols = [
		{
			key: "title",
			label: "Exam",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.title}</div>
					<div className="truncate text-xs text-ink-soft">
						{r.course} · {r.course_title} · {r.campus}
					</div>
				</div>
			),
			sortValue: (r) => r.title,
			exportValue: (r) => r.title,
		},
		{ key: "exam_type", label: "Type", hideOnMobile: true },
		{
			key: "start_datetime",
			label: "Window",
			render: (r) =>
				r.start_datetime ? (
					<div className="text-sm">
						<div>{dateTime(r.start_datetime)}</div>
						<div className="text-xs text-ink-soft">{num(r.duration_minutes)} min</div>
					</div>
				) : (
					<span className="text-ink-soft">Not scheduled</span>
				),
			sortValue: (r) => r.start_datetime || "",
			exportValue: (r) => r.start_datetime,
		},
		{ key: "question_count", label: "Questions", align: "right", hideOnMobile: true },
		{ key: "submitted_count", label: "Submitted", align: "right", render: (r) => `${num(r.submitted_count)} / ${num(r.attempt_count)}`, sortValue: (r) => Number(r.submitted_count || 0) },
		{ key: "to_mark", label: "To mark", align: "right", render: (r) => (r.to_mark ? <span className="font-semibold text-orange-600">{num(r.to_mark)}</span> : "0"), sortValue: (r) => Number(r.to_mark || 0) },
		{ key: "average_score", label: "Average", align: "right", hideOnMobile: true, render: (r) => (r.submitted_count ? fmtScore(r.average_score) : "—") },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" dot={r.status === "Open"} />, exportValue: (r) => r.status },
	]

	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Exams"
				subtitle="Online exams across every offering in the term: schedule, live sittings, marking and results release."
				actions={<TermSelect lookups={lookups.data} value={term} onChange={setTerm} className="w-60" />}
			/>
			<SubNav group="exams" />
			{t.truncated ? (
				<Alert tone="warning" className="mb-4">
					This term has more than 200 offerings; only the first 200 are scanned for exams.
				</Alert>
			) : null}
			{t.failed ? (
				<Alert tone="warning" className="mb-4">
					Exams for {t.failed} offering{t.failed === 1 ? "" : "s"} could not be loaded.
				</Alert>
			) : null}
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Exams this term" icon={FileSpreadsheet} value={num(t.exams.length)} hint={`across ${num(t.offerings.length)} offerings`} loading={t.isLoading} />
				<StatCard label="Live now" icon={Radio} value={num(counts.Open)} tone={counts.Open ? "red" : "gray"} loading={t.isLoading} />
				<StatCard label="Scheduled ahead" icon={AlarmClock} value={num(upcoming)} tone="blue" loading={t.isLoading} />
				<StatCard label="Answers to mark" icon={PenLine} value={num(toMark)} tone={toMark ? "orange" : "green"} hint={`${num(counts.Released)} released`} loading={t.isLoading} />
			</div>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search exam, course or campus…"
				chips={[{ id: "", label: "All", count: t.exams.length }, ...STATUSES.filter((s) => counts[s] || ["Open", "Scheduled"].includes(s)).map((s) => ({ id: s, label: s, count: counts[s] || 0 }))]}
				active={status}
				onChip={setStatus}
				right={<ExportButton filename={`exams-${term}`} cols={cols} rows={rows} />}
			/>
			<DataTable
				query={{ isLoading: t.isLoading, isError: t.isError && !t.exams.length, error: t.error, refetch: t.refetch }}
				rows={t.isLoading ? undefined : rows}
				cols={cols}
				rowTo={(r) => `${BASE}/exams/${encodeURIComponent(r.name)}`}
				empty={t.exams.length ? "No exams match these filters" : "No exams set for this term yet"}
				emptyIcon={CheckCheck}
				emptyAction={
					!t.exams.length ? (
						<Link to={`${BASE}/offerings?term=${encodeURIComponent(term)}`} className="btn btn-secondary btn-sm">
							Browse offerings
						</Link>
					) : null
				}
			/>
			<p className="mt-3 text-xs text-ink-soft">Lecturers build and schedule exams from the staff portal; manage the question banks here.</p>
		</>
	)
}
