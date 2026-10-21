import { Link, useParams } from "react-router-dom"
import clsx from "clsx"
import { CheckCircle2, CircleDot, Hourglass, Lightbulb, MessageSquare, XCircle } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Donut, Empty, Html, PageHeader, QueryState, Skeleton } from "@/shared/components/ui"
import { dateTime, num } from "@/shared/utils/format"
import { API } from "../components/lib"
import { Hero, HeroStat } from "../components/bits"

export default function ExamResult() {
	const { attempt } = useParams()
	const q = useApi(API.examResult, { attempt }, { retry: false })
	const notReleased = /not been released/i.test(q.error?.message || "")
	return (
		<>
			<PageHeader
				back={{ to: q.data?.exam?.name ? `/student/exams/${encodeURIComponent(q.data.exam.name)}` : "/student/exams", label: "Exams" }}
				eyebrow={q.data ? [q.data.exam.exam_type, q.data.exam.course_title].filter(Boolean).join(" · ") : "Exam result"}
				title={q.data?.exam?.title || "Exam result"}
			/>
			{notReleased ? (
				<div className="card">
					<Empty
						icon={Hourglass}
						title="Results not released yet"
						subtitle="Your lecturer is still marking or hasn't released this exam. You'll get a notification when it's ready."
						action={
							<Link to="/student/exams" className="btn btn-secondary btn-sm">
								Back to exams
							</Link>
						}
					/>
				</div>
			) : (
				<QueryState
					query={q}
					skeleton={
						<div className="space-y-4">
							<Skeleton className="h-40 rounded-2xl" />
							<Skeleton className="h-64 rounded-2xl" />
						</div>
					}
				>
					{(d) => <ResultBody d={d} />}
				</QueryState>
			)}
		</>
	)
}

function ResultBody({ d }) {
	const a = d.attempt || {}
	const items = d.items || []
	const correct = items.filter((i) => i.is_correct).length
	return (
		<div className="space-y-5">
			<Hero>
				<div className="flex flex-col gap-5 sm:flex-row sm:items-center">
					<div className="flex items-center gap-4">
						<div className="rounded-full bg-white/10 p-1.5">
							<Donut value={a.percentage} size={92} stroke={9} tone={a.passed ? "gold" : "red"} track="stroke-white/15">
								<span className="text-lg font-bold text-white">{Math.round(Number(a.percentage) || 0)}%</span>
							</Donut>
						</div>
						<div>
							<div className="font-serif text-2xl">{a.passed ? "Well done!" : "Keep going"}</div>
							<div className="mt-1 flex flex-wrap gap-2">
								<span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-bold", a.passed ? "bg-emerald-400/20 text-emerald-200" : "bg-red-400/20 text-red-200")}>
									{a.passed ? "Passed" : "Below pass mark"}
								</span>
								{a.grade ? <span className="rounded-full bg-gold-400/20 px-2.5 py-0.5 text-xs font-bold text-gold-200">Grade {a.grade}</span> : null}
							</div>
						</div>
					</div>
					<div className="grid flex-1 grid-cols-3 gap-4 sm:ml-auto sm:max-w-md">
						<HeroStat label="Score" value={`${num(a.total_score, 1)}/${num(a.max_score)}`} />
						<HeroStat label="Pass mark" value={`${num(d.exam.pass_mark)}%`} />
						<HeroStat label="Correct" value={`${correct}/${items.length}`} sub={`Attempt ${a.attempt_number}`} />
					</div>
				</div>
				{a.submitted_on ? <p className="mt-4 text-xs text-white/60">Submitted {dateTime(a.submitted_on)}{a.submission_mode === "Auto Submitted" ? " (automatically when time ran out)" : ""}</p> : null}
			</Hero>

			{!d.show_answers ? (
				<p className="rounded-xl border border-line bg-cream/60 px-4 py-3 text-sm text-ink-muted">
					Your lecturer has chosen not to show the correct answers for this exam. You can still see the marks for each question.
				</p>
			) : null}

			<section className="space-y-3">
				<h2 className="text-xs font-bold uppercase tracking-wider text-ink-soft">Question review</h2>
				{items.map((it, i) => (
					<ReviewItem key={it.question} it={it} no={i + 1} show={d.show_answers} />
				))}
			</section>
		</div>
	)
}

function ReviewItem({ it, no, show }) {
	const full = Number(it.marks_awarded) >= Number(it.max_marks) && Number(it.max_marks) > 0
	const zero = !Number(it.marks_awarded)
	const tone = !it.is_marked && !it.auto_marked ? "gray" : full ? "green" : zero ? "red" : "orange"
	const Icon = tone === "green" ? CheckCircle2 : tone === "red" ? XCircle : CircleDot
	return (
		<article className="card p-4 sm:p-5">
			<header className="mb-3 flex items-start gap-3">
				<span
					className={clsx(
						"grid h-8 w-8 shrink-0 place-items-center rounded-full",
						tone === "green" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : tone === "red" ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : tone === "orange" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-cream text-ink-soft"
					)}
				>
					<Icon size={18} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
						<span className="font-bold text-ink">Question {no}</span>
						<span>{it.question_type}</span>
					</div>
					<Html html={it.text} className="mt-1 text-[15px]" />
				</div>
				<Badge tone={tone} size="sm">
					{num(it.marks_awarded, 1)}/{num(it.max_marks)}
				</Badge>
			</header>
			<div className="pl-0 sm:pl-11">
				<AnswerView it={it} show={show} />
				{it.feedback ? (
					<div className="mt-3 flex gap-2 rounded-xl bg-cream/70 p-3 text-sm">
						<MessageSquare size={16} className="mt-0.5 shrink-0 text-ink-soft" />
						<div>
							<div className="text-xs font-semibold text-ink-soft">Lecturer feedback</div>
							<Html html={it.feedback} className="text-sm" />
						</div>
					</div>
				) : null}
				{show && it.explanation ? (
					<div className="mt-3 flex gap-2 rounded-xl border border-gold-200 bg-gold-50 p-3 text-sm">
						<Lightbulb size={16} className="mt-0.5 shrink-0 text-gold-600" />
						<Html html={it.explanation} className="text-sm" />
					</div>
				) : null}
			</div>
		</article>
	)
}

function AnswerView({ it, show }) {
	const t = it.question_type
	const ans = it.answer
	const correct = it.correct_answer
	if (it.options) {
		const chosen = new Set(Array.isArray(ans) ? ans.map(String) : ans != null && ans !== "" ? [String(ans)] : [])
		const right = new Set(Array.isArray(correct) ? correct.map(String) : correct != null ? [String(correct)] : [])
		return (
			<ul className="space-y-1.5">
				{it.options.map((o) => {
					const mine = chosen.has(String(o.id))
					const ok = show && right.has(String(o.id))
					return (
						<li
							key={o.id}
							className={clsx(
								"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
								ok ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10" : mine ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-line"
							)}
						>
							<span className="min-w-0 flex-1">{o.text}</span>
							{mine ? <Badge tone={ok || (!show && it.is_correct) ? "green" : show ? "red" : "gray"} size="xs">Your answer</Badge> : null}
							{ok ? <Badge tone="green" size="xs">Correct</Badge> : null}
						</li>
					)
				})}
				{!chosen.size ? <li className="text-xs italic text-ink-soft">Not answered</li> : null}
			</ul>
		)
	}
	if (t === "Matching") {
		const mine = ans && typeof ans === "object" ? ans : {}
		return (
			<ul className="space-y-1.5">
				{(it.prompts || []).map((p) => {
					const ok = show && correct ? correct[p.id] === mine[p.id] : null
					return (
						<li key={p.id} className="grid gap-1 rounded-lg border border-line px-3 py-2 text-sm sm:grid-cols-2">
							<span className="font-medium text-ink">{p.text}</span>
							<span className={clsx(ok === true && "text-emerald-700 dark:text-emerald-300", ok === false && "text-red-700 dark:text-red-300")}>
								{mine[p.id] || <em className="text-ink-soft">No match</em>}
								{ok === false && correct?.[p.id] ? <span className="ml-2 text-xs text-ink-soft">(correct: {correct[p.id]})</span> : null}
							</span>
						</li>
					)
				})}
			</ul>
		)
	}
	return (
		<div className="space-y-2">
			<div className="rounded-lg border border-line bg-canvas/50 px-3 py-2 text-sm">
				<div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Your answer</div>
				{ans ? <div className="whitespace-pre-wrap break-words text-ink">{String(ans).replace(/<[^>]+>/g, "")}</div> : <em className="text-ink-soft">Not answered</em>}
			</div>
			{show && correct && (Array.isArray(correct) ? correct.length : true) ? (
				<div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-500/40 dark:bg-emerald-500/10">
					<div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Accepted answers</div>
					{Array.isArray(correct) ? correct.join(" · ") : String(correct)}
				</div>
			) : null}
		</div>
	)
}

