import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button, Checkbox, Drawer, IconButton, Input, Loading, Select, Switch, Textarea } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { DIFFICULTIES, M, P, QUESTION_TYPES, fromHtml, toHtml } from "./lib"

const OPTION_TYPES = ["Multiple Choice", "Multiple Select"]
const TEXT_TYPES = ["Short Answer", "Fill in the Blank"]
const TYPE_HELP = {
	"Multiple Choice": "One correct option. Auto-marked.",
	"Multiple Select": "One or more correct options. Partial credit; wrong picks cancel right ones.",
	"True or False": "A statement students mark true or false. Auto-marked.",
	"Short Answer": "Auto-marked against the accepted answers; you can adjust marks when marking.",
	"Fill in the Blank": "Write ___ where the blank goes. Auto-marked against the accepted answers.",
	Matching: "Students match each prompt to its answer. Partial credit per correct pair.",
	Essay: "Marked by hand. Add a marking guide to help markers.",
}

const blank = (course) => ({
	course,
	question_type: "Multiple Choice",
	question: "",
	marks: 1,
	topic: "",
	difficulty: "Medium",
	is_active: 1,
	options: [
		{ option_text: "", is_correct: 1 },
		{ option_text: "", is_correct: 0 },
		{ option_text: "", is_correct: 0 },
		{ option_text: "", is_correct: 0 },
	],
	correct_boolean: "",
	accepted_answers: "",
	case_sensitive: 0,
	matching_pairs: [
		{ prompt: "", match: "" },
		{ prompt: "", match: "" },
	],
	marking_guide: "",
	explanation: "",
})

function validate(f) {
	if (!fromHtml(toHtml(f.question)).trim()) return "Enter the question text."
	if (!(Number(f.marks) > 0)) return "Marks must be greater than zero."
	const t = f.question_type
	if (OPTION_TYPES.includes(t)) {
		const opts = f.options
		if (opts.some((o) => !o.option_text.trim())) return "Options can't be blank. Remove empty ones."
		if (opts.length < 2) return "Add at least two options."
		const seen = new Set(opts.map((o) => o.option_text.trim().toLowerCase()))
		if (seen.size !== opts.length) return "Options must be unique."
		const right = opts.filter((o) => o.is_correct).length
		if (t === "Multiple Choice" && right !== 1) return "Mark exactly one option as correct."
		if (t === "Multiple Select" && right < 1) return "Mark at least one option as correct."
	}
	if (t === "True or False" && !["True", "False"].includes(f.correct_boolean)) return "Choose whether the statement is true or false."
	if (TEXT_TYPES.includes(t) && !f.accepted_answers.split("\n").some((a) => a.trim())) return "Add at least one accepted answer."
	if (t === "Matching") {
		if (f.matching_pairs.length < 2) return "Add at least two pairs."
		if (f.matching_pairs.some((p) => !p.prompt.trim() || !p.match.trim())) return "Each pair needs a prompt and a match."
		const seen = new Set(f.matching_pairs.map((p) => p.prompt.trim().toLowerCase()))
		if (seen.size !== f.matching_pairs.length) return "Matching prompts must be unique."
	}
	return null
}

export function QuestionEditor({ open, onClose, course, name, topics = [], onSaved }) {
	const [f, setF] = useState(() => blank(course))
	const q = useApi(M.getQuestion, { name }, { enabled: open && Boolean(name) })
	const save = useAction(M.saveQuestion, {
		invalidate: [P.exam],
		success: name ? "Question updated" : "Question added",
		onSuccess: (doc) => {
			onSaved?.(doc)
			onClose()
		},
	})

	useEffect(() => {
		if (!open) return
		if (!name) setF(blank(course))
	}, [open, name, course])

	useEffect(() => {
		const d = q.data
		if (!open || !name || !d) return
		const b = blank(d.course)
		setF({
			...b,
			...d,
			question: fromHtml(d.question),
			marking_guide: fromHtml(d.marking_guide),
			explanation: fromHtml(d.explanation),
			topic: d.topic || "",
			accepted_answers: d.accepted_answers || "",
			correct_boolean: d.correct_boolean || "",
			options: d.options?.length ? d.options.map((o) => ({ option_text: fromHtml(o.option_text), is_correct: o.is_correct ? 1 : 0 })) : b.options,
			matching_pairs: d.matching_pairs?.length ? d.matching_pairs.map((p) => ({ prompt: p.prompt || "", match: p.match || "" })) : b.matching_pairs,
		})
	}, [q.data, open, name])

	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
	const t = f.question_type
	const setOpt = (i, patch) =>
		setF((x) => ({
			...x,
			options: x.options.map((o, j) => (j === i ? { ...o, ...patch } : t === "Multiple Choice" && patch.is_correct ? { ...o, is_correct: 0 } : o)),
		}))
	const setPair = (i, patch) => setF((x) => ({ ...x, matching_pairs: x.matching_pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))

	const submit = (e) => {
		e?.preventDefault()
		const problem = validate(f)
		if (problem) return toast.error(problem)
		const data = {
			name: name || undefined,
			course: f.course || course,
			question_type: t,
			question: toHtml(f.question),
			marks: Number(f.marks),
			topic: f.topic.trim() || null,
			difficulty: f.difficulty,
			is_active: f.is_active ? 1 : 0,
			explanation: toHtml(f.explanation) || null,
			marking_guide: t === "Essay" ? toHtml(f.marking_guide) || null : null,
			correct_boolean: t === "True or False" ? f.correct_boolean : null,
			accepted_answers: TEXT_TYPES.includes(t) ? f.accepted_answers : null,
			case_sensitive: TEXT_TYPES.includes(t) && f.case_sensitive ? 1 : 0,
			options: OPTION_TYPES.includes(t) ? f.options.map((o) => ({ option_text: o.option_text.trim(), is_correct: o.is_correct ? 1 : 0 })) : [],
			matching_pairs: t === "Matching" ? f.matching_pairs.map((p) => ({ prompt: p.prompt.trim(), match: p.match.trim() })) : [],
		}
		save.mutate({ data })
	}

	const loading = Boolean(name) && q.isLoading

	return (
		<Drawer
			open={open}
			onClose={onClose}
			width="max-w-2xl"
			title={name ? "Edit question" : "New question"}
			subtitle={name ? `${name} · ${course}` : `Question bank · ${course}`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={submit} loading={save.isPending} disabled={loading}>
						{name ? "Save question" : "Add question"}
					</Button>
				</>
			}
		>
			{loading ? (
				<Loading />
			) : (
				<form onSubmit={submit} className="space-y-5">
					<div className="grid gap-4 sm:grid-cols-3">
						<Select label="Type" required value={t} onChange={set("question_type")} options={QUESTION_TYPES} className="sm:col-span-2" hint={TYPE_HELP[t]} />
						<Input label="Marks" required type="number" min={0.5} step="0.5" value={f.marks} onChange={set("marks")} />
					</div>
					<Textarea
						label="Question"
						required
						rows={4}
						value={f.question}
						onChange={set("question")}
						placeholder={t === "Fill in the Blank" ? "The book of Romans was written by ___." : t === "True or False" ? "State the statement students judge…" : "Type the question…"}
					/>
					<div className="grid gap-4 sm:grid-cols-3">
						<Input label="Topic" value={f.topic} onChange={set("topic")} list="mbc-topics" placeholder="e.g. Genre" className="sm:col-span-2" />
						<datalist id="mbc-topics">
							{topics.map((x) => (
								<option key={x} value={x} />
							))}
						</datalist>
						<Select label="Difficulty" value={f.difficulty} onChange={set("difficulty")} options={DIFFICULTIES} />
					</div>

					{OPTION_TYPES.includes(t) ? (
						<fieldset className="space-y-2">
							<legend className="label">Options · tick the correct {t === "Multiple Choice" ? "one" : "ones"}</legend>
							{f.options.map((o, i) => (
								<div key={i} className={`flex items-center gap-2 rounded-xl border p-2 ${o.is_correct ? "border-brand-500 bg-brand-50" : "border-line"}`}>
									<input
										type={t === "Multiple Choice" ? "radio" : "checkbox"}
										name="mbc-correct"
										checked={Boolean(o.is_correct)}
										onChange={(e) => setOpt(i, { is_correct: e.target.checked ? 1 : 0 })}
										aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
										className="h-5 w-5 shrink-0 accent-[rgb(var(--brand-700))]"
									/>
									<span className="w-5 shrink-0 text-center text-xs font-bold text-ink-soft">{String.fromCharCode(65 + i)}</span>
									<input
										className="input !py-2"
										value={o.option_text}
										onChange={(e) => setOpt(i, { option_text: e.target.value })}
										placeholder={`Option ${String.fromCharCode(65 + i)}`}
										aria-label={`Option ${String.fromCharCode(65 + i)}`}
									/>
									<IconButton
										icon={Trash2}
										label={`Remove option ${String.fromCharCode(65 + i)}`}
										tone="danger"
										disabled={f.options.length <= 2}
										onClick={() => setF((x) => ({ ...x, options: x.options.filter((_, j) => j !== i) }))}
									/>
								</div>
							))}
							{f.options.length < 6 ? (
								<Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((x) => ({ ...x, options: [...x.options, { option_text: "", is_correct: 0 }] }))}>
									Add option
								</Button>
							) : null}
						</fieldset>
					) : null}

					{t === "True or False" ? (
						<fieldset>
							<legend className="label">Correct answer</legend>
							<div className="grid grid-cols-2 gap-2">
								{["True", "False"].map((v) => (
									<button
										key={v}
										type="button"
										aria-pressed={f.correct_boolean === v}
										onClick={() => setF((x) => ({ ...x, correct_boolean: v }))}
										className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${f.correct_boolean === v ? "border-brand-700 bg-brand-50 text-ink ring-4 ring-brand-500/10" : "border-line text-ink-muted hover:border-brand-300"}`}
									>
										{v}
									</button>
								))}
							</div>
						</fieldset>
					) : null}

					{TEXT_TYPES.includes(t) ? (
						<div className="space-y-3">
							<Textarea label="Accepted answers" required rows={4} value={f.accepted_answers} onChange={set("accepted_answers")} hint="One per line. Extra spaces are ignored." placeholder={"Paul\nThe apostle Paul"} />
							<Checkbox checked={Boolean(f.case_sensitive)} onChange={(v) => setF((x) => ({ ...x, case_sensitive: v ? 1 : 0 }))} label="Case sensitive" />
						</div>
					) : null}

					{t === "Matching" ? (
						<fieldset className="space-y-2">
							<legend className="label">Pairs</legend>
							{f.matching_pairs.map((p, i) => (
								<div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
									<input className="input !py-2" value={p.prompt} onChange={(e) => setPair(i, { prompt: e.target.value })} placeholder="Prompt" aria-label={`Prompt ${i + 1}`} />
									<input className="input !py-2" value={p.match} onChange={(e) => setPair(i, { match: e.target.value })} placeholder="Match" aria-label={`Match ${i + 1}`} />
									<IconButton
										icon={Trash2}
										label={`Remove pair ${i + 1}`}
										tone="danger"
										disabled={f.matching_pairs.length <= 2}
										onClick={() => setF((x) => ({ ...x, matching_pairs: x.matching_pairs.filter((_, j) => j !== i) }))}
									/>
								</div>
							))}
							<Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((x) => ({ ...x, matching_pairs: [...x.matching_pairs, { prompt: "", match: "" }] }))}>
								Add pair
							</Button>
						</fieldset>
					) : null}

					{t === "Essay" ? (
						<Textarea label="Marking guide" rows={5} value={f.marking_guide} onChange={set("marking_guide")} hint="Shown to markers only: key points and how marks are split." />
					) : null}
					<Textarea label="Explanation" rows={3} value={f.explanation} onChange={set("explanation")} hint="Shown to students after results are released, if the exam allows it." />
					<Switch checked={Boolean(f.is_active)} onChange={(v) => setF((x) => ({ ...x, is_active: v ? 1 : 0 }))} label="Active" description="Inactive questions stay in past exams but can't be added to new ones." />
				</form>
			)}
		</Drawer>
	)
}
