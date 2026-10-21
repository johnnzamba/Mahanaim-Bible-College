import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
	AlertTriangle,
	BadgeCheck,
	CalendarClock,
	CheckCircle2,
	Eye,
	FileText,
	Gavel,
	GraduationCap,
	HandCoins,
	Mail,
	MapPin,
	Phone,
	PlayCircle,
	ExternalLink,
	UserPlus,
	Users,
} from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"
import {
	Alert,
	Avatar,
	Badge,
	Button,
	ConfirmDialog,
	Empty,
	InfoRow,
	Input,
	KeyValueGrid,
	Modal,
	PageHeader,
	Panel,
	SkeletonRows,
	Tabs,
	Textarea,
	ErrorState,
} from "@/shared/components/ui"
import { DataTable, DownloadLink, Timeline } from "@/shared/components/kit"
import { date, dateTime, money } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { API, CAN, FeeBadge, kv, NoAccess, REQUIRED_DOCUMENTS, StatusBadge, fileName, isImage, isPdf, isPermissionError } from "../lib"
import DecisionModal from "../components/DecisionModal"

const DECISIONS = ["Admitted", "Waitlisted", "Rejected"]
const MATCH_LABEL = { email: "email", national_id: "ID number", phone: "phone" }

const NEXT_STEP = {
	Draft: "The applicant is still completing the form. Nothing to do yet.",
	Submitted: "Check the documents, then start the review.",
	"Under Review": "Schedule an interview or record a decision.",
	Interview: "Hold the interview, then record a decision.",
	Waitlisted: "Admit or reject when a place is confirmed.",
	Admitted: "Waiting for the applicant to accept the offer. You can create the student record now.",
	Accepted: "The applicant accepted. Make sure the student record exists.",
	Rejected: "This application is closed.",
	Declined: "The applicant declined the offer.",
	Withdrawn: "The applicant withdrew this application.",
}

const localInputNow = () => {
	const d = new Date(Date.now() + 60 * 60 * 1000)
	d.setMinutes(0, 0, 0)
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function ApplicationDetail() {
	const { name } = useParams()
	const q = useApi(`${API}get_application`, { name })
	if (q.isLoading) {
		return (
			<>
				<PageHeader title="Loading application…" back={{ to: "/admin/admissions", label: "Applications" }} />
				<Panel>
					<SkeletonRows rows={8} />
				</Panel>
			</>
		)
	}
	if (isPermissionError(q.error)) return <NoAccess message="Only admissions staff, the registrar, the academic dean and finance can open applications." />
	if (q.isError) {
		return (
			<>
				<PageHeader title="Application" back={{ to: "/admin/admissions", label: "Applications" }} />
				<Panel>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Panel>
			</>
		)
	}
	return <Application app={q.data} />
}

function Application({ app }) {
	const { hasRole } = useSession()
	const canReview = hasRole(...CAN.review)
	const canWaive = hasRole(...CAN.waive)
	const canConvert = hasRole(...CAN.convert)
	const canOpenStudent = hasRole(ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE)
	const [tab, setTab] = useState("personal")
	const [dialog, setDialog] = useState(null)
	const allowed = app.allowed_transitions || []
	const decisions = DECISIONS.filter((d) => allowed.includes(d))
	const feeOpen = Number(app.application_fee) > 0 && ["Unpaid", "Pending"].includes(app.fee_status)

	const missingDocs = useMemo(() => {
		const have = new Set((app.documents || []).filter((d) => d.file).map((d) => d.document_type))
		if (app.photo) have.add("Passport Photo")
		return REQUIRED_DOCUMENTS.filter((group) => !group.some((t) => have.has(t))).map((g) => g.join(" or "))
	}, [app])

	const duplicates = (app.duplicates || []).filter((d) => !(d.doctype === "Student" && d.name === app.student))
	const close = () => setDialog(null)
	const tabs = [
		{ id: "personal", label: "Personal" },
		{ id: "academic", label: "Academic" },
		{ id: "documents", label: missingDocs.length ? `Documents · ${missingDocs.length} missing` : "Documents", count: (app.documents || []).length },
		{ id: "payments", label: "Payments" },
		{ id: "review", label: "Review" },
		{ id: "history", label: "History", count: (app.status_log || []).length },
	]

	const actions = []
	if (canReview && allowed.includes("Under Review"))
		actions.push(
			<Button key="review" icon={PlayCircle} onClick={() => setDialog("review")} disabled={app.awaiting_fee} title={app.awaiting_fee ? "The application fee must be paid or waived first" : undefined}>
				Start review
			</Button>
		)
	if (canReview && (allowed.includes("Interview") || app.status === "Interview"))
		actions.push(
			<Button key="interview" variant={app.status === "Interview" ? "secondary" : "primary"} icon={CalendarClock} onClick={() => setDialog("interview")}>
				{app.status === "Interview" ? "Reschedule interview" : "Schedule interview"}
			</Button>
		)
	if (canReview && decisions.length)
		actions.push(
			<Button key="decide" variant={app.status === "Interview" || app.status === "Waitlisted" ? "primary" : "secondary"} icon={Gavel} onClick={() => setDialog("decide")}>
				Record decision
			</Button>
		)
	if (app.letter_available)
		actions.push(
			<Button key="letter" variant="secondary" icon={FileText} onClick={() => setDialog("letter")}>
				Admission letter
			</Button>
		)
	if (canConvert && ["Admitted", "Accepted"].includes(app.status) && !app.student)
		actions.push(
			<Button key="convert" icon={UserPlus} onClick={() => setDialog("convert")}>
				Create student record
			</Button>
		)
	if (canWaive && feeOpen && !["Rejected", "Withdrawn", "Declined"].includes(app.status))
		actions.push(
			<Button key="waive" variant="ghost" icon={HandCoins} onClick={() => setDialog("waive")}>
				Waive fee
			</Button>
		)

	return (
		<>
			<PageHeader
				back={{ to: "/admin/admissions", label: "Applications" }}
				eyebrow={app.name}
				title={app.full_name || "Unnamed applicant"}
				actions={actions.length ? actions : null}
			>
				<div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
					<StatusBadge status={app.status} />
					<FeeBadge status={app.fee_status} awaiting={app.awaiting_fee} size="sm" />
					<span className="inline-flex items-center gap-1">
						<GraduationCap size={14} /> {app.programme_info?.programme_name || app.programme_name || app.programme}
					</span>
				</div>
			</PageHeader>

			{app.awaiting_fee ? (
				<Alert tone="warning" className="mb-4" title="Application fee outstanding">
					Review can start once the {money(app.application_fee)} application fee is paid{canWaive ? " or waived" : ""}.
				</Alert>
			) : null}
			{duplicates.length ? (
				<Alert tone="warning" className="mb-4" icon={Users} title={`Possible duplicate${duplicates.length > 1 ? "s" : ""}`}>
					<ul className="mt-1 space-y-0.5">
						{duplicates.slice(0, 5).map((d) => (
							<li key={`${d.doctype || "app"}-${d.name}`}>
								{d.doctype === "Student" ? (
									canOpenStudent ? (
										<Link className="font-semibold underline" to={`/admin/students/${encodeURIComponent(d.name)}`}>
											{d.full_name} ({d.student_number || d.name})
										</Link>
									) : (
										<span className="font-semibold">
											{d.full_name} ({d.student_number || d.name})
										</span>
									)
								) : (
									<Link className="font-semibold underline" to={`/admin/admissions/${encodeURIComponent(d.name)}`}>
										{d.full_name} ({d.name})
									</Link>
								)}{" "}
								· {[d.doctype === "Student" ? "Student" : "Application", d.programme_name, d.status].filter(Boolean).join(" · ")}
								{d.match?.length ? <span className="opacity-75"> (same {d.match.map((m) => MATCH_LABEL[m] || m).join(", ")})</span> : null}
							</li>
						))}
					</ul>
				</Alert>
			) : null}

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-5 lg:col-span-2">
					<Tabs tabs={tabs} active={tab} onChange={setTab} />
					{tab === "personal" ? <Personal app={app} /> : null}
					{tab === "academic" ? <Academic app={app} /> : null}
					{tab === "documents" ? <Documents app={app} missing={missingDocs} /> : null}
					{tab === "payments" ? <Payments app={app} canWaive={canWaive && feeOpen} onWaive={() => setDialog("waive")} /> : null}
					{tab === "review" ? <Review app={app} /> : null}
					{tab === "history" ? <History app={app} /> : null}
				</div>

				<aside className="min-w-0 space-y-5">
					<Panel>
						<div className="flex items-center gap-3">
							<Avatar name={app.full_name} src={app.photo} size={56} />
							<div className="min-w-0">
								<div className="truncate font-semibold text-ink">{app.full_name}</div>
								<div className="truncate text-xs text-ink-soft">
									{[app.gender, app.date_of_birth ? `Born ${date(app.date_of_birth)}` : null].filter(Boolean).join(" · ")}
								</div>
							</div>
						</div>
						<div className="mt-4 space-y-2 text-sm">
							{app.email ? (
								<a href={`mailto:${app.email}`} className="flex items-center gap-2 text-ink-muted hover:text-brand-700">
									<Mail size={14} /> <span className="truncate">{app.email}</span>
								</a>
							) : null}
							{app.phone ? (
								<a href={`tel:${app.phone}`} className="flex items-center gap-2 text-ink-muted hover:text-brand-700">
									<Phone size={14} /> {app.phone}
								</a>
							) : null}
							{app.county ? (
								<div className="flex items-center gap-2 text-ink-muted">
									<MapPin size={14} /> {app.county}
								</div>
							) : null}
						</div>
					</Panel>

					<Panel title="Application" icon={FileText} bodyClass="px-5 py-2 divide-y divide-line">
						<InfoRow label="Programme" value={app.programme_info?.programme_name || app.programme} />
						<InfoRow label="Level" value={app.programme_info?.level} />
						<InfoRow label="Campus" value={app.campus} />
						<InfoRow label="Study mode" value={app.study_mode} />
						<InfoRow label="Intake" value={app.intake} />
						<InfoRow label="Sponsorship" value={app.sponsorship_type} />
						<InfoRow label="Submitted" value={app.submitted_on ? dateTime(app.submitted_on) : "Not yet"} />
					</Panel>

					<Panel title="Next step" icon={BadgeCheck}>
						<p className="text-sm text-ink-muted">{NEXT_STEP[app.status] || "—"}</p>
						{app.status === "Admitted" && app.offer_expiry ? <p className="mt-2 text-xs text-ink-soft">Offer open until {date(app.offer_expiry)}.</p> : null}
						{app.student ? (
							<div className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm">
								<div className="text-xs text-ink-soft">Student record</div>
								{canOpenStudent ? (
									<Link to={`/admin/students/${encodeURIComponent(app.student)}`} className="font-semibold text-brand-700 hover:underline">
										{app.student_number || app.student}
									</Link>
								) : (
									<span className="font-semibold text-ink">{app.student_number || app.student}</span>
								)}
							</div>
						) : null}
					</Panel>
				</aside>
			</div>

			<StartReview app={app} open={dialog === "review"} onClose={close} />
			<ScheduleInterview app={app} open={dialog === "interview"} onClose={close} />
			<DecisionModal open={dialog === "decide"} onClose={close} names={[app.name]} label={app.full_name} allowed={decisions} />
			<WaiveFee app={app} open={dialog === "waive"} onClose={close} />
			<ConvertToStudent app={app} open={dialog === "convert"} onClose={close} canOpenStudent={canOpenStudent} />
			<LetterPreview app={app} open={dialog === "letter"} onClose={close} />
		</>
	)
}

/* ───────────── Tabs ───────────── */

function Personal({ app }) {
	return (
		<div className="space-y-5">
			<Panel title="Personal details">
				<KeyValueGrid
					cols={3}
					items={kv([
						{ label: "First name", value: app.first_name },
						{ label: "Middle name", value: app.middle_name },
						{ label: "Last name", value: app.last_name },
						{ label: "Gender", value: app.gender },
						{ label: "Date of birth", value: app.date_of_birth ? date(app.date_of_birth) : null },
						{ label: "Marital status", value: app.marital_status },
						{ label: "National ID / passport", value: app.national_id },
						{ label: "Nationality", value: app.nationality },
						{ label: "County", value: app.county },
						{ label: "Email", value: app.email },
						{ label: "Phone", value: app.phone },
						{ label: "Postal address", value: app.postal_address },
						{ label: "Disability or special needs", value: app.disability, wide: true },
					])}
				/>
			</Panel>
			<Panel title="Next of kin">
				<KeyValueGrid
					cols={3}
					items={kv([
						{ label: "Name", value: app.nok_name },
						{ label: "Relationship", value: app.nok_relationship },
						{ label: "Phone", value: app.nok_phone },
					])}
				/>
			</Panel>
			<Panel title="Church and ministry">
				<KeyValueGrid
					cols={3}
					items={kv([
						{ label: "Home church", value: app.home_church },
						{ label: "Partner church", value: app.partner_church },
						{ label: "Denomination", value: app.denomination },
						{ label: "Born again (year)", value: app.year_born_again },
						{ label: "Pastor", value: app.pastor_name },
						{ label: "Pastor's phone", value: app.pastor_phone },
						{ label: "Ministry role", value: app.ministry_role },
						{ label: "Ministry experience", value: app.ministry_experience, wide: true },
						{ label: "Testimony", value: app.testimony ? <span className="whitespace-pre-line font-normal text-ink-muted">{app.testimony}</span> : null, wide: true },
					])}
				/>
			</Panel>
		</div>
	)
}

function Academic({ app }) {
	return (
		<div className="space-y-5">
			<Panel title="Qualifications">
				<KeyValueGrid
					cols={3}
					items={kv([
						{ label: "KCSE mean grade", value: app.kcse_mean_grade },
						{ label: "KCSE year", value: app.kcse_year },
						{ label: "Highest qualification", value: app.highest_qualification },
						app.programme_info?.minimum_entry ? { label: "Programme entry requirement", value: app.programme_info.minimum_entry, wide: true } : null,
					])}
				/>
			</Panel>
			<Panel title="Schools and colleges attended" bodyClass="">
				<DataTable
					rows={app.academic_records || []}
					empty="No academic history entered"
					cols={[
						{ key: "institution", label: "Institution" },
						{ key: "qualification", label: "Qualification" },
						{ key: "year_completed", label: "Year", align: "right" },
						{ key: "grade", label: "Grade" },
					]}
					className="rounded-none border-0 shadow-none"
				/>
			</Panel>
		</div>
	)
}

function Documents({ app, missing }) {
	const [preview, setPreview] = useState(null)
	const docs = [...(app.documents || [])]
	if (app.photo && !docs.some((d) => d.document_type === "Passport Photo")) docs.unshift({ name: "photo", document_type: "Passport Photo", file: app.photo, verified: 0 })
	return (
		<div className="space-y-4">
			{missing.length ? (
				<Alert tone="error" icon={AlertTriangle} title="Missing required documents">
					{missing.join(", ")}. Ask the applicant to upload {missing.length === 1 ? "it" : "them"} from their portal before deciding.
				</Alert>
			) : (
				<Alert tone="success" title="All required documents are present" />
			)}
			<Panel title="Uploaded documents" bodyClass="divide-y divide-line">
				{docs.length ? (
					docs.map((d) => (
						<div key={d.name} className="flex flex-wrap items-center gap-3 px-5 py-3">
							<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream text-gold-700">
								<FileText size={18} />
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-semibold text-ink">{d.document_type}</span>
									{d.verified ? (
										<Badge tone="green" size="xs">
											Verified
										</Badge>
									) : null}
								</div>
								<div className="truncate text-xs text-ink-soft">{d.file ? fileName(d.file) : "No file attached"}</div>
								{d.remarks ? <div className="mt-0.5 text-xs text-ink-muted">{d.remarks}</div> : null}
							</div>
							{safeUrl(d.file) ? (
								<div className="flex gap-2">
									{isImage(d.file) || isPdf(d.file) ? (
										<Button size="sm" variant="secondary" icon={Eye} onClick={() => setPreview(d)}>
											Preview
										</Button>
									) : null}
									<a href={safeUrl(d.file)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
										<ExternalLink size={14} /> Open
									</a>
								</div>
							) : null}
						</div>
					))
				) : (
					<Empty compact icon={FileText} title="No documents uploaded" />
				)}
				{missing.map((m) => (
					<div key={m} className="flex items-center gap-3 bg-red-50/60 px-5 py-3 dark:bg-red-950/30">
						<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950">
							<AlertTriangle size={18} />
						</span>
						<div className="min-w-0 flex-1">
							<div className="font-semibold text-ink">{m}</div>
							<div className="text-xs text-red-700 dark:text-red-300">Required, not uploaded</div>
						</div>
						<Badge tone="red" size="xs">
							Missing
						</Badge>
					</div>
				))}
			</Panel>
			<Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.document_type} subtitle={preview ? fileName(preview.file) : ""} size="xl"
				footer={
					preview ? (
						<a href={safeUrl(preview.file)} target="_blank" rel="noreferrer" className="btn btn-secondary">
							<ExternalLink size={16} /> Open in new tab
						</a>
					) : null
				}
			>
				{preview && isImage(preview.file) ? (
					<img src={safeUrl(preview.file)} alt={preview.document_type} className="mx-auto max-h-[70vh] rounded-xl object-contain" />
				) : preview && isPdf(preview.file) ? (
					<iframe src={safeUrl(preview.file)} title={preview.document_type} className="h-[70vh] w-full rounded-xl border border-line bg-white" />
				) : null}
			</Modal>
		</div>
	)
}

function Payments({ app, canWaive, onWaive }) {
	const p = app.fee_payment_info
	return (
		<div className="space-y-5">
			<Panel title="Application fee" actions={canWaive ? <Button size="sm" variant="secondary" icon={HandCoins} onClick={onWaive}>Waive fee</Button> : null}>
				<div className="grid gap-4 sm:grid-cols-3">
					<div>
						<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Amount</div>
						<div className="mt-1 text-xl font-bold text-ink">{Number(app.application_fee) > 0 ? money(app.application_fee) : "No fee"}</div>
					</div>
					<div>
						<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Status</div>
						<div className="mt-1.5">
							<FeeBadge status={app.fee_status} awaiting={app.awaiting_fee} size="sm" />
						</div>
					</div>
					<div>
						<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Applicant's next step</div>
						<div className="mt-1 text-sm text-ink-muted">{app.awaiting_fee ? "Pay the application fee" : "None for the fee"}</div>
					</div>
				</div>
			</Panel>
			<Panel title="Payment received" bodyClass={p ? "px-5 py-2 divide-y divide-line" : undefined}>
				{p ? (
					<>
						<InfoRow
							label="Receipt"
							value={
								<Link to={`/admin/finance/payments/${encodeURIComponent(p.name)}`} className="text-brand-700 hover:underline">
									{p.name}
								</Link>
							}
						/>
						<InfoRow label="Amount" value={money(p.amount)} />
						<InfoRow label="Method" value={p.mode_of_payment} />
						<InfoRow label="Reference" value={p.reference_no} />
						<InfoRow label="Date" value={date(p.posting_date)} />
						<InfoRow label="Status" value={<Badge status={p.status} size="xs" />} />
					</>
				) : (
					<Empty compact icon={HandCoins} title={app.fee_status === "Waived" ? "Fee waived" : "No payment recorded yet"} subtitle={app.fee_status === "Waived" ? "See History for the reason." : "M-Pesa and manual receipts appear here once posted."} />
				)}
			</Panel>
		</div>
	)
}

function Review({ app }) {
	return (
		<div className="space-y-5">
			<Panel title="Review">
				<KeyValueGrid
					cols={3}
					items={kv([
						{ label: "Reviewer", value: app.reviewer_name || app.reviewer },
						{ label: "Interview", value: app.interview_date ? dateTime(app.interview_date) : "Not scheduled" },
						{ label: "Decision date", value: app.decision_date ? date(app.decision_date) : null },
						{ label: "Offer expires", value: app.offer_expiry ? date(app.offer_expiry) : null },
						{ label: "Letter issued", value: app.admission_letter_issued ? "Yes" : "No" },
						{ label: "Accepted on", value: app.accepted_on ? dateTime(app.accepted_on) : null },
					])}
				/>
			</Panel>
			<Panel title="Notes">
				{app.review_notes ? <p className="whitespace-pre-line text-sm text-ink">{app.review_notes}</p> : <p className="text-sm text-ink-soft">No review notes yet. Notes added when starting the review, scheduling or deciding appear here.</p>}
				{app.rejection_reason ? (
					<Alert tone="error" className="mt-4" title="Reason given to the applicant">
						{app.rejection_reason}
					</Alert>
				) : null}
			</Panel>
		</div>
	)
}

function History({ app }) {
	const log = app.status_log || []
	if (!log.length) return <Panel><Empty compact title="No history yet" /></Panel>
	const steps = log.map((l, i) => ({
		label: l.from_status && l.from_status !== l.to_status ? `${l.from_status} → ${l.to_status}` : l.to_status,
		date: `${dateTime(l.timestamp)}${l.user ? ` · ${l.user}` : ""}`,
		note: l.note,
		status: i === log.length - 1 ? (["Rejected", "Withdrawn", "Declined"].includes(l.to_status) ? "failed" : "current") : "done",
	}))
	return (
		<Panel title="Status history">
			<Timeline steps={steps} />
		</Panel>
	)
}

/* ───────────── Dialogs ───────────── */

function StartReview({ app, open, onClose }) {
	const [notes, setNotes] = useState("")
	const act = useAction(`${API}start_review`, { invalidate: [API], success: "Review started", onSuccess: onClose })
	return (
		<ConfirmDialog
			open={open}
			onClose={onClose}
			title="Start review"
			message={`You will be recorded as the reviewer for ${app.full_name}. The applicant sees that their application is under review.`}
			confirmLabel="Start review"
			loading={act.isPending}
			onConfirm={() => act.mutate({ name: app.name, notes: notes.trim() || undefined })}
		>
			<Textarea className="mt-3" label="Notes (optional)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
		</ConfirmDialog>
	)
}

function ScheduleInterview({ app, open, onClose }) {
	const [when, setWhen] = useState("")
	const [notes, setNotes] = useState("")
	const [err, setErr] = useState("")
	const act = useAction(`${API}schedule_interview`, {
		invalidate: [API],
		success: app.status === "Interview" ? "Interview rescheduled" : "Interview scheduled",
		onSuccess: () => {
			setWhen("")
			setNotes("")
			onClose()
		},
	})
	const submit = () => {
		if (!when) return setErr("Choose the interview date and time.")
		if (new Date(when) <= new Date()) return setErr("The interview must be in the future.")
		setErr("")
		act.mutate({ name: app.name, interview_date: `${when.replace("T", " ")}:00`, notes: notes.trim() || undefined })
	}
	return (
		<Modal
			open={open}
			onClose={onClose}
			title={app.status === "Interview" ? "Reschedule interview" : "Schedule interview"}
			subtitle={app.full_name}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={act.isPending}>
						Cancel
					</Button>
					<Button icon={CalendarClock} onClick={submit} loading={act.isPending}>
						{app.status === "Interview" ? "Reschedule" : "Schedule"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{app.interview_date ? <Alert tone="info">Currently scheduled for {dateTime(app.interview_date)}.</Alert> : null}
				<Input type="datetime-local" label="Date and time" required min={localInputNow()} value={when} onChange={(e) => setWhen(e.target.value)} />
				<Textarea label="Notes for the panel" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Venue, panel members, what to prepare…" />
				<p className="text-xs text-ink-soft">The applicant is notified by email and in their portal.</p>
				{err ? <Alert tone="error">{err}</Alert> : null}
			</div>
		</Modal>
	)
}

function WaiveFee({ app, open, onClose }) {
	const [reason, setReason] = useState("")
	const [err, setErr] = useState("")
	const act = useAction(`${API}waive_application_fee`, { invalidate: [API], success: "Application fee waived", onSuccess: onClose })
	return (
		<ConfirmDialog
			open={open}
			onClose={onClose}
			title="Waive application fee"
			message={`${app.full_name} will not need to pay the ${money(app.application_fee)} application fee. This is recorded in the history.`}
			confirmLabel="Waive fee"
			loading={act.isPending}
			onConfirm={() => {
				if (!reason.trim()) return setErr("Give a reason for the waiver.")
				setErr("")
				act.mutate({ name: app.name, reason: reason.trim() })
			}}
		>
			<Textarea className="mt-3" label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={err} placeholder="e.g. Sponsored by partner church" />
		</ConfirmDialog>
	)
}

function ConvertToStudent({ app, open, onClose, canOpenStudent }) {
	const [done, setDone] = useState(null)
	const act = useAction(`${API}convert_to_student`, {
		invalidate: [API, "mahanaim.api.students."],
		success: (r) => `Student record ${r.student_number || r.student} created`,
		onSuccess: (r) => setDone(r),
	})
	const closeAll = () => {
		setDone(null)
		onClose()
	}
	if (done) {
		return (
			<Modal
				open={open}
				onClose={closeAll}
				title="Student record created"
				footer={
					<>
						<Button variant="secondary" onClick={closeAll}>
							Close
						</Button>
						{canOpenStudent ? (
							<Link to={`/admin/students/${encodeURIComponent(done.student)}`} className="btn btn-primary">
								Open student record
							</Link>
						) : null}
					</>
				}
			>
				<div className="flex items-center gap-3">
					<CheckCircle2 className="text-emerald-600" size={28} />
					<p className="text-sm text-ink-muted">
						{app.full_name} is now student <span className="font-semibold text-ink">{done.student_number || done.student}</span>.
					</p>
				</div>
			</Modal>
		)
	}
	return (
		<ConfirmDialog
			open={open}
			onClose={onClose}
			title="Create student record"
			message={`This creates a student record and student number for ${app.full_name} in ${app.programme_info?.programme_name || app.programme}, and gives them access to the student portal.`}
			confirmLabel="Create student"
			loading={act.isPending}
			onConfirm={() => act.mutate({ name: app.name })}
		/>
	)
}

function LetterPreview({ app, open, onClose }) {
	const q = useApi(`${API}admission_letter`, { name: app.name, format: "html" }, { enabled: open })
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Admission letter"
			subtitle={app.full_name}
			size="xl"
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
					<DownloadLink href={frappe.downloadUrl(`${API}admission_letter`, { name: app.name, format: "pdf" })} variant="primary">
						Download PDF
					</DownloadLink>
				</>
			}
		>
			{q.isLoading ? (
				<SkeletonRows rows={8} />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			) : (
				<iframe title="Admission letter" srcDoc={q.data?.html || ""} sandbox="" className="h-[65vh] w-full rounded-xl border border-line bg-white" />
			)}
		</Modal>
	)
}
