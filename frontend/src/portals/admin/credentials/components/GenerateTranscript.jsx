import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Alert, Button, Modal, Select } from "@/shared/components/ui"
import { API, StudentPicker, TERM_HINT, TRANSCRIPT_TYPES, TermSelect, useLookups } from "../lib"

/**
 * Draft transcript for a student (generate_transcript, Registrar). With `request`, the student and type come
 * from a Student Request and the draft is linked back to it.
 */
export default function GenerateTranscript({ open, onClose, request, student: fixedStudent }) {
	const navigate = useNavigate()
	const L = useLookups().data || {}
	const [student, setStudent] = useState(null)
	const [type, setType] = useState("Official")
	const [term, setTerm] = useState("")

	useEffect(() => {
		if (!open) return
		const reqType = String(request?.document_type || "").split(" ")[0]
		setType(TRANSCRIPT_TYPES.includes(reqType) ? reqType : "Official")
		setTerm(request?.academic_term || "")
		setStudent(
			fixedStudent ||
				(request ? { name: request.student, full_name: request.student_name, student_number: request.student, status: null } : null)
		)
	}, [open, request, fixedStudent])

	const gen = useAction(`${API}generate_transcript`, {
		invalidate: [API, "mahanaim.api.students.list_requests", "mahanaim.api.students.get_request"],
		success: (r) => `Draft transcript ${r.name} created`,
		onSuccess: (r) => {
			onClose()
			navigate(`/admin/credentials/transcripts/${encodeURIComponent(r.name)}`)
		},
	})

	const locked = Boolean(request || fixedStudent)
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Generate transcript"
			subtitle={request ? `For request ${request.name}` : "Creates a draft from the student's published results"}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={gen.isPending}>
						Cancel
					</Button>
					<Button icon={FileText} loading={gen.isPending} disabled={!student} onClick={() => gen.mutate({ student: student.name, type, as_of_term: term || undefined, request: request?.name })}>
						Generate draft
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{locked && student ? (
					<div className="rounded-xl border border-line bg-cream px-3 py-2">
						<div className="text-sm font-semibold text-ink">{student.full_name || student.name}</div>
						<div className="text-xs text-ink-soft">{[student.student_number, student.programme_name].filter(Boolean).join(" · ") || student.name}</div>
					</div>
				) : (
					<StudentPicker value={student} onChange={setStudent} required />
				)}
				<div className="grid gap-3 sm:grid-cols-2">
					<Select label="Transcript type" required value={type} onChange={(e) => setType(e.target.value)} options={TRANSCRIPT_TYPES} hint={type === "Provisional" ? "For students still studying" : type === "Final" ? "After completion" : "Standard academic record"} />
					<TermSelect L={L} value={term} onChange={setTerm} hint={TERM_HINT} />
				</div>
				<Alert tone="info">The draft takes a snapshot of published results now. You can refresh it while it is a draft, and the fee check runs when it is issued.</Alert>
			</div>
		</Modal>
	)
}
