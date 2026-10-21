import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { AlertTriangle, BookPlus, Check, CheckCircle2, ClipboardList, Lock, Save, Send, Sparkles, Users, X, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, ConfirmDialog, Empty, PageHeader, Panel, ProgressBar, QueryState, Skeleton, Textarea } from "@/shared/components/ui"
import { DataTable, Timeline } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { API, INV, humanSpan, msUntil, plural } from "../components/lib"

export default function Registration() {
	const q = useApi(API.regOptions, {}, { retry: false })
	const history = useApi(API.myRegs)
	const closed = q.isError && /no academic term open/i.test(q.error?.message || "")
	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Course registration"
				subtitle={q.data ? `${q.data.term.term_label} · ${q.data.student?.programme_name || ""}` : "Choose your courses for the coming term."}
			/>
			{closed ? (
				<div className="card mb-6">
					<Empty icon={Lock} title="Registration is closed" subtitle="There is no term open for registration right now. You'll be notified when the next window opens." />
				</div>
			) : (
				<QueryState
					query={q}
					skeleton={
						<div className="space-y-4">
							<Skeleton className="h-24 rounded-2xl" />
							<Skeleton className="h-96 rounded-2xl" />
						</div>
					}
				>
					{(d) => <Planner d={d} />}
				</QueryState>
			)}
			<Panel title="Registration history" icon={ClipboardList} className="mt-6" bodyClass="p-0">
				<DataTable
					className="rounded-none border-0 shadow-none"
					query={history}
					empty="No registrations yet"
					cols={[
						{ key: "term_label", label: "Term", render: (r) => <span className="font-semibold text-ink">{r.term_label || r.academic_term}</span> },
						{ key: "courses", label: "Courses", render: (r) => `${(r.courses || []).filter((c) => c.status !== "Dropped").length} courses` },
						{ key: "total_credits", label: "Credits", align: "right", render: (r) => num(r.total_credits) },
						{ key: "creation", label: "Created", render: (r) => date(r.creation), hideOnMobile: true },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} dot /> },
					]}
				/>
			</Panel>
		</>
	)
}

const STATUS_COPY = {
	Draft: { tone: "warning", title: "Draft saved", body: "Your selection is saved but not yet submitted. Submit it for your Head of Department to approve." },
	Submitted: { tone: "info", title: "Submitted for approval", body: "Your registration is waiting for approval. You can still change courses until it's approved." },
	Approved: { tone: "success", title: "Registration approved", body: "You're enrolled for this term. To drop a course, create a Course Drop request." },
	Rejected: { tone: "error", title: "Registration rejected", body: "See the remarks below, adjust your courses and submit again." },
}

function regTimeline(reg) {
	const s = reg.status
	return [
		{ label: "Draft created", date: date(reg.creation), status: "done" },
		{ label: "Submitted", status: ["Submitted", "Approved", "Rejected"].includes(s) ? "done" : s === "Draft" ? "current" : "pending" },
		s === "Rejected"
			? { label: "Rejected", date: date(reg.modified), note: reg.remarks, status: "failed" }
			: { label: "Approved", date: reg.approved_on ? date(reg.approved_on) : null, note: reg.approved_by ? `By ${reg.approved_by}` : null, status: s === "Approved" ? "done" : s === "Submitted" ? "current" : "pending" },
	]
}

function Planner({ d }) {
	const reg = d.registration
	const editable = d.can_register
	const [editing, setEditing] = useState(!reg || reg.status === "Draft")
	const initial = useMemo(() => new Set(d.offerings.filter((o) => o.registered || o.enrolled).map((o) => o.name)), [d.offerings])
	const [sel, setSel] = useState(initial)
	const [confirm, setConfirm] = useState(null)
	const [remarks, setRemarks] = useState(reg?.remarks || "")
	useEffect(() => setSel(initial), [initial])

	const save = useAction(API.submitReg, {
		invalidate: [INV.students],
		success: (r) => (r.status === "Submitted" ? "Registration submitted for approval" : "Draft saved"),
		onSuccess: () => {
			setConfirm(null)
			setEditing(false)
		},
	})
	const cancel = useAction(API.cancelReg, { invalidate: [INV.students], success: "Registration cancelled", onSuccess: () => setConfirm(null) })

	const byName = Object.fromEntries(d.offerings.map((o) => [o.name, o]))
	const chosen = [...sel].map((n) => byName[n]).filter(Boolean)
	const credits = chosen.reduce((s, o) => s + Number(o.credits || 0), 0)
	const max = Number(d.max_credits) || 24
	const over = credits > max
	const groups = useMemo(() => {
		const g = { Core: [], Elective: [], Other: [] }
		for (const o of d.offerings) (g[o.course_type] || g.Other).push(o)
		return Object.entries(g).filter(([, v]) => v.length)
	}, [d.offerings])

	const blockedReason = (o) => {
		if (o.already_passed) return "Already passed"
		if (!o.prerequisites_met) return "Prerequisites not met"
		if (o.is_full && !sel.has(o.name)) return "Class is full"
		return null
	}
	const toggle = (o) => {
		if (!editing || !editable || (blockedReason(o) && !sel.has(o.name))) return
		setSel((s) => {
			const x = new Set(s)
			if (x.has(o.name)) x.delete(o.name)
			else x.add(o.name)
			return x
		})
	}
	const pickRecommended = () =>
		setSel(new Set(d.offerings.filter((o) => o.recommended && o.course_type === "Core" && !blockedReason(o)).map((o) => o.name)))

	const window_ = d.window || {}
	const closesIn = msUntil(window_.late_registration_end || window_.registration_end ? `${window_.late_registration_end || window_.registration_end} 23:59:59` : null)
	const fee = d.fee_clearance || {}
	const changed = sel.size !== initial.size || [...sel].some((n) => !initial.has(n))

	return (
		<div className="space-y-5">
			<div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<Badge tone={window_.is_open ? "green" : "red"} dot>
							{window_.is_open ? (window_.is_late ? "Late registration" : "Registration open") : "Registration closed"}
						</Badge>
						{reg ? <Badge status={reg.status} dot /> : null}
					</div>
					<p className="mt-1.5 text-sm text-ink-muted">
						Window {date(window_.registration_start)} – {date(window_.late_registration_end || window_.registration_end)}
						{closesIn > 0 ? ` · closes in ${humanSpan(closesIn)}` : ""}. Term runs {date(d.term.start_date)} – {date(d.term.end_date)}.
					</p>
				</div>
				<div className="text-left sm:text-right">
					<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Credit limit</div>
					<div className="text-lg font-bold text-ink">{num(max)} credits</div>
				</div>
			</div>

			{!d.eligible ? (
				<Alert tone="error" title="You can't register right now">
					Your student status is {d.student?.status}. Contact the Registrar for help.
				</Alert>
			) : null}
			{fee.cleared === false ? (
				<Alert tone="warning" title="Fee clearance needed" action={<Link to="/student/fees/pay" className="btn btn-primary btn-sm">Pay fees</Link>}>
					{fee.message || `Pay at least ${num(fee.required_percent)}% of your fees to register. Balance ${money(fee.balance)}.`}
				</Alert>
			) : null}

			{reg ? (
				<div className="grid gap-5 lg:grid-cols-3">
					<div className="lg:col-span-2">
						<Alert tone={STATUS_COPY[reg.status]?.tone || "info"} title={STATUS_COPY[reg.status]?.title || reg.status}>
							{STATUS_COPY[reg.status]?.body}
							{reg.remarks && reg.status === "Rejected" ? <div className="mt-1 font-semibold">Remarks: {reg.remarks}</div> : null}
							{reg.fee_invoice ? (
								<div className="mt-1">
									Fee invoice{" "}
									<Link to="/student/fees" className="link">
										{reg.fee_invoice}
									</Link>
								</div>
							) : null}
						</Alert>
					</div>
					<Panel title="Progress" bodyClass="px-5 py-4">
						<Timeline steps={regTimeline(reg)} />
					</Panel>
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				<h2 className="mr-auto font-serif text-lg text-ink">{editing ? "Choose your courses" : "Your courses"}</h2>
				{editing && editable ? (
					<Button size="sm" variant="ghost" icon={Sparkles} onClick={pickRecommended}>
						Select recommended core
					</Button>
				) : null}
				{!editing && editable ? (
					<Button size="sm" variant="secondary" icon={BookPlus} onClick={() => setEditing(true)}>
						Change courses
					</Button>
				) : null}
				{reg?.can_cancel ? (
					<Button size="sm" variant="ghost" icon={XCircle} onClick={() => setConfirm("cancel")}>
						Cancel registration
					</Button>
				) : null}
			</div>

			{d.offerings.length ? (
				groups
					.map(([type, list]) => [type, list.filter((o) => editing || sel.has(o.name))])
					.filter(([, list]) => list.length)
					.map(([type, list]) => (
						<section key={type}>
							<h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">
								{type} courses <span className="font-normal">({list.length})</span>
							</h3>
							<div className="grid gap-3 md:grid-cols-2">
								{list.map((o) => (
									<OfferingCard key={o.name} o={o} on={sel.has(o.name)} blocked={blockedReason(o)} disabled={!editing || !editable} onToggle={() => toggle(o)} />
								))}
							</div>
						</section>
					))
			) : (
				<div className="card">
					<Empty icon={BookPlus} title="No courses offered yet" subtitle="Course offerings for this term haven't been published for your programme and campus." />
				</div>
			)}

			{editing && editable ? (
				<div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-lift lg:bottom-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2 text-sm">
								<span className="font-semibold text-ink">
									{chosen.length} {chosen.length === 1 ? "course" : "courses"} · {num(credits)} credits
								</span>
								<span className={clsx("text-xs font-semibold", over ? "text-red-600" : "text-ink-soft")}>max {num(max)}</span>
							</div>
							<ProgressBar className="mt-1.5" size="sm" value={(credits / max) * 100} tone={over ? "red" : credits ? "brand" : "gray"} />
							{over ? <p className="mt-1 text-xs font-medium text-red-600">Remove {num(credits - max)} credits to stay within the limit.</p> : null}
						</div>
						<div className="flex gap-2">
							{reg && reg.status !== "Draft" ? (
								<Button variant="ghost" onClick={() => (setSel(initial), setEditing(false))}>
									Discard
								</Button>
							) : null}
							<Button variant="secondary" icon={Save} disabled={!chosen.length || over || (!changed && reg?.status === "Draft")} loading={save.isPending && confirm == null} onClick={() => save.mutate({ term: d.term.name, offerings: [...sel], submit: 0 })}>
								Save draft
							</Button>
							<Button icon={Send} disabled={!chosen.length || over} onClick={() => setConfirm("submit")}>
								Submit
							</Button>
						</div>
					</div>
				</div>
			) : null}

			<ConfirmDialog
				open={confirm === "submit"}
				title="Submit registration?"
				message={`You're registering for ${chosen.length} courses (${num(credits)} credits) in ${d.term.term_label}. Your Head of Department will review it.`}
				confirmLabel="Submit for approval"
				loading={save.isPending}
				onClose={() => setConfirm(null)}
				onConfirm={() => save.mutate({ term: d.term.name, offerings: [...sel], submit: 1, remarks })}
			>
				<ul className="my-3 space-y-1 text-sm">
					{chosen.map((o) => (
						<li key={o.name} className="flex justify-between gap-2">
							<span className="truncate text-ink">
								<span className="font-mono text-xs text-ink-soft">{o.course_code}</span> {o.course_title}
							</span>
							<span className="shrink-0 text-ink-soft">{num(o.credits)} cr</span>
						</li>
					))}
				</ul>
				<Textarea label="Note to your HOD (optional)" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
			</ConfirmDialog>
			<ConfirmDialog
				open={confirm === "cancel"}
				title="Cancel this registration?"
				message="Your course selection will be withdrawn. You can register again while the window is open."
				confirmLabel="Cancel registration"
				tone="danger"
				loading={cancel.isPending}
				onClose={() => setConfirm(null)}
				onConfirm={() => cancel.mutate({ name: reg.name })}
			/>
		</div>
	)
}

function OfferingCard({ o, on, blocked, disabled, onToggle }) {
	const lect = (o.lecturers || []).map((l) => l.name).filter(Boolean)
	const isDisabled = disabled || (blocked && !on)
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={on}
			aria-disabled={isDisabled}
			onClick={onToggle}
			className={clsx(
				"card flex w-full items-start gap-3 p-4 text-left transition",
				on ? "border-brand-600 ring-2 ring-brand-500/20" : "",
				isDisabled ? "cursor-default" : "hover:border-brand-300",
				blocked && !on && "opacity-70"
			)}
		>
			<span
				aria-hidden
				className={clsx(
					"mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition",
					on ? "border-brand-700 bg-brand-800 text-white dark:border-brand-600 dark:bg-brand-600 dark:text-brand-50" : "border-line"
				)}
			>
				{on ? <Check size={13} strokeWidth={3} /> : null}
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-1.5">
					<span className="rounded bg-cream px-1.5 py-0.5 font-mono text-[11px] font-bold text-gold-700">{o.course_code}</span>
					{o.recommended ? <Badge tone="blue" size="xs">Recommended</Badge> : null}
					{o.is_retake ? <Badge tone="orange" size="xs">Retake</Badge> : null}
					{o.enrolled ? <Badge tone="green" size="xs">Enrolled</Badge> : null}
				</span>
				<span className="mt-1 block font-semibold leading-snug text-ink">{o.course_title}</span>
				<span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
					<span>{num(o.credits)} credits</span>
					<span>Section {o.section || "A"}</span>
					{o.study_mode ? <span>{o.study_mode}</span> : null}
					{lect.length ? (
						<span className="inline-flex items-center gap-1">
							<Users size={11} /> {lect.join(", ")}
						</span>
					) : null}
				</span>
				{(o.prerequisites || []).length ? (
					<span className="mt-1.5 flex flex-wrap gap-1">
						{o.prerequisites.map((p) => (
							<span
								key={p.course}
								className={clsx(
									"inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
									p.satisfied ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
								)}
								title={p.title}
							>
								{p.satisfied ? <CheckCircle2 size={11} /> : <X size={11} />} {p.course}
							</span>
						))}
					</span>
				) : null}
				{blocked ? (
					<span className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-red-600">
						<AlertTriangle size={12} /> {blocked}
					</span>
				) : null}
			</span>
			<span className="shrink-0 text-right text-xs">
				{o.seats_left != null ? (
					<span className={clsx("font-semibold", o.is_full ? "text-red-600" : o.seats_left <= 5 ? "text-amber-600" : "text-ink-soft")}>
						{o.is_full ? "Full" : `${plural(o.seats_left, "seat")} left`}
					</span>
				) : (
					<span className="text-ink-soft">Open</span>
				)}
			</span>
		</button>
	)
}
