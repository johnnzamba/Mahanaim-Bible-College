import { useState } from "react"
import { Link } from "react-router-dom"
import { Library, Plus } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Toolbar } from "@/shared/components/kit"
import { ExamsTable } from "../ExamsTable"
import { M } from "../lib"

const FILTERS = ["", "Draft", "Scheduled", "Open", "Closed", "Marking", "Released", "Cancelled"]

export default function ExamsTab({ offering, data: d }) {
	const [status, setStatus] = useState("")
	const q = useApi(M.listExams, { offering })
	const all = q.data?.data || []
	const counts = all.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] || 0) + 1 }), {})
	const rows = all.filter((e) => !status || e.status === status)
	const course = d?.offering?.course

	return (
		<div>
			<Toolbar
				chips={FILTERS.filter((f) => !f || counts[f]).map((f) => ({ id: f, label: f || "All", count: f ? counts[f] : all.length }))}
				active={status}
				onChip={setStatus}
				right={
					<>
						<Link to={`/lecturer/question-bank${course ? `?course=${encodeURIComponent(course)}` : ""}`} className="btn btn-secondary btn-sm">
							<Library size={14} /> Question bank
						</Link>
						<Link to={`/lecturer/exams/new?offering=${encodeURIComponent(offering)}`} className="btn btn-primary btn-sm">
							<Plus size={14} /> New exam
						</Link>
					</>
				}
			/>
			<ExamsTable
				query={q}
				rows={q.isSuccess ? rows : undefined}
				empty={status ? `No ${status.toLowerCase()} exams` : "No exams yet"}
				emptyAction={
					<Link to={`/lecturer/exams/new?offering=${encodeURIComponent(offering)}`} className="btn btn-primary btn-sm">
						<Plus size={14} /> Build an exam
					</Link>
				}
			/>
		</div>
	)
}
