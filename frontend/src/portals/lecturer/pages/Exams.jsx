import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarClock, Library, NotebookPen, PenLine, Plus, Radio } from "lucide-react"
import { Alert, Button, Modal, PageHeader, StatCard } from "@/shared/components/ui"
import { Toolbar } from "@/shared/components/kit"
import { ExamsTable } from "../components/ExamsTable"
import { OfferingSelect } from "../components/bits"
import { useAcross } from "../components/useAcross"
import { M } from "../components/lib"

const CHIPS = [
	{ id: "", label: "All" },
	{ id: "live", label: "Open now" },
	{ id: "Scheduled", label: "Scheduled" },
	{ id: "Draft", label: "Drafts" },
	{ id: "mark", label: "To mark" },
	{ id: "done", label: "Closed & released" },
]
const MATCH = {
	live: (e) => e.status === "Open",
	Scheduled: (e) => e.status === "Scheduled",
	Draft: (e) => e.status === "Draft",
	mark: (e) => e.to_mark > 0 || e.status === "Marking",
	done: (e) => ["Closed", "Released"].includes(e.status),
}

export function NewExamModal({ open, onClose }) {
	const nav = useNavigate()
	const [offering, setOffering] = useState("")
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="sm"
			title="New exam"
			subtitle="Exams draw their questions from the course's question bank."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={!offering} onClick={() => nav(`/lecturer/exams/new?offering=${encodeURIComponent(offering)}`)}>
						Continue
					</Button>
				</>
			}
		>
			<OfferingSelect value={offering} onChange={setOffering} label="Which course is it for?" />
		</Modal>
	)
}

export default function Exams() {
	const nav = useNavigate()
	const q = useAcross(M.listExams, {})
	const [chip, setChip] = useState("")
	const [search, setSearch] = useState("")
	const [creating, setCreating] = useState(false)
	const rows = useMemo(() => q.data?.data || [], [q.data])
	const counts = useMemo(() => Object.fromEntries(CHIPS.map((c) => [c.id, c.id ? rows.filter(MATCH[c.id]).length : rows.length])), [rows])
	const term = search.trim().toLowerCase()
	const filtered = rows.filter((e) => (!chip || MATCH[chip](e)) && (!term || `${e.title} ${e.course_title} ${e.exam_type}`.toLowerCase().includes(term)))
	const toMark = rows.reduce((n, e) => n + (e.to_mark || 0), 0)

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Assessment"
				title="Exams & CATs"
				subtitle="Build online or in-person papers from your question bank, run them live and mark the answers."
				actions={
					<>
						<Button variant="secondary" size="sm" icon={Library} onClick={() => nav("/lecturer/question-bank")}>
							Question bank
						</Button>
						<Button size="sm" icon={Plus} onClick={() => setCreating(true)} disabled={!q.offerings.length}>
							New exam
						</Button>
					</>
				}
			/>
			{q.data?.failed?.length ? <Alert tone="warning">Some courses couldn't be loaded. Their exams are missing from this list.</Alert> : null}
			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
				<StatCard label="Open now" value={counts.live} tone={counts.live ? "green" : "brand"} icon={Radio} loading={q.isLoading} />
				<StatCard label="Scheduled" value={counts.Scheduled} tone="blue" icon={CalendarClock} loading={q.isLoading} />
				<StatCard label="Answers to mark" value={toMark} tone={toMark ? "orange" : "brand"} icon={PenLine} loading={q.isLoading} />
				<StatCard label="Drafts" value={counts.Draft} icon={NotebookPen} loading={q.isLoading} />
			</div>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search exams…"
				chips={CHIPS.map((c) => ({ ...c, count: counts[c.id] }))}
				active={chip}
				onChip={setChip}
			/>
			<ExamsTable
				query={q}
				rows={q.data ? filtered : undefined}
				showCourse
				empty={chip || term ? "No exams match" : "No exams yet this term"}
				emptyAction={
					!chip && !term ? (
						<Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
							Create your first exam
						</Button>
					) : null
				}
			/>
			<NewExamModal open={creating} onClose={() => setCreating(false)} />
		</div>
	)
}
