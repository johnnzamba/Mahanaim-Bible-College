import { useState } from "react"
import { Download, Mail, MessageSquare, Users } from "lucide-react"
import { AvatarCell, Badge, Button } from "@/shared/components/ui"
import { DataTable, ExportButton, SearchInput, SelectionBar, useDebounced } from "@/shared/components/kit"
import { frappe } from "@/shared/api/frappe"
import { pct } from "@/shared/utils/format"
import { MessageClassModal } from "../MessageClassModal"
import { M, download, pctTone, score } from "../lib"

export default function StudentsTab({ data: d, offering }) {
	const [search, setSearch] = useState("")
	const [selected, setSelected] = useState([])
	const [message, setMessage] = useState(null)
	const s = useDebounced(search).toLowerCase()
	const roster = (d.roster || []).filter((r) => !s || `${r.full_name} ${r.student_number} ${r.email}`.toLowerCase().includes(s))
	const title = `${d.offering?.course} · ${d.offering?.course_title}`

	const cols = [
		{ key: "full_name", label: "Student", render: (r) => <AvatarCell name={r.full_name} sub={r.student_number} image={r.photo} size={34} />, exportValue: (r) => r.full_name },
		{ key: "student_number", label: "Number", hideOnMobile: true, className: "hidden xl:table-cell" },
		{
			key: "email",
			label: "Contact",
			hideOnMobile: true,
			render: (r) => (
				<div className="text-xs">
					{r.email ? (
						<a href={`mailto:${r.email}`} className="link" onClick={(e) => e.stopPropagation()}>
							{r.email}
						</a>
					) : null}
					<div className="text-ink-soft">{r.phone || ""}</div>
				</div>
			),
		},
		{ key: "programme", label: "Programme", hideOnMobile: true },
		{
			key: "attendance_percentage",
			label: "Attendance",
			align: "right",
			render: (r) => (r.sessions_held ? <Badge tone={pctTone(r.attendance_percentage)}>{pct(r.attendance_percentage)}</Badge> : <span className="text-ink-soft">—</span>),
		},
		{ key: "cat_average", label: "CAT avg", align: "right", render: (r) => score(r.cat_average, 1), hideOnMobile: true },
		{ key: "assignment_average", label: "Assign. avg", align: "right", render: (r) => score(r.assignment_average, 1), hideOnMobile: true },
		{ key: "final_grade", label: "Grade", align: "right", render: (r) => (r.final_grade ? <b>{r.final_grade}</b> : "—") },
		{
			key: "fee_cleared",
			label: "Fees",
			sortValue: (r) => (r.fee_cleared ? 1 : 0),
			exportValue: (r) => (r.fee_cleared ? "Cleared" : "Not cleared"),
			render: (r) => (
				<span title={r.fee_message || ""}>
					<Badge tone={r.fee_cleared ? "green" : "orange"} size="xs">
						{r.fee_cleared ? "Cleared" : "Not cleared"}
					</Badge>
				</span>
			),
		},
		{ key: "enrolment_status", label: "Status", hideOnMobile: true, render: (r) => <Badge status={r.enrolment_status} size="xs" /> },
	]

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<SearchInput value={search} onChange={setSearch} placeholder="Search students…" className="w-full sm:max-w-xs" />
				<div className="flex flex-wrap gap-2 sm:ml-auto">
					<ExportButton filename={`${d.offering?.course}-students`} cols={cols} rows={roster} />
					<Button size="sm" variant="secondary" icon={Download} onClick={() => download(frappe.downloadUrl(M.rosterCsv, { offering }))}>
						Roster CSV
					</Button>
					<Button size="sm" icon={MessageSquare} onClick={() => setMessage({ students: null })} disabled={!d.roster?.length}>
						Message class
					</Button>
				</div>
			</div>
			<DataTable
				rowKey="student"
				rows={roster}
				cols={cols}
				selectable
				selected={selected}
				onSelect={setSelected}
				pageSize={25}
				empty={search ? "No student matches your search" : "No students enrolled yet"}
				emptyIcon={Users}
			/>
			<SelectionBar count={selected.length} onClear={() => setSelected([])}>
				<Button size="sm" icon={Mail} onClick={() => setMessage({ students: (d.roster || []).filter((r) => selected.includes(r.student)) })}>
					Message
				</Button>
			</SelectionBar>
			<MessageClassModal open={Boolean(message)} onClose={() => setMessage(null)} offering={offering} title={title} students={message?.students} />
		</div>
	)
}
