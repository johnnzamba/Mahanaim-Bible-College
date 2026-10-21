import { useEffect, useState } from "react"
import clsx from "clsx"
import { Plus, Trash2 } from "lucide-react"
import { Alert, Button, Checkbox, ConfirmDialog, IconButton, Input, Drawer, RadioCards, Select, SkeletonRows, Switch, Textarea } from "@/shared/components/ui"
import { useAction } from "@/shared/api/hooks"
import { frappe, plainText } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { DIFFICULTY, EXAMS, QUESTION_TYPES } from "../lib"

const OPTION_TYPES = ["Multiple Choice", "Multiple Select"]
const TEXT_TYPES = ["Short Answer", "Fill in the Blank"]
const MAX_OPTIONS = 8

/** Paragraph/line-break-only HTML can be edited as plain text; anything richer stays raw HTML. */
export const isSimpleHtml = (html) => !/<(?!\/?(p|br)\b)[a-z!]/i.test(html || "")
export const htmlToText = (html) =>
	plainText(
		String(html || "")
			.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
			.replace(/<br\s*\/?>/gi, "\n"),
	)
		.replace(/\u00a0/g, " ")
		.trim()
export const textToHtml = (text) =>
	String(text || "")
		.trim()
		.split(/\n{2,}/)
		.filter((p) => p.trim())
		.map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`)
		.join("")

const blank = (course) => ({
	course,
	question_type: "Multiple Choice",
	text: "",
	raw: false,
	marks: 1,
	topic: "",
	difficulty: "Medium",
	is_active: 1,
	correct_boolean: "",
	accepted_answers: "",
	case_sensitive: 0,
	marking_guide: "",
	explanation: "",
	options: [
		{ option_text: "", is_correct: 1 },
		{ option_text: "", is_correct: 0 },
		{ option_text: "", is_correct: 0 },
		{ option_text: "", is_correct: 0 },
	],
	matching_pairs: [
		{ prompt: "", match: "" },
		{ prompt: "", match: "" },
	],
})

function fromDoc(d) {
	const raw = !isSimpleHtml(d.question)
	return {
		name: d.name,
		course: d.course,
		question_type: d.question_type,
		text: raw ? d.question || "" : htmlToText(d.question),
		raw,
		marks: d.marks,
		topic: d.topic || "",
		difficulty: d.difficulty || "Medium",
		is_active: d.is_active ? 1 : 0,
		correct_boolean: d.correct_boolean || "",
		accepted_answers: d.accepted_answers || "",
		case_sensitive: d.case_sensitive ? 1 : 0,
		marking_guide: htmlToText(d.marking_guide),
		explanation: d.explanation || "",
		options: d.options?.length ? d.options.map((o) => ({ name: o.name, option_text: o.option_text, is_correct: o.is_correct ? 1 : 0 })) : blank().options,
		matching_pairs: d.matching_pairs?.length ? d.matching_pairs.map((p) => ({ name: p.name, prompt: p.prompt, match: p.match })) : blank().matching_pairs,
		used_in: d.used_in,
	}
}

export function questionProblems(v) {
	const p = []
	const t = v.question_type
	if (!v.text.replace(/<[^>]+>/g, "").trim() && !/<img/i.test(v.text)) p.push("Enter the question text.")
	if (!(Number(v.marks) > 0)) p.push("Marks must be greater than zero.")
	if (OPTION_TYPES.includes(t)) {
		const texts = v.options.map((o) => o.option_text.trim())
		if (texts.some((x) => !x)) p.push("Options cannot be blank.")
		if (texts.length < 2) p.push("Add at least two options.")
		const lower = texts.map((x) => x.toLowerCase().replace(/\s+/g, " "))
		if (new Set(lower).size !== lower.length) p.push("Options must be unique.")
		const correct = v.options.filter((o) => o.is_correct).length
		if (t === "Multiple Choice" && correct !== 1) p.push("Mark exactly one option as correct.")
		if (t === "Multiple Select" && correct < 1) p.push("Mark at least one option as correct.")
	}
	if (t === "True or False" && !["True", "False"].includes(v.correct_boolean)) p.push("Choose whether the statement is true or false.")
	if (TEXT_TYPES.includes(t) && !v.accepted_answers.split("\n").some((a) => a.trim())) p.push("Add at least one accepted answer.")
	if (t === "Matching") {
		if (v.matching_pairs.length < 2) p.push("Add at least two matching pairs.")
		if (v.matching_pairs.some((m) => !m.prompt.trim() || !m.match.trim())) p.push("Each pair needs a prompt and a match.")
		const prompts = v.matching_pairs.map((m) => m.prompt.trim().toLowerCase())
		if (new Set(prompts).size !== prompts.length) p.push("Matching prompts must be unique.")
	}
	return p
}

function toPayload(v) {
	const t = v.question_type
	const out = {
		question_type: t,
		question: v.raw ? v.text : textToHtml(v.text),
		marks: Number(v.marks),
		topic: v.topic.trim() || null,
		difficulty: v.difficulty,
		is_active: v.is_active ? 1 : 0,
		explanation: v.explanation || null,
	}
	if (v.name) out.name = v.name
	else out.course = v.course
	if (OPTION_TYPES.includes(t)) out.options = v.options.map((o) => ({ ...(o.name ? { name: o.name } : {}), option_text: o.option_text.trim(), is_correct: o.is_correct ? 1 : 0 }))
	if (t === "True or False") out.correct_boolean = v.correct_boolean
	if (TEXT_TYPES.includes(t)) {
		out.accepted_answers = v.accepted_answers
		out.case_sensitive = v.case_sensitive ? 1 : 0
	}
	if (t === "Matching") out.matching_pairs = v.matching_pairs.map((m) => ({ ...(m.name ? { name: m.name } : {}), prompt: m.prompt.trim(), match: m.match.trim() }))
	if (t === "Essay") out.marking_guide = v.marking_guide ? textToHtml(v.marking_guide) : null
	return out
}

export function QuestionEditor({ open, onClose, course, question, topics = [] }) {
	const [v, setV] = useState(null)
	const [touched, setTouched] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)
	useEffect(() => {
		if (!open) return
		setTouched(false)
		if (!question) {
			setV(blank(course))
			return
		}
		setV(null)
		frappe
			.call(`${EXAMS}get_question`, { name: question })
			.then((d) => setV(fromDoc(d)))
			.catch((e) => {
				toast.error(e.message)
				onClose()
			})
	}, [open, question, course]) // eslint-disable-line react-hooks/exhaustive-deps
	const save = useAction(`${EXAMS}save_question`, { invalidate: [`${EXAMS}question_bank`, `${EXAMS}get_exam`], success: question ? "Question saved" : "Question added", onSuccess: onClose })
	const remove = useAction(`${EXAMS}delete_question`, {
		invalidate: [`${EXAMS}question_bank`],
		success: "Question deleted",
		onSuccess: () => {
			setConfirmDelete(false)
			onClose()
		},
	})
	if (!open) return null
	const issues = v ? questionProblems(v) : []
	const t = v?.question_type
	const set = (k) => (e) => setV((cur) => ({ ...cur, [k]: e?.target ? e.target.value : e }))
	const setOpt = (i, patch) => setV((cur) => ({ ...cur, options: cur.options.map((o, j) => (j === i ? { ...o, ...patch } : t === "Multiple Choice" && patch.is_correct ? { ...o, is_correct: 0 } : o)) }))
	const setPair = (i, patch) => setV((cur) => ({ ...cur, matching_pairs: cur.matching_pairs.map((m, j) => (j === i ? { ...m, ...patch } : m)) }))
	const submit = () => {
		setTouched(true)
		if (issues.length) return
		save.mutate({ data: toPayload(v) })
	}
	return (
		<Drawer
			open
			onClose={onClose}
			width="max-w-2xl"
			title={question ? "Edit question" : "New question"}
			subtitle={question ? question : `Question bank · ${course}`}
			footer={
				v ? (
					<div className="flex w-full items-center gap-2">
						{question ? (
							<Button variant="ghost" icon={Trash2} className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)} disabled={v.used_in?.length > 0} title={v.used_in?.length ? "Used in an exam; deactivate it instead" : undefined}>
								Delete
							</Button>
						) : null}
						<Button variant="secondary" onClick={onClose} className={question ? undefined : "ml-auto"}>
							Cancel
						</Button>
						<Button loading={save.isPending} onClick={submit}>
							{question ? "Save question" : "Add question"}
						</Button>
					</div>
				) : null
			}
		>
			{!v ? (
				<SkeletonRows rows={8} />
			) : (
				<div className="space-y-5">
					<Select label="Question type" value={t} onChange={set("question_type")} options={QUESTION_TYPES} />
					<div>
						<Textarea
							label={v.raw ? "Question (HTML)" : "Question"}
							required
							rows={v.raw ? 6 : 4}
							value={v.text}
							onChange={set("text")}
							className={v.raw ? "font-mono text-xs" : undefined}
							hint={
								v.raw
									? "This question has rich formatting, so it is edited as HTML."
									: t === "Fill in the Blank"
										? "Write the sentence with ____ where the blank goes. Blank lines start new paragraphs."
										: "Blank lines start new paragraphs."
							}
						/>
						{!v.raw ? (
							<button type="button" className="mt-1 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setV((cur) => ({ ...cur, raw: true, text: textToHtml(cur.text) }))}>
								Edit as HTML
							</button>
						) : null}
					</div>

					{OPTION_TYPES.includes(t) ? (
						<div>
							<p className="mb-2 text-sm font-medium text-ink">
								Options <span className="font-normal text-ink-soft">· {t === "Multiple Choice" ? "pick the one correct answer" : "tick every correct answer"}</span>
							</p>
							<div className="space-y-2">
								{v.options.map((o, i) => (
									<div key={o.name || i} className={clsx("flex items-center gap-2 rounded-xl border px-2 py-1.5", o.is_correct ? "border-green-400 bg-green-50/60 dark:bg-green-950/30" : "border-line")}>
										<span className="w-5 text-center text-xs font-semibold text-ink-soft">{String.fromCharCode(65 + i)}</span>
										<input
											type={t === "Multiple Choice" ? "radio" : "checkbox"}
											name="correct"
											aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
											checked={Boolean(o.is_correct)}
											onChange={(e) => setOpt(i, { is_correct: e.target.checked ? 1 : 0 })}
											className="h-4 w-4 accent-[rgb(var(--brand-700))]"
										/>
										<input value={o.option_text} onChange={(e) => setOpt(i, { option_text: e.target.value })} placeholder={`Option ${String.fromCharCode(65 + i)}`} className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none" />
										<IconButton icon={Trash2} tone="danger" label="Remove option" disabled={v.options.length <= 2} onClick={() => setV((cur) => ({ ...cur, options: cur.options.filter((_, j) => j !== i) }))} className="disabled:opacity-30" />
									</div>
								))}
							</div>
							{v.options.length < MAX_OPTIONS ? (
								<Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setV((cur) => ({ ...cur, options: [...cur.options, { option_text: "", is_correct: 0 }] }))}>
									Add option
								</Button>
							) : null}
						</div>
					) : null}

					{t === "True or False" ? (
						<div>
							<p className="mb-2 text-sm font-medium text-ink">The statement is…</p>
							<RadioCards
								value={v.correct_boolean}
								onChange={(x) => setV((cur) => ({ ...cur, correct_boolean: x }))}
								options={[
									{ value: "True", label: "True" },
									{ value: "False", label: "False" },
								]}
							/>
						</div>
					) : null}

					{TEXT_TYPES.includes(t) ? (
						<div>
							<Textarea label="Accepted answers" required rows={4} value={v.accepted_answers} onChange={set("accepted_answers")} hint="One per line; any of them earns the marks" />
							<Checkbox className="mt-2" label="Case sensitive" checked={Boolean(v.case_sensitive)} onChange={(c) => setV((cur) => ({ ...cur, case_sensitive: c ? 1 : 0 }))} />
						</div>
					) : null}

					{t === "Matching" ? (
						<div>
							<p className="mb-2 text-sm font-medium text-ink">
								Pairs <span className="font-normal text-ink-soft">· students see the matches shuffled</span>
							</p>
							<div className="space-y-2">
								{v.matching_pairs.map((m, i) => (
									<div key={m.name || i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
										<Input aria-label="Prompt" placeholder="Prompt" value={m.prompt} onChange={(e) => setPair(i, { prompt: e.target.value })} />
										<span className="text-ink-soft">→</span>
										<Input aria-label="Match" placeholder="Match" value={m.match} onChange={(e) => setPair(i, { match: e.target.value })} />
										<IconButton icon={Trash2} tone="danger" label="Remove pair" disabled={v.matching_pairs.length <= 2} onClick={() => setV((cur) => ({ ...cur, matching_pairs: cur.matching_pairs.filter((_, j) => j !== i) }))} className="disabled:opacity-30" />
									</div>
								))}
							</div>
							<Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => setV((cur) => ({ ...cur, matching_pairs: [...cur.matching_pairs, { prompt: "", match: "" }] }))}>
								Add pair
							</Button>
						</div>
					) : null}

					{t === "Essay" ? <Textarea label="Marking guide" rows={4} value={v.marking_guide} onChange={set("marking_guide")} hint="Shown to the lecturer while marking, not to students" /> : null}

					<div className="grid gap-4 sm:grid-cols-3">
						<Input label="Marks" type="number" min="0.5" step="0.5" required value={v.marks} onChange={set("marks")} />
						<div>
							<Input label="Topic" value={v.topic} onChange={set("topic")} list="mbc-question-topics" placeholder="e.g. Pentateuch" />
							<datalist id="mbc-question-topics">
								{topics.map((x) => (
									<option key={x} value={x} />
								))}
							</datalist>
						</div>
						<Select label="Difficulty" value={v.difficulty} onChange={set("difficulty")} options={DIFFICULTY} />
					</div>
					<Textarea label="Explanation" rows={2} value={v.explanation} onChange={set("explanation")} hint="Shown to students after results are released, if the exam allows it" />
					<Switch label="Active" description="Inactive questions stay in old exams but can't be added to new ones" checked={Boolean(v.is_active)} onChange={(c) => setV((cur) => ({ ...cur, is_active: c ? 1 : 0 }))} />
					{v.used_in?.length ? <p className="text-xs text-ink-soft">Used in {v.used_in.join(", ")}. Answers can't change while one of those exams is open or being marked.</p> : null}
					{touched && issues.length ? (
						<Alert tone="error" title="Fix these first">
							<ul className="list-disc pl-4">
								{issues.map((i) => (
									<li key={i}>{i}</li>
								))}
							</ul>
						</Alert>
					) : null}
				</div>
			)}
			<ConfirmDialog
				open={confirmDelete}
				title="Delete this question?"
				message="It is removed from the bank permanently."
				confirmLabel="Delete"
				tone="danger"
				loading={remove.isPending}
				onConfirm={() => remove.mutate({ name: question })}
				onClose={() => setConfirmDelete(false)}
			/>
		</Drawer>
	)
}
