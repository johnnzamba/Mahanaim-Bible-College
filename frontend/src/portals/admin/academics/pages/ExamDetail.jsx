import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { Ban, CalendarCheck, CalendarX, CheckCircle2, Clock, Eye, FileQuestion, Lock, PenLine, Radio, Send, Timer, Trophy, Users } from "lucide-react"
import { Alert, Badge, Button, ConfirmDialog, Empty, ErrorState, Html, KeyValueGrid, MetricRow, PageHeader, Panel, ProgressBar, SkeletonRows, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { BarsChart } from "@/shared/components/Charts"
import { useAction, useApi } from "@/shared/api/hooks"
import { dateTime, num, time } from "@/shared/utils/format"
import { BASE, EXAMS, fmtScore, useAcademicRoles } from "../lib"
import { Facts } from "../components/common"

const fmtLeft = (s) => {
	const n = Math.max(0, Number(s || 0))
	const m = Math.floor(n / 60)
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(Math.floor(n % 60)).padStart(2, "0")}`
}

const ACTIONS = {
	schedule: { method: "schedule_exam", label: "Schedule", icon: CalendarCheck, from: ["Draft"], confirm: "Schedule this exam? Enrolled students are notified and it opens automatically at the start time.", success: "Exam scheduled" },
	unschedule: { method: "unschedule_exam", label: "Back to draft", icon: CalendarX, from: ["Scheduled"], variant: "secondary", confirm: "Move the exam back to Draft? Students will no longer see it as scheduled.", success: "Exam moved to draft" },
	close: { method: "close_exam", label: "Close now", icon: Lock, from: ["Open"], variant: "danger", confirm: "Close the exam now? Attempts in progress are submitted automatically as they are.", success: "Exam closed" },
	release: { method: "release_results", label: "Release results", icon: Send, from: ["Closed", "Marking"], variant: "gold", confirm: "Release results to students? They are notified and can see their scores.", success: "Results released" },
	cancel: { method: "cancel_exam", label: "Cancel exam", icon: Ban, from: ["Draft", "Scheduled", "Open"], variant: "ghost", confirm: "Cancel this exam? Students can no longer sit it.", success: "Exam cancelled", danger: true },
}

function MonitorTab({ exam, live }) {
	const q = useApi(`${EXAMS}exam_monitor`, { exam: exam.name }, { refetchInterval: live ? 10_000 : false })
	const d = q.data
	if (q.isLoading) return <SkeletonRows rows={6} />
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	const attempts = d?.attempts || []
	const notStarted = d?.not_started?.length || 0
	const total = attempts.length + notStarted
	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <span className="font-semibold text-ink">{r.student_name || r.student}</span>, sortValue: (r) => r.student_name },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" dot={r.status === "In Progress"} /> },
		{ key: "started_on", label: "Started", hideOnMobile: true, render: (r) => time(r.started_on), sortValue: (r) => r.started_on },
		{
			key: "answered",
			label: "Progress",
			width: "10rem",
			render: (r) => <ProgressBar size="sm" value={r.questions ? (r.answered / r.questions) * 100 : 0} label={`${num(r.answered)}/${num(r.questions)}`} />,
			sortValue: (r) => (r.questions ? r.answered / r.questions : 0),
		},
		{
			key: "time_left",
			label: "Time left",
			align: "right",
			render: (r) => (r.status === "In Progress" ? <span className={clsx("font-mono text-sm", r.time_left < 300 && "font-semibold text-red-600")}>{fmtLeft(r.time_left)}</span> : r.submitted_on ? time(r.submitted_on) : "—"),
			sortValue: (r) => Number(r.time_left || 0),
		},
		{
			key: "focus_lost_count",
			label: "Left the tab",
			align: "right",
			render: (r) => (r.focus_lost_count ? <Badge tone={r.focus_lost_count >= 3 ? "red" : "orange"} size="xs">{num(r.focus_lost_count)}×</Badge> : <span className="text-ink-soft">0</span>),
			sortValue: (r) => Number(r.focus_lost_count || 0),
		},
		{ key: "percentage", label: "Score", align: "right", hideOnMobile: true, render: (r) => (r.status === "Released" || r.status === "Marked" ? `${fmtScore(r.percentage)}%` : "—") },
	]
	return (
		<>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<MetricRow
					items={[
						{ label: "In progress", value: num(d?.in_progress), tone: d?.in_progress ? "green" : undefined },
						{ label: "Submitted", value: num(d?.submitted) },
						{ label: "Not started", value: num(notStarted), tone: notStarted && live ? "orange" : undefined },
						{ label: "Roster", value: num(total) },
					]}
				/>
				<span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
					{live ? (
						<>
							<span className="relative flex h-2 w-2">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
								<span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
							</span>
							Live · refreshes every 10 s · {time(d?.server_time)}
						</>
					) : (
						<>Snapshot at {time(d?.server_time)}</>
					)}
				</span>
			</div>
			{total ? <ProgressBar className="mb-4" value={((d?.submitted || 0) / total) * 100} tone="green" label={`${num(d?.submitted)} of ${num(total)} submitted`} /> : null}
			<DataTable rows={attempts} cols={cols} dense initialSort={live ? { key: "time_left", dir: "asc" } : undefined} empty={live ? "Nobody has started yet" : "No attempts"} emptyIcon={Users} />
		</>
	)
}

function MarkingTab({ exam }) {
	const q = useApi(`${EXAMS}marking_queue`, { exam: exam.name })
	const d = q.data
	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <span className="font-semibold text-ink">{r.student_name || r.student}</span>, sortValue: (r) => r.student_name },
		{ key: "attempt_number", label: "Attempt", align: "right", hideOnMobile: true },
		{ key: "submitted_on", label: "Submitted", hideOnMobile: true, render: (r) => dateTime(r.submitted_on), sortValue: (r) => r.submitted_on },
		{ key: "auto_score", label: "Auto", align: "right", render: (r) => fmtScore(r.auto_score) },
		{ key: "manual_score", label: "Manual", align: "right", render: (r) => fmtScore(r.manual_score) },
		{ key: "total_score", label: "Total", align: "right", render: (r) => `${fmtScore(r.total_score)} / ${fmtScore(r.max_score)}` },
		{ key: "unmarked", label: "Unmarked", align: "right", render: (r) => (r.unmarked ? <span className="font-semibold text-orange-600">{num(r.unmarked)}</span> : <CheckCircle2 size={15} className="ml-auto text-green-600" />), sortValue: (r) => Number(r.unmarked || 0) },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" /> },
	]
	return (
		<>
			{d ? (
				<div className="mb-4 grid grid-cols-3 gap-3">
					<StatCard label="Submitted attempts" value={num(d.total)} icon={Users} />
					<StatCard label="Need marking" value={num(d.pending)} icon={PenLine} tone={d.pending ? "orange" : "green"} />
					<StatCard label="Unmarked answers" value={num(d.unmarked_answers)} icon={FileQuestion} tone={d.unmarked_answers ? "orange" : "green"} />
				</div>
			) : null}
			{d?.pending ? (
				<Alert tone="info" className="mb-4">
					Lecturers mark essay and short-answer questions in the lecturer portal. Results can be released once nothing is pending.
				</Alert>
			) : null}
			<DataTable query={q} cols={cols} dense initialSort={{ key: "unmarked", dir: "desc" }} empty="No submitted attempts yet" emptyIcon={PenLine} />
		</>
	)
}

function StatsTab({ exam }) {
	const q = useApi(`${EXAMS}exam_stats`, { exam: exam.name })
	const d = q.data
	if (q.isLoading) return <SkeletonRows rows={6} />
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	if (!d?.count)
		return (
			<div className="card">
				<Empty icon={Trophy} title="No marked attempts yet" subtitle="Statistics appear once attempts are marked." />
			</div>
		)
	const qcols = [
		{ key: "title", label: "Question", render: (r) => <span className="line-clamp-2 text-sm">{r.title || r.question}</span> },
		{ key: "question_type", label: "Type", hideOnMobile: true },
		{ key: "answered", label: "Answered", align: "right", render: (r) => `${num(r.answered)}/${num(r.responses)}` },
		{ key: "correct_rate", label: "Correct", align: "right", hideOnMobile: true, render: (r) => `${fmtScore(r.correct_rate)}%` },
		{ key: "facility", label: "Facility", width: "9rem", render: (r) => <ProgressBar size="sm" value={r.facility} label={`${fmtScore(r.facility)}%`} tone={r.facility >= 70 ? "green" : r.facility >= 40 ? "gold" : "red"} />, sortValue: (r) => r.facility },
		{ key: "difficulty", label: "Played as", render: (r) => <Badge tone={{ Easy: "green", Medium: "gold", Hard: "red" }[r.difficulty]} size="xs">{r.difficulty}</Badge> },
	]
	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Marked attempts" value={num(d.count)} icon={Users} />
				<StatCard label="Average" value={`${fmtScore(d.average)}%`} icon={Trophy} tone="gold" />
				<StatCard label="Pass rate" value={`${fmtScore(d.pass_rate)}%`} icon={CheckCircle2} tone={d.pass_rate >= 50 ? "green" : "red"} />
				<StatCard label="Range" value={`${fmtScore(d.lowest)}–${fmtScore(d.highest)}`} icon={Timer} tone="purple" />
			</div>
			<div className="grid gap-5 lg:grid-cols-2">
				<Panel title="Score distribution" subtitle="Percentage bands">
					<BarsChart data={(d.distribution || []).map((b) => ({ label: b.range, Students: b.count }))} series={[{ key: "Students", label: "Students" }]} height={220} />
				</Panel>
				<Panel title="Grades" subtitle="Using the default grading scale">
					<BarsChart data={(d.grades || []).map((g) => ({ label: g.grade, Students: g.count }))} series={[{ key: "Students", label: "Students", color: "#c9a227" }]} height={220} />
				</Panel>
			</div>
			<Panel title="Question analysis" subtitle="Hardest first. Facility is the share of available marks students earned." bodyClass="p-0">
				<DataTable rows={d.questions || []} cols={qcols} rowKey="question" dense className="rounded-none border-0 shadow-none" empty="No answers recorded" />
			</Panel>
		</div>
	)
}

function SetupTab({ exam }) {
	const marks = exam.questions.reduce((a, r) => a + Number(r.marks || 0), 0)
	const byType = exam.questions.reduce((m, r) => ({ ...m, [r.question_type]: (m[r.question_type] || 0) + 1 }), {})
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="space-y-5 lg:col-span-2">
				<Panel title="Configuration">
					<KeyValueGrid
						cols={3}
						items={[
							{ label: "Type", value: exam.exam_type },
							{ label: "Counts towards", value: exam.assessment_component || "—" },
							{ label: "Delivery", value: exam.delivery_mode || "Online" },
							{ label: "Opens", value: exam.start_datetime ? dateTime(exam.start_datetime) : "Not set" },
							{ label: "Closes", value: exam.end_datetime ? dateTime(exam.end_datetime) : "Not set" },
							{ label: "Duration", value: `${num(exam.duration_minutes)} minutes` },
							{ label: "Total marks", value: fmtScore(exam.total_marks) },
							{ label: "Pass mark", value: `${fmtScore(exam.pass_mark)}%` },
							{ label: "Attempts allowed", value: num(exam.max_attempts || 1) },
							{ label: "Venue", value: exam.venue || "—" },
							{ label: "Access code", value: exam.access_code ? "Required" : "None" },
							{ label: "Fee clearance", value: exam.require_fee_clearance ? "Required" : "Not required" },
						]}
					/>
					<div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
						{[
							[exam.shuffle_questions, "Shuffled questions"],
							[exam.shuffle_options, "Shuffled options"],
							[exam.random_question_count, `Random ${exam.random_question_count} per student`],
							[exam.auto_release_objective, "Auto-release objective results"],
							[exam.show_answers_after_release, "Answers shown after release"],
						]
							.filter(([on]) => on)
							.map(([, label]) => (
								<Badge key={label} tone="blue" size="xs">
									{label}
								</Badge>
							))}
					</div>
					{exam.instructions ? <Html className="prose prose-sm mt-4 max-w-none border-t border-line pt-4 text-ink-muted" html={exam.instructions} /> : null}
				</Panel>
				<Panel title="Paper" subtitle={`${exam.questions.length} questions · ${fmtScore(marks)} marks`} bodyClass="p-0">
					{exam.questions.length ? (
						<ol className="divide-y divide-line">
							{exam.questions.map((r, i) => (
								<li key={r.question} className="flex items-start gap-3 px-4 py-2.5">
									<span className="mt-0.5 w-6 shrink-0 text-right text-xs font-semibold text-ink-soft">{i + 1}.</span>
									<span className="min-w-0 flex-1">
										<span className="line-clamp-2 text-sm text-ink">{r.title || r.question}</span>
										<span className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-ink-soft">
											{r.question_type}
											{r.topic ? ` · ${r.topic}` : ""}
											{r.difficulty ? ` · ${r.difficulty}` : ""}
										</span>
									</span>
									<span className="shrink-0 text-sm font-semibold text-ink">{fmtScore(r.marks)}</span>
								</li>
							))}
						</ol>
					) : (
						<Empty compact icon={FileQuestion} title="No questions added yet" />
					)}
				</Panel>
			</div>
			<div className="space-y-5">
				<Panel title="Question mix">
					<div className="space-y-2">
						{Object.entries(byType).map(([k, n]) => (
							<div key={k} className="flex items-center justify-between text-sm">
								<span className="text-ink-muted">{k}</span>
								<span className="font-semibold text-ink">{num(n)}</span>
							</div>
						))}
						{!exam.questions.length ? <p className="text-sm text-ink-soft">Empty paper.</p> : null}
					</div>
					{exam.has_manual_questions ? <p className="mt-3 text-xs text-orange-600">Includes questions a lecturer must mark by hand.</p> : null}
				</Panel>
				<Panel title="Sittings">
					<dl className="divide-y divide-line text-sm">
						{[
							["Attempts started", num(exam.attempt_count)],
							["Submitted", num(exam.submitted_count)],
							["Average score", exam.submitted_count ? fmtScore(exam.average_score) : "—"],
						].map(([k, v]) => (
							<div key={k} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
								<dt className="text-ink-muted">{k}</dt>
								<dd className="font-semibold tabular-nums text-ink">{v}</dd>
							</div>
						))}
					</dl>
				</Panel>
			</div>
		</div>
	)
}

export default function ExamDetail() {
	const { name } = useParams()
	const [params, setParams] = useSearchParams()
	const roles = useAcademicRoles()
	const q = useApi(`${EXAMS}get_exam`, { name })
	const [pending, setPending] = useState(null)
	const exam = q.data
	const live = exam?.status === "Open"
	const tab = params.get("tab") || (live ? "monitor" : "setup")
	const setTab = (t) => setParams({ tab: t }, { replace: true })
	const act = useAction(pending ? `${EXAMS}${ACTIONS[pending].method}` : `${EXAMS}noop`, {
		invalidate: [EXAMS],
		success: pending ? ACTIONS[pending].success : undefined,
		onSuccess: () => setPending(null),
	})
	const available = useMemo(() => (exam ? Object.entries(ACTIONS).filter(([, a]) => a.from.includes(exam.status)) : []), [exam])

	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	if (!exam)
		return (
			<>
				<PageHeader title="Exam" back={{ to: `${BASE}/exams`, label: "Exams" }} />
				<SkeletonRows rows={8} />
			</>
		)
	const tabs = [
		{ id: "setup", label: "Paper & setup" },
		{ id: "monitor", label: live ? "Live monitor" : "Sittings" },
		{ id: "marking", label: "Marking" },
		{ id: "stats", label: "Statistics" },
	]
	return (
		<>
			<PageHeader
				back={{ to: `${BASE}/exams?term=${encodeURIComponent(exam.academic_term || "")}`, label: "Exams" }}
				eyebrow={`${exam.course_title || ""} · ${exam.academic_term || ""}`}
				title={exam.title}
				actions={
					roles.admin ? (
						<>
							{available.map(([id, a]) => (
								<Button key={id} icon={a.icon} variant={a.variant || "primary"} onClick={() => setPending(id)} className={a.danger ? "text-red-600" : undefined}>
									{a.label}
								</Button>
							))}
						</>
					) : null
				}
			>
				<Facts
					items={[
						{ label: "Status", value: <Badge status={exam.status} size="xs" dot={live} /> },
						{ label: "Offering", value: <Link to={`${BASE}/offerings/${encodeURIComponent(exam.course_offering)}`} className="text-brand-700 hover:underline">{exam.course_offering}</Link> },
						exam.start_datetime && { label: "Window", icon: Clock, value: `${dateTime(exam.start_datetime)} – ${time(exam.end_datetime)}` },
					]}
				/>
			</PageHeader>

			{live ? (
				<Alert tone="error" icon={Radio} className="mb-4" title="This exam is live">
					Students are sitting it now. The monitor refreshes every 10 seconds.
				</Alert>
			) : exam.status === "Marking" || exam.status === "Closed" ? (
				<Alert tone="warning" icon={Eye} className="mb-4" title="Waiting for release">
					Check the marking queue; release results once every attempt is marked.
				</Alert>
			) : null}

			<Tabs className="mb-5" tabs={tabs} active={tab} onChange={setTab} />
			{tab === "setup" ? <SetupTab exam={exam} /> : null}
			{tab === "monitor" ? <MonitorTab exam={exam} live={live} /> : null}
			{tab === "marking" ? <MarkingTab exam={exam} /> : null}
			{tab === "stats" ? <StatsTab exam={exam} /> : null}

			<ConfirmDialog
				open={Boolean(pending)}
				title={pending ? `${ACTIONS[pending].label}?` : ""}
				message={pending ? ACTIONS[pending].confirm : ""}
				confirmLabel={pending ? ACTIONS[pending].label : "Confirm"}
				tone={pending && (ACTIONS[pending].danger || pending === "close") ? "danger" : "primary"}
				loading={act.isPending}
				onConfirm={() => act.mutate({ [pending === "release" ? "exam" : "name"]: exam.name })}
				onClose={() => setPending(null)}
			/>
		</>
	)
}
