import { Suspense, lazy, useEffect, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import {
	AlertTriangle,
	CalendarClock,
	CheckCircle2,
	ClipboardCheck,
	Copy,
	EyeOff,
	KeyRound,
	Loader2,
	MapPin,
	Maximize,
	NotebookPen,
	PlayCircle,
	RotateCcw,
	Save,
	Timer,
	Wifi,
} from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { Alert, Badge, Button, Checkbox, Empty, Input, KeyValueGrid, PageHeader, Panel, QueryState, Skeleton } from "@/shared/components/ui"
import { dateTime, num, pct } from "@/shared/utils/format"
import { API, INV, clock, humanSpan, msUntil, pctTone, syncServerTime } from "../components/lib"
import { IconChip, examTone, useServerTime, useTick } from "../components/bits"

const ExamRunner = lazy(() => import("../components/exam/ExamRunner"))

const RULES = [
	{ icon: Timer, text: "The timer starts when you press Start and keeps running even if you close the page." },
	{ icon: Save, text: "Every answer saves automatically. If your connection drops, answers are kept on this device and sync when you're back." },
	{ icon: EyeOff, text: "Leaving the exam window, switching tabs or exiting full screen is recorded for your lecturer." },
	{ icon: Copy, text: "Copy and paste are disabled." },
	{ icon: ClipboardCheck, text: "When the time runs out your answers are submitted automatically." },
	{ icon: Wifi, text: "Use a charged device and a stable connection. You can reload the page to resume." },
]

export default function ExamRoom() {
	const { exam: examName } = useParams()
	const [params, setParams] = useSearchParams()
	const attemptParam = params.get("attempt")
	const q = useApi(API.exams, {}, { refetchInterval: 30000 })
	useServerTime(q.data?.server_time, q.dataUpdatedAt)
	const invalidate = useInvalidate()
	const [payload, setPayload] = useState(null)
	const [resumed, setResumed] = useState(false)
	const [summary, setSummary] = useState(null)
	const [mode, setMode] = useState(null)
	const [loadingAttempt, setLoadingAttempt] = useState(Boolean(attemptParam))
	const [error, setError] = useState(null)

	// Resume (or show the summary of) the attempt in the URL, e.g. after a reload.
	useEffect(() => {
		if (!attemptParam || payload || summary) return undefined
		let live = true
		setLoadingAttempt(true)
		frappe
			.call(API.getAttempt, { attempt: attemptParam })
			.then((r) => {
				if (!live) return
				if (r.status === "In Progress") {
					syncServerTime(r.server_time)
					setPayload(r)
					setResumed(true)
				} else {
					setSummary(r)
					setMode(r.submission_mode === "Auto Submitted" ? "auto" : "manual")
				}
			})
			.catch((e) => {
				if (!live) return
				setError(e?.message || "Couldn't open that attempt.")
				setParams({}, { replace: true })
			})
			.finally(() => live && setLoadingAttempt(false))
		return () => {
			live = false
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [attemptParam])

	const d = q.data || {}
	const exam = [...(d.open || []), ...(d.upcoming || []), ...(d.past || [])].find((e) => e.name === examName)

	const onStarted = (r) => {
		syncServerTime(r.server_time)
		setPayload(r)
		setResumed(false)
		setParams({ attempt: r.attempt }, { replace: true })
	}
	const onFinished = (s, m) => {
		setSummary(s)
		setMode(m)
		setPayload(null)
		invalidate(INV.exams, INV.students)
	}

	if (payload)
		return (
			<Suspense fallback={<FullScreenLoader text="Preparing your exam…" />}>
				<ExamRunner payload={payload} resumed={resumed} onFinished={onFinished} />
			</Suspense>
		)

	return (
		<>
			<PageHeader
				back={{ to: "/student/exams", label: "Exams" }}
				eyebrow={exam ? [exam.exam_type, exam.course_title].filter(Boolean).join(" · ") : "Exam"}
				title={exam?.title || (q.isLoading ? "Loading…" : "Exam")}
				actions={exam ? <Badge tone={examTone(exam.status)} dot>{exam.status}</Badge> : null}
			/>
			{error ? (
				<Alert tone="error" title="Couldn't resume" className="mb-4">
					{error}
				</Alert>
			) : null}
			{summary ? (
				<Summary summary={summary} mode={mode} exam={exam} />
			) : loadingAttempt ? (
				<FullScreenLoader text="Resuming your exam…" inline />
			) : (
				<QueryState
					query={q}
					skeleton={
						<div className="grid gap-5 lg:grid-cols-3">
							<Skeleton className="h-80 rounded-2xl lg:col-span-2" />
							<Skeleton className="h-64 rounded-2xl" />
						</div>
					}
				>
					{() =>
						exam ? (
							<Lobby exam={exam} onStarted={onStarted} onResume={(a) => setParams({ attempt: a }, { replace: true })} />
						) : (
							<div className="card">
								<Empty
									icon={NotebookPen}
									title="Exam not found"
									subtitle="It may not be published yet, or you're not enrolled in its course."
									action={
										<Link to="/student/exams" className="btn btn-primary btn-sm">
											All exams
										</Link>
									}
								/>
							</div>
						)
					}
				</QueryState>
			)}
		</>
	)
}

function FullScreenLoader({ text, inline }) {
	return (
		<div className={clsx("grid place-items-center", inline ? "py-24" : "fixed inset-0 z-[70] bg-canvas")}>
			<div className="flex items-center gap-3 text-ink-muted">
				<Loader2 className="animate-spin text-brand-600" /> {text}
			</div>
		</div>
	)
}

function Lobby({ exam: e, onStarted, onResume }) {
	useTick(1000)
	const [code, setCode] = useState("")
	const [ack, setAck] = useState(false)
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState(null)
	const opensIn = msUntil(e.start_datetime)
	const closesIn = msUntil(e.end_datetime)
	const maxAttempts = Math.max(1, Number(e.max_attempts || 1))
	const online = e.delivery_mode !== "In Person" && e.delivery_mode !== "Paper"
	const released = (e.attempts || []).filter((a) => a.status !== "In Progress")

	const start = async () => {
		setErr(null)
		setBusy(true)
		try {
			if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => {})
			const r = await frappe.call(API.startExam, { exam: e.name, access_code: code.trim() || undefined })
			onStarted(r)
		} catch (x) {
			if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
			setErr(x?.message || "Couldn't start the exam.")
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="space-y-5 lg:col-span-2">
				<Panel title="Exam details" icon={CalendarClock}>
					<KeyValueGrid
						cols={3}
						items={[
							{ label: "Opens", value: dateTime(e.start_datetime) },
							{ label: "Closes", value: dateTime(e.end_datetime) },
							{ label: "Duration", value: `${num(e.duration_minutes)} minutes` },
							{ label: "Total marks", value: num(e.total_marks) },
							{ label: "Attempts", value: `${e.attempts_used} of ${maxAttempts} used` },
							{ label: "Where", value: online ? "Online (this portal)" : e.venue || e.delivery_mode },
						]}
					/>
				</Panel>
				<Panel title="Before you begin" icon={ClipboardCheck}>
					<ul className="space-y-3">
						{RULES.map((r) => (
							<li key={r.text} className="flex items-start gap-3 text-sm text-ink-muted">
								<IconChip icon={r.icon} tone="brand" size={30} />
								<span className="pt-1">{r.text}</span>
							</li>
						))}
					</ul>
					<p className="mt-4 text-xs text-ink-soft">Your lecturer's own instructions appear on the first question once you start.</p>
				</Panel>
			</div>

			<div className="order-first space-y-5 lg:order-none">
				<div className="card overflow-hidden">
					<div className="hero-wash relative p-5 text-white">
						<div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
							{e.status === "Scheduled" ? "Opens in" : e.status === "Open" ? "Window closes in" : "Exam window"}
						</div>
						<div className="mt-1 font-mono text-3xl font-bold tabular-nums">
							{e.status === "Scheduled" && opensIn > 0
								? opensIn < 86400000
									? clock(opensIn / 1000)
									: humanSpan(opensIn)
								: e.status === "Open" && closesIn > 0
									? closesIn < 86400000
										? clock(closesIn / 1000)
										: humanSpan(closesIn)
									: "Closed"}
						</div>
						<div className="mt-1 text-xs text-white/70">{num(e.duration_minutes)} minutes once started</div>
					</div>
					<div className="space-y-4 p-5">
						{e.in_progress_attempt ? (
							<>
								<Alert tone="warning" title="You have an attempt in progress">
									{e.time_remaining != null ? `About ${humanSpan(Number(e.time_remaining) * 1000)} left on the clock.` : "Your timer is still running."}
								</Alert>
								<Button className="w-full" variant="gold" size="lg" icon={RotateCcw} onClick={() => onResume(e.in_progress_attempt)}>
									Resume exam
								</Button>
							</>
						) : e.can_start ? (
							<>
								{e.requires_access_code ? (
									<Input
										label="Access code"
										icon={KeyRound}
										value={code}
										onChange={(x) => setCode(x.target.value.toUpperCase())}
										placeholder="Given by your invigilator"
										autoComplete="off"
										autoCapitalize="characters"
										spellCheck={false}
										onKeyDown={(x) => x.key === "Enter" && ack && code.trim() && start()}
									/>
								) : null}
								<Checkbox
									checked={ack}
									onChange={setAck}
									label="I'm ready to begin"
									description="I have read the rules and will work on my own without outside help."
								/>
								{err ? (
									<Alert tone="error" title="Couldn't start">
										{err}
									</Alert>
								) : null}
								<Button
									className="w-full"
									size="lg"
									icon={e.attempts_used ? RotateCcw : PlayCircle}
									loading={busy}
									disabled={!ack || (e.requires_access_code && !code.trim())}
									onClick={start}
								>
									{e.attempts_used ? `Start attempt ${e.attempts_used + 1}` : "Start exam"}
								</Button>
								<p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-soft">
									<Maximize size={12} /> The exam opens in full screen.
								</p>
							</>
						) : (
							<div className="space-y-2">
								{(e.reasons || []).length ? (
									e.reasons.map((r) => (
										<Alert key={r} tone={/fee/i.test(r) ? "error" : "info"} icon={/fee/i.test(r) ? AlertTriangle : undefined}>
											{r}
										</Alert>
									))
								) : (
									<Alert tone="info">{e.status === "Scheduled" ? "This exam isn't open yet. This page updates automatically." : "This exam is closed."}</Alert>
								)}
								{(e.reasons || []).some((r) => /fee/i.test(r)) ? (
									<Link to="/student/fees/pay" className="btn btn-primary w-full">
										Pay fees now
									</Link>
								) : null}
								{!online ? (
									<p className="flex items-center gap-1.5 text-sm text-ink-muted">
										<MapPin size={14} /> Sit this exam in person{e.venue ? ` at ${e.venue}` : ""}.
									</p>
								) : null}
							</div>
						)}
					</div>
				</div>

				<Panel title="Your attempts" icon={CheckCircle2} bodyClass="p-0">
					{released.length ? (
						<ul className="divide-y divide-line">
							{released.map((a) => (
								<li key={a.name}>
									{a.status === "Released" ? (
										<Link to={`/student/exams/result/${encodeURIComponent(a.name)}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-cream/60">
											<span className="text-sm font-semibold text-ink">Attempt {a.attempt_number}</span>
											<Badge tone={pctTone(a.percentage, { good: 70, warn: 50 })}>{pct(a.percentage)}</Badge>
										</Link>
									) : (
										<div className="flex items-center justify-between gap-3 px-5 py-3">
											<span className="text-sm font-semibold text-ink">Attempt {a.attempt_number}</span>
											<Badge tone="orange">Awaiting results</Badge>
										</div>
									)}
								</li>
							))}
						</ul>
					) : (
						<p className="px-5 py-4 text-sm text-ink-soft">No attempts yet.</p>
					)}
				</Panel>
			</div>
		</div>
	)
}

function Summary({ summary: s, mode, exam }) {
	const auto = mode === "auto" || s.submission_mode === "Auto Submitted"
	const total = Number(s.questions) || 0
	const answered = Number(s.answered) || 0
	return (
		<div className="mx-auto max-w-xl">
			<div className="card overflow-hidden text-center">
				<div className="hero-wash relative px-6 py-8 text-white">
					<div className="pattern-dots pointer-events-none absolute inset-0 opacity-30" aria-hidden />
					<div className="relative">
						<span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15">
							<CheckCircle2 size={34} className="text-gold-300" />
						</span>
						<h2 className="mt-4 font-serif text-2xl text-white">{auto ? "Time's up. Your exam was submitted" : "Exam submitted"}</h2>
						<p className="mt-1 text-sm text-white/75">{exam?.title || "Your answers have been received."}</p>
					</div>
				</div>
				<div className="grid grid-cols-3 divide-x divide-line border-b border-line">
					<div className="px-3 py-4">
						<div className="text-xl font-bold text-ink">
							{answered}/{total}
						</div>
						<div className="text-[11px] text-ink-soft">Answered</div>
					</div>
					<div className="px-3 py-4">
						<div className="text-xl font-bold text-ink">{s.attempt_number || "—"}</div>
						<div className="text-[11px] text-ink-soft">Attempt</div>
					</div>
					<div className="px-3 py-4">
						<div className="text-sm font-bold text-ink">{s.submitted_on ? dateTime(s.submitted_on) : "Just now"}</div>
						<div className="text-[11px] text-ink-soft">Submitted</div>
					</div>
				</div>
				<div className="space-y-4 p-6">
					{s.result_available ? (
						<Link to={`/student/exams/result/${encodeURIComponent(s.attempt)}`} className="btn btn-primary w-full">
							View your result
						</Link>
					) : (
						<p className="text-sm text-ink-muted">
							{s.status === "Marked" ? "Your exam has been marked." : "Objective questions are marked automatically; written answers are marked by your lecturer."} Your result appears here once it's released.
						</p>
					)}
					<div className="flex flex-wrap justify-center gap-2">
						<Link to="/student/exams" className="btn btn-secondary btn-sm">
							Back to exams
						</Link>
						{exam?.course_offering ? (
							<Link to={`/student/courses/${encodeURIComponent(exam.course_offering)}`} className="btn btn-ghost btn-sm">
								Go to course
							</Link>
						) : null}
					</div>
				</div>
			</div>
		</div>
	)
}
