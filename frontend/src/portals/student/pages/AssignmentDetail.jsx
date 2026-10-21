import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import clsx from "clsx"
import { AlertTriangle, Award, CalendarClock, CheckCircle2, Clock, Download, FileText, Lock, Paperclip, RotateCcw, Send, Timer } from "lucide-react"
import { frappe, plainText } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, ConfirmDialog, FileDrop, Html, KeyValueGrid, PageHeader, Panel, QueryState, Skeleton, Textarea } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { dateTime, num, pct } from "@/shared/utils/format"
import { API, ASSIGNMENT_STATE, INV, fileUrl, humanSpan, msUntil, pctTone } from "../components/lib"
import { IconChip, SafeLink, useServerTime, useTick } from "../components/bits"

const MAX_MB = 20

export default function AssignmentDetail() {
	const { name } = useParams()
	const q = useApi(API.assignment, { name })
	useServerTime(q.data?.server_time, q.dataUpdatedAt)
	const a = q.data?.assignment
	return (
		<>
			<PageHeader
				back={{ to: a?.course_offering ? `/student/courses/${encodeURIComponent(a.course_offering)}?tab=assignments` : "/student/assignments", label: a?.course_title || "Assignments" }}
				eyebrow={a ? [a.assessment_component, a.course_title].filter(Boolean).join(" · ") : "Assignment"}
				title={a?.title || (q.isLoading ? "Loading…" : "Assignment")}
				actions={q.data ? <Badge tone={ASSIGNMENT_STATE[q.data.state]?.tone} dot>{ASSIGNMENT_STATE[q.data.state]?.label}</Badge> : null}
			/>
			<QueryState
				query={q}
				skeleton={
					<div className="grid gap-5 lg:grid-cols-3">
						<Skeleton className="h-72 rounded-2xl lg:col-span-2" />
						<Skeleton className="h-72 rounded-2xl" />
					</div>
				}
			>
				{(data) => <Body data={data} />}
			</QueryState>
		</>
	)
}

function Body({ data }) {
	const { assignment: a, submission: sub } = data
	const released = sub && Number(sub.released)
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="space-y-5 lg:col-span-2">
				{released ? <GradePanel a={a} sub={sub} /> : null}
				<Panel title="Brief" icon={FileText}>
					{a.instructions ? <Html html={a.instructions} /> : <p className="text-sm text-ink-soft">No written instructions. See the attached brief.</p>}
					{a.has_attachment ? (
						<a
							href={fileUrl("mahanaim.api.assessments.download_assignment_file", { name: a.name, kind: "brief" })}
							target="_blank"
							rel="noreferrer"
							className="mt-4 flex items-center gap-3 rounded-xl border border-line p-3 transition hover:border-brand-300 hover:bg-cream/60"
						>
							<IconChip icon={Paperclip} tone="blue" size={36} />
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-semibold text-ink">Assignment brief</span>
								<span className="block text-xs text-ink-soft">Attached by your lecturer</span>
							</span>
							<Download size={16} className="text-ink-soft" />
						</a>
					) : null}
				</Panel>
				<SubmitPanel data={data} />
			</div>
			<div className="space-y-5">
				<DeadlineCard data={data} />
				<Panel title="Details" icon={CalendarClock}>
					<KeyValueGrid
						cols={1}
						items={[
							{ label: "Opens", value: a.open_date ? dateTime(a.open_date) : "Now" },
							{ label: "Due", value: dateTime(a.due_date) },
							{ label: "Maximum score", value: `${num(a.max_score)} marks` },
							{ label: "Submission type", value: a.submission_type },
							{ label: "Accepted files", value: a.submission_type === "Text" ? "—" : (a.allowed_file_types || "Any").split(",").join(", ").toUpperCase() },
							{
								label: "Late work",
								value: Number(a.allow_late)
									? `Accepted${a.late_cutoff ? ` until ${dateTime(a.late_cutoff)}` : ""}. Penalty ${num(a.late_penalty_percent_per_day)}% per day${Number(a.max_late_penalty_percent) ? ` (max ${num(a.max_late_penalty_percent)}%)` : ""}`
									: "Not accepted",
							},
						]}
					/>
				</Panel>
			</div>
		</div>
	)
}

function DeadlineCard({ data }) {
	useTick(1000)
	const { assignment: a, submission: sub, state } = data
	const ms = msUntil(a.due_date)
	const cutoffMs = a.late_cutoff ? msUntil(a.late_cutoff) : null
	const done = ["submitted", "graded"].includes(state)
	const overdue = ms != null && ms < 0
	const tone = done ? "green" : overdue ? "red" : ms < 86400000 ? "orange" : "brand"
	return (
		<div className={clsx("card overflow-hidden")}>
			<div className={clsx("flex items-center gap-3 p-5", done ? "bg-emerald-50 dark:bg-emerald-500/10" : overdue ? "bg-red-50 dark:bg-red-500/10" : "bg-cream/70")}>
				<IconChip icon={done ? CheckCircle2 : overdue ? AlertTriangle : Timer} tone={tone} size={44} />
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{done ? "Submitted" : overdue ? "Past due" : "Time left"}</div>
					<div className="text-xl font-bold tabular-nums text-ink">
						{done ? dateTime(sub?.submitted_on) : overdue ? `${humanSpan(ms)} ago` : <Countdown ms={ms} />}
					</div>
				</div>
			</div>
			<div className="space-y-1.5 px-5 py-4 text-sm">
				<div className="flex justify-between gap-2">
					<span className="text-ink-soft">Due</span>
					<span className="font-semibold text-ink">{dateTime(a.due_date)}</span>
				</div>
				{sub?.is_late ? (
					<div className="flex justify-between gap-2">
						<span className="text-ink-soft">Late by</span>
						<span className="font-semibold text-amber-700 dark:text-amber-300">{num(sub.days_late)} day(s)</span>
					</div>
				) : null}
				{!done && overdue && data.can_submit && cutoffMs != null && cutoffMs > 0 ? (
					<div className="flex justify-between gap-2">
						<span className="text-ink-soft">Late window closes in</span>
						<span className="font-semibold text-ink">{humanSpan(cutoffMs)}</span>
					</div>
				) : null}
			</div>
		</div>
	)
}

function Countdown({ ms }) {
	const s = Math.max(0, Math.floor(ms / 1000))
	const d = Math.floor(s / 86400)
	const h = Math.floor((s % 86400) / 3600)
	const m = Math.floor((s % 3600) / 60)
	const r = s % 60
	const p = (n) => String(n).padStart(2, "0")
	return <span>{d ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(r)}`}</span>
}

function GradePanel({ a, sub }) {
	const pcent = (Number(sub.final_score) / (Number(a.max_score) || 1)) * 100
	return (
		<Panel title="Your grade" icon={Award}>
			<div className="flex flex-wrap items-center gap-5">
				<div className="text-center">
					<div className="font-serif text-4xl font-bold text-ink">{num(sub.final_score, 1)}</div>
					<div className="text-xs text-ink-soft">out of {num(a.max_score)}</div>
				</div>
				<div className="min-w-[10rem] flex-1 space-y-1 text-sm">
					<Badge tone={pctTone(pcent, { good: 70, warn: 50 })}>{pct(pcent)}</Badge>
					{Number(sub.penalty) ? (
						<p className="text-ink-muted">
							Raw score {num(sub.raw_score, 1)} less a late penalty of {num(sub.penalty, 1)}.
						</p>
					) : null}
					{sub.graded_on ? <p className="text-xs text-ink-soft">Graded {dateTime(sub.graded_on)}</p> : null}
				</div>
			</div>
			{sub.feedback ? (
				<div className="mt-4 rounded-xl border border-line bg-cream/50 p-4">
					<div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Lecturer feedback</div>
					<Html html={sub.feedback} className="text-sm" />
				</div>
			) : null}
			{sub.has_feedback_attachment ? (
				<a
					href={fileUrl("mahanaim.api.assessments.download_assignment_file", { name: sub.name, kind: "feedback" })}
					target="_blank"
					rel="noreferrer"
					className="btn btn-secondary btn-sm mt-3"
				>
					<Download size={14} /> Feedback file
				</a>
			) : null}
		</Panel>
	)
}

// Keep paragraph and line breaks, then let plainText() parse inertly (never innerHTML on a live element).
const stripHtml = (html) => (html ? plainText(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n")) : "")

const toHtml = (text) =>
	text
		.split(/\n{2,}/)
		.map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`)
		.join("")

function SubmitPanel({ data }) {
	const { assignment: a, submission: sub, can_submit, reason } = data
	const type = a.submission_type || "File and Text"
	const wantsText = type !== "File Upload"
	const wantsFile = type !== "Text"
	const draftKey = `mbc-asg-draft-${a.name}`
	const [editing, setEditing] = useState(!sub)
	const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? stripHtml(sub?.answer_text))
	const [file, setFile] = useState(sub?.attachment || null)
	const [busy, setBusy] = useState(false)
	const [confirm, setConfirm] = useState(false)
	const submit = useAction(API.submitAssignment, {
		invalidate: [INV.assessments, INV.students],
		success: (r) => (r?.submission?.status === "Late" ? "Submitted (late)" : "Submitted. Good work!"),
		onSuccess: () => {
			localStorage.removeItem(draftKey)
			setConfirm(false)
			setEditing(false)
		},
	})

	useEffect(() => {
		if (!editing) return
		const id = setTimeout(() => {
			if (text && text !== stripHtml(sub?.answer_text)) localStorage.setItem(draftKey, text)
		}, 600)
		return () => clearTimeout(id)
	}, [text, editing, draftKey, sub])

	const accept = useMemo(
		() =>
			(a.allowed_file_types || "")
				.split(",")
				.map((x) => x.trim())
				.filter(Boolean)
				.map((x) => `.${x.replace(/^\./, "")}`)
				.join(","),
		[a.allowed_file_types]
	)

	const onFile = async (f) => {
		if (f.size > MAX_MB * 1024 * 1024) return toast.error(`That file is larger than ${MAX_MB} MB.`)
		const ext = f.name.split(".").pop().toLowerCase()
		if (accept && !accept.split(",").includes(`.${ext}`)) return toast.error(`Only ${a.allowed_file_types} files are accepted.`)
		setBusy(true)
		try {
			const r = await frappe.uploadFile(f, true)
			setFile(r.file_url)
			toast.success("File uploaded")
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setBusy(false)
		}
	}

	const words = text.trim() ? text.trim().split(/\s+/).length : 0
	const ready = type === "Text" ? text.trim() : type === "File Upload" ? file : text.trim() || file

	if (!editing && sub) {
		return (
			<Panel
				title="Your submission"
				icon={Send}
				actions={
					can_submit ? (
						<Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setEditing(true)}>
							Edit &amp; resubmit
						</Button>
					) : null
				}
			>
				<div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
					<Badge status={sub.status} dot />
					<span className="text-ink-muted">Submitted {dateTime(sub.submitted_on)}</span>
				</div>
				{sub.answer_text ? (
					<div className="max-h-96 overflow-y-auto rounded-xl border border-line bg-canvas/50 p-4">
						<Html html={sub.answer_text} className="text-sm" />
					</div>
				) : null}
				{sub.attachment ? (
					<SafeLink href={sub.attachment} className="mt-3 flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-cream/60">
						<IconChip icon={Paperclip} tone="brand" size={34} />
						<span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{decodeURIComponent(sub.attachment.split("/").pop())}</span>
						<Download size={16} className="text-ink-soft" />
					</SafeLink>
				) : null}
				{!can_submit && reason && !Number(sub.released) ? (
					<p className="mt-3 flex items-center gap-1.5 text-xs text-ink-soft">
						<Lock size={12} /> {reason}
					</p>
				) : null}
			</Panel>
		)
	}

	if (!can_submit)
		return (
			<Alert tone={data.state === "overdue" ? "error" : "info"} title="Submissions closed" icon={Lock}>
				{reason || "This assignment is not accepting submissions."}
			</Alert>
		)

	return (
		<Panel title={sub ? "Resubmit your work" : "Submit your work"} icon={Send} subtitle={sub ? "Your new submission replaces the previous one." : null}>
			{data.is_late ? (
				<Alert tone="warning" title="This submission will be late" className="mb-4">
					A penalty of {num(a.late_penalty_percent_per_day)}% per day applies
					{Number(a.max_late_penalty_percent) ? `, up to ${num(a.max_late_penalty_percent)}%` : ""}.
				</Alert>
			) : null}
			<div className="space-y-4">
				{wantsText ? (
					<div>
						<Textarea
							label={type === "Text" ? "Your answer" : "Your answer (optional if you attach a file)"}
							rows={10}
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Type or paste your answer here…"
						/>
						<div className="mt-1 flex justify-between text-[11px] text-ink-soft">
							<span>Drafts are saved on this device as you type.</span>
							<span>{words} words</span>
						</div>
					</div>
				) : null}
				{wantsFile ? (
					<div>
						<FileDrop
							label={type === "File Upload" ? "Attach your work" : "Attachment"}
							hint={`${(a.allowed_file_types || "Any type").toUpperCase()} · up to ${MAX_MB} MB`}
							accept={accept || undefined}
							onFile={onFile}
							busy={busy}
							value={file}
						/>
						{file ? (
							<button type="button" className="link mt-1 text-xs" onClick={() => setFile(null)}>
								Remove file
							</button>
						) : null}
					</div>
				) : null}
				<div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
					{sub ? (
						<Button variant="ghost" onClick={() => setEditing(false)}>
							Cancel
						</Button>
					) : null}
					<Button icon={Send} disabled={!ready || busy} onClick={() => setConfirm(true)}>
						{sub ? "Resubmit" : "Submit assignment"}
					</Button>
				</div>
			</div>
			<ConfirmDialog
				open={confirm}
				title={sub ? "Resubmit this assignment?" : "Submit this assignment?"}
				message={
					data.is_late
						? "The due date has passed, so a late penalty will be applied."
						: "You can edit and resubmit until the due date."
				}
				confirmLabel={sub ? "Resubmit" : "Submit"}
				loading={submit.isPending}
				onClose={() => setConfirm(false)}
				onConfirm={() =>
					submit.mutate({
						assignment: a.name,
						answer_text: wantsText && text.trim() ? toHtml(text.trim()) : "",
						attachment: wantsFile ? file || "" : "",
					})
				}
			>
				<ul className="mt-3 space-y-1 text-sm text-ink-muted">
					{wantsText ? (
						<li className="flex items-center gap-2">
							<Clock size={14} /> {words} words of text
						</li>
					) : null}
					{wantsFile ? (
						<li className="flex items-center gap-2">
							<Paperclip size={14} /> {file ? decodeURIComponent(String(file).split("/").pop()) : "No file"}
						</li>
					) : null}
				</ul>
			</ConfirmDialog>
		</Panel>
	)
}
