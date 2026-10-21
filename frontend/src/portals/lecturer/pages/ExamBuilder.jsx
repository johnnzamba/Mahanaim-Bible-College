import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Activity, CalendarCheck2, CalendarX2, Ban, ClipboardCheck, Lock, RotateCcw, Save, Send, Trash2, Undo2 } from "lucide-react"
import { Alert, Button, Card, ConfirmDialog, ErrorState, Loading, PageHeader, Tabs } from "@/shared/components/ui"
import { Stepper } from "@/shared/components/kit"
import { useAction, useApi, useInvalidate } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { dateTime } from "@/shared/utils/format"
import { ExamSettingsForm, SETTING_KEYS, defaultExam, examErrors } from "../components/exam/ExamSettingsForm"
import { QuestionPicker } from "../components/exam/QuestionPicker"
import { ExamResults } from "../components/exam/ExamResults"
import { SaveBar, StatusBadge } from "../components/bits"
import { M, P, PAPER_EDITABLE, fromHtml, score, toHtml } from "../components/lib"

const FLOW = ["Draft", "Scheduled", "Open", "Closed", "Marking", "Released"]
const INTS = ["duration_minutes", "max_attempts", "random_question_count", "shuffle_questions", "shuffle_options", "require_fee_clearance", "show_answers_after_release", "auto_release_objective"]

function formFrom(doc) {
	const f = {}
	for (const k of SETTING_KEYS) f[k] = doc[k] ?? (k === "venue" || k === "access_code" ? "" : defaultExam()[k])
	f.instructions = fromHtml(doc.instructions)
	return f
}

export default function ExamBuilder() {
	const { exam } = useParams()
	const isNew = exam === "new"
	const [params] = useSearchParams()
	const nav = useNavigate()
	const invalidate = useInvalidate()
	const q = useApi(M.getExam, { name: exam }, { enabled: !isNew })
	const doc = q.data
	const offering = isNew ? params.get("offering") : doc?.course_offering
	const off = useApi(M.getOffering, { offering }, { enabled: Boolean(offering), staleTime: 300_000 })
	const course = off.data?.course

	const [form, setForm] = useState(isNew ? defaultExam() : null)
	const [orig, setOrig] = useState(isNew ? defaultExam() : null)
	const [items, setItems] = useState([])
	const [dirty, setDirty] = useState(false)
	const [tab, setTab] = useState(isNew ? "settings" : null)
	const [showErrors, setShowErrors] = useState(false)
	const [confirm, setConfirm] = useState(null)
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		if (!doc || dirty) return
		const f = formFrom(doc)
		setForm(f)
		setOrig(f)
		setItems(doc.questions || [])
		setTab((t) => t || (["Closed", "Marking", "Released"].includes(doc.status) && doc.attempt_count ? "results" : doc.questions?.length ? "settings" : "questions"))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [doc?.modified, doc?.status])

	const status = isNew ? "Draft" : doc?.status
	const paperEditable = isNew || PAPER_EDITABLE.includes(status)
	const settingsEditable = paperEditable
	const errors = useMemo(() => (form ? examErrors(form) : {}), [form])
	const hasErrors = Object.keys(errors).length > 0
	const queue = useApi(M.markingQueue, { exam }, { enabled: !isNew && ["Open", "Closed", "Marking", "Released"].includes(status) })
	const pending = queue.data?.pending || 0

	const set = (patch) => {
		setForm((f) => ({ ...f, ...patch }))
		setDirty(true)
	}
	const setPaper = (next) => {
		setItems(next)
		setDirty(true)
	}

	const save = async () => {
		if (hasErrors) {
			setShowErrors(true)
			setTab("settings")
			toast.error("Fix the highlighted settings first.")
			return null
		}
		const data = { ...form }
		for (const k of INTS) data[k] = Number(data[k]) || 0
		data.pass_mark = Number(data.pass_mark) || 0
		data.max_attempts = Math.max(1, data.max_attempts)
		data.duration_minutes = Math.max(1, data.duration_minutes)
		if (form.instructions !== orig?.instructions) data.instructions = toHtml(form.instructions)
		else delete data.instructions
		if (isNew) data.course_offering = offering
		else data.name = doc.name
		if (paperEditable) data.questions = items.map((i) => ({ question: i.question, marks: Number(i.marks) || 0 }))
		setSaving(true)
		try {
			const res = await frappe.call(M.saveExam, { data })
			setDirty(false)
			setShowErrors(false)
			invalidate(P.exam, P.lec)
			if (isNew) {
				toast.success("Exam created")
				nav(`/lecturer/exams/${res.name}`, { replace: true })
			} else toast.success("Exam saved")
			return res
		} catch (e) {
			toast.error(e.message || "Couldn't save the exam")
			return null
		} finally {
			setSaving(false)
		}
	}

	const after = { invalidate: [P.exam, P.lec, P.res], onSuccess: () => setConfirm(null) }
	const schedule = useAction(M.scheduleExam, { ...after, success: "Scheduled. Students have been notified." })
	const unschedule = useAction(M.unscheduleExam, { ...after, success: "Moved back to draft" })
	const cancel = useAction(M.cancelExam, { ...after, success: "Exam cancelled" })
	const close = useAction(M.closeExam, { ...after, success: "Exam closed. Live attempts were submitted." })
	const release = useAction(M.releaseResults, { ...after, success: "Results released to students" })
	const del = useAction(M.deleteExam, {
		invalidate: [P.exam, P.lec],
		success: "Exam deleted",
		onSuccess: () => nav(offering ? `/lecturer/courses/${offering}?tab=exams` : "/lecturer/exams", { replace: true }),
	})
	const busy = saving || [schedule, unschedule, cancel, close, release, del].some((m) => m.isPending)

	if (!isNew && q.isError) {
		return (
			<div className="space-y-6">
				<PageHeader title="Exam" back={{ to: "/lecturer/exams", label: "Exams" }} />
				<Card>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Card>
			</div>
		)
	}
	if (isNew && !offering) {
		return (
			<div className="space-y-6">
				<PageHeader title="New exam" back={{ to: "/lecturer/exams", label: "Exams" }} />
				<Alert tone="warning" title="Choose a course first">
					Start from <Link className="link" to="/lecturer/exams">Exams</Link> and pick the course this exam is for.
				</Alert>
			</div>
		)
	}
	if (!form || (!isNew && !doc)) return <Loading className="min-h-[50vh]" />

	const total = items.reduce((n, i) => n + (Number(i.marks) || 0), 0)
	const name = doc?.name
	const C = {
		schedule: {
			title: "Schedule this exam?",
			message: `Enrolled students are notified. It opens automatically on ${dateTime(form.start_datetime)}.`,
			label: "Schedule",
			run: async () => {
				if (dirty && !(await save())) return
				schedule.mutate({ name })
			},
		},
		unschedule: { title: "Move back to draft?", message: "Students will no longer see it as upcoming.", label: "Unschedule", run: () => unschedule.mutate({ name }) },
		cancel: { title: "Cancel this exam?", message: "It will be withdrawn. You can restore it to draft later.", label: "Cancel exam", danger: true, run: () => cancel.mutate({ name }) },
		restore: { title: "Restore to draft?", message: "You can edit and reschedule it.", label: "Restore", run: () => unschedule.mutate({ name }) },
		close: { title: "Close the exam now?", message: "Students still writing are submitted automatically with the answers they've saved.", label: "Close now", danger: true, run: () => close.mutate({ name }) },
		release: { title: "Release results?", message: "Students are notified and can see their scores.", label: "Release", run: () => release.mutate({ exam: name }) },
		delete: { title: "Delete this exam?", message: `"${form.title}" will be removed permanently.`, label: "Delete", danger: true, run: () => del.mutate({ name }) },
	}[confirm]

	const actions = isNew ? null : (
		<>
			{["Open", "Closed", "Marking", "Released"].includes(status) ? (
				<Link to={`/lecturer/exams/${name}/monitor`} className="btn btn-secondary btn-sm">
					<Activity size={14} /> {status === "Open" ? "Live monitor" : "Attempts"}
				</Link>
			) : null}
			{["Open", "Closed", "Marking", "Released"].includes(status) && (doc.has_manual_questions || pending) ? (
				<Link to={`/lecturer/exams/${name}/marking`} className={`btn btn-sm ${pending ? "btn-primary" : "btn-secondary"}`}>
					<ClipboardCheck size={14} /> Marking{pending ? ` (${pending})` : ""}
				</Link>
			) : null}
			{status === "Draft" ? (
				<Button size="sm" variant="gold" icon={CalendarCheck2} disabled={busy} onClick={() => setConfirm("schedule")}>
					Schedule
				</Button>
			) : null}
			{status === "Scheduled" ? (
				<Button size="sm" variant="secondary" icon={CalendarX2} disabled={busy} onClick={() => setConfirm("unschedule")}>
					Unschedule
				</Button>
			) : null}
			{["Draft", "Scheduled"].includes(status) && !doc.attempt_count ? (
				<Button size="sm" variant="danger-soft" icon={Ban} disabled={busy} onClick={() => setConfirm("cancel")}>
					Cancel
				</Button>
			) : null}
			{status === "Open" ? (
				<Button size="sm" variant="danger-soft" icon={Lock} disabled={busy} onClick={() => setConfirm("close")}>
					Close now
				</Button>
			) : null}
			{["Closed", "Marking"].includes(status) ? (
				<Button size="sm" variant="gold" icon={Send} disabled={busy || pending > 0} onClick={() => setConfirm("release")} title={pending ? "Finish marking first" : undefined}>
					Release results
				</Button>
			) : null}
			{status === "Cancelled" ? (
				<Button size="sm" variant="secondary" icon={RotateCcw} disabled={busy} onClick={() => setConfirm("restore")}>
					Restore to draft
				</Button>
			) : null}
			{["Draft", "Cancelled"].includes(status) && !doc.attempt_count ? (
				<Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={() => setConfirm("delete")} aria-label="Delete exam">
					Delete
				</Button>
			) : null}
		</>
	)

	const showResults = !isNew && (doc.attempt_count > 0 || ["Closed", "Marking", "Released"].includes(status))
	const current = tab || "settings"

	return (
		<div className="space-y-6">
			<PageHeader
				back={offering ? { to: `/lecturer/courses/${offering}?tab=exams`, label: off.data?.course_title || "Course" } : { to: "/lecturer/exams", label: "Exams" }}
				eyebrow={`${form.exam_type} · ${off.data ? `${off.data.course} ${off.data.course_title}` : offering}`}
				title={isNew ? form.title || "New exam" : doc.title}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<StatusBadge kind="exam" status={status} />
						<span>
							{dateTime(form.start_datetime)} → {dateTime(form.end_datetime)}
						</span>
						<span>
							{form.duration_minutes} min · {score(total)} marks
						</span>
						{form.access_code ? <span className="font-mono">Code {form.access_code}</span> : null}
					</span>
				}
				actions={actions}
			/>

			{status !== "Cancelled" ? <Stepper steps={FLOW} current={Math.max(FLOW.indexOf(status), 0)} /> : null}

			{status === "Open" ? (
				<Alert tone="success" title="This exam is live">
					{doc.attempt_count} attempt{doc.attempt_count === 1 ? "" : "s"} started, {doc.submitted_count} submitted. The paper and settings are locked while it runs.
				</Alert>
			) : null}
			{["Closed", "Marking"].includes(status) && pending ? (
				<Alert
					tone="warning"
					title={pending === 1 ? "1 attempt still needs marking" : `${pending} attempts still need marking`}
					action={
						<Link to={`/lecturer/exams/${name}/marking`} className="btn btn-primary btn-sm">
							Start marking
						</Link>
					}
				>
					Results can be released once every attempt is finalised.
				</Alert>
			) : null}
			{status === "Draft" && form.delivery_mode === "Online" && !items.length ? (
				<Alert tone="info">Add questions from the bank before scheduling an online exam.</Alert>
			) : null}

			<Tabs
				className="overflow-y-hidden pb-px"
				active={current}
				onChange={setTab}
				tabs={[
					{ id: "settings", label: "Settings" },
					{ id: "questions", label: "Questions", count: items.length },
					showResults ? { id: "results", label: "Results" } : null,
				].filter(Boolean)}
			/>

			{current === "settings" ? <ExamSettingsForm form={form} set={set} errors={showErrors ? errors : {}} locked={!settingsEditable} /> : null}
			{current === "questions" ? (
				off.isLoading ? <Loading /> : <QuestionPicker course={course} items={items} onChange={setPaper} locked={!paperEditable} randomCount={form.random_question_count} />
			) : null}
			{current === "results" && name ? <ExamResults exam={name} /> : null}

			{settingsEditable && (dirty || isNew) ? (
				<SaveBar note={isNew ? "New exam, not saved yet" : "Unsaved changes"}>
					{!isNew ? (
						<Button
							variant="ghost"
							size="sm"
							icon={Undo2}
							disabled={busy}
							onClick={() => {
								setDirty(false)
								setForm(formFrom(doc))
								setItems(doc.questions || [])
							}}
						>
							Discard
						</Button>
					) : null}
					<Button size="sm" icon={Save} loading={saving} onClick={save}>
						{isNew ? "Create exam" : "Save changes"}
					</Button>
				</SaveBar>
			) : null}

			<ConfirmDialog
				open={Boolean(C)}
				onClose={() => setConfirm(null)}
				title={C?.title}
				message={C?.message}
				confirmLabel={C?.label}
				tone={C?.danger ? "danger" : "primary"}
				loading={busy}
				onConfirm={() => C?.run()}
			/>
		</div>
	)
}
