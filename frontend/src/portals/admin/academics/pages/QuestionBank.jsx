import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { BookOpen, FileQuestion, Library, Plus, Upload } from "lucide-react"
import { Alert, Badge, Button, FileDrop, Modal, PageHeader, Pagination, Panel, Select, StatCard } from "@/shared/components/ui"
import { DataTable, Toolbar, exportCsv, useDebounced } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { ACAD, BASE, DIFFICULTY, EXAMS, PAGE, QUESTION_TYPES, fmtScore, parseCsv, rowsOf } from "../lib"
import { SubNav } from "../components/common"
import { CoursePicker } from "../components/CoursePicker"
import { QuestionEditor } from "../components/QuestionEditor"

const DIFF_TONE = { Easy: "green", Medium: "orange", Hard: "red" }
const TYPE_SHORT = {
	"Multiple Choice": "MCQ",
	"Multiple Select": "Multi-select",
	"True or False": "True/False",
	"Short Answer": "Short answer",
	"Fill in the Blank": "Fill blank",
	Essay: "Essay",
	Matching: "Matching",
}

const TEMPLATE_COLS = ["question_type", "question", "marks", "topic", "difficulty", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "correct", "pairs", "case_sensitive", "marking_guide", "explanation"]
const TEMPLATE_ROWS = [
	{ question_type: "Multiple Choice", question: "Who led Israel out of Egypt?", marks: 1, topic: "Pentateuch", difficulty: "Easy", option_a: "Moses", option_b: "Aaron", option_c: "Joshua", correct: "A" },
	{ question_type: "Multiple Select", question: "Which of these are Gospels?", marks: 2, topic: "Gospels", difficulty: "Medium", option_a: "Matthew", option_b: "Acts", option_c: "John", correct: "A,C" },
	{ question_type: "True or False", question: "Paul wrote the letter to the Romans.", marks: 1, topic: "Epistles", correct: "True" },
	{ question_type: "Short Answer", question: "In which city was Jesus born?", marks: 1, correct: "Bethlehem|Bethlehem of Judea", case_sensitive: 0 },
	{ question_type: "Fill in the Blank", question: "In the beginning God created the heavens and the ____.", marks: 1, correct: "earth" },
	{ question_type: "Matching", question: "Match each book to its theme.", marks: 3, pairs: "Genesis=Creation|Exodus=Deliverance|Acts=Early church" },
	{ question_type: "Essay", question: "Discuss the covenant theme in Genesis.", marks: 10, difficulty: "Hard", marking_guide: "Abrahamic covenant, promises, signs" },
]

function rowProblems(r) {
	const p = []
	const type = (r.question_type || "Multiple Choice").toLowerCase()
	if (!r.question) p.push("no question text")
	if (r.marks && !(Number(r.marks) > 0)) p.push("marks must be > 0")
	if (["multiple choice", "mcq", "multiple select"].includes(type)) {
		if (!r.option_a || !r.option_b) p.push("needs option_a and option_b")
		if (!r.correct) p.push("no correct letter")
	} else if (["true or false", "tf", "true/false", "short answer", "fill in the blank"].includes(type)) {
		if (!r.correct) p.push("no correct answer")
	} else if (type === "matching") {
		if ((r.pairs || "").split("|").filter((x) => x.includes("=")).length < 2) p.push("needs 2+ pairs")
	} else if (type !== "essay") p.push(`unknown type "${r.question_type}"`)
	return p
}

function ImportModal({ open, onClose, course }) {
	const [file, setFile] = useState(null)
	const [rows, setRows] = useState([])
	const [result, setResult] = useState(null)
	const imp = useAction(`${EXAMS}import_questions`, {
		invalidate: [`${EXAMS}question_bank`],
		success: false,
		onSuccess: (r) => setResult(r),
	})
	const close = () => {
		setFile(null)
		setRows([])
		setResult(null)
		onClose()
	}
	const read = (f) => {
		setResult(null)
		setFile(f.name)
		f.text().then((t) => setRows(parseCsv(t)))
	}
	const checked = rows.map((r, i) => ({ ...r, _row: i + 1, _problems: rowProblems(r) }))
	const bad = checked.filter((r) => r._problems.length).length
	return (
		<Modal
			open={open}
			onClose={close}
			size="xl"
			title="Import questions from CSV"
			subtitle={`Into the ${course} bank. Valid rows are kept; rows with errors are reported back.`}
			footer={
				result ? (
					<Button onClick={close}>Done</Button>
				) : (
					<>
						<Button variant="secondary" onClick={close}>
							Cancel
						</Button>
						<Button icon={Upload} loading={imp.isPending} disabled={!rows.length || rows.length > 500} onClick={() => imp.mutate({ course, rows })}>
							Import {rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
						</Button>
					</>
				)
			}
		>
			{result ? (
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<StatCard label="Created" value={result.created} tone="green" icon={FileQuestion} />
						<StatCard label="Failed" value={result.failed} tone={result.failed ? "red" : "gray"} icon={FileQuestion} />
					</div>
					{result.errors?.length ? (
						<DataTable
							dense
							noCards
							maxHeight={260}
							rowKey={(r) => r.row}
							rows={result.errors}
							cols={[
								{ key: "row", label: "Row", render: (r) => r.row },
								{ key: "error", label: "Error", render: (r) => <span className="text-red-700 dark:text-red-300">{plainText(r.error)}</span> },
							]}
						/>
					) : null}
				</div>
			) : (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream/60 px-3 py-2 text-xs text-ink-muted dark:bg-white/5">
						<span>
							<b>correct</b>: option letters (<code>B</code> or <code>A,C</code>), <code>True</code>/<code>False</code>, or accepted answers split by <code>|</code>. <b>pairs</b>: <code>left=right|left=right</code>.
						</span>
						<button
							type="button"
							className="font-semibold text-brand-700 hover:underline"
							onClick={() =>
								exportCsv(
									"question-import-template",
									TEMPLATE_COLS.map((k) => ({ key: k, label: k })),
									TEMPLATE_ROWS
								)
							}
						>
							Download template
						</button>
					</div>
					<FileDrop label="CSV file" accept=".csv,text/csv" onFile={read} value={file} hint="Up to 500 rows. First row must be the column headers." />
					{rows.length > 500 ? <Alert tone="error">This file has {rows.length} rows; import at most 500 at a time.</Alert> : null}
					{rows.length ? (
						<>
							{bad ? (
								<Alert tone="warning" title={`${bad} row${bad === 1 ? "" : "s"} look incomplete`}>
									They will be reported back as failed; the rest still import.
								</Alert>
							) : null}
							<DataTable
								dense
								noCards
								maxHeight={300}
								rowKey={(r) => r._row}
								rows={checked}
								cols={[
									{ key: "_row", label: "#", render: (r) => r._row },
									{ key: "question_type", label: "Type", render: (r) => r.question_type || "Multiple Choice" },
									{ key: "question", label: "Question", render: (r) => <span className="line-clamp-2">{r.question || "—"}</span> },
									{ key: "marks", label: "Marks", align: "right", render: (r) => r.marks || 1 },
									{
										key: "_problems",
										label: "Check",
										render: (r) => (r._problems.length ? <span className="text-xs text-red-700 dark:text-red-300">{r._problems.join("; ")}</span> : <Badge tone="green" size="xs">OK</Badge>),
									},
								]}
							/>
						</>
					) : null}
				</div>
			)}
		</Modal>
	)
}

function ChooseCourse({ onPick }) {
	return (
		<Panel title="Choose a course" subtitle="Each course keeps its own bank of questions that exams draw from" icon={Library}>
			<CoursePicker onPick={(c) => onPick(c.name)} activeOnly={false} autoFocus maxHeight={420} />
		</Panel>
	)
}

export default function QuestionBank() {
	const [params, setParams] = useSearchParams()
	const course = params.get("course") || ""
	const [search, setSearch] = useState("")
	const debounced = useDebounced(search)
	const [type, setType] = useState("")
	const [difficulty, setDifficulty] = useState("")
	const [topic, setTopic] = useState("")
	const [active, setActive] = useState("1")
	const [page, setPage] = useState(1)
	const [editing, setEditing] = useState(null)
	const [importing, setImporting] = useState(false)
	const [changing, setChanging] = useState(false)

	const pick = (c) => {
		setPage(1)
		setTopic("")
		setChanging(false)
		setParams({ course: c }, { replace: false })
	}
	const courseQ = useApi(`${ACAD}get_course`, { code: course }, { enabled: Boolean(course) })
	const filters = useMemo(() => ({ question_type: type, topic, difficulty, is_active: active === "all" ? "" : active, search: debounced.trim() }), [type, topic, difficulty, active, debounced])
	const q = useApi(`${EXAMS}question_bank`, { course, filters, start: (page - 1) * PAGE, page_length: PAGE }, { enabled: Boolean(course), placeholderData: keepPreviousData })
	const allQ = useApi(`${EXAMS}question_bank`, { course, filters: {}, start: 0, page_length: 1 }, { enabled: Boolean(course) })
	const rows = rowsOf(q.data)
	const topics = q.data?.topics || allQ.data?.topics || []
	const resetPage = (fn) => (v) => {
		setPage(1)
		fn(v?.target ? v.target.value : v)
	}

	const cols = [
		{
			key: "question_title",
			label: "Question",
			render: (r) => (
				<div className="min-w-0 max-w-xl">
					<div className="line-clamp-2 font-medium text-ink">{r.question_title}</div>
					<div className="mt-0.5 text-xs text-ink-soft">
						{r.name}
						{r.used_in?.length ? ` · in ${r.used_in.length} exam${r.used_in.length === 1 ? "" : "s"}` : ""}
					</div>
				</div>
			),
		},
		{ key: "question_type", label: "Type", render: (r) => <Badge tone="blue" size="xs">{TYPE_SHORT[r.question_type] || r.question_type}</Badge> },
		{ key: "topic", label: "Topic", hideOnMobile: true, render: (r) => r.topic || <span className="text-ink-soft">—</span> },
		{ key: "difficulty", label: "Difficulty", hideOnMobile: true, render: (r) => (r.difficulty ? <Badge tone={DIFF_TONE[r.difficulty]} size="xs">{r.difficulty}</Badge> : "—") },
		{ key: "marks", label: "Marks", align: "right", render: (r) => fmtScore(r.marks, 2), sortValue: (r) => Number(r.marks || 0) },
		{ key: "is_active", label: "Status", render: (r) => <Badge tone={r.is_active ? "green" : "gray"} size="xs">{r.is_active ? "Active" : "Inactive"}</Badge> },
	]

	const c = courseQ.data
	return (
		<div>
			<PageHeader
				eyebrow="Academics"
				title="Question bank"
				subtitle={course ? (c ? `${c.course_code} · ${c.course_title}` : course) : "Reusable exam questions, per course"}
				actions={
					course ? (
						<>
							<Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
								Change course
							</Button>
							<Button variant="secondary" size="sm" icon={Upload} onClick={() => setImporting(true)}>
								Import CSV
							</Button>
							<Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
								New question
							</Button>
						</>
					) : null
				}
			/>
			<SubNav group="exams" />
			{!course ? (
				<ChooseCourse onPick={pick} />
			) : (
				<>
					<div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
						<StatCard label="In bank" value={allQ.data?.total ?? "—"} icon={FileQuestion} loading={allQ.isLoading} />
						<StatCard label="Shown" value={q.data?.total ?? "—"} icon={FileQuestion} tone="blue" loading={q.isLoading} />
						<StatCard label="Topics" value={topics.length} icon={BookOpen} tone="purple" loading={allQ.isLoading} />
						<StatCard label="Course" value={<span className="text-lg sm:text-[1.45rem]">{c?.course_code || course}</span>} hint={c ? `${fmtScore(c.credits)} credits` : undefined} icon={Library} tone="gold" to={`${BASE}/courses/${encodeURIComponent(course)}`} />
					</div>
					<Toolbar
						search={search}
						onSearch={resetPage(setSearch)}
						placeholder="Search question text…"
						chips={[
							{ id: "1", label: "Active" },
							{ id: "0", label: "Inactive" },
							{ id: "all", label: "All" },
						]}
						active={active}
						onChip={resetPage(setActive)}
						className="!mb-3"
					/>
					<div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
						<Select aria-label="Type" value={type} onChange={resetPage(setType)} options={QUESTION_TYPES} placeholder="All types" />
						<Select aria-label="Difficulty" value={difficulty} onChange={resetPage(setDifficulty)} options={DIFFICULTY} placeholder="Any difficulty" />
						<Select aria-label="Topic" value={topic} onChange={resetPage(setTopic)} options={topics} placeholder="All topics" className="col-span-2 sm:col-span-1" />
					</div>
					<DataTable
						cols={cols}
						rows={q.isLoading || q.isError ? undefined : rows}
						query={q}
						rowKey={(r) => r.name}
						onRow={(r) => setEditing(r.name)}
						emptyIcon={FileQuestion}
						empty={allQ.data?.total ? "No questions match these filters" : "This bank is empty"}
						emptyAction={
							<div className="flex gap-2">
								<Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
									Add a question
								</Button>
								<Button size="sm" variant="secondary" icon={Upload} onClick={() => setImporting(true)}>
									Import CSV
								</Button>
							</div>
						}
					/>
					<Pagination page={page} pageSize={PAGE} total={q.data?.total || 0} onChange={setPage} className="mt-3" />
					<p className="mt-4 text-xs text-ink-soft">
						Exams are built from this bank by the course lecturer.{" "}
						<Link to={`${BASE}/exams`} className="font-semibold text-brand-700 hover:underline">
							See exams
						</Link>
					</p>
				</>
			)}
			<QuestionEditor open={Boolean(editing)} onClose={() => setEditing(null)} course={course} question={editing === "new" ? null : editing} topics={topics} />
			<ImportModal open={importing} onClose={() => setImporting(false)} course={course} />
			<Modal open={changing} onClose={() => setChanging(false)} title="Change course" size="lg">
				<CoursePicker onPick={(x) => pick(x.name)} selected={[course]} activeOnly={false} autoFocus maxHeight={360} />
			</Modal>
		</div>
	)
}
