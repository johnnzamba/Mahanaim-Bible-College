import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Award, CalendarClock, CheckCircle2, History, NotebookPen, PlayCircle } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Empty, PageHeader, QueryState, Skeleton, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { dateTime, pct } from "@/shared/utils/format"
import { API, pctTone } from "../components/lib"
import { GOLD_BTN, useServerTime } from "../components/bits"
import { ExamCard } from "../components/ExamCard"

export default function Exams() {
	const q = useApi(API.exams, {}, { refetchInterval: 60000 })
	useServerTime(q.data?.server_time, q.dataUpdatedAt)
	const d = q.data || {}
	const [tab, setTab] = useState("now")
	const released = useMemo(
		() =>
			(d.past || [])
				.concat(d.open || [])
				.flatMap((e) => (e.attempts || []).map((a) => ({ ...a, exam: e })))
				.filter((a) => a.status !== "In Progress"),
		[d]
	)
	const avg = useMemo(() => {
		const xs = released.filter((a) => a.status === "Released" && a.percentage != null)
		return xs.length ? xs.reduce((s, a) => s + Number(a.percentage), 0) / xs.length : null
	}, [released])
	const blocked = (d.open || []).find((e) => !e.can_start && !e.in_progress_attempt && (e.reasons || []).some((r) => /fee/i.test(r)))
	const inProgress = (d.open || []).find((e) => e.in_progress_attempt)

	return (
		<>
			<PageHeader eyebrow="Learning" title="Exams & CATs" subtitle="Online and in-person assessments: open now, coming up, and your results." />
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Open now" value={(d.open || []).length} icon={PlayCircle} tone="green" loading={q.isLoading} />
				<StatCard label="Upcoming" value={(d.upcoming || []).length} icon={CalendarClock} tone="blue" loading={q.isLoading} />
				<StatCard label="Completed attempts" value={released.length} icon={CheckCircle2} tone="brand" loading={q.isLoading} />
				<StatCard label="Average score" value={avg == null ? "—" : pct(avg)} icon={Award} tone="gold" loading={q.isLoading} hint="Released results" />
			</div>
			{inProgress ? (
				<Alert
					tone="warning"
					title={`${inProgress.title} is in progress`}
					className="mb-4"
					action={
						<Link to={`/student/exams/${encodeURIComponent(inProgress.name)}`} className={`${GOLD_BTN} btn-sm`}>
							Resume
						</Link>
					}
				>
					Your timer keeps running while you're away. Resume now.
				</Alert>
			) : null}
			{blocked ? (
				<Alert
					tone="error"
					title="Fee clearance required"
					className="mb-4"
					action={
						<Link to="/student/fees/pay" className="btn btn-primary btn-sm">
							Pay fees
						</Link>
					}
				>
					{blocked.reasons.find((r) => /fee/i.test(r))}
				</Alert>
			) : null}
			<Tabs
				className="mb-4 pb-px"
				tabs={[
					{ id: "now", label: "Open & upcoming", count: (d.open || []).length + (d.upcoming || []).length },
					{ id: "past", label: "Past", count: (d.past || []).length },
					{ id: "results", label: "My results", count: released.length },
				]}
				active={tab}
				onChange={setTab}
			/>
			<QueryState
				query={q}
				skeleton={
					<div className="space-y-3">
						<Skeleton className="h-24 rounded-2xl" />
						<Skeleton className="h-24 rounded-2xl" />
					</div>
				}
			>
				{() =>
					tab === "now" ? (
						<div className="space-y-6">
							<Group title="Open now" rows={d.open} empty="No exams are open right now." />
							<Group title="Coming up" rows={d.upcoming} empty="Nothing scheduled yet." />
						</div>
					) : tab === "past" ? (
						<Group rows={d.past} empty="No past exams." />
					) : (
						<DataTable
							rows={released}
							empty="No attempts yet"
							emptyIcon={History}
							rowKey="name"
							rowTo={(r) => (r.status === "Released" ? `/student/exams/result/${encodeURIComponent(r.name)}` : null)}
							initialSort={{ key: "exam", dir: "asc" }}
							cols={[
								{
									key: "exam",
									label: "Exam",
									sortValue: (r) => r.exam.title,
									render: (r) => (
										<span className="block">
											<span className="block font-semibold text-ink">{r.exam.title}</span>
											<span className="block text-xs text-ink-soft">{r.exam.course_title}</span>
										</span>
									),
								},
								{ key: "type", label: "Type", render: (r) => r.exam.exam_type, hideOnMobile: true },
								{ key: "attempt_number", label: "Attempt", align: "center", hideOnMobile: true },
								{ key: "when", label: "Date", render: (r) => dateTime(r.exam.start_datetime), hideOnMobile: true },
								{
									key: "status",
									label: "Result",
									align: "right",
									render: (r) =>
										r.status === "Released" ? (
											<Badge tone={pctTone(r.percentage, { good: 70, warn: 50 })}>{pct(r.percentage)}</Badge>
										) : (
											<Badge tone="orange">Awaiting marking</Badge>
										),
								},
							]}
						/>
					)
				}
			</QueryState>
		</>
	)
}

function Group({ title, rows = [], empty }) {
	return (
		<section>
			{title ? <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">{title}</h2> : null}
			{rows.length ? (
				<div className="space-y-3">
					{rows.map((e) => (
						<ExamCard key={e.name} exam={e} />
					))}
				</div>
			) : (
				<div className="card">
					<Empty compact icon={NotebookPen} title={empty} />
				</div>
			)}
		</section>
	)
}
