import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Eye, EyeOff, FileUp, Library, Plus, Trash2 } from "lucide-react"
import { Badge, Button, ConfirmDialog, Empty, IconButton, PageHeader, Pagination, Select } from "@/shared/components/ui"
import { DataTable, SelectionBar, Toolbar, useDebounced } from "@/shared/components/kit"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { CsvImportModal } from "../components/CsvImportModal"
import { QuestionEditor } from "../components/QuestionEditor"
import { StatusBadge } from "../components/bits"
import { DIFFICULTIES, M, P, QUESTION_TYPES, score, since, useMyOfferings } from "../components/lib"

const PAGE = 25

export default function QuestionBank() {
	const [params, setParams] = useSearchParams()
	const offerings = useMyOfferings("all")
	const courses = useMemo(() => {
		const seen = new Map()
		for (const o of offerings.data?.data || []) if (!seen.has(o.course)) seen.set(o.course, { course: o.course, title: o.course_title })
		return [...seen.values()].sort((a, b) => a.course.localeCompare(b.course))
	}, [offerings.data])
	const course = params.get("course") || courses[0]?.course || ""
	const courseTitle = courses.find((c) => c.course === course)?.title || ""

	const [search, setSearch] = useState("")
	const [type, setType] = useState("")
	const [topic, setTopic] = useState("")
	const [difficulty, setDifficulty] = useState("")
	const [active, setActive] = useState("1")
	const [page, setPage] = useState(1)
	const [selected, setSelected] = useState([])
	const [editing, setEditing] = useState(null)
	const [importing, setImporting] = useState(false)
	const [confirm, setConfirm] = useState(null)
	const [busy, setBusy] = useState(false)
	const s = useDebounced(search, 300)
	const invalidate = useInvalidate()

	useEffect(() => {
		setPage(1)
		setSelected([])
	}, [course, s, type, topic, difficulty, active])

	const q = useApi(
		M.questionBank,
		{ course, filters: { search: s, question_type: type, topic, difficulty, is_active: active }, start: (page - 1) * PAGE, page_length: PAGE },
		{ enabled: Boolean(course), placeholderData: (prev) => prev }
	)
	const rows = q.data?.data || []
	const topics = q.data?.topics || []

	const bulk = async (label, fn, names) => {
		setBusy(true)
		const failed = []
		for (const n of names) {
			try {
				await fn(n)
			} catch (e) {
				failed.push(`${n}: ${e.message}`)
			}
		}
		setBusy(false)
		setConfirm(null)
		setSelected([])
		invalidate(P.exam)
		const ok = names.length - failed.length
		if (ok) toast.success(`${ok} question${ok === 1 ? "" : "s"} ${label}`)
		if (failed.length) toast.error(failed.length === 1 ? failed[0] : `${failed.length} couldn't be ${label}. Questions used in exams can only be deactivated.`)
	}
	const setActiveMany = (names, on) => bulk(on ? "activated" : "deactivated", (n) => frappe.call(M.saveQuestion, { data: { name: n, is_active: on ? 1 : 0 } }), names)
	const deleteMany = (names) => bulk("deleted", (n) => frappe.call(M.deleteQuestion, { name: n }), names)

	if (offerings.isSuccess && !courses.length) {
		return (
			<div className="space-y-6">
				<PageHeader eyebrow="Assessment" title="Question bank" />
				<div className="card">
					<Empty icon={Library} title="No courses assigned" subtitle="The question bank is organised by course. You'll see it once you're assigned to teach one." />
				</div>
			</div>
		)
	}

	const usedIn = (r) => r.used_in?.length || 0
	const cols = [
		{
			key: "question_title",
			label: "Question",
			render: (r) => (
				<div className="min-w-0 max-w-xl">
					<div className={`line-clamp-2 ${r.is_active ? "text-ink" : "text-ink-soft line-through"}`}>{r.question_title}</div>
					<div className="mt-0.5 text-[11px] text-ink-soft">
						{r.name} · edited {since(r.modified)}
					</div>
				</div>
			),
			sortValue: (r) => r.question_title,
		},
		{ key: "question_type", label: "Type", render: (r) => <Badge tone={r.question_type === "Essay" ? "purple" : "gray"} size="xs">{r.question_type}</Badge>, sortValue: (r) => r.question_type },
		{ key: "topic", label: "Topic", render: (r) => r.topic || <span className="text-ink-soft">—</span>, sortValue: (r) => r.topic || "" },
		{ key: "difficulty", label: "Level", render: (r) => <StatusBadge kind="question" status={r.difficulty} size="xs" dot={false} />, sortValue: (r) => DIFFICULTIES.indexOf(r.difficulty) },
		{ key: "marks", label: "Marks", align: "right", render: (r) => score(r.marks), sortValue: (r) => r.marks },
		{
			key: "used_in",
			label: "Used",
			align: "right",
			render: (r) => (usedIn(r) ? <span title={r.used_in.join(", ")}>{usedIn(r)} exam{usedIn(r) === 1 ? "" : "s"}</span> : <span className="text-ink-soft">—</span>),
			sortValue: usedIn,
			exportValue: (r) => (r.used_in || []).join(" "),
		},
		{
			key: "act",
			label: "",
			sortable: false,
			export: false,
			hideOnMobile: true,
			render: (r) => (
				<div className="flex justify-end gap-1">
					<IconButton icon={r.is_active ? EyeOff : Eye} label={r.is_active ? "Deactivate" : "Activate"} onClick={() => setActiveMany([r.name], !r.is_active)} />
					{!usedIn(r) ? <IconButton icon={Trash2} label="Delete question" tone="danger" onClick={() => setConfirm({ names: [r.name], title: r.question_title })} /> : null}
				</div>
			),
		},
	]

	const selectedRows = rows.filter((r) => selected.includes(r.name))
	const deletable = selectedRows.filter((r) => !usedIn(r)).map((r) => r.name)

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Assessment"
				title="Question bank"
				subtitle="Questions belong to a course and can be reused across its exams and CATs, term after term."
				actions={
					<>
						<Button size="sm" variant="secondary" icon={FileUp} disabled={!course} onClick={() => setImporting(true)}>
							Import CSV
						</Button>
						<Button size="sm" icon={Plus} disabled={!course} onClick={() => setEditing({})}>
							New question
						</Button>
					</>
				}
			/>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<Select
					label="Course"
					className="sm:col-span-2 lg:col-span-1"
					value={course}
					onChange={(e) => setParams({ course: e.target.value }, { replace: true })}
					options={courses.map((c) => ({ value: c.course, label: `${c.course} · ${c.title}` }))}
					placeholder={offerings.isLoading ? "Loading…" : undefined}
				/>
				<Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={QUESTION_TYPES} placeholder="All types" />
				<Select label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} options={topics} placeholder="All topics" />
				<Select label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} options={DIFFICULTIES} placeholder="Any" />
				<Select
					label="Status"
					value={active}
					onChange={(e) => setActive(e.target.value)}
					options={[
						{ value: "1", label: "Active" },
						{ value: "0", label: "Inactive" },
					]}
					placeholder="All"
				/>
			</div>

			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search question text…"
				right={<span className="text-sm text-ink-soft">{q.data ? `${q.data.total} question${q.data.total === 1 ? "" : "s"}` : ""}</span>}
			/>

			<DataTable
				query={q}
				rows={q.data ? rows : undefined}
				cols={cols}
				onRow={(r) => setEditing({ name: r.name })}
				selectable
				selected={selected}
				onSelect={setSelected}
				empty={
					<Empty
						compact
						icon={Library}
						title={s || type || topic || difficulty ? "No questions match" : `No questions for ${course} yet`}
						subtitle="Write questions one by one or import many from a spreadsheet."
						action={
							<div className="flex flex-wrap justify-center gap-2">
								<Button size="sm" icon={Plus} onClick={() => setEditing({})}>
									New question
								</Button>
								<Button size="sm" variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>
									Import CSV
								</Button>
							</div>
						}
					/>
				}
				footer={q.data?.total > PAGE ? <Pagination page={page} pageSize={PAGE} total={q.data.total} onChange={setPage} /> : null}
			/>

			{selected.length ? (
				<SelectionBar count={selected.length} onClear={() => setSelected([])}>
					<Button size="sm" variant="secondary" icon={EyeOff} disabled={busy} onClick={() => setActiveMany(selected, false)}>
						Deactivate
					</Button>
					<Button size="sm" variant="secondary" icon={Eye} disabled={busy} onClick={() => setActiveMany(selected, true)}>
						Activate
					</Button>
					{deletable.length ? (
						<Button size="sm" variant="danger-soft" icon={Trash2} disabled={busy} onClick={() => setConfirm({ names: deletable })}>
							Delete {deletable.length}
						</Button>
					) : null}
				</SelectionBar>
			) : null}

			<QuestionEditor open={Boolean(editing)} onClose={() => setEditing(null)} course={course} name={editing?.name} topics={topics} />
			<CsvImportModal open={importing} onClose={() => setImporting(false)} course={course} courseTitle={courseTitle} />
			<ConfirmDialog
				open={Boolean(confirm)}
				onClose={() => setConfirm(null)}
				title={confirm?.names.length === 1 ? "Delete this question?" : `Delete ${confirm?.names.length} questions?`}
				message={confirm?.title ? `"${confirm.title}" will be removed permanently.` : "They will be removed permanently. Questions used in exams are skipped."}
				confirmLabel="Delete"
				tone="danger"
				loading={busy}
				onConfirm={() => deleteMany(confirm.names)}
			/>
		</div>
	)
}
