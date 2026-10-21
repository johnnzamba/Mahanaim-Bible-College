import { useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Lightbulb, PenLine, Send, ShieldAlert } from "lucide-react"
import { Alert, Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Html, Loading, PageHeader, Panel, ProgressBar, QueryState, SkeletonRows, Textarea } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { dateTime } from "@/shared/utils/format"
import { AnswerView } from "../components/exam/AnswerView"
import { ScoreInput, StatusBadge } from "../components/bits"
import { M, MANUAL_TYPES, P, score } from "../components/lib"

const PENDING = ["Submitted", "Auto Submitted", "Marking"]

function MarkBox({ attempt, item, locked }) {
	const [marks, setMarks] = useState("")
	const [feedback, setFeedback] = useState("")
	const [open, setOpen] = useState(false)
	useEffect(() => {
		setMarks(item.is_marked ? String(item.marks_awarded) : "")
		setFeedback(item.feedback || "")
	}, [item.question, item.marks_awarded, item.is_marked, item.feedback])
	const save = useAction(M.markAnswer, {
		invalidate: [M.attemptForMarking, M.markingQueue, P.lec],
		onSuccess: (r) => {
			toast.success(r.unmarked ? `Saved · ${r.unmarked} answer${r.unmarked === 1 ? "" : "s"} left` : "Saved · all answers marked")
			setOpen(false)
		},
	})
	const max = Number(item.max_marks) || 0
	const n = marks === "" ? null : Number(marks)
	const bad = n === null || Number.isNaN(n) || n < 0 || n > max
	const manual = MANUAL_TYPES.includes(item.question_type)
	const needs = !item.is_marked
	const dirty = marks !== (item.is_marked ? String(item.marks_awarded) : "") || feedback !== (item.feedback || "")

	if (!manual && !open) {
		return (
			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
				<span className="text-ink-muted">
					{item.auto_marked ? "Auto-marked" : "Marked"}: <b className="text-ink">{score(item.marks_awarded)}</b> / {score(max)}
				</span>
				{!locked ? (
					<Button size="sm" variant="ghost" icon={PenLine} onClick={() => setOpen(true)}>
						Override
					</Button>
				) : null}
			</div>
		)
	}
	return (
		<div className={`space-y-3 rounded-xl border p-3 ${needs ? "border-gold-300 bg-gold-50/60" : "border-line"}`}>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-semibold text-ink">Marks</span>
				<ScoreInput value={marks} onChange={setMarks} max={max} label={`Marks for ${item.question}`} disabled={locked} />
				<span className="text-sm text-ink-soft">/ {score(max)}</span>
				{!locked ? (
					<div className="flex gap-1">
						{[0, 0.5, 1].map((f) => (
							<button key={f} type="button" className="chip !px-2 !py-0.5 text-[11px]" onClick={() => setMarks(String(Math.round(max * f * 2) / 2))}>
								{f === 0 ? "0" : f === 1 ? "Full" : "Half"}
							</button>
						))}
					</div>
				) : null}
				{item.is_marked && !dirty ? (
					<span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
						<CheckCircle2 size={14} /> Marked
					</span>
				) : null}
			</div>
			<Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback on this answer (optional)" disabled={locked} aria-label="Feedback" />
			{!locked ? (
				<div className="flex justify-end gap-2">
					{!manual ? (
						<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
							Cancel
						</Button>
					) : null}
					<Button
						size="sm"
						disabled={bad || !dirty}
						loading={save.isPending}
						onClick={() => save.mutate({ attempt, question: item.question, marks: n, feedback })}
					>
						Save mark
					</Button>
				</div>
			) : null}
		</div>
	)
}

function AttemptPane({ name, onNext, hasNext }) {
	const q = useApi(M.attemptForMarking, { attempt: name })
	const [onlyManual, setOnlyManual] = useState(false)
	const [confirm, setConfirm] = useState(false)
	const finalise = useAction(M.finaliseAttempt, {
		invalidate: [M.attemptForMarking, M.markingQueue, P.exam, P.lec, P.res],
		success: (r) => `Finalised at ${score(r.percentage, 1)}%`,
		onSuccess: () => {
			setConfirm(false)
			if (hasNext) onNext()
		},
	})
	return (
		<QueryState query={q} skeleton={<Card className="p-5"><SkeletonRows rows={8} /></Card>}>
			{(d) => {
				const a = d.attempt
				const locked = !["Submitted", "Auto Submitted", "Marking", "Marked"].includes(a.status)
				const unmarked = d.items.filter((i) => !i.is_marked).length
				const items = onlyManual ? d.items.filter((i) => MANUAL_TYPES.includes(i.question_type) || !i.is_marked) : d.items
				return (
					<div className="space-y-4">
						<Card className="p-4 sm:p-5">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<h2 className="truncate font-serif text-xl text-ink">{a.student_name}</h2>
									<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
										<StatusBadge kind="attempt" status={a.status} size="xs" />
										<span>Attempt {a.attempt_number}</span>
										<span>· Submitted {dateTime(a.submitted_on)}</span>
										{a.submission_mode && a.submission_mode !== "Submitted" ? <Badge tone="gray" size="xs">{a.submission_mode}</Badge> : null}
										{a.focus_lost_count ? (
											<Badge tone={a.focus_lost_count >= 3 ? "red" : "orange"} size="xs">
												<ShieldAlert size={11} /> {a.focus_lost_count} focus loss{a.focus_lost_count === 1 ? "" : "es"}
											</Badge>
										) : null}
									</div>
								</div>
								<div className="text-right">
									<div className="font-serif text-2xl text-ink">
										{score(a.total_score)}
										<span className="text-base text-ink-soft"> / {score(a.max_score)}</span>
									</div>
									<div className="text-xs text-ink-soft">{score(a.percentage, 1)}%{unmarked ? " so far" : ""}</div>
								</div>
							</div>
							<ProgressBar className="mt-4" value={d.items.length ? ((d.items.length - unmarked) / d.items.length) * 100 : 0} size="sm" tone={unmarked ? "gold" : "green"} label={`${d.items.length - unmarked} of ${d.items.length} answers marked`} />
							<label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
								<input type="checkbox" className="h-4 w-4 accent-[rgb(var(--brand-700))]" checked={onlyManual} onChange={(e) => setOnlyManual(e.target.checked)} />
								Show only answers marked by hand
							</label>
						</Card>

						{items.map((it) => {
							const idx = d.items.indexOf(it) + 1
							return (
								<Card key={it.question} className="space-y-3 p-4 sm:p-5">
									<div className="flex flex-wrap items-center gap-2 text-xs">
										<span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">{idx}</span>
										<Badge tone={MANUAL_TYPES.includes(it.question_type) ? "purple" : "gray"} size="xs">
											{it.question_type}
										</Badge>
										<span className="text-ink-soft">{score(it.max_marks)} marks</span>
										{!it.is_marked ? (
											<Badge tone="orange" size="xs">
												Needs marking
											</Badge>
										) : null}
									</div>
									<Html html={it.text} className="text-[15px] font-medium" />
									<AnswerView item={it} />
									{it.marking_guide ? (
										<details className="rounded-xl border border-gold-200 bg-cream/70 p-3 text-sm" open={!it.is_marked}>
											<summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-ink">
												<Lightbulb size={14} className="text-gold-700" /> Marking guide
											</summary>
											<Html html={it.marking_guide} className="mt-2 text-sm" />
										</details>
									) : null}
									{it.explanation ? (
										<p className="text-xs text-ink-soft">
											<b>Explanation:</b> {it.explanation.replace(/<[^>]+>/g, " ")}
										</p>
									) : null}
									<MarkBox attempt={a.name} item={it} locked={locked} />
								</Card>
							)
						})}

						<div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur lg:bottom-4">
							<span className="text-sm text-ink-muted">
								{a.status === "Marked" ? "Finalised" : unmarked ? `${unmarked} answer${unmarked === 1 ? "" : "s"} still to mark` : "All answers marked"}
							</span>
							<div className="ml-auto flex gap-2">
								{hasNext ? (
									<Button size="sm" variant="secondary" iconRight={ChevronRight} onClick={onNext}>
										Next
									</Button>
								) : null}
								{PENDING.includes(a.status) ? (
									<Button size="sm" icon={CheckCircle2} disabled={unmarked > 0} onClick={() => setConfirm(true)}>
										Finalise
									</Button>
								) : null}
							</div>
						</div>
						<ConfirmDialog
							open={confirm}
							onClose={() => setConfirm(false)}
							title="Finalise this attempt?"
							message={`${a.student_name}: ${score(a.total_score)}/${score(a.max_score)} (${score(a.percentage, 1)}%). You can still adjust marks until results are released.`}
							confirmLabel="Finalise"
							loading={finalise.isPending}
							onConfirm={() => finalise.mutate({ attempt: a.name })}
						/>
					</div>
				)
			}}
		</QueryState>
	)
}

export default function ExamMarking() {
	const { exam } = useParams()
	const [params, setParams] = useSearchParams()
	const q = useApi(M.markingQueue, { exam })
	const [filter, setFilter] = useState("pending")
	const [confirmRelease, setConfirmRelease] = useState(false)
	const release = useAction(M.releaseResults, { invalidate: [P.exam, P.lec, P.res], success: "Results released to students", onSuccess: () => setConfirmRelease(false) })
	const all = useMemo(() => q.data?.data || [], [q.data])
	const list = filter === "pending" ? all.filter((a) => PENDING.includes(a.status)) : all
	const selected = params.get("attempt")
	const select = (name) => setParams(name ? { attempt: name } : {}, { replace: false })
	const idx = list.findIndex((a) => a.name === selected)
	const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : list.find((a) => a.name !== selected && PENDING.includes(a.status))

	useEffect(() => {
		if (!selected && list.length && window.matchMedia("(min-width: 1024px)").matches) select(list[0].name)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [list.length, selected])

	if (q.isError) {
		return (
			<div className="space-y-6">
				<PageHeader title="Marking" back={{ to: `/lecturer/exams/${exam}`, label: "Exam" }} />
				<Card>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Card>
			</div>
		)
	}
	if (!q.data) return <Loading className="min-h-[50vh]" />
	const e = q.data.exam
	const canRelease = ["Closed", "Marking"].includes(e.status) && q.data.pending === 0 && all.some((a) => a.status === "Marked")

	return (
		<div className="space-y-6">
			<PageHeader
				back={{ to: `/lecturer/exams/${exam}`, label: e.title }}
				eyebrow="Marking"
				title={e.title}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<StatusBadge kind="exam" status={e.status} />
						<span>
							{q.data.pending} attempt{q.data.pending === 1 ? "" : "s"} pending · {q.data.unmarked_answers} answer{q.data.unmarked_answers === 1 ? "" : "s"} to mark
						</span>
					</span>
				}
				actions={
					canRelease ? (
						<Button size="sm" variant="gold" icon={Send} onClick={() => setConfirmRelease(true)}>
							Release results
						</Button>
					) : null
				}
			/>
			{e.status === "Open" ? <Alert tone="info">The exam is still open. You can mark submitted attempts now; results are released after it closes.</Alert> : null}
			{q.data.pending === 0 && all.length && e.status !== "Released" ? (
				<Alert tone="success" title="Marking complete">
					{["Closed", "Marking"].includes(e.status) ? "Every attempt is finalised. Release the results when you're ready." : "Every submitted attempt is finalised."}
				</Alert>
			) : null}

			<div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
				<Panel
					title="Attempts"
					className={selected ? "hidden lg:flex" : ""}
					bodyClass="!p-0"
					actions={
						<select className="input !w-auto !py-1 text-xs" value={filter} onChange={(ev) => setFilter(ev.target.value)} aria-label="Filter attempts">
							<option value="pending">To mark</option>
							<option value="all">All</option>
						</select>
					}
				>
					{list.length ? (
						<ul className="scroll-thin divide-y divide-line overflow-y-auto lg:max-h-[calc(100vh-260px)]">
							{list.map((a) => (
								<li key={a.name}>
									<button
										type="button"
										onClick={() => select(a.name)}
										className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-cream/60 ${a.name === selected ? "bg-brand-50" : ""}`}
										aria-current={a.name === selected ? "true" : undefined}
									>
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm font-semibold text-ink">{a.student_name}</div>
											<div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-soft">
												<StatusBadge kind="attempt" status={a.status} size="xs" dot={false} />
												{a.focus_lost_count ? <ShieldAlert size={12} className="text-orange-500" aria-label="Flagged" /> : null}
											</div>
										</div>
										<div className="shrink-0 text-right">
											{a.unmarked ? (
												<Badge tone="orange" size="xs">
													{a.unmarked} to mark
												</Badge>
											) : (
												<span className="text-sm font-semibold tabular-nums text-ink">{score(a.percentage, 0)}%</span>
											)}
										</div>
									</button>
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={ClipboardCheck} title={filter === "pending" ? "Nothing waiting" : "No submitted attempts"} subtitle={filter === "pending" && all.length ? "Switch to All to review finalised attempts." : undefined} />
					)}
				</Panel>
				<div className={selected ? "" : "hidden lg:block"}>
					{selected ? (
						<>
							<button type="button" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-brand-700 lg:hidden" onClick={() => select(null)}>
								<ChevronLeft size={14} /> All attempts
							</button>
							<AttemptPane key={selected} name={selected} hasNext={Boolean(next)} onNext={() => next && select(next.name)} />
						</>
					) : (
						<Card>
							<Empty icon={ClipboardCheck} title="Choose an attempt" subtitle="Pick a student on the left to start marking." />
						</Card>
					)}
				</div>
			</div>

			<ConfirmDialog
				open={confirmRelease}
				onClose={() => setConfirmRelease(false)}
				title="Release results?"
				message="Students are notified and can see their scores. Released attempts can no longer be changed."
				confirmLabel="Release"
				loading={release.isPending}
				onConfirm={() => release.mutate({ exam })}
			/>
		</div>
	)
}

