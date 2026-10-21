import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Eye, Lock, Pause, Play, ShieldAlert, UserX } from "lucide-react"
import { Alert, Badge, Button, Card, ConfirmDialog, Drawer, ErrorState, Loading, PageHeader, Panel, ProgressBar, QueryState, SkeletonRows, StatCard, Textarea } from "@/shared/components/ui"
import { DataTable, Timeline, Toolbar } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { dateTime, time } from "@/shared/utils/format"
import { StatusBadge } from "../components/bits"
import { M, P, duration, score } from "../components/lib"

const POLL_MS = 10_000
const CHIPS = [
	{ id: "", label: "All" },
	{ id: "writing", label: "Writing" },
	{ id: "done", label: "Submitted" },
	{ id: "flagged", label: "Flagged" },
	{ id: "void", label: "Void" },
]
const MATCH = {
	writing: (a) => a.status === "In Progress",
	done: (a) => !["In Progress", "Void"].includes(a.status),
	flagged: (a) => a.focus_lost_count > 0,
	void: (a) => a.status === "Void",
}
const FLAG_EVENTS = /focus|blur|hidden|tab|copy|paste|fullscreen|visibility/i

function useNow(active) {
	const [now, setNow] = useState(Date.now())
	useEffect(() => {
		if (!active) return undefined
		const t = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(t)
	}, [active])
	return now
}

function FocusFlag({ n }) {
	if (!n) return <span className="text-xs text-ink-soft">—</span>
	return (
		<Badge tone={n >= 3 ? "red" : "orange"} size="xs">
			<ShieldAlert size={11} /> {n} focus loss{n === 1 ? "" : "es"}
		</Badge>
	)
}

function AttemptDrawer({ attempt, onClose, onVoid }) {
	const q = useApi(M.attemptForMarking, { attempt: attempt?.name }, { enabled: Boolean(attempt), refetchInterval: attempt?.status === "In Progress" ? POLL_MS : false })
	return (
		<Drawer
			open={Boolean(attempt)}
			onClose={onClose}
			title={attempt?.student_name || ""}
			subtitle={attempt ? `${attempt.name} · attempt ${attempt.attempt_number}` : ""}
			footer={
				attempt && attempt.status !== "Void" && attempt.status !== "Released" ? (
					<Button variant="danger-soft" icon={UserX} onClick={() => onVoid(attempt)}>
						Void attempt
					</Button>
				) : null
			}
		>
			<QueryState query={q} skeleton={<SkeletonRows rows={6} />}>
				{(d) => (
					<div className="space-y-5">
						<div className="flex flex-wrap items-center gap-2">
							<StatusBadge kind="attempt" status={d.attempt.status} />
							<FocusFlag n={d.attempt.focus_lost_count} />
							{d.attempt.submission_mode && d.attempt.submission_mode !== "Submitted" ? <Badge tone="gray">{d.attempt.submission_mode}</Badge> : null}
						</div>
						<dl className="grid grid-cols-2 gap-3 text-sm">
							<div>
								<dt className="text-xs text-ink-soft">Started</dt>
								<dd>{dateTime(d.attempt.started_on)}</dd>
							</div>
							<div>
								<dt className="text-xs text-ink-soft">Deadline</dt>
								<dd>{dateTime(d.attempt.deadline)}</dd>
							</div>
							<div>
								<dt className="text-xs text-ink-soft">Submitted</dt>
								<dd>{d.attempt.submitted_on ? dateTime(d.attempt.submitted_on) : "—"}</dd>
							</div>
							<div>
								<dt className="text-xs text-ink-soft">IP address</dt>
								<dd className="font-mono text-xs">{d.attempt.ip_address || "—"}</dd>
							</div>
						</dl>
						{d.attempt.remarks ? (
							<Alert tone="warning" title="Remarks">
								<span className="whitespace-pre-line">{d.attempt.remarks}</span>
							</Alert>
						) : null}
						<div>
							<div className="label">Activity log</div>
							{d.events?.length ? (
								<Timeline
									steps={d.events.map((e) => ({
										label: e.event,
										date: time(e.timestamp) || dateTime(e.timestamp),
										note: e.detail || undefined,
										status: FLAG_EVENTS.test(e.event) ? "failed" : "done",
									}))}
								/>
							) : (
								<p className="text-sm text-ink-soft">No events recorded.</p>
							)}
						</div>
					</div>
				)}
			</QueryState>
		</Drawer>
	)
}

export default function ExamMonitor() {
	const { exam } = useParams()
	const [live, setLive] = useState(true)
	const q = useApi(M.examMonitor, { exam }, { refetchInterval: (query) => (live && query.state.data?.exam?.status === "Open" ? POLL_MS : false) })
	const d = q.data
	const offering = d?.exam?.course_offering
	const roster = useApi(M.overview, { offering }, { enabled: Boolean(offering), staleTime: 120_000 })
	const isOpen = d?.exam?.status === "Open"
	const now = useNow(isOpen && live)
	const [chip, setChip] = useState("")
	const [search, setSearch] = useState("")
	const [view, setView] = useState(null)
	const [voiding, setVoiding] = useState(null)
	const [reason, setReason] = useState("")
	const [confirmClose, setConfirmClose] = useState(false)
	const close = useAction(M.closeExam, { invalidate: [P.exam, P.lec], success: "Exam closed. Live attempts were submitted.", onSuccess: () => setConfirmClose(false) })
	const voidA = useAction(M.voidAttempt, {
		invalidate: [P.exam, P.lec],
		success: "Attempt voided. The student can sit again.",
		onSuccess: () => {
			setVoiding(null)
			setView(null)
			setReason("")
		},
	})

	const attempts = useMemo(() => d?.attempts || [], [d])
	const elapsed = q.dataUpdatedAt ? Math.max(0, Math.floor((now - q.dataUpdatedAt) / 1000)) : 0
	const left = (a) => (a.status === "In Progress" ? Math.max(0, (a.time_left || 0) - elapsed) : 0)
	const counts = useMemo(() => Object.fromEntries(CHIPS.map((c) => [c.id, c.id ? attempts.filter(MATCH[c.id]).length : attempts.length])), [attempts])
	const term = search.trim().toLowerCase()
	const rows = attempts.filter((a) => (!chip || MATCH[chip](a)) && (!term || (a.student_name || "").toLowerCase().includes(term)))
	const names = useMemo(() => Object.fromEntries((roster.data?.roster || []).map((r) => [r.student, r])), [roster.data])
	const notStarted = (d?.not_started || []).map((s) => names[s] || { student: s, full_name: s })
	const flagged = attempts.filter((a) => a.focus_lost_count >= 3 && a.status === "In Progress")

	if (q.isError && !d) {
		return (
			<div className="space-y-6">
				<PageHeader title="Live monitor" back={{ to: `/lecturer/exams/${exam}`, label: "Exam" }} />
				<Card>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Card>
			</div>
		)
	}
	if (!d) return <Loading className="min-h-[50vh]" />
	const e = d.exam
	const enrolled = attempts.filter((a) => a.status !== "Void").length + notStarted.length

	return (
		<div className="space-y-6">
			<PageHeader
				back={{ to: `/lecturer/exams/${exam}`, label: e.title }}
				eyebrow={isOpen ? "Live monitor" : "Attempts"}
				title={e.title}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<StatusBadge kind="exam" status={e.status} />
						<span>
							{dateTime(e.start_datetime)} → {dateTime(e.end_datetime)}
						</span>
						{isOpen ? (
							<span className="inline-flex items-center gap-1.5">
								<span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-gray-400"}`} aria-hidden />
								{live ? `Updated ${time(new Date(q.dataUpdatedAt))}` : "Paused"}
							</span>
						) : null}
					</span>
				}
				actions={
					<>
						{isOpen ? (
							<Button size="sm" variant="ghost" icon={live ? Pause : Play} onClick={() => setLive((x) => !x)}>
								{live ? "Pause" : "Resume"}
							</Button>
						) : null}
						<Link to={`/lecturer/exams/${exam}/marking`} className="btn btn-secondary btn-sm">
							<ClipboardCheck size={14} /> Marking
						</Link>
						{isOpen ? (
							<Button size="sm" variant="danger-soft" icon={Lock} onClick={() => setConfirmClose(true)}>
								Close exam
							</Button>
						) : null}
					</>
				}
			/>

			{flagged.length ? (
				<Alert tone="error" title={`${flagged.length} student${flagged.length === 1 ? " has" : "s have"} left the exam window 3+ times`}>
					{flagged.map((a) => a.student_name).join(", ")}. Open an attempt to see its activity log.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
				<StatCard label="Writing now" value={d.in_progress} icon={Activity} tone={d.in_progress ? "green" : "brand"} />
				<StatCard label="Submitted" value={d.submitted} tone="blue" icon={CheckCircle2} hint={enrolled ? `${Math.round((d.submitted / enrolled) * 100)}% of class` : undefined} />
				<StatCard label="Not started" value={notStarted.length} tone={notStarted.length ? "orange" : "green"} icon={UserX} />
				<StatCard label="Flagged" value={counts.flagged} tone={counts.flagged ? "red" : "brand"} icon={AlertTriangle} hint="Left the exam window" />
			</div>

			<div className="grid gap-6 2xl:grid-cols-4">
				<div className="min-w-0 2xl:col-span-3">
					<Toolbar search={search} onSearch={setSearch} placeholder="Find a student…" chips={CHIPS.map((c) => ({ ...c, count: counts[c.id] }))} active={chip} onChip={setChip} />
					<DataTable
						rows={rows}
						onRow={setView}
						empty={attempts.length ? "No attempts match" : isOpen ? "Nobody has started yet" : "No attempts"}
						emptyIcon={Activity}
						initialSort={{ key: "student_name", dir: "asc" }}
						cols={[
							{ key: "student_name", label: "Student", render: (a) => <span className="font-medium text-ink">{a.student_name}</span>, sortValue: (a) => a.student_name },
							{ key: "status", label: "Status", render: (a) => <StatusBadge kind="attempt" status={a.status} size="xs" />, sortValue: (a) => a.status },
							{
								key: "answered",
								label: "Progress",
								render: (a) => (
									<div className="min-w-[7rem]">
										<ProgressBar value={a.questions ? (a.answered / a.questions) * 100 : 0} size="sm" tone={a.answered === a.questions ? "green" : "brand"} />
										<div className="mt-0.5 text-[11px] text-ink-soft">
											{a.answered}/{a.questions} answered
										</div>
									</div>
								),
								sortValue: (a) => (a.questions ? a.answered / a.questions : 0),
							},
							{
								key: "time_left",
								label: "Time left",
								align: "right",
								render: (a) =>
									a.status === "In Progress" ? (
										<span className={`font-mono tabular-nums ${left(a) < 300 ? "font-semibold text-red-600" : "text-ink"}`}>{duration(left(a))}</span>
									) : a.submitted_on ? (
										<span className="text-xs text-ink-soft">Done {time(a.submitted_on)}</span>
									) : (
										"—"
									),
								sortValue: (a) => left(a),
							},
							{ key: "focus_lost_count", label: "Flags", render: (a) => <FocusFlag n={a.focus_lost_count} />, sortValue: (a) => a.focus_lost_count },
							{
								key: "percentage",
								label: "Score",
								align: "right",
								render: (a) => (["Marked", "Released"].includes(a.status) ? `${score(a.percentage, 1)}%` : a.status === "Marking" ? <span className="text-xs text-ink-soft">{score(a.percentage, 1)}% so far</span> : "—"),
								sortValue: (a) => a.percentage,
							},
							{
								key: "act",
								label: "",
								sortable: false,
								export: false,
								hideOnMobile: true,
								render: (a) => <Button size="sm" variant="ghost" icon={Eye} aria-label={`View ${a.student_name}'s attempt`} onClick={(ev) => (ev.stopPropagation(), setView(a))} />,
							},
						]}
					/>
				</div>
				<Panel title="Not started" subtitle={`${notStarted.length} of ${enrolled}`} bodyClass="!p-0">
					{notStarted.length ? (
						<ul className="scroll-thin max-h-[420px] divide-y divide-line overflow-y-auto">
							{notStarted.map((s) => (
								<li key={s.student} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
									<span className="min-w-0 truncate text-ink">{s.full_name}</span>
									{s.fee_cleared === false ? (
										<Badge tone="red" size="xs">
											Fees
										</Badge>
									) : null}
								</li>
							))}
						</ul>
					) : (
						<p className="px-4 py-6 text-center text-sm text-ink-soft">Everyone has started.</p>
					)}
				</Panel>
			</div>

			<AttemptDrawer attempt={view} onClose={() => setView(null)} onVoid={setVoiding} />
			<ConfirmDialog
				open={Boolean(voiding)}
				onClose={() => setVoiding(null)}
				title={`Void ${voiding?.student_name || ""}'s attempt?`}
				message="Use this for technical failures or misconduct. The attempt stops counting and the student can sit again."
				confirmLabel="Void attempt"
				tone="danger"
				loading={voidA.isPending}
				onConfirm={() => (reason.trim() ? voidA.mutate({ attempt: voiding.name, reason }) : toast.error("Give a reason for voiding."))}
			>
				<Textarea className="mt-3" label="Reason" required rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Power failure at 10:20, approved resit" />
			</ConfirmDialog>
			<ConfirmDialog
				open={confirmClose}
				onClose={() => setConfirmClose(false)}
				title="Close the exam now?"
				message={`${d.in_progress} student${d.in_progress === 1 ? " is" : "s are"} still writing; their saved answers are submitted automatically.`}
				confirmLabel="Close exam"
				tone="danger"
				loading={close.isPending}
				onConfirm={() => close.mutate({ name: exam })}
			/>
		</div>
	)
}
