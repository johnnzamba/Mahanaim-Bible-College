import { useMemo, useState } from "react"
import { Download, FileSpreadsheet, Upload } from "lucide-react"
import { Alert, Badge, Button, FileDrop, Modal } from "@/shared/components/ui"
import { DataTable, exportCsv } from "@/shared/components/kit"
import { useAction } from "@/shared/api/hooks"
import { M, P, QUESTION_TYPES } from "./lib"

const COLUMNS = [
	"question_type",
	"question",
	"marks",
	"topic",
	"difficulty",
	"option_a",
	"option_b",
	"option_c",
	"option_d",
	"option_e",
	"option_f",
	"correct",
	"pairs",
	"case_sensitive",
	"marking_guide",
	"explanation",
]
const MAX_ROWS = 500
const ALIASES = { mcq: "Multiple Choice", tf: "True or False", "true/false": "True or False" }

const SAMPLE = [
	{ question_type: "Multiple Choice", question: "Who wrote the epistle to the Romans?", marks: 1, topic: "Pauline epistles", difficulty: "Easy", option_a: "Peter", option_b: "Paul", option_c: "John", option_d: "James", correct: "B" },
	{ question_type: "Multiple Select", question: "Which of these are Gospels?", marks: 2, topic: "Canon", option_a: "Mark", option_b: "Acts", option_c: "Luke", correct: "A,C" },
	{ question_type: "True or False", question: "Hermeneutics is the study of interpretation.", marks: 1, correct: "True" },
	{ question_type: "Short Answer", question: "Name the first book of the Bible.", marks: 1, correct: "Genesis|Gen" },
	{ question_type: "Fill in the Blank", question: "The Sermon on the Mount is in Matthew chapters 5 to ___.", marks: 1, correct: "7|seven" },
	{ question_type: "Matching", question: "Match each book to its genre.", marks: 3, pairs: "Psalms=Poetry|Acts=History|Revelation=Apocalyptic" },
	{ question_type: "Essay", question: "Discuss the role of historical context in interpretation.", marks: 10, difficulty: "Hard", marking_guide: "Context defined (2); examples (4); application (4)" },
]

/** RFC 4180-ish parser: quoted fields, doubled quotes, CRLF, embedded newlines. */
export function parseCsv(text) {
	const rows = []
	let row = []
	let field = ""
	let quoted = false
	const s = String(text || "").replace(/^\ufeff/, "")
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (quoted) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					field += '"'
					i++
				} else quoted = false
			} else field += c
		} else if (c === '"') quoted = true
		else if (c === ",") {
			row.push(field)
			field = ""
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && s[i + 1] === "\n") i++
			row.push(field)
			rows.push(row)
			row = []
			field = ""
		} else field += c
	}
	if (field !== "" || row.length) {
		row.push(field)
		rows.push(row)
	}
	return rows.filter((r) => r.some((x) => String(x).trim() !== ""))
}

/** Client-side mirror of exams.question_from_row validation, so problems show before upload. */
function check(r) {
	const type = ALIASES[String(r.question_type || "").toLowerCase()] || r.question_type || "Multiple Choice"
	if (!QUESTION_TYPES.includes(type)) return `Unknown type "${r.question_type}"`
	if (!String(r.question || "").trim()) return "Question text is missing"
	if (r.marks && !(Number(r.marks) > 0)) return "Marks must be a positive number"
	const correct = String(r.correct || "").trim()
	if (type === "Multiple Choice" || type === "Multiple Select") {
		const letters = "ABCDEF".split("").filter((l) => String(r[`option_${l.toLowerCase()}`] || "").trim())
		if (letters.length < 2) return "Needs at least two options"
		const picked = correct.toUpperCase().split(/[,;]/).map((x) => x.trim()).filter(Boolean)
		if (!picked.length) return "Say which option is correct (e.g. B)"
		if (picked.some((p) => !letters.includes(p))) return `Correct "${correct}" doesn't match an option`
		if (type === "Multiple Choice" && picked.length !== 1) return "Multiple choice needs exactly one correct letter"
	}
	if (type === "True or False" && !/^(true|false|t|f|yes|no|1|0)$/i.test(correct)) return "Correct must be True or False"
	if ((type === "Short Answer" || type === "Fill in the Blank") && !correct.split("|").some((x) => x.trim())) return "Add accepted answers in 'correct' (separate with |)"
	if (type === "Matching" && String(r.pairs || "").split("|").filter((x) => x.includes("=")).length < 2) return "Add at least two pairs as left=right|left=right"
	return null
}

export function CsvImportModal({ open, onClose, course, courseTitle }) {
	const [rows, setRows] = useState(null)
	const [fileLabel, setFileLabel] = useState("")
	const [parseError, setParseError] = useState("")
	const [result, setResult] = useState(null)
	const imp = useAction(M.importQuestions, {
		invalidate: [P.exam],
		onSuccess: (r) => setResult(r),
	})

	const reset = () => {
		setRows(null)
		setFileLabel("")
		setParseError("")
		setResult(null)
	}
	const close = () => {
		reset()
		onClose()
	}

	const read = async (file) => {
		reset()
		setFileLabel(file.name)
		try {
			const text = await file.text()
			const grid = parseCsv(text)
			if (grid.length < 2) throw new Error("The file has no data rows.")
			const head = grid[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, "_"))
			if (!head.includes("question")) throw new Error("Missing a 'question' column. Download the template to see the expected headers.")
			const body = grid.slice(1).map((cells, i) => {
				const r = { _row: i + 1 }
				head.forEach((h, j) => {
					if (h) r[h] = (cells[j] ?? "").trim()
				})
				r._error = check(r)
				return r
			})
			if (body.length > MAX_ROWS) throw new Error(`Import at most ${MAX_ROWS} questions at a time (this file has ${body.length}).`)
			setRows(body)
		} catch (e) {
			setParseError(e.message || "Couldn't read that file")
		}
	}

	const bad = useMemo(() => (rows || []).filter((r) => r._error), [rows])
	const good = (rows || []).length - bad.length
	const serverErrors = result?.errors || []

	const run = () => {
		const payload = rows.filter((r) => !r._error).map(({ _row, _error, ...r }) => r)
		imp.mutate({ course, rows: payload })
	}

	const template = () =>
		exportCsv(
			"question-import-template",
			COLUMNS.map((c) => ({ key: c, label: c })),
			SAMPLE
		)

	return (
		<Modal
			open={open}
			onClose={close}
			size="xl"
			title="Import questions from CSV"
			subtitle={courseTitle ? `Into the ${course} question bank · ${courseTitle}` : `Into the ${course} question bank`}
			footer={
				result ? (
					<Button onClick={close}>Done</Button>
				) : (
					<>
						<Button variant="secondary" onClick={close}>
							Cancel
						</Button>
						<Button icon={Upload} onClick={run} loading={imp.isPending} disabled={!good}>
							Import {good ? `${good} question${good === 1 ? "" : "s"}` : ""}
						</Button>
					</>
				)
			}
		>
			<div className="space-y-4">
				{result ? (
					<>
						<Alert tone={result.failed ? "warning" : "success"} title={`${result.created} question${result.created === 1 ? "" : "s"} imported`}>
							{result.failed ? `${result.failed} row${result.failed === 1 ? "" : "s"} were rejected by the server. Fix them and import those rows again.` : "Every valid row was added to the bank."}
						</Alert>
						{serverErrors.length ? (
							<>
								<DataTable
									rowKey="row"
									rows={serverErrors}
									dense
									noCards
									maxHeight={280}
									cols={[
										{ key: "row", label: "Row", width: 70 },
										{ key: "error", label: "Problem", render: (e) => <span className="text-red-700 dark:text-red-300">{e.error}</span> },
									]}
								/>
								<Button
									size="sm"
									variant="secondary"
									icon={Download}
									onClick={() => {
										const sent = rows.filter((r) => !r._error)
										exportCsv(
											"question-import-errors",
											[{ key: "_problem", label: "problem" }, ...COLUMNS.map((c) => ({ key: c, label: c }))],
											serverErrors.map((e) => ({ ...sent[e.row - 1], _problem: e.error }))
										)
									}}
								>
									Download rejected rows
								</Button>
							</>
						) : null}
					</>
				) : (
					<>
						<div className="flex flex-col gap-3 rounded-xl border border-line bg-cream/60 p-4 text-sm sm:flex-row sm:items-center">
							<FileSpreadsheet size={22} className="shrink-0 text-gold-700" />
							<div className="min-w-0 flex-1 text-ink-muted">
								One question per row. <b className="text-ink">correct</b> takes option letters (<code>B</code> or <code>A,C</code>), <code>True</code>/<code>False</code>, or accepted answers separated by <code>|</code>. Matching uses <b className="text-ink">pairs</b> like <code>left=right|left=right</code>.
							</div>
							<Button size="sm" variant="secondary" icon={Download} onClick={template}>
								Template
							</Button>
						</div>
						<FileDrop label="CSV file" accept=".csv,text/csv" onFile={read} value={fileLabel} hint="Save from Excel or Google Sheets as CSV (UTF-8)." />
						{parseError ? <Alert tone="error">{parseError}</Alert> : null}
						{rows ? (
							<>
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<Badge tone="green">{good} ready</Badge>
									{bad.length ? <Badge tone="red">{bad.length} with problems (skipped)</Badge> : null}
									{bad.length ? (
										<button
											type="button"
											className="link text-xs"
											onClick={() =>
												exportCsv(
													"question-import-problems",
													[{ key: "_row", label: "row" }, { key: "_error", label: "problem" }, ...COLUMNS.map((c) => ({ key: c, label: c }))],
													bad
												)
											}
										>
											Download problem rows
										</button>
									) : null}
								</div>
								<DataTable
									rowKey="_row"
									rows={rows}
									dense
									noCards
									maxHeight={340}
									cols={[
										{ key: "_row", label: "#", width: 50 },
										{ key: "question_type", label: "Type", render: (r) => ALIASES[String(r.question_type || "").toLowerCase()] || r.question_type || "Multiple Choice" },
										{ key: "question", label: "Question", render: (r) => <span className="line-clamp-2 max-w-md">{r.question}</span> },
										{ key: "marks", label: "Marks", align: "right", render: (r) => r.marks || 1 },
										{ key: "correct", label: "Answer", render: (r) => <span className="line-clamp-1 max-w-[12rem]">{r.correct || r.pairs || "—"}</span> },
										{
											key: "_error",
											label: "Check",
											render: (r) => (r._error ? <span className="text-xs font-semibold text-red-700 dark:text-red-300">{r._error}</span> : <Badge tone="green">OK</Badge>),
										},
									]}
								/>
							</>
						) : null}
					</>
				)}
			</div>
		</Modal>
	)
}
