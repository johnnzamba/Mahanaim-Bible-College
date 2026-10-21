import { useId } from "react"
import clsx from "clsx"
import { Check, X } from "lucide-react"

export const TYPE_HINT = {
	"Multiple Choice": "Choose one answer",
	"Multiple Select": "Choose all that apply",
	"True or False": "True or false?",
	"Short Answer": "Type a short answer",
	"Fill in the Blank": "Fill in the blank",
	Essay: "Write your answer",
	Matching: "Match each item",
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const SHORT_MAX = 1000
const ESSAY_MAX = 60000

/**
 * Answer control for one exam question. Wire format matches services/exams.encode_answer:
 * MCQ → option id, Multiple Select → [ids], True/False → "true"|"false", text → string,
 * Matching → { prompt_id: match_text }.
 */
export function QuestionInput({ q, value, onChange, onBlur, disabled }) {
	const t = q.question_type
	if (t === "Multiple Choice" || t === "True or False")
		return <Choices q={q} value={value} disabled={disabled} onChange={(v) => onChange(v, { immediate: true })} tf={t === "True or False"} />
	if (t === "Multiple Select")
		return (
			<Choices
				q={q}
				multi
				value={Array.isArray(value) ? value : []}
				disabled={disabled}
				onChange={(v) => onChange(v, { immediate: true })}
			/>
		)
	if (t === "Matching") return <Matching q={q} value={value && typeof value === "object" ? value : {}} disabled={disabled} onChange={(v) => onChange(v, { immediate: true })} />
	if (t === "Short Answer" || t === "Fill in the Blank")
		return <TextAnswer q={q} value={value} onChange={onChange} onBlur={onBlur} disabled={disabled} max={SHORT_MAX} />
	return <TextAnswer q={q} value={value} onChange={onChange} onBlur={onBlur} disabled={disabled} max={ESSAY_MAX} essay />
}

function Choices({ q, value, onChange, multi, tf, disabled }) {
	const name = useId()
	const opts = q.options || []
	const isOn = (id) => (multi ? value.includes(id) : value === id)
	const pick = (id) => {
		if (disabled) return
		if (multi) onChange(isOn(id) ? value.filter((x) => x !== id) : [...value, id])
		else onChange(value === id ? "" : id)
	}
	return (
		<div role={multi ? "group" : "radiogroup"} aria-label={TYPE_HINT[q.question_type]} className={clsx(tf ? "grid grid-cols-2 gap-3" : "space-y-2.5")}>
			{opts.map((o, i) => {
				const on = isOn(o.id)
				return (
					<label
						key={o.id}
						className={clsx(
							"flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-[15px] transition",
							tf && "justify-center py-4 font-semibold",
							on ? "border-brand-600 bg-brand-50 text-ink" : "border-line bg-surface hover:border-brand-300",
							disabled && "cursor-not-allowed opacity-70"
						)}
					>
						<input
							type={multi ? "checkbox" : "radio"}
							name={name}
							className="sr-only"
							checked={on}
							disabled={disabled}
							onChange={() => pick(o.id)}
							onClick={(e) => {
								// Allow clearing a radio choice by clicking it again.
								if (!multi && on) {
									e.preventDefault()
									pick(o.id)
								}
							}}
						/>
						{tf ? (
							<>
								{o.id === "true" ? <Check size={18} /> : <X size={18} />}
								{o.text}
							</>
						) : (
							<>
								<span
									aria-hidden
									className={clsx(
										"grid h-7 w-7 shrink-0 place-items-center text-xs font-bold transition",
										multi ? "rounded-md" : "rounded-full",
										on ? "bg-brand-800 text-white dark:bg-brand-600 dark:text-brand-50" : "border border-line text-ink-soft"
									)}
								>
									{on && multi ? <Check size={14} /> : LETTERS[i]}
								</span>
								<span className="min-w-0 flex-1 break-words">{o.text}</span>
							</>
						)}
					</label>
				)
			})}
		</div>
	)
}

function Matching({ q, value, onChange, disabled }) {
	const matches = q.matches || []
	const used = new Set(Object.values(value))
	return (
		<div className="space-y-3">
			{(q.prompts || []).map((p, i) => {
				const id = `m-${q.question}-${p.id}`
				return (
					<div key={p.id} className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 sm:items-center">
						<label htmlFor={id} className="flex items-start gap-2 text-[15px] text-ink">
							<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cream text-xs font-bold text-gold-700">{i + 1}</span>
							<span className="min-w-0 break-words">{p.text}</span>
						</label>
						<select
							id={id}
							className="input"
							value={value[p.id] || ""}
							disabled={disabled}
							onChange={(e) => {
								const next = { ...value }
								if (e.target.value) next[p.id] = e.target.value
								else delete next[p.id]
								onChange(next)
							}}
						>
							<option value="">Choose a match…</option>
							{matches.map((m) => (
								<option key={m} value={m}>
									{used.has(m) && value[p.id] !== m ? `${m} (used)` : m}
								</option>
							))}
						</select>
					</div>
				)
			})}
		</div>
	)
}

function TextAnswer({ q, value, onChange, onBlur, disabled, max, essay }) {
	const id = useId()
	const v = typeof value === "string" ? value : ""
	const words = v.trim() ? v.trim().split(/\s+/).length : 0
	return (
		<div>
			<label htmlFor={id} className="sr-only">
				Your answer to question {q.no}
			</label>
			{essay ? (
				<textarea
					id={id}
					rows={12}
					className="input min-h-[14rem] resize-y text-[15px] leading-7"
					value={v}
					maxLength={max}
					disabled={disabled}
					spellCheck
					placeholder="Write your answer here…"
					onChange={(e) => onChange(e.target.value)}
					onBlur={onBlur}
				/>
			) : (
				<input
					id={id}
					className="input text-[15px]"
					value={v}
					maxLength={max}
					disabled={disabled}
					autoComplete="off"
					placeholder={q.question_type === "Fill in the Blank" ? "Missing word or phrase" : "Your answer"}
					onChange={(e) => onChange(e.target.value)}
					onBlur={onBlur}
				/>
			)}
			<div className="mt-1.5 flex justify-end gap-3 text-[11px] text-ink-soft">
				{essay ? <span>{words} words</span> : null}
				<span>
					{v.length.toLocaleString()} / {max.toLocaleString()}
				</span>
			</div>
		</div>
	)
}
