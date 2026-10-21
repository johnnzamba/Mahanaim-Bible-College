import { useState } from "react"
import clsx from "clsx"
import {
	ArrowLeft,
	BookX,
	Building2,
	CalendarClock,
	CalendarPlus,
	ClipboardCheck,
	DoorOpen,
	FileQuestion,
	FileText,
	GraduationCap,
	ScrollText,
	Send,
	X,
} from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Alert, Button, FileDrop, Input, Modal, Select, Textarea } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { IconChip } from "./bits"
import { API, INV, isoDate } from "./lib"

export const REQUEST_TYPES = [
	{ type: "Deferment", icon: CalendarClock, tone: "orange", blurb: "Pause your studies for a term or more and return later." },
	{ type: "Resumption", icon: CalendarPlus, tone: "green", blurb: "Return to class after a deferment." },
	{ type: "Withdrawal", icon: DoorOpen, tone: "red", blurb: "Leave the college permanently." },
	{ type: "Course Drop", icon: BookX, tone: "orange", blurb: "Drop a course you're enrolled in this term." },
	{ type: "Programme Transfer", icon: GraduationCap, tone: "purple", blurb: "Move to a different programme." },
	{ type: "Campus Transfer", icon: Building2, tone: "blue", blurb: "Continue your studies at another campus." },
	{ type: "Document Request", icon: FileText, tone: "brand", blurb: "Letters: introduction, bonafide student, fee status, recommendation…" },
	{ type: "Transcript Request", icon: ScrollText, tone: "gold", blurb: "A provisional or official academic transcript." },
	{ type: "Clearance", icon: ClipboardCheck, tone: "green", blurb: "Get cleared by the library, finance and other offices before you leave or graduate." },
	{ type: "Other", icon: FileQuestion, tone: "gray", blurb: "Anything else for the Registrar." },
]
export const typeMeta = (t) => REQUEST_TYPES.find((x) => x.type === t) || REQUEST_TYPES[REQUEST_TYPES.length - 1]

const DOCUMENTS = ["Letter of Introduction", "Bonafide Student Letter", "Fee Status Letter", "Recommendation Letter", "Attachment / Internship Letter", "Student ID Replacement"]
const DELIVERY = [
	{ value: "Collect", label: "Collect from the Registrar's office" },
	{ value: "Email", label: "Email (scanned copy)" },
	{ value: "Courier", label: "Courier (charges apply)" },
]
const REASON_HINT = {
	Deferment: "Explain why you need to defer (e.g. medical, financial, family, ministry posting).",
	Withdrawal: "Tell us why you're leaving. This helps us improve.",
	"Course Drop": "Why do you want to drop this course?",
	Clearance: "e.g. Completing my studies, graduation, transfer.",
}
const EMPTY = { from_date: "", to_date: "", new_programme: "", new_campus: "", course_enrolment: "", document_type: "", other_doc: "", copies: 1, delivery_method: "Collect", reason: "", attachment: "" }

/** Two-step "new request" dialog: pick a type, then a form driven by that type. Transcript requests are handed to `onTranscript`. */
export function RequestModal({ open, onClose, onTranscript, onCreated }) {
	const session = useSession()
	const st = session.student || {}
	const [type, setType] = useState(null)
	const [f, setF] = useState(EMPTY)
	const [uploading, setUploading] = useState(false)
	const lookups = useApi(API.lookups, {}, { guest: true, enabled: open && ["Programme Transfer", "Campus Transfer"].includes(type), staleTime: 3600_000 })
	const courses = useApi(API.enrolments, {}, { enabled: open && type === "Course Drop" })
	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
	const reset = () => (setType(null), setF(EMPTY))
	const close = () => (reset(), onClose())
	const act = useAction(API.createRequest, {
		invalidate: [INV.students],
		success: (r) => `Request ${r.name} submitted`,
		onSuccess: (r) => {
			close()
			onCreated?.(r)
		},
	})

	const pick = (t) => {
		if (t === "Transcript Request") {
			close()
			onTranscript?.()
			return
		}
		setType(t)
	}
	const upload = async (file) => {
		if (file.size > 10 * 1024 * 1024) return toast.error("Files must be 10 MB or smaller")
		setUploading(true)
		try {
			const r = await frappe.uploadFile(file, true)
			setF((x) => ({ ...x, attachment: r.file_url }))
		} catch (e) {
			toast.error(e.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const docType = f.document_type === "__other" ? f.other_doc.trim() : f.document_type
	const errors = {
		to_date: f.from_date && f.to_date && f.to_date < f.from_date ? "End date can't be before the start date" : null,
		new_programme: type === "Programme Transfer" && f.new_programme === st.programme ? "That's your current programme" : null,
		new_campus: type === "Campus Transfer" && f.new_campus === st.campus ? "You're already at this campus" : null,
	}
	const valid =
		type &&
		f.reason.trim().length >= 5 &&
		!Object.values(errors).some(Boolean) &&
		(type !== "Deferment" || (f.from_date && f.to_date)) &&
		(type !== "Resumption" || f.from_date) &&
		(type !== "Programme Transfer" || f.new_programme) &&
		(type !== "Campus Transfer" || f.new_campus) &&
		(type !== "Course Drop" || f.course_enrolment) &&
		(type !== "Document Request" || docType)

	const submit = () => {
		const data = { request_type: type, reason: f.reason.trim(), attachment: f.attachment || undefined }
		if (["Deferment", "Resumption"].includes(type)) data.from_date = f.from_date
		if (type === "Deferment") data.to_date = f.to_date
		if (type === "Programme Transfer") data.new_programme = f.new_programme
		if (type === "Campus Transfer") data.new_campus = f.new_campus
		if (type === "Course Drop") data.course_enrolment = f.course_enrolment
		if (type === "Document Request") Object.assign(data, { document_type: docType, copies: Number(f.copies) || 1, delivery_method: f.delivery_method })
		act.mutate({ data })
	}

	const meta = type ? typeMeta(type) : null
	const enrolled = (courses.data?.data || []).filter((c) => c.status === "Enrolled")
	return (
		<Modal
			open={open}
			onClose={close}
			size={type ? "md" : "lg"}
			title={type ? type : "New request"}
			subtitle={type ? meta.blurb : "What do you need help with?"}
			footer={
				type ? (
					<>
						<Button variant="ghost" icon={ArrowLeft} onClick={reset} className="mr-auto">
							Back
						</Button>
						<Button variant="secondary" onClick={close}>
							Cancel
						</Button>
						<Button icon={Send} disabled={!valid || uploading} loading={act.isPending} onClick={submit}>
							Submit request
						</Button>
					</>
				) : null
			}
		>
			{!type ? (
				<div className="grid gap-2 sm:grid-cols-2">
					{REQUEST_TYPES.map((t) => (
						<button key={t.type} type="button" onClick={() => pick(t.type)} className="flex items-start gap-3 rounded-xl border border-line p-3 text-left transition hover:border-brand-300 hover:bg-cream/60">
							<IconChip icon={t.icon} tone={t.tone} size={36} />
							<span className="min-w-0">
								<span className="block text-sm font-semibold text-ink">{t.type}</span>
								<span className="block text-xs leading-snug text-ink-soft">{t.blurb}</span>
							</span>
						</button>
					))}
				</div>
			) : (
				<div className="space-y-4">
					{type === "Withdrawal" ? (
						<Alert tone="error" title="This ends your studies">
							Once approved you'll need to clear with all offices, and you'll have to re-apply to return. Consider a deferment if you plan to come back.
						</Alert>
					) : null}
					{type === "Clearance" ? (
						<Alert tone="info">Each office (library, finance, dean of students…) will review and sign off. Track progress on this request.</Alert>
					) : null}
					{type === "Deferment" ? (
						<div className="grid grid-cols-2 gap-3">
							<Input type="date" label="From" required value={f.from_date} min={isoDate(new Date())} onChange={set("from_date")} />
							<Input type="date" label="Until" required value={f.to_date} min={f.from_date || undefined} onChange={set("to_date")} error={errors.to_date} />
						</div>
					) : null}
					{type === "Resumption" ? <Input type="date" label="Resume from" required value={f.from_date} onChange={set("from_date")} hint="Usually the first day of the coming term." /> : null}
					{type === "Programme Transfer" ? (
						<Select
							label="Transfer to"
							required
							value={f.new_programme}
							onChange={set("new_programme")}
							error={errors.new_programme}
							placeholder={lookups.isLoading ? "Loading programmes…" : "Choose a programme"}
							options={(lookups.data?.programmes || []).map((p) => ({ value: p.code, label: `${p.name} (${p.level})` }))}
							hint={st.programme_name ? `Currently: ${st.programme_name}` : null}
						/>
					) : null}
					{type === "Campus Transfer" ? (
						<Select
							label="Transfer to"
							required
							value={f.new_campus}
							onChange={set("new_campus")}
							error={errors.new_campus}
							placeholder={lookups.isLoading ? "Loading campuses…" : "Choose a campus"}
							options={(lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.town ? `${c.name} · ${c.town}` : c.name }))}
							hint={st.campus ? `Currently: ${st.campus}` : null}
						/>
					) : null}
					{type === "Course Drop" ? (
						enrolled.length || courses.isLoading ? (
							<Select
								label="Course to drop"
								required
								value={f.course_enrolment}
								onChange={set("course_enrolment")}
								placeholder={courses.isLoading ? "Loading your courses…" : "Choose a course"}
								options={enrolled.map((c) => ({ value: c.name, label: `${c.course_code} · ${c.course_title} (${c.term_label || c.academic_term})` }))}
								hint="Dropping may affect your fees and progression. Check with your HOD."
							/>
						) : (
							<Alert tone="warning">You have no enrolled courses to drop.</Alert>
						)
					) : null}
					{type === "Document Request" ? (
						<>
							<Select label="Document" required value={f.document_type} onChange={set("document_type")} placeholder="Choose a document" options={[...DOCUMENTS, { value: "__other", label: "Something else…" }]} />
							{f.document_type === "__other" ? <Input label="Describe the document" required value={f.other_doc} onChange={set("other_doc")} maxLength={140} /> : null}
							<div className="grid grid-cols-[6rem,1fr] gap-3">
								<Input type="number" label="Copies" min={1} max={10} value={f.copies} onChange={set("copies")} />
								<Select label="Delivery" value={f.delivery_method} onChange={set("delivery_method")} options={DELIVERY} />
							</div>
						</>
					) : null}
					<Textarea label="Reason" required rows={4} value={f.reason} onChange={set("reason")} hint={REASON_HINT[type] || "Give the Registrar enough detail to act on your request."} maxLength={2000} />
					<div>
						<FileDrop label="Supporting document (optional)" hint="PDF or image up to 10 MB, e.g. a medical note or sponsor letter." accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" busy={uploading} value={f.attachment} onFile={upload} />
						{f.attachment ? (
							<button type="button" className={clsx("mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-600")} onClick={() => setF((x) => ({ ...x, attachment: "" }))}>
								<X size={12} /> Remove attachment
							</button>
						) : null}
					</div>
				</div>
			)}
		</Modal>
	)
}
