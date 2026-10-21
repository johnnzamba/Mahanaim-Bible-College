import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Check, Library, Plus, Trash2 } from "lucide-react"
import { Badge, Button, Empty, IconButton, Pagination, Panel, Select, SkeletonRows } from "@/shared/components/ui"
import { SearchInput, useDebounced } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { QuestionEditor } from "../QuestionEditor"
import { StatusBadge } from "../bits"
import { DIFFICULTIES, M, MANUAL_TYPES, QUESTION_TYPES, score } from "../lib"

const PAGE = 15

/** Bank browser: filters + paged list with "Add" buttons. */
function BankBrowser({ course, chosen, onAdd, locked }) {
	const [search, setSearch] = useState("")
	const [type, setType] = useState("")
	const [topic, setTopic] = useState("")
	const [difficulty, setDifficulty] = useState("")
	const [page, setPage] = useState(1)
	const [creating, setCreating] = useState(false)
	const s = useDebounced(search, 300)
	useEffect(() => setPage(1), [s, type, topic, difficulty])
	const q = useApi(
		M.questionBank,
		{ course, filters: { search: s, question_type: type, topic, difficulty, is_active: 1 }, start: (page - 1) * PAGE, page_length: PAGE },
		{ enabled: Boolean(course), placeholderData: (prev) => prev }
	)
	const rows = q.data?.data || []
	const topics = q.data?.topics || []
	const fresh = rows.filter((r) => !chosen.has(r.name))

	return (
		<Panel
			title="Question bank"
			subtitle={q.data ? `${q.data.total} active question${q.data.total === 1 ? "" : "s"}${type || topic || difficulty || s ? " match" : ""}` : "Loading…"}
			actions={
				<Button size="sm" variant="secondary" icon={Plus} onClick={() => setCreating(true)} disabled={locked}>
					New
				</Button>
			}
			bodyClass="!p-0"
		>
			<div className="space-y-2 border-b border-line p-4">
				<SearchInput value={search} onChange={setSearch} placeholder="Search question text…" />
				<div className="grid grid-cols-3 gap-2">
					<select className="input !py-1.5 text-xs" aria-label="Question type" value={type} onChange={(e) => setType(e.target.value)}>
						<option value="">All types</option>
						{QUESTION_TYPES.map((t) => (
							<option key={t}>{t}</option>
						))}
					</select>
					<select className="input !py-1.5 text-xs" aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
						<option value="">All topics</option>
						{topics.map((t) => (
							<option key={t}>{t}</option>
						))}
					</select>
					<select className="input !py-1.5 text-xs" aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
						<option value="">Any level</option>
						{DIFFICULTIES.map((t) => (
							<option key={t}>{t}</option>
						))}
					</select>
				</div>
			</div>
			{q.isLoading ? (
				<div className="p-4">
					<SkeletonRows rows={5} />
				</div>
			) : rows.length ? (
				<>
					<ul className="divide-y divide-line">
						{rows.map((r) => {
							const on = chosen.has(r.name)
							return (
								<li key={r.name} className="flex items-start gap-3 px-4 py-3">
									<div className="min-w-0 flex-1">
										<div className="line-clamp-2 text-sm text-ink">{r.question_title}</div>
										<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
											<Badge tone="gray" size="xs">
												{r.question_type}
											</Badge>
											{r.difficulty ? <StatusBadge kind="question" status={r.difficulty} size="xs" dot={false} /> : null}
											{r.topic ? <span>{r.topic}</span> : null}
											<span>· {score(r.marks)} mk</span>
										</div>
									</div>
									{on ? (
										<span className="inline-flex shrink-0 items-center gap-1 pt-1 text-xs font-semibold text-emerald-600">
											<Check size={14} /> Added
										</span>
									) : (
										<Button size="sm" variant="secondary" icon={Plus} disabled={locked} onClick={() => onAdd([r])} aria-label={`Add ${r.question_title}`}>
											Add
										</Button>
									)}
								</li>
							)
						})}
					</ul>
					<div className="flex items-center justify-between gap-2 border-t border-line px-4">
						<Button size="sm" variant="ghost" disabled={locked || !fresh.length} onClick={() => onAdd(fresh)}>
							Add {fresh.length || ""} on this page
						</Button>
						<Pagination page={page} pageSize={PAGE} total={q.data?.total || 0} onChange={setPage} />
					</div>
				</>
			) : (
				<Empty
					compact
					icon={Library}
					title={s || type || topic || difficulty ? "No questions match" : "This course's bank is empty"}
					subtitle="Write questions here or import a CSV from the Question bank page."
				/>
			)}
			<QuestionEditor
				open={creating}
				onClose={() => setCreating(false)}
				course={course}
				topics={topics}
				onSaved={(doc) => {
					setCreating(false)
					if (doc?.name) onAdd([{ ...doc, question_title: doc.question_title || doc.name }])
				}}
			/>
		</Panel>
	)
}

/**
 * The exam paper: chosen questions with per-question marks and ordering, plus the bank browser.
 * `items`: [{question, marks, title, question_type, topic, difficulty}]
 */
export function QuestionPicker({ course, items, onChange, locked, randomCount }) {
	const chosen = new Set(items.map((i) => i.question))
	const total = items.reduce((n, i) => n + (Number(i.marks) || 0), 0)
	const manual = items.filter((i) => MANUAL_TYPES.includes(i.question_type)).length
	const add = (rows) =>
		onChange([
			...items,
			...rows
				.filter((r) => !chosen.has(r.name))
				.map((r) => ({ question: r.name, marks: r.marks, title: r.question_title, question_type: r.question_type, topic: r.topic, difficulty: r.difficulty })),
		])
	const move = (i, d) => {
		const next = [...items]
		;[next[i], next[i + d]] = [next[i + d], next[i]]
		onChange(next)
	}
	const rc = Number(randomCount) || 0

	return (
		<div className="grid gap-6 lg:grid-cols-5">
			<Panel
				className="lg:col-span-3"
				title="Paper"
				subtitle={
					items.length
						? `${items.length} question${items.length === 1 ? "" : "s"} · ${score(total)} marks${manual ? ` · ${manual} marked by hand` : ""}`
						: "No questions yet"
				}
				bodyClass="!p-0"
			>
				{rc > 0 && rc < items.length ? (
					<p className="border-b border-line bg-cream/60 px-4 py-2 text-xs text-ink-muted">
						Each student gets {rc} random question{rc === 1 ? "" : "s"} from this list (about {score((rc * total) / items.length, 1)} marks).
					</p>
				) : null}
				{items.length ? (
					<ol className="divide-y divide-line">
						{items.map((it, i) => (
							<li key={it.question} className="flex items-start gap-3 px-4 py-3">
								<span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
								<div className="min-w-0 flex-1">
									<div className="line-clamp-2 text-sm text-ink">{it.title || it.question}</div>
									<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
										<Badge tone={MANUAL_TYPES.includes(it.question_type) ? "purple" : "gray"} size="xs">
											{it.question_type}
										</Badge>
										{it.difficulty ? <StatusBadge kind="question" status={it.difficulty} size="xs" dot={false} /> : null}
										{it.topic ? <span>{it.topic}</span> : null}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<input
										type="number"
										min={0.5}
										step="0.5"
										aria-label={`Marks for question ${i + 1}`}
										className="input !w-16 !px-2 !py-1.5 text-right tabular-nums"
										value={it.marks ?? ""}
										disabled={locked}
										onWheel={(e) => e.currentTarget.blur()}
										onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)))}
									/>
									<span className="hidden text-xs text-ink-soft sm:inline">mk</span>
									{!locked ? (
										<span className="ml-1 hidden sm:contents">
											<IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
											<IconButton icon={ArrowDown} label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
										</span>
									) : null}
									{!locked ? <IconButton icon={Trash2} label="Remove question" tone="danger" onClick={() => onChange(items.filter((_, j) => j !== i))} /> : null}
								</div>
							</li>
						))}
					</ol>
				) : (
					<Empty compact icon={Library} title="Pick questions from the bank" subtitle={locked ? undefined : "Use the panel alongside to add questions; set marks per question here."} />
				)}
				{items.length ? (
					<div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
						<span className="text-ink-muted">Total</span>
						<span className="font-serif text-xl text-ink">{score(total)} marks</span>
					</div>
				) : null}
			</Panel>
			<div className="lg:col-span-2">{course ? <BankBrowser course={course} chosen={chosen} onAdd={add} locked={locked} /> : null}</div>
		</div>
	)
}
