import { Check, X } from "lucide-react"
import { Html } from "@/shared/components/ui"

const looksHtml = (s) => /<\/?[a-z][\s\S]*>/i.test(String(s || ""))

function Text({ value }) {
	if (value === null || value === undefined || value === "") return <p className="text-sm italic text-ink-soft">No answer given</p>
	return looksHtml(value) ? <Html html={value} className="text-sm" /> : <p className="whitespace-pre-wrap text-sm text-ink">{String(value)}</p>
}

function OptionRow({ text, picked, correct }) {
	return (
		<li
			className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm ${
				picked && correct
					? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
					: picked
						? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
						: correct
							? "border-dashed border-emerald-400"
							: "border-line"
			}`}
		>
			<span
				className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${picked ? "border-transparent bg-ink text-surface" : "border-line"}`}
				aria-hidden
			>
				{picked ? <Check size={10} strokeWidth={3} /> : null}
			</span>
			<span className="min-w-0 flex-1 text-ink">{text}</span>
			{correct ? <span className="shrink-0 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Correct</span> : null}
			{picked && !correct ? <X size={14} className="shrink-0 text-red-600" aria-label="Wrong choice" /> : null}
		</li>
	)
}

/** Read-only rendering of a student's answer against the key (review_items shape). */
export function AnswerView({ item }) {
	const t = item.question_type
	const ans = item.answer
	const key = item.correct_answer
	if (item.options && (t === "Multiple Choice" || t === "Multiple Select" || t === "True or False")) {
		const picked = new Set(Array.isArray(ans) ? ans.map(String) : ans != null ? [String(ans)] : [])
		const right = new Set(Array.isArray(key) ? key.map(String) : key != null ? [String(key)] : [])
		return (
			<div>
				<ul className="space-y-1.5">
					{item.options.map((o) => (
						<OptionRow key={o.id} text={o.text} picked={picked.has(String(o.id))} correct={right.has(String(o.id))} />
					))}
				</ul>
				{!picked.size ? <p className="mt-2 text-xs italic text-ink-soft">No option chosen</p> : null}
			</div>
		)
	}
	if (t === "Matching" && item.prompts) {
		const a = ans && typeof ans === "object" ? ans : {}
		const k = key && typeof key === "object" ? key : {}
		return (
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-left text-[11px] uppercase tracking-wide text-ink-soft">
							<th className="py-1 pr-3 font-semibold">Prompt</th>
							<th className="py-1 pr-3 font-semibold">Student</th>
							<th className="py-1 font-semibold">Correct</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-line">
						{item.prompts.map((p) => {
							const ok = a[p.id] != null && String(a[p.id]).trim().toLowerCase() === String(k[p.id] ?? "").trim().toLowerCase()
							return (
								<tr key={p.id}>
									<td className="py-1.5 pr-3 text-ink">{p.text}</td>
									<td className={`py-1.5 pr-3 font-medium ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>{a[p.id] ?? "—"}</td>
									<td className="py-1.5 text-ink-muted">{k[p.id] ?? "—"}</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		)
	}
	return (
		<div className="space-y-2">
			<div className="rounded-xl border border-line bg-canvas/60 p-3">
				<Text value={ans} />
			</div>
			{Array.isArray(key) && key.length ? (
				<p className="text-xs text-ink-soft">
					Accepted: <span className="font-medium text-ink-muted">{key.join(" · ")}</span>
				</p>
			) : null}
		</div>
	)
}
