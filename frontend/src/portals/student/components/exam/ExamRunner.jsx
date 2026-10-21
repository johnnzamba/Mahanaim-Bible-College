import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import clsx from "clsx"
import {
	AlertTriangle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Flag,
	LayoutGrid,
	Loader2,
	Lock,
	Maximize,
	Send,
	Timer,
	WifiOff,
} from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { Button, Html, Modal } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { API, clock, isAnswered, readLocal, writeLocal } from "../lib"
import { QuestionInput, TYPE_HINT } from "./QuestionInput"

const KEY = (a) => `mbc-exam-${a}`
const FLAGS = (a) => `mbc-exam-flags-${a}`
const POS = (a) => `mbc-exam-pos-${a}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isTransient = (e) => !e?.status || e.status >= 500 || e.status === 408 || e.status === 429
const isClosed = (msg) => /time is up|already been submitted|no longer be changed/i.test(msg || "")

export function clearExamLocal(attempt) {
	writeLocal(KEY(attempt), undefined)
	writeLocal(FLAGS(attempt), undefined)
	try {
		sessionStorage.removeItem(POS(attempt))
	} catch {
		/* ignore */
	}
}

/**
 * Full-screen exam runner. The server is the source of truth for time; answers autosave through a
 * persisted retry queue so a dropped connection or reload never loses work.
 */
export default function ExamRunner({ payload, resumed, onFinished }) {
	const attempt = payload.attempt
	const questions = payload.questions || []
	const exam = payload.exam || {}

	/* ── answers + save queue ── */
	const pending = useRef(readLocal(KEY(attempt), {}).pending || {})
	const [answers, setAnswers] = useState(() => {
		const m = {}
		for (const q of questions) m[q.question] = q.answer ?? null
		return { ...m, ...pending.current }
	})
	const [sync, setSync] = useState(Object.keys(pending.current).length ? "pending" : "saved")
	const [lastSaved, setLastSaved] = useState(null)
	const timers = useRef({})
	const retryTimer = useRef(null)
	const backoff = useRef(0)
	const flushing = useRef(null)
	const stopped = useRef(false)
	const finishedRef = useRef(false)

	/* ── clock ── */
	const deadline = useRef(Date.now() + Number(payload.time_remaining || 0) * 1000)
	const [now, setNow] = useState(Date.now())
	const remaining = Math.max(0, Math.ceil((deadline.current - now) / 1000))
	const setRemaining = (sec) => {
		if (sec == null) return
		deadline.current = Date.now() + Number(sec) * 1000
		setNow(Date.now())
	}

	/* ── navigation + flags ── */
	const [idx, setIdx] = useState(() => {
		const v = Number(sessionStorage.getItem(POS(attempt)))
		return Number.isFinite(v) && v >= 0 && v < questions.length ? v : 0
	})
	const [flags, setFlags] = useState(() => new Set(readLocal(FLAGS(attempt), [])))
	const [navOpen, setNavOpen] = useState(false)
	const [confirm, setConfirm] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
	const [awayCount, setAwayCount] = useState(0)
	const [online, setOnline] = useState(navigator.onLine)
	const q = questions[idx]

	const persist = () => writeLocal(KEY(attempt), Object.keys(pending.current).length ? { pending: pending.current, at: Date.now() } : undefined)
	const numberOf = useMemo(() => Object.fromEntries(questions.map((x) => [x.question, x.no])), [questions])

	const loggedResume = useRef(false)
	const log = useCallback(
		(event_type, details) => {
			if (stopped.current) return
			frappe.call(API.logEvent, { attempt, event_type, details }).catch(() => {})
		},
		[attempt]
	)

	const finish = useCallback(
		(summary, mode) => {
			if (finishedRef.current) return
			finishedRef.current = true
			stopped.current = true
			clearTimeout(retryTimer.current)
			clearExamLocal(attempt)
			if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
			onFinished?.(summary, mode)
		},
		[attempt, onFinished]
	)

	const closedByServer = useCallback(async () => {
		stopped.current = true
		setSync("closed")
		try {
			const r = await frappe.call(API.getAttempt, { attempt })
			if (r.status !== "In Progress") finish(r, "server")
		} catch {
			/* the runner's auto-submit will take over */
		}
	}, [attempt, finish])

	const scheduleRetry = useCallback((fn) => {
		clearTimeout(retryTimer.current)
		const delay = Math.min(30000, 2000 * 2 ** backoff.current)
		backoff.current += 1
		retryTimer.current = setTimeout(fn, delay)
	}, [])

	const flush = useCallback(() => {
		if (flushing.current) return flushing.current
		const run = async () => {
			while (!stopped.current) {
				const keys = Object.keys(pending.current)
				if (!keys.length) {
					setSync("saved")
					return true
				}
				const question = keys[0]
				const value = pending.current[question]
				setSync("saving")
				try {
					const r = await frappe.call(API.saveAnswer, { attempt, question, answer: isAnswered(value) ? value : "" })
					if (pending.current[question] === value) {
						delete pending.current[question]
						persist()
					}
					setRemaining(r?.time_remaining)
					backoff.current = 0
					setLastSaved(Date.now())
				} catch (e) {
					if (isClosed(e?.message)) {
						closedByServer()
						return false
					}
					if (isTransient(e) || e?.status === 401 || e?.status === 403) {
						setSync(navigator.onLine ? "retrying" : "offline")
						scheduleRetry(() => flush())
						return false
					}
					toast.error(`Question ${numberOf[question] || ""}: ${e?.message || "could not save"}`)
					if (pending.current[question] === value) {
						delete pending.current[question]
						persist()
					}
					setSync("error")
				}
			}
			return false
		}
		flushing.current = run().finally(() => {
			flushing.current = null
		})
		return flushing.current
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [attempt, closedByServer, scheduleRetry, numberOf])

	const setAnswer = useCallback(
		(question, value, { immediate } = {}) => {
			if (stopped.current) return
			setAnswers((a) => ({ ...a, [question]: value }))
			pending.current[question] = value
			persist()
			setSync("pending")
			clearTimeout(timers.current[question])
			timers.current[question] = setTimeout(() => flush(), immediate ? 0 : 900)
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[flush]
	)

	const resync = useCallback(async () => {
		if (stopped.current) return
		try {
			const r = await frappe.call(API.getAttempt, { attempt })
			if (r.status && r.status !== "In Progress") finish(r, "server")
			else setRemaining(r.time_remaining)
		} catch {
			/* keep local countdown */
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [attempt, finish])

	/* ── submit ── */
	const submittingRef = useRef(false)
	const submit = useCallback(
		async ({ auto } = {}) => {
			if (submittingRef.current || finishedRef.current) return
			submittingRef.current = true
			setSubmitting(true)
			try {
				if (!stopped.current) await Promise.race([flush(), sleep(auto ? 8000 : 15000)])
				if (!auto && Object.keys(pending.current).length && !stopped.current) {
					toast.error("Some answers haven't reached the server yet. Check your connection, then submit again.")
					return
				}
				stopped.current = true
				for (let i = 0; ; i++) {
					try {
						const r = await frappe.call(API.submitAttempt, { attempt })
						finish(r, auto ? "auto" : "manual")
						return
					} catch (e) {
						if (/already been submitted/i.test(e?.message || "")) {
							const r = await frappe.call(API.getAttempt, { attempt }).catch(() => ({ attempt, status: "Submitted" }))
							finish(r, "server")
							return
						}
						if (!isTransient(e) || (!auto && i >= 2)) {
							stopped.current = false
							toast.error(e?.message || "Couldn't submit. Please try again.")
							return
						}
						setSync("offline")
						await sleep(Math.min(15000, 2000 * (i + 1)))
					}
				}
			} finally {
				submittingRef.current = false
				setSubmitting(false)
				setConfirm(false)
			}
		},
		[attempt, flush, finish]
	)

	/* ── effects ── */
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 500)
		return () => clearInterval(id)
	}, [])

	useEffect(() => {
		if (Object.keys(pending.current).length) flush()
		if (resumed && !loggedResume.current) {
			loggedResume.current = true
			log("resumed", { answered: payload.answered })
		}
		const prev = document.body.style.overflow
		document.body.style.overflow = "hidden"
		return () => {
			document.body.style.overflow = prev
			clearTimeout(retryTimer.current)
			for (const t of Object.values(timers.current)) clearTimeout(t)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(() => {
		try {
			sessionStorage.setItem(POS(attempt), String(idx))
		} catch {
			/* ignore */
		}
	}, [idx, attempt])

	useEffect(() => writeLocal(FLAGS(attempt), [...flags]), [flags, attempt])

	// Server re-sync every minute.
	useEffect(() => {
		const id = setInterval(resync, 60000)
		return () => clearInterval(id)
	}, [resync])

	// Time warnings + auto-submit.
	const warned = useRef({})
	useEffect(() => {
		if (finishedRef.current) return
		if (remaining <= 300 && remaining > 290 && !warned.current.five) {
			warned.current.five = true
			toast.info("5 minutes left")
		}
		if (remaining <= 60 && remaining > 50 && !warned.current.one) {
			warned.current.one = true
			toast.info("1 minute left. Your exam submits automatically at 00:00")
		}
		if (remaining <= 0 && !warned.current.auto) {
			warned.current.auto = true
			submit({ auto: true })
		}
	}, [remaining, submit])

	// Integrity events.
	useEffect(() => {
		let away = false
		const lost = (reason) => {
			if (away || finishedRef.current) return
			away = true
			setAwayCount((n) => n + 1)
			log("focus_lost", { reason })
		}
		const back = () => {
			if (!away) return
			away = false
			log("focus_regained")
			resync()
		}
		const onVis = () => (document.hidden ? lost("tab_hidden") : back())
		const onBlur = () => lost("window_blur")
		const onFocus = () => back()
		const onFs = () => {
			const fs = Boolean(document.fullscreenElement)
			setFullscreen(fs)
			if (!fs && !finishedRef.current) log("fullscreen_exit")
		}
		const onOnline = () => {
			setOnline(true)
			backoff.current = 0
			log("reconnect")
			resync()
			flush()
		}
		const onOffline = () => {
			setOnline(false)
			setSync((s) => (s === "saved" ? s : "offline"))
		}
		const onUnload = (e) => {
			if (finishedRef.current) return
			e.preventDefault()
			e.returnValue = ""
		}
		document.addEventListener("visibilitychange", onVis)
		window.addEventListener("blur", onBlur)
		window.addEventListener("focus", onFocus)
		document.addEventListener("fullscreenchange", onFs)
		window.addEventListener("online", onOnline)
		window.addEventListener("offline", onOffline)
		window.addEventListener("beforeunload", onUnload)
		return () => {
			document.removeEventListener("visibilitychange", onVis)
			window.removeEventListener("blur", onBlur)
			window.removeEventListener("focus", onFocus)
			document.removeEventListener("fullscreenchange", onFs)
			window.removeEventListener("online", onOnline)
			window.removeEventListener("offline", onOffline)
			window.removeEventListener("beforeunload", onUnload)
		}
	}, [log, resync, flush])

	// Arrow-key navigation outside text fields.
	useEffect(() => {
		const onKey = (e) => {
			if (confirm || navOpen) return
			const tag = e.target?.tagName
			if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) && e.target.type !== "radio" && e.target.type !== "checkbox") return
			if (e.key === "ArrowRight") setIdx((i) => Math.min(questions.length - 1, i + 1))
			if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1))
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [questions.length, confirm, navOpen])

	const blockClipboard = (kind) => (e) => {
		e.preventDefault()
		log(kind, { question: q?.no, field: e.target?.tagName })
		toast.info(kind === "paste" ? "Pasting is disabled during the exam." : "Copying is disabled during the exam.")
	}

	const goto = (i) => {
		setIdx(Math.max(0, Math.min(questions.length - 1, i)))
		setNavOpen(false)
		document.getElementById("exam-main")?.scrollTo({ top: 0 })
	}
	const toggleFlag = () =>
		setFlags((s) => {
			const x = new Set(s)
			if (x.has(q.question)) x.delete(q.question)
			else x.add(q.question)
			return x
		})
	const enterFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => toast.info("Full screen isn't available on this device."))

	const answeredCount = questions.filter((x) => isAnswered(answers[x.question])).length
	const unanswered = questions.filter((x) => !isAnswered(answers[x.question]))
	const flagged = questions.filter((x) => flags.has(x.question))
	const low = remaining <= 60
	const warn = remaining <= 300

	const navigator_ = (
		<Navigator questions={questions} answers={answers} flags={flags} current={idx} onPick={goto} answered={answeredCount} />
	)

	return createPortal(
		<div
			className="fixed inset-0 z-[70] flex flex-col bg-canvas text-ink"
			role="application"
			aria-label={`Exam: ${exam.title}`}
			onCopy={blockClipboard("copy")}
			onCut={blockClipboard("copy")}
			onPaste={blockClipboard("paste")}
			onContextMenu={(e) => e.preventDefault()}
		>
			{/* Header */}
			<header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 sm:gap-3 sm:px-5 sm:py-3">
				<div className="min-w-0 flex-1">
					<div className="truncate font-serif text-[15px] font-semibold text-ink sm:text-lg">{exam.title}</div>
					<div className="hidden truncate text-xs text-ink-soft sm:block">
						{exam.course_title} · Attempt {payload.attempt_number}
					</div>
				</div>
				<SaveIndicator sync={sync} online={online} lastSaved={lastSaved} />
				<div
					role="timer"
					aria-live="off"
					aria-label={`Time remaining ${clock(remaining)}`}
					className={clsx(
						"flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-base font-bold tabular-nums sm:text-lg",
						low ? "animate-pulse bg-red-600 text-white" : warn ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-brand-50 text-brand-800"
					)}
				>
					<Timer size={16} /> {clock(remaining)}
				</div>
				{!fullscreen && document.documentElement.requestFullscreen ? (
					<button type="button" onClick={enterFullscreen} className="hidden h-9 w-9 place-items-center rounded-lg text-ink-soft hover:bg-brand-50 sm:grid" aria-label="Enter full screen" title="Full screen">
						<Maximize size={18} />
					</button>
				) : null}
				<Button size="sm" icon={Send} onClick={() => setConfirm(true)} disabled={submitting} className="hidden sm:inline-flex">
					Submit
				</Button>
			</header>

			{!online || sync === "offline" ? (
				<div className="flex items-center gap-2 bg-red-600 px-4 py-1.5 text-xs font-semibold text-white">
					<WifiOff size={14} /> You're offline. Keep working: answers are stored on this device and will sync when you reconnect.
				</div>
			) : awayCount > 0 ? (
				<div className="flex items-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
					<AlertTriangle size={14} /> You left the exam window {awayCount} {awayCount === 1 ? "time" : "times"}. This is recorded for your lecturer.
				</div>
			) : null}

			<div className="flex min-h-0 flex-1">
				{/* Question */}
				<main id="exam-main" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
					{q ? (
						<div className="mx-auto max-w-3xl px-4 py-5 sm:px-8 sm:py-8">
							<div className="mb-3 flex flex-wrap items-center gap-2">
								<span className="rounded-lg px-2.5 py-1 text-xs font-bold bg-brand-800 text-white dark:bg-brand-600 dark:text-brand-50">Question {q.no}</span>
								<span className="text-xs text-ink-soft">of {questions.length}</span>
								<span className="text-xs font-semibold text-gold-700">
									{Number(q.marks)} {Number(q.marks) === 1 ? "mark" : "marks"}
								</span>
								<span className="flex-1" />
								<button
									type="button"
									onClick={toggleFlag}
									aria-pressed={flags.has(q.question)}
									className={clsx(
										"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
										flags.has(q.question) ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "text-ink-soft hover:bg-cream"
									)}
								>
									<Flag size={13} className={flags.has(q.question) ? "fill-current" : ""} /> {flags.has(q.question) ? "Flagged" : "Flag for review"}
								</button>
							</div>
							<div className="exam-paper card p-4 sm:p-6">
								<Html html={q.text} className="text-[15.5px] leading-7 text-ink" />
								<p className="mt-2 text-xs font-medium uppercase tracking-wide text-ink-soft">{TYPE_HINT[q.question_type] || q.question_type}</p>
							</div>
							<div className="mt-4">
								<QuestionInput
									key={q.question}
									q={q}
									value={answers[q.question]}
									disabled={submitting || sync === "closed"}
									onChange={(v, opts) => setAnswer(q.question, v, opts)}
									onBlur={() => flush()}
								/>
							</div>
							<div className="mt-8 hidden items-center justify-between gap-3 sm:flex">
								<Button variant="secondary" icon={ChevronLeft} disabled={idx === 0} onClick={() => goto(idx - 1)}>
									Previous
								</Button>
								{idx < questions.length - 1 ? (
									<Button iconRight={ChevronRight} onClick={() => goto(idx + 1)}>
										Next
									</Button>
								) : (
									<Button variant="gold" icon={Send} onClick={() => setConfirm(true)}>
										Review &amp; submit
									</Button>
								)}
							</div>
							{idx === 0 && exam.instructions ? (
								<details className="mt-8 rounded-xl border border-line bg-surface p-4 text-sm">
									<summary className="cursor-pointer font-semibold text-ink">Exam instructions</summary>
									<Html html={exam.instructions} className="mt-2 text-sm" />
								</details>
							) : null}
						</div>
					) : null}
				</main>

				{/* Navigator (desktop) */}
				<aside className="hidden w-72 shrink-0 flex-col border-l border-line bg-surface lg:flex">
					<div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{navigator_}</div>
					<div className="border-t border-line p-4">
						<Button className="w-full" icon={Send} onClick={() => setConfirm(true)} disabled={submitting}>
							Submit exam
						</Button>
					</div>
				</aside>
			</div>

			{/* Mobile footer */}
			<footer className="safe-bottom flex items-center gap-2 border-t border-line bg-surface px-3 py-2 sm:hidden">
				<button type="button" onClick={() => goto(idx - 1)} disabled={idx === 0} className="grid h-11 w-11 place-items-center rounded-xl border border-line disabled:opacity-40" aria-label="Previous question">
					<ChevronLeft size={20} />
				</button>
				<button type="button" onClick={() => setNavOpen(true)} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold">
					<LayoutGrid size={16} /> {idx + 1} / {questions.length}
					<span className="text-xs font-normal text-ink-soft">· {answeredCount} done</span>
				</button>
				{idx < questions.length - 1 ? (
					<button type="button" onClick={() => goto(idx + 1)} className="grid h-11 w-11 place-items-center rounded-xl bg-brand-800 text-white dark:bg-brand-600 dark:text-brand-50" aria-label="Next question">
						<ChevronRight size={20} />
					</button>
				) : (
					<button type="button" onClick={() => setConfirm(true)} className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold bg-brand-800 text-white dark:bg-brand-600 dark:text-brand-50" aria-label="Submit exam">
						<Send size={16} /> Submit
					</button>
				)}
			</footer>

			<Modal open={navOpen} onClose={() => setNavOpen(false)} title="Questions" subtitle={`${answeredCount} of ${questions.length} answered`}>
				{navigator_}
				<Button className="mt-4 w-full" icon={Send} onClick={() => (setNavOpen(false), setConfirm(true))}>
					Submit exam
				</Button>
			</Modal>

			<Modal
				open={confirm}
				onClose={() => !submitting && setConfirm(false)}
				title="Submit your exam?"
				size="sm"
				footer={
					<>
						<Button variant="secondary" onClick={() => setConfirm(false)} disabled={submitting}>
							Keep working
						</Button>
						<Button icon={Send} loading={submitting} onClick={() => submit()}>
							Submit now
						</Button>
					</>
				}
			>
				<div className="space-y-3 text-sm">
					<div className="grid grid-cols-3 gap-2 text-center">
						<Count label="Answered" value={answeredCount} tone="text-emerald-600" />
						<Count label="Unanswered" value={unanswered.length} tone={unanswered.length ? "text-red-600" : "text-ink"} />
						<Count label="Flagged" value={flagged.length} tone={flagged.length ? "text-amber-600" : "text-ink"} />
					</div>
					{unanswered.length ? (
						<div>
							<p className="mb-1.5 font-medium text-ink">Unanswered questions</p>
							<div className="flex flex-wrap gap-1.5">
								{unanswered.map((x) => (
									<button key={x.question} type="button" onClick={() => (setConfirm(false), goto(x.no - 1))} className="h-8 min-w-8 rounded-lg border border-red-300 px-2 text-xs font-bold text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10">
										{x.no}
									</button>
								))}
							</div>
						</div>
					) : null}
					{flagged.length ? (
						<div>
							<p className="mb-1.5 font-medium text-ink">Flagged for review</p>
							<div className="flex flex-wrap gap-1.5">
								{flagged.map((x) => (
									<button key={x.question} type="button" onClick={() => (setConfirm(false), goto(x.no - 1))} className="h-8 min-w-8 rounded-lg border border-amber-300 px-2 text-xs font-bold text-amber-800 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10">
										{x.no}
									</button>
								))}
							</div>
						</div>
					) : null}
					{sync !== "saved" && sync !== "closed" ? (
						<p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
							<Loader2 size={12} className="animate-spin" /> Saving your latest answers first…
						</p>
					) : null}
					<p className="text-ink-muted">After you submit you can't change your answers. Time left: {clock(remaining)}.</p>
				</div>
			</Modal>

			{submitting && !confirm ? (
				<div className="fixed inset-0 z-[90] grid place-items-center bg-brand-900/50 backdrop-blur-sm">
					<div className="card flex items-center gap-3 px-6 py-4">
						<Loader2 className="animate-spin text-brand-600" /> <span className="font-semibold">Submitting your exam…</span>
					</div>
				</div>
			) : null}
		</div>,
		document.body
	)
}

function Count({ label, value, tone }) {
	return (
		<div className="rounded-xl border border-line px-2 py-2">
			<div className={clsx("text-xl font-bold", tone)}>{value}</div>
			<div className="text-[11px] text-ink-soft">{label}</div>
		</div>
	)
}

function SaveIndicator({ sync, online, lastSaved }) {
	const state = !online ? "offline" : sync
	const map = {
		saved: { icon: CheckCircle2, text: lastSaved ? "Saved" : "All saved", cls: "text-emerald-600" },
		saving: { icon: Loader2, text: "Saving…", cls: "text-ink-soft", spin: true },
		pending: { icon: Loader2, text: "Saving…", cls: "text-ink-soft", spin: true },
		retrying: { icon: AlertTriangle, text: "Retrying…", cls: "text-amber-600" },
		offline: { icon: WifiOff, text: "Offline", cls: "text-red-600" },
		error: { icon: AlertTriangle, text: "Not saved", cls: "text-red-600" },
		closed: { icon: Lock, text: "Time up", cls: "text-red-600" },
	}
	const s = map[state] || map.saved
	const Icon = s.icon
	return (
		<span className={clsx("inline-flex items-center gap-1 text-xs font-semibold", s.cls)} role="status" aria-live="polite">
			<Icon size={14} className={s.spin ? "animate-spin" : ""} />
			<span className="hidden sm:inline">{s.text}</span>
		</span>
	)
}

function Navigator({ questions, answers, flags, current, onPick, answered }) {
	return (
		<div>
			<div className="mb-3 flex items-center justify-between text-xs">
				<span className="font-semibold uppercase tracking-wide text-ink-soft">Questions</span>
				<span className="font-semibold text-ink">
					{answered}/{questions.length} answered
				</span>
			</div>
			<div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line">
				<div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(answered / Math.max(1, questions.length)) * 100}%` }} />
			</div>
			<div className="grid grid-cols-6 gap-1.5 sm:grid-cols-5">
				{questions.map((x, i) => {
					const done = isAnswered(answers[x.question])
					const flag = flags.has(x.question)
					return (
						<button
							key={x.question}
							type="button"
							onClick={() => onPick(i)}
							aria-label={`Question ${x.no}${done ? ", answered" : ", not answered"}${flag ? ", flagged" : ""}`}
							aria-current={i === current ? "step" : undefined}
							className={clsx(
								"relative grid h-10 place-items-center rounded-lg text-sm font-bold transition",
								done ? "bg-brand-800 text-white dark:bg-brand-600 dark:text-brand-50" : "border border-line bg-surface text-ink hover:border-brand-300",
								i === current && "ring-2 ring-gold-500 ring-offset-2 ring-offset-surface"
							)}
						>
							{x.no}
							{flag ? <Flag size={10} className="absolute right-0.5 top-0.5 fill-amber-400 text-amber-500" /> : null}
						</button>
					)
				})}
			</div>
			<div className="mt-4 space-y-1.5 text-[11px] text-ink-soft">
				<div className="flex items-center gap-2">
					<span className="h-3 w-3 rounded bg-brand-800 dark:bg-brand-600" /> Answered
				</div>
				<div className="flex items-center gap-2">
					<span className="h-3 w-3 rounded border border-line bg-surface" /> Not answered
				</div>
				<div className="flex items-center gap-2">
					<Flag size={11} className="fill-amber-400 text-amber-500" /> Flagged for review
				</div>
			</div>
		</div>
	)
}
