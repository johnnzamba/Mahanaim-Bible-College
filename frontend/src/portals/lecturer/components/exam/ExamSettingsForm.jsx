import { siteWallClock } from "@/shared/utils/format"
import { KeyRound, Laptop, School } from "lucide-react"
import { Input, Panel, RadioCards, Select, Switch, Textarea } from "@/shared/components/ui"
import { EXAM_COMPONENTS, EXAM_TYPES, addDays, fromLocalInput, pad, toLocalInput, ymd } from "../lib"

const FINAL_TYPES = ["Main Exam", "Special", "Supplementary"]

export function defaultExam() {
	const day = ymd(addDays(siteWallClock(), 1))
	return {
		title: "",
		exam_type: "CAT",
		assessment_component: "CAT",
		delivery_mode: "Online",
		start_datetime: `${day} 09:00:00`,
		end_datetime: `${day} 11:00:00`,
		duration_minutes: 60,
		venue: "",
		access_code: "",
		pass_mark: 40,
		max_attempts: 1,
		shuffle_questions: 1,
		shuffle_options: 1,
		random_question_count: 0,
		require_fee_clearance: 1,
		show_answers_after_release: 0,
		auto_release_objective: 0,
		instructions: "",
	}
}

export const SETTING_KEYS = Object.keys(defaultExam())

const minutesBetween = (a, b) => {
	if (!a || !b) return null
	const t = (s) => new Date(String(s).replace(" ", "T")).getTime()
	return Math.round((t(b) - t(a)) / 60000)
}

/** Client-side mirror of Exam.validate_schedule; returns {field: message}. */
export function examErrors(f) {
	const e = {}
	if (!String(f.title || "").trim()) e.title = "Give the exam a title."
	const win = minutesBetween(f.start_datetime, f.end_datetime)
	if (!f.start_datetime) e.start_datetime = "Required"
	if (!f.end_datetime) e.end_datetime = "Required"
	else if (win !== null && win <= 0) e.end_datetime = "Must be after the start."
	const dur = Number(f.duration_minutes)
	if (!dur || dur <= 0) e.duration_minutes = "Must be more than 0."
	else if (win > 0 && dur > win) e.duration_minutes = `Can't exceed the ${win}-minute window.`
	const pm = Number(f.pass_mark)
	if (Number.isNaN(pm) || pm < 0 || pm > 100) e.pass_mark = "0–100%"
	if (Number(f.max_attempts) < 1) e.max_attempts = "At least 1"
	if (Number(f.random_question_count) < 0) e.random_question_count = "Can't be negative"
	return e
}

function code() {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

export function ExamSettingsForm({ form, set, errors = {}, locked }) {
	const win = minutesBetween(form.start_datetime, form.end_datetime)
	const final = FINAL_TYPES.includes(form.exam_type)
	const sw = (key, label, description) => (
		<Switch className="py-3" checked={Boolean(Number(form[key]))} onChange={(v) => set({ [key]: v ? 1 : 0 })} disabled={locked} label={label} description={description} />
	)
	return (
		<div className="grid gap-6 xl:grid-cols-2">
			<Panel title="Basics">
				<div className="space-y-4">
					<Input label="Title" required value={form.title} error={errors.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. CAT 1: Hermeneutical methods" disabled={locked} />
					<div className="grid gap-4 sm:grid-cols-2">
						<Select
							label="Type"
							value={form.exam_type}
							options={EXAM_TYPES}
							disabled={locked}
							onChange={(e) => {
								const t = e.target.value
								set(FINAL_TYPES.includes(t) && form.assessment_component === "CAT" ? { exam_type: t, assessment_component: "Exam" } : { exam_type: t })
							}}
						/>
						<Select
							label="Counts towards"
							value={form.assessment_component}
							options={EXAM_COMPONENTS.filter((c) => !(final && c === "CAT"))}
							disabled={locked}
							hint={form.assessment_component === "CAT" ? "Mark sheet: CAT column" : form.assessment_component === "Exam" ? "Mark sheet: Exam column" : "Mark sheet: Other column"}
							onChange={(e) => set({ assessment_component: e.target.value })}
						/>
					</div>
					<div>
						<span className="label">Delivery</span>
						<RadioCards
							value={form.delivery_mode}
							onChange={(v) => set({ delivery_mode: v })}
							options={[
								{ value: "Online", label: "Online", description: "Sat in the portal; objective questions mark themselves.", icon: Laptop, disabled: locked },
								{ value: "In Person", label: "In person", description: "Paper exam in a venue; enter marks on the mark sheet.", icon: School, disabled: locked },
							]}
						/>
					</div>
					{form.delivery_mode === "In Person" || form.venue ? (
						<Input label="Venue" value={form.venue || ""} onChange={(e) => set({ venue: e.target.value })} placeholder="e.g. Main hall" disabled={locked} />
					) : null}
				</div>
			</Panel>

			<Panel title="When" subtitle={win > 0 ? `Window ${win >= 60 ? `${Math.floor(win / 60)}h ${pad(win % 60)}m` : `${win} min`}` : undefined}>
				<div className="space-y-4">
					<div className="grid gap-4 sm:grid-cols-2">
						<Input
							type="datetime-local"
							label="Opens"
							required
							value={toLocalInput(form.start_datetime)}
							error={errors.start_datetime}
							disabled={locked}
							onChange={(e) => set({ start_datetime: fromLocalInput(e.target.value) })}
						/>
						<Input
							type="datetime-local"
							label="Closes"
							required
							value={toLocalInput(form.end_datetime)}
							error={errors.end_datetime}
							disabled={locked}
							onChange={(e) => set({ end_datetime: fromLocalInput(e.target.value) })}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<Input
							type="number"
							min={1}
							label="Duration (minutes)"
							required
							value={form.duration_minutes}
							error={errors.duration_minutes}
							hint="Each student's timer starts when they begin."
							disabled={locked}
							onChange={(e) => set({ duration_minutes: e.target.value })}
						/>
						<Input type="number" min={1} label="Attempts allowed" value={form.max_attempts} error={errors.max_attempts} disabled={locked} onChange={(e) => set({ max_attempts: e.target.value })} />
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<Input type="number" min={0} max={100} label="Pass mark (%)" value={form.pass_mark} error={errors.pass_mark} disabled={locked} onChange={(e) => set({ pass_mark: e.target.value })} />
						<div>
							<label className="label" htmlFor="exam-access-code">
								Access code
							</label>
							<div className="flex gap-2">
								<input
									id="exam-access-code"
									className="input font-mono uppercase tracking-widest"
									value={form.access_code || ""}
									placeholder="None"
									disabled={locked}
									onChange={(e) => set({ access_code: e.target.value.toUpperCase() })}
								/>
								<button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={locked} onClick={() => set({ access_code: code() })} aria-label="Generate access code" title="Generate a code">
									<KeyRound size={14} />
								</button>
							</div>
							<p className="mt-1 text-xs text-ink-soft">Optional; the invigilator reads it out.</p>
						</div>
					</div>
				</div>
			</Panel>

			<Panel title="Rules">
				<div className="-my-3 divide-y divide-line">
					{sw("shuffle_questions", "Shuffle question order", "Each student gets the questions in a different order.")}
					{sw("shuffle_options", "Shuffle answer options", "Multiple-choice options appear in a random order.")}
					{sw("require_fee_clearance", "Require fee clearance", "Students with outstanding fees can't start.")}
					{sw("show_answers_after_release", "Show correct answers after release", "Students can review the answer key with their results.")}
					{sw("auto_release_objective", "Release objective-only results instantly", "If nothing needs hand marking, students see their score on submitting.")}
					<div className="flex items-center justify-between gap-4 py-3">
						<div>
							<div className="text-sm font-medium text-ink">Random subset</div>
							<div className="text-xs text-ink-soft">Serve this many random questions from the paper (0 = all).</div>
							{errors.random_question_count ? <div className="text-xs text-red-600">{errors.random_question_count}</div> : null}
						</div>
						<input
							type="number"
							min={0}
							aria-label="Random question count"
							className="input !w-20 text-right"
							value={form.random_question_count ?? 0}
							disabled={locked}
							onChange={(e) => set({ random_question_count: e.target.value })}
						/>
					</div>
				</div>
			</Panel>

			<Panel title="Instructions" subtitle="Shown before the student starts">
				<Textarea rows={8} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} disabled={locked} placeholder="e.g. Answer all questions. You have 60 minutes once you start." />
			</Panel>
		</div>
	)
}
