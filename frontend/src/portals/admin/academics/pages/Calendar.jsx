import { useEffect, useMemo, useState } from "react"
import clsx from "clsx"
import { CalendarDays, CalendarPlus, CheckCircle2, DoorOpen, Pencil, Plus, Star } from "lucide-react"
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Empty, ErrorState, IconButton, Input, Modal, PageHeader, Panel, Select, SkeletonRows } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { date, daysUntil, num } from "@/shared/utils/format"
import { ACAD, LOOKUPS, SETUP, TERM_STATUS, useAcademicRoles, useLookups } from "../lib"

const CAL = `${SETUP}academic_calendar`
const INVALIDATE = [CAL, LOOKUPS, `${ACAD}academics_stats`]
const TERM_TONE = {
	Planned: "gray",
	"Registration Open": "blue",
	"In Session": "green",
	Examinations: "orange",
	Closed: "purple",
}
const BAR = {
	Planned: "bg-gray-400 dark:bg-gray-600",
	"Registration Open": "bg-blue-400",
	"In Session": "bg-brand-600",
	Examinations: "bg-orange-400",
	Closed: "bg-purple-400 dark:bg-purple-700",
}
const ms = (d) => new Date(`${d}T00:00:00`).getTime()
const todayIso = () => new Date().toISOString().slice(0, 10)

function useSaveMaster(doctype, onDone) {
	return useAction(`${SETUP}save_master`, {
		invalidate: INVALIDATE,
		success: `${doctype} saved`,
		onSuccess: onDone,
	})
}

function YearForm({ open, onClose, year }) {
	const [v, setV] = useState(null)
	useEffect(() => {
		if (open)
			setV(
				year
					? {
							year_name: year.year_name,
							start_date: year.start_date,
							end_date: year.end_date,
							is_current: year.is_current ? 1 : 0,
						}
					: { year_name: "", start_date: "", end_date: "", is_current: 0 }
			)
	}, [open, year])
	const save = useSaveMaster("Academic year", onClose)
	if (!open || !v) return null
	const bad = v.start_date && v.end_date && v.start_date >= v.end_date
	return (
		<Modal
			open
			onClose={onClose}
			title={year ? `Edit ${year.name}` : "New academic year"}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						loading={save.isPending}
						disabled={!v.year_name || !v.start_date || !v.end_date || bad}
						onClick={() =>
							save.mutate({
								doctype: "Academic Year",
								name: year?.name,
								data: v,
							})
						}
					>
						Save
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input
					className="sm:col-span-2"
					label="Year name"
					required
					value={v.year_name}
					onChange={(e) => setV((cur) => ({ ...cur, year_name: e.target.value }))}
					disabled={Boolean(year)}
					hint={year ? "The name cannot be changed" : "e.g. 2027-2028"}
				/>
				<Input label="Starts" type="date" required value={v.start_date} onChange={(e) => setV((cur) => ({ ...cur, start_date: e.target.value }))} />
				<Input label="Ends" type="date" required value={v.end_date} onChange={(e) => setV((cur) => ({ ...cur, end_date: e.target.value }))} error={bad ? "Must end after it starts" : null} />
				<Checkbox className="sm:col-span-2" label="Current academic year" checked={Boolean(v.is_current)} onChange={(c) => setV((cur) => ({ ...cur, is_current: c ? 1 : 0 }))} />
			</div>
		</Modal>
	)
}

const TERM_DATES = [
	["start_date", "Term starts", true],
	["end_date", "Term ends", true],
	["registration_start", "Registration opens"],
	["registration_end", "Registration closes"],
	["late_registration_end", "Late registration closes"],
	["exam_start", "Exams start"],
	["exam_end", "Exams end"],
	["results_release_date", "Results release"],
]

function termIssues(v, year) {
	const p = []
	const d = (k) => v[k] || null
	if (d("start_date") && d("end_date") && d("start_date") >= d("end_date")) p.push("The term must end after it starts.")
	if (year && d("start_date") && d("end_date") && (d("start_date") < year.start_date || d("end_date") > year.end_date))
		p.push(`Term dates must fall within ${year.name} (${date(year.start_date)} – ${date(year.end_date)}).`)
	if (d("registration_start") && d("registration_end") && d("registration_start") > d("registration_end")) p.push("Registration must open on or before the day it closes.")
	if (d("registration_end") && d("late_registration_end") && d("registration_end") > d("late_registration_end")) p.push("Late registration cannot end before normal registration closes.")
	const close = d("late_registration_end") || d("registration_end")
	if (close && d("end_date") && close > d("end_date")) p.push("Registration must close before the term ends.")
	if (d("exam_start") && d("exam_end") && d("exam_start") > d("exam_end")) p.push("Exams cannot end before they start.")
	if (d("exam_start") && d("start_date") && d("end_date") && (d("exam_start") < d("start_date") || d("exam_start") > d("end_date"))) p.push("Exams must start within the term.")
	return p
}

function TermForm({ open, onClose, term, years, defaultYear }) {
	const [v, setV] = useState(null)
	useEffect(() => {
		if (!open) return
		const base = {
			academic_year: defaultYear || years[0]?.name || "",
			term_name: "",
			term_number: 1,
			status: "Planned",
			is_current: 0,
		}
		for (const [k] of TERM_DATES) base[k] = ""
		if (term) for (const k of Object.keys(base)) base[k] = term[k] ?? base[k]
		if (term) base.is_current = term.is_current ? 1 : 0
		setV(base)
	}, [open, term, defaultYear]) // eslint-disable-line react-hooks/exhaustive-deps
	const save = useSaveMaster("Term", onClose)
	if (!open || !v) return null
	const year = years.find((y) => y.name === v.academic_year)
	const issues = termIssues(v, year)
	const payload = { ...v, term_number: Number(v.term_number || 1) }
	for (const [k] of TERM_DATES) payload[k] = v[k] || null
	return (
		<Modal
			open
			onClose={onClose}
			size="lg"
			title={term ? `Edit ${term.term_label || term.name}` : "New term"}
			subtitle="Registration, exam and results dates drive the student portal and reminders."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						loading={save.isPending}
						disabled={!v.academic_year || !v.term_name || !v.start_date || !v.end_date || issues.length > 0}
						onClick={() =>
							save.mutate({
								doctype: "Academic Term",
								name: term?.name,
								data: payload,
							})
						}
					>
						Save term
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-3">
				<Select
					label="Academic year"
					required
					value={v.academic_year}
					onChange={(e) => setV((cur) => ({ ...cur, academic_year: e.target.value }))}
					options={years.map((y) => y.name)}
					disabled={Boolean(term)}
				/>
				<Input
					label="Term name"
					required
					value={v.term_name}
					onChange={(e) => setV((cur) => ({ ...cur, term_name: e.target.value }))}
					disabled={Boolean(term)}
					hint={term ? "Part of the term's ID" : "e.g. Term 1"}
				/>
				<Input label="Term number" type="number" min="1" max="4" value={v.term_number} onChange={(e) => setV((cur) => ({ ...cur, term_number: e.target.value }))} hint="Matches curriculum terms" />
				<Select label="Status" value={v.status} onChange={(e) => setV((cur) => ({ ...cur, status: e.target.value }))} options={TERM_STATUS} />
				<div className="flex items-end pb-2 sm:col-span-2">
					<Checkbox
						label="Current term"
						description="Used as the default everywhere; only one term can be current"
						checked={Boolean(v.is_current)}
						onChange={(c) => setV((cur) => ({ ...cur, is_current: c ? 1 : 0 }))}
					/>
				</div>
				{TERM_DATES.map(([k, label, req]) => (
					<Input key={k} label={label} type="date" required={req} value={v[k] || ""} onChange={(e) => setV((cur) => ({ ...cur, [k]: e.target.value }))} />
				))}
			</div>
			{issues.length ? (
				<Alert tone="warning" className="mt-4" title="Check the dates">
					<ul className="list-disc pl-4">
						{issues.map((i) => (
							<li key={i}>{i}</li>
						))}
					</ul>
				</Alert>
			) : null}
		</Modal>
	)
}

function IntakeForm({ open, onClose, intake, years }) {
	const [v, setV] = useState(null)
	const [loading, setLoading] = useState(false)
	useEffect(() => {
		if (!open) return
		const blank = {
			intake_name: "",
			academic_year: years[0]?.name || "",
			start_date: "",
			applications_open: 0,
			application_open_date: "",
			application_close_date: "",
			capacity: "",
		}
		if (!intake) {
			setV(blank)
			return
		}
		setLoading(true)
		frappe
			.call("frappe.client.get", { doctype: "Intake", name: intake.name })
			.then((d) => setV(Object.fromEntries(Object.keys(blank).map((k) => [k, d[k] ?? blank[k]]))))
			.catch((e) => {
				toast.error(e.message)
				onClose()
			})
			.finally(() => setLoading(false))
	}, [open, intake]) // eslint-disable-line react-hooks/exhaustive-deps
	const save = useSaveMaster("Intake", onClose)
	if (!open) return null
	const bad = v && v.application_open_date && v.application_close_date && v.application_open_date > v.application_close_date
	return (
		<Modal
			open
			onClose={onClose}
			title={intake ? `Edit ${intake.intake_name || intake.name}` : "New intake"}
			subtitle="Intakes are what applicants apply to."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						loading={save.isPending}
						disabled={!v || !v.intake_name || bad}
						onClick={() =>
							save.mutate({
								doctype: "Intake",
								name: intake?.name,
								data: {
									...v,
									capacity: v.capacity === "" ? 0 : Number(v.capacity),
									start_date: v.start_date || null,
									application_open_date: v.application_open_date || null,
									application_close_date: v.application_close_date || null,
									academic_year: v.academic_year || null,
								},
							})
						}
					>
						Save intake
					</Button>
				</>
			}
		>
			{loading || !v ? (
				<SkeletonRows rows={4} />
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					<Input
						label="Intake name"
						required
						value={v.intake_name}
						onChange={(e) => setV((cur) => ({ ...cur, intake_name: e.target.value }))}
						disabled={Boolean(intake)}
						hint={intake ? "The name cannot be changed" : "e.g. September 2027"}
					/>
					<Select
						label="Academic year"
						value={v.academic_year || ""}
						onChange={(e) => setV((cur) => ({ ...cur, academic_year: e.target.value }))}
						placeholder="None"
						options={years.map((y) => y.name)}
					/>
					<Input label="Classes start" type="date" value={v.start_date || ""} onChange={(e) => setV((cur) => ({ ...cur, start_date: e.target.value }))} />
					<Input label="Capacity" type="number" min="0" value={v.capacity || ""} onChange={(e) => setV((cur) => ({ ...cur, capacity: e.target.value }))} hint="Blank for no limit" />
					<Input label="Applications open" type="date" value={v.application_open_date || ""} onChange={(e) => setV((cur) => ({ ...cur, application_open_date: e.target.value }))} />
					<Input
						label="Applications close"
						type="date"
						value={v.application_close_date || ""}
						onChange={(e) =>
							setV((cur) => ({
								...cur,
								application_close_date: e.target.value,
							}))
						}
						error={bad ? "Must close after it opens" : null}
					/>
					<Checkbox
						className="sm:col-span-2"
						label="Accepting applications"
						description="Shows on the website's Apply page"
						checked={Boolean(v.applications_open)}
						onChange={(c) => setV((cur) => ({ ...cur, applications_open: c ? 1 : 0 }))}
					/>
				</div>
			)}
		</Modal>
	)
}

/** Proportional strip of the year: one block per term, lighter bands for registration and exams, a "today" pin. */
function YearTimeline({ year }) {
	const start = ms(year.start_date)
	const span = Math.max(1, ms(year.end_date) - start)
	const pos = (d) => Math.max(0, Math.min(100, ((ms(d) - start) / span) * 100))
	const now = todayIso()
	const inYear = now >= year.start_date && now <= year.end_date
	const months = useMemo(() => {
		const out = []
		const d = new Date(`${year.start_date}T00:00:00`)
		d.setDate(1)
		if (ms(d.toISOString().slice(0, 10)) < start) d.setMonth(d.getMonth() + 1)
		while (d.getTime() <= start + span) {
			out.push({
				left: ((d.getTime() - start) / span) * 100,
				label: d.toLocaleDateString("en-GB", { month: "short" }),
			})
			d.setMonth(d.getMonth() + 1)
		}
		return out
	}, [year.start_date, start, span])
	// Overlapping terms (e.g. parallel cohorts) get their own lane instead of hiding each other.
	const placed = useMemo(() => {
		const ends = []
		return [...year.terms]
			.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""))
			.map((t) => {
				let lane = ends.findIndex((e) => e < t.start_date)
				if (lane < 0) lane = ends.push(t.end_date) - 1
				else ends[lane] = t.end_date
				return { t, lane }
			})
	}, [year.terms])
	const lanes = Math.max(1, ...placed.map((p) => p.lane + 1))
	const laneH = lanes > 1 ? 32 : 44
	return (
		<div className="relative pb-6 pt-1" aria-label={`Timeline for ${year.name}`}>
			<div className="relative overflow-hidden rounded-xl bg-cream dark:bg-white/5" style={{ height: lanes * laneH }}>
				{placed.map(({ t, lane }) => {
					const left = pos(t.start_date)
					const width = Math.max(1.5, pos(t.end_date) - left)
					return (
						<div
							key={t.name}
							title={`${t.term_label || t.name}: ${date(t.start_date)} – ${date(t.end_date)}`}
							className={clsx(
								"absolute overflow-hidden rounded-lg text-[11px] font-semibold text-white",
								BAR[t.status] || BAR.Planned,
								t.is_current && "ring-2 ring-gold-400 ring-offset-1 ring-offset-surface"
							)}
							style={{
								left: `${left}%`,
								width: `${width}%`,
								top: lane * laneH + 4,
								height: laneH - 8,
							}}
						>
							{t.registration_start && t.registration_end ? (
								<div
									className="absolute inset-y-0 bg-white/30"
									style={{
										left: `${((ms(t.registration_start) - ms(t.start_date)) / Math.max(1, ms(t.end_date) - ms(t.start_date))) * 100}%`,
										width: `${((ms(t.late_registration_end || t.registration_end) - ms(t.registration_start)) / Math.max(1, ms(t.end_date) - ms(t.start_date))) * 100}%`,
									}}
								/>
							) : null}
							{t.exam_start ? (
								<div
									className="absolute inset-y-0 bg-black/20"
									style={{
										left: `${((ms(t.exam_start) - ms(t.start_date)) / Math.max(1, ms(t.end_date) - ms(t.start_date))) * 100}%`,
										width: `${((ms(t.exam_end || t.exam_start) - ms(t.exam_start) + 86400000) / Math.max(1, ms(t.end_date) - ms(t.start_date))) * 100}%`,
									}}
								/>
							) : null}
							<span className="relative block truncate px-2 drop-shadow-sm" style={{ lineHeight: `${laneH - 8}px` }}>
								{t.term_name}
							</span>
						</div>
					)
				})}
				{inYear ? (
					<div className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: `${pos(now)}%` }}>
						<span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-red-500" />
					</div>
				) : null}
			</div>
			<div className="absolute inset-x-0 bottom-0 h-5 text-[10px] text-ink-soft">
				{months.map((m) => (
					<span key={m.left} className="absolute -translate-x-1/2" style={{ left: `${m.left}%` }}>
						{m.label}
					</span>
				))}
			</div>
		</div>
	)
}

function TermCard({ t, canEdit, canSetCurrent, onEdit, onCurrent }) {
	const until = daysUntil(t.start_date)
	const rows = [
		["Registration", t.registration_start ? `${date(t.registration_start, { day: "numeric", month: "short" })} – ${date(t.registration_end, { day: "numeric", month: "short" })}` : null],
		["Late registration", t.late_registration_end ? `until ${date(t.late_registration_end, { day: "numeric", month: "short" })}` : null],
		["Exams", t.exam_start ? `${date(t.exam_start, { day: "numeric", month: "short" })} – ${date(t.exam_end || t.exam_start, { day: "numeric", month: "short" })}` : null],
		["Results release", t.results_release_date ? date(t.results_release_date) : null],
	]
	return (
		<div className={clsx("rounded-2xl border p-4", t.is_current ? "border-gold-400 bg-gold-50/40 dark:bg-gold-900/10" : "border-line")}>
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-ink">{t.term_name}</h3>
						{t.is_current ? (
							<Badge tone="gold" size="xs">
								<Star size={11} className="mr-0.5 inline" /> Current
							</Badge>
						) : null}
						<Badge tone={TERM_TONE[t.status]} size="xs">
							{t.status}
						</Badge>
					</div>
					<p className="mt-0.5 text-xs text-ink-soft">
						{date(t.start_date)} – {date(t.end_date)} · curriculum term {t.term_number || 1}
						{until > 0 ? ` · starts in ${num(until)} days` : ""}
					</p>
				</div>
				{canEdit ? <IconButton icon={Pencil} label={`Edit ${t.term_label || t.name}`} onClick={onEdit} /> : null}
			</div>
			<dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
				{rows.map(([k, val]) => (
					<div key={k}>
						<dt className="text-ink-soft">{k}</dt>
						<dd className={clsx("font-medium", val ? "text-ink" : "text-ink-soft")}>{val || "Not set"}</dd>
					</div>
				))}
			</dl>
			{t.registration_window?.is_open ? (
				<p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
					<DoorOpen size={13} /> Registration is open
					{t.registration_window.is_late ? " (late)" : ""}
				</p>
			) : t.registration_window?.state === "upcoming" ? (
				<p className="mt-3 text-xs text-ink-soft">Registration opens {date(t.registration_start)}</p>
			) : null}
			{canSetCurrent && !t.is_current ? (
				<Button size="sm" variant="ghost" icon={CheckCircle2} className="mt-2 -ml-2" onClick={onCurrent}>
					Make current
				</Button>
			) : null}
		</div>
	)
}

export default function Calendar() {
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const q = useApi(CAL, {})
	const [yearForm, setYearForm] = useState(null)
	const [termForm, setTermForm] = useState(null)
	const [intakeForm, setIntakeForm] = useState(null)
	const [making, setMaking] = useState(null)
	const setCurrent = useAction(`${SETUP}set_current_term`, {
		invalidate: INVALIDATE,
		success: (d) => `${d.current_term} is now the current term`,
		onSuccess: () => setMaking(null),
	})
	const years = q.data?.years || []
	const intakes = lookups.data?.intakes || []
	const intakesFor = (y) => intakes.filter((i) => i.academic_year === y)
	const orphanIntakes = intakes.filter((i) => !i.academic_year || !years.some((y) => y.name === i.academic_year))
	const canSetCurrent = roles.admin

	const intakeList = (list) => (
		<ul className="divide-y divide-line">
			{list.map((i) => (
				<li key={i.name} className="flex items-center gap-3 py-2">
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-semibold text-ink">{i.intake_name || i.name}</span>
						<span className="block text-xs text-ink-soft">{i.start_date ? `Classes start ${date(i.start_date)}` : "No start date"}</span>
					</span>
					<Badge tone={i.applications_open ? "green" : "gray"} size="xs">
						{i.applications_open ? "Applications open" : "Closed"}
					</Badge>
					{roles.intake ? <IconButton icon={Pencil} label={`Edit ${i.intake_name || i.name}`} onClick={() => setIntakeForm({ intake: i })} /> : null}
				</li>
			))}
		</ul>
	)

	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Academic calendar"
				subtitle="Academic years, their terms and key dates, and the intakes applicants join."
				actions={
					<>
						{roles.intake ? (
							<Button variant="secondary" icon={Plus} onClick={() => setIntakeForm({})}>
								Intake
							</Button>
						) : null}
						{roles.calendar ? (
							<>
								<Button variant="secondary" icon={Plus} onClick={() => setYearForm({})}>
									Year
								</Button>
								<Button icon={CalendarPlus} onClick={() => setTermForm({})} disabled={!years.length}>
									New term
								</Button>
							</>
						) : null}
					</>
				}
			/>
			{!roles.calendar && roles.admin ? (
				<Alert tone="info" className="mb-4">
					Only the Registrar can add or edit years and terms. You can still change the current term.
				</Alert>
			) : null}

			{q.isLoading ? (
				<SkeletonRows rows={6} />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			) : !years.length ? (
				<div className="card">
					<Empty
						icon={CalendarDays}
						title="No academic years yet"
						subtitle="Create the academic year, then its terms."
						action={
							roles.calendar ? (
								<Button icon={Plus} onClick={() => setYearForm({})}>
									New academic year
								</Button>
							) : null
						}
					/>
				</div>
			) : (
				<div className="space-y-6">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
						{Object.entries(BAR).map(([k, cls]) => (
							<span key={k} className="inline-flex items-center gap-1.5">
								<span className={clsx("h-2.5 w-4 rounded", cls)} /> {k}
							</span>
						))}
						<span className="inline-flex items-center gap-1.5">
							<span className="h-2.5 w-4 rounded bg-brand-600/50" /> lighter = registration, darker = exams
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="h-3 w-0.5 bg-red-500" /> today
						</span>
					</div>
					{years.map((y) => (
						<Panel
							key={y.name}
							icon={CalendarDays}
							title={
								<span className="flex items-center gap-2">
									{y.year_name || y.name}
									{y.is_current ? (
										<Badge tone="gold" size="xs">
											Current year
										</Badge>
									) : null}
								</span>
							}
							subtitle={`${date(y.start_date)} – ${date(y.end_date)} · ${y.terms.length} term${y.terms.length === 1 ? "" : "s"}`}
							actions={
								roles.calendar ? (
									<div className="flex gap-1">
										<Button size="sm" variant="ghost" icon={Plus} onClick={() => setTermForm({ year: y.name })}>
											Term
										</Button>
										<IconButton icon={Pencil} label={`Edit ${y.name}`} onClick={() => setYearForm({ year: y })} />
									</div>
								) : null
							}
						>
							<YearTimeline year={y} />
							{y.terms.length ? (
								<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
									{y.terms.map((t) => (
										<TermCard key={t.name} t={t} canEdit={roles.calendar} canSetCurrent={canSetCurrent} onEdit={() => setTermForm({ term: t })} onCurrent={() => setMaking(t)} />
									))}
								</div>
							) : (
								<p className="mt-2 text-sm text-ink-soft">No terms in this year yet.</p>
							)}
							{intakesFor(y.name).length ? (
								<div className="mt-5 border-t border-line pt-4">
									<h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Intakes</h4>
									{intakeList(intakesFor(y.name))}
								</div>
							) : null}
						</Panel>
					))}
					{orphanIntakes.length ? (
						<Panel title="Other intakes" subtitle="Not linked to a year shown above">
							{intakeList(orphanIntakes)}
						</Panel>
					) : null}
				</div>
			)}

			<YearForm open={Boolean(yearForm)} onClose={() => setYearForm(null)} year={yearForm?.year} />
			<TermForm open={Boolean(termForm)} onClose={() => setTermForm(null)} term={termForm?.term} years={years} defaultYear={termForm?.year} />
			<IntakeForm
				open={Boolean(intakeForm)}
				onClose={() => setIntakeForm(null)}
				intake={intakeForm?.intake}
				years={lookups.data?.academic_years?.length ? lookups.data.academic_years.map((y) => (typeof y === "string" ? { name: y } : y)) : years}
			/>
			<ConfirmDialog
				open={Boolean(making)}
				title="Change the current term?"
				message={making ? `${making.term_label || making.name} becomes the default term for registration, timetables, mark sheets and reports across every portal.` : ""}
				confirmLabel="Make current"
				loading={setCurrent.isPending}
				onConfirm={() => setCurrent.mutate({ term: making.name })}
				onClose={() => setMaking(null)}
			/>
		</>
	)
}
