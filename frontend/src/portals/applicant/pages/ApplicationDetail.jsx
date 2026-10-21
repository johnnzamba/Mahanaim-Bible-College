import { useEffect, useMemo, useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { Ban, Banknote, CircleAlert, Download, FileText, GraduationCap, History, LifeBuoy, PenLine, Receipt, Smartphone } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, ErrorState, InfoRow, KeyValueGrid, PageHeader, Panel, Skeleton } from "@/shared/components/ui"
import { Timeline } from "@/shared/components/kit"
import { useSession } from "@/shared/session"
import { date, dateTime, money } from "@/shared/utils/format"
import { CLOSED_STATUSES, FEE_PAYABLE_STATUSES, M, docChecklist, draftProgress, journey, letterPdfUrl, needsReupload, receiptUrl } from "../lib"
import { useApplication, useOptions } from "../hooks"
import { AppStatus, FeeBadge } from "../components/AppStatus"
import { AdmissionLetter } from "../components/AdmissionLetter"
import { DocChecklist } from "../components/DocChecklist"
import { FlaggedDocsAlert } from "../components/DocState"
import { ApplicationDocuments } from "../components/ApplicationDocuments"
import { NextActionCard, resolveNextAction } from "../components/NextAction"
import { OfferResponse, WelcomeModal } from "../components/OfferResponse"
import { PayFeeDialog } from "../components/PayFeeDialog"
import { WithdrawDialog } from "../components/WithdrawDialog"
import { years } from "../components/ProgrammeCard"

export default function ApplicationDetail() {
	const { name } = useParams()
	const q = useApplication(name)
	const options = useOptions()
	if (q.isLoading || options.isLoading) return <DetailSkeleton />
	if (q.isError) {
		return (
			<>
				<PageHeader title="Application" back={{ to: "/applicant/application", label: "My applications" }} />
				<ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't open this application" />
			</>
		)
	}
	return <Detail app={q.data} options={options.data} />
}

function DetailSkeleton() {
	return (
		<div className="space-y-5">
			<Skeleton className="h-16 w-1/2" />
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
				<div className="space-y-5">
					<Skeleton className="h-28" />
					<Skeleton className="h-64" />
				</div>
				<Skeleton className="h-96" />
			</div>
		</div>
	)
}

function Detail({ app, options }) {
	const session = useSession()
	const { hash, key } = useLocation()
	const [paying, setPaying] = useState(false)
	const [withdrawing, setWithdrawing] = useState(false)
	const [welcome, setWelcome] = useState(null)
	const fee = useApi(M.feeStatus, { application: app.name })
	const checklist = docChecklist(app, options)
	const flow = journey(app)
	const detail = `/applicant/application/${app.name}`
	const prog = options?.programmes?.find((p) => p.name === app.programme)

	useEffect(() => {
		if (!hash) return
		const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }), 150)
		return () => clearTimeout(t)
	}, [hash, key])

	const action = useMemo(() => {
		const a = resolveNextAction(app, { checklist, progress: draftProgress(app, options), portals: session.portals || [] })
		// Admitted → OfferResponse, Accepted → EnrolledBanner carry the call to action on this page.
		if (!a || app.status === "Admitted" || app.status === "Accepted") return null
		if (a.cta?.to?.startsWith(detail) && !a.cta.to.startsWith(`${detail}#`)) return { ...a, cta: null }
		if (a.cta?.to === "/applicant/documents") return { ...a, cta: { ...a.cta, to: `${detail}#documents` } }
		if (a.secondary?.to === "/applicant/documents") return { ...a, secondary: { ...a.secondary, to: `${detail}#documents` } }
		return a
	}, [app, checklist, options, session.portals, detail])

	const feeData = fee.data
	const unpaid = app.application_fee > 0 && !["Paid", "Waived"].includes(app.fee_status)
	const canPay = unpaid && FEE_PAYABLE_STATUSES.includes(app.status)

	return (
		<>
			<PageHeader
				eyebrow={`Application ${app.name}`}
				title={<span className="whitespace-normal">{app.programme_name || app.programme}</span>}
				subtitle={[app.campus, app.study_mode, app.intake].filter(Boolean).join(" · ")}
				back={{ to: "/applicant/application", label: "My applications" }}
				actions={
					<>
						{app.can_edit ? (
							<Link to={`/applicant/apply?application=${app.name}`} className="btn btn-primary">
								<PenLine size={16} /> Continue editing
							</Link>
						) : null}
						{canPay && app.status !== "Draft" ? (
							<Button variant="gold" icon={Smartphone} onClick={() => setPaying(true)}>
								Pay fee
							</Button>
						) : null}
						{app.letter_available ? (
							<a href={letterPdfUrl(app.name)} className="btn btn-secondary" download>
								<Download size={16} /> Admission letter
							</a>
						) : null}
						{app.can_withdraw ? (
							<Button variant="ghost" icon={Ban} onClick={() => setWithdrawing(true)} className="text-red-600 dark:text-red-300">
								Withdraw
							</Button>
						) : null}
					</>
				}
			>
				<div className="mt-2.5 flex flex-wrap items-center gap-2">
					<AppStatus status={app.status} />
					{app.application_fee > 0 ? <FeeBadge status={app.fee_status} appStatus={app.status} /> : null}
					{app.student_number ? <Badge tone="brand">Student no. {app.student_number}</Badge> : null}
					{app.submitted_on ? <span className="text-xs text-ink-soft">Submitted {date(app.submitted_on)}</span> : <span className="text-xs text-ink-soft">Started {date(app.creation)}</span>}
				</div>
			</PageHeader>

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
				<div className="min-w-0 space-y-5">
					{action ? <NextActionCard action={action} onPay={() => setPaying(true)} /> : null}
					{action?.kind !== "reupload" ? (
						<FlaggedDocsAlert app={app} onOpen={() => document.getElementById("documents")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
					) : null}
					{app.status === "Rejected" ? (
						<Alert tone="error" title="We're unable to offer you a place this time">
							{app.rejection_reason || "Thank you for your interest in Mahanaim. You're welcome to apply again for a later intake."}
						</Alert>
					) : null}
					{app.status === "Admitted" ? (
						<div id="offer" className="scroll-mt-24">
							<OfferResponse app={app} onAccepted={setWelcome} />
						</div>
					) : null}
					{app.status === "Accepted" ? <EnrolledBanner app={app} portals={session.portals || []} /> : null}
					{app.letter_available ? <AdmissionLetter app={app} /> : null}
					{app.status === "Draft" && app.missing?.length ? (
						<Alert
							tone="warning"
							title="Still needed before you can submit"
							action={
								<Link to={`/applicant/apply?application=${app.name}`} className="btn btn-secondary btn-sm">
									Complete
								</Link>
							}
						>
							{app.missing.join(" · ")}
						</Alert>
					) : null}

					<ProgrammeSection app={app} prog={prog} />
					<PersonalSection app={app} />
					<ChurchSection app={app} />
					<AcademicSection app={app} />
					<DocumentsSection app={app} options={options} checklist={checklist} />
				</div>

				<aside className="space-y-5" aria-label="Application status">
					<Panel title="Progress" icon={History}>
						{flow.closed ? (
							<p className="mb-4 rounded-xl bg-cream/70 px-3 py-2 text-xs text-ink-muted">
								This application is closed{app.status === "Withdrawn" ? " — you withdrew it" : ""}.
							</p>
						) : null}
						<Timeline steps={flow.steps} />
					</Panel>
					<FeePanel app={app} fee={fee} feeData={feeData} canPay={canPay} onPay={() => setPaying(true)} />
					<ActivityPanel log={app.status_log} />
					<Panel title="Need help?" icon={LifeBuoy}>
						<p className="text-sm text-ink-muted">Questions about your application? Quote <span className="font-mono font-semibold text-ink">{app.name}</span> when you contact us.</p>
						<Link to="/contact?type=Admissions" className="btn btn-secondary btn-sm mt-3">
							Contact admissions
						</Link>
					</Panel>
				</aside>
			</div>

			<PayFeeDialog app={app} open={paying} onClose={() => setPaying(false)} />
			<WithdrawDialog app={app} open={withdrawing} onClose={() => setWithdrawing(false)} />
			<WelcomeModal welcome={welcome} onClose={() => setWelcome(null)} />
		</>
	)
}

function EnrolledBanner({ app, portals }) {
	const ready = Boolean(app.student) && portals.includes("student")
	return (
		<div className="hero-wash relative overflow-hidden rounded-2xl p-5 text-white">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
				<span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15">
					<GraduationCap size={24} aria-hidden />
				</span>
				<div className="min-w-0 flex-1">
					<div className="font-serif text-xl">{app.student ? "You're enrolled!" : "Offer accepted"}</div>
					<p className="text-sm text-white/80">
						{app.student_number
							? `Your student number is ${app.student_number}. Accepted ${date(app.accepted_on)}.`
							: "The registry is setting up your student record. You'll be notified with your student number."}
					</p>
				</div>
				{ready ? (
					<Link to="/student" className="btn btn-gold shrink-0">
						Go to student portal
					</Link>
				) : null}
			</div>
		</div>
	)
}

function Section({ title, children, edit, id }) {
	return (
		<Panel
			title={title}
			actions={
				edit ? (
					<Link to={edit} className="btn btn-ghost btn-sm">
						<PenLine size={14} /> Edit
					</Link>
				) : null
			}
		>
			<div id={id}>{children}</div>
		</Panel>
	)
}

const editLink = (app, step) => (app.can_edit ? `/applicant/apply?application=${app.name}&step=${step}` : null)

function ProgrammeSection({ app, prog }) {
	return (
		<Section title="Programme & intake" edit={editLink(app, 0)}>
			<KeyValueGrid
				cols={3}
				items={[
					{ label: "Programme", value: app.programme_name || app.programme },
					prog ? { label: "Level · duration", value: [prog.level, years(prog.duration_years)].filter(Boolean).join(" · ") } : null,
					{ label: "Campus", value: app.campus },
					{ label: "Study mode", value: app.study_mode },
					{ label: "Intake", value: app.intake || "To be confirmed" },
					{ label: "Sponsorship", value: app.sponsorship_type },
				]}
			/>
		</Section>
	)
}

function PersonalSection({ app }) {
	return (
		<Section title="Personal details" edit={editLink(app, 1)}>
			<KeyValueGrid
				cols={3}
				items={[
					{ label: "Full name", value: app.full_name || [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") },
					{ label: "Phone", value: app.phone },
					{ label: "Gender", value: app.gender },
					{ label: "Email", value: app.email, wide: true },
					{ label: "Date of birth", value: app.date_of_birth ? date(app.date_of_birth) : null },
					{ label: "Marital status", value: app.marital_status },
					{ label: "ID / passport no.", value: app.national_id },
					{ label: "Nationality", value: app.nationality },
					{ label: "County", value: app.county },
					app.postal_address ? { label: "Postal address", value: app.postal_address } : null,
					app.disability ? { label: "Special needs", value: app.disability, wide: true } : null,
				]}
			/>
			<div className="mt-5 border-t border-line pt-4">
				<div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Next of kin</div>
				<KeyValueGrid
					cols={3}
					items={[
						{ label: "Name", value: app.nok_name },
						{ label: "Relationship", value: app.nok_relationship },
						{ label: "Phone", value: app.nok_phone },
					]}
				/>
			</div>
		</Section>
	)
}

function ChurchSection({ app }) {
	return (
		<Section title="Church & ministry" edit={editLink(app, 2)}>
			<KeyValueGrid
				cols={3}
				items={[
					{ label: "Home church", value: app.home_church },
					{ label: "Denomination", value: app.denomination },
					{ label: "Born again (year)", value: app.year_born_again },
					{ label: "Senior pastor", value: app.pastor_name },
					{ label: "Pastor's phone", value: app.pastor_phone },
					{ label: "Ministry role", value: app.ministry_role },
					app.testimony ? { label: "Testimony", value: <span className="whitespace-pre-line font-normal text-ink-muted">{app.testimony}</span>, wide: true } : null,
					app.ministry_experience
						? { label: "Ministry experience & calling", value: <span className="whitespace-pre-line font-normal text-ink-muted">{app.ministry_experience}</span>, wide: true }
						: null,
				]}
			/>
		</Section>
	)
}

function AcademicSection({ app }) {
	const rows = app.academic_records || []
	return (
		<Section title="Academic background" edit={editLink(app, 3)}>
			<KeyValueGrid
				cols={3}
				items={[
					{ label: "Highest qualification", value: app.highest_qualification },
					{ label: "KCSE mean grade", value: app.kcse_mean_grade },
					{ label: "KCSE year", value: app.kcse_year },
				]}
			/>
			{rows.length ? (
				<div className="mt-5 overflow-x-auto rounded-xl border border-line">
					<table className="table-base">
						<thead>
							<tr>
								<th>Institution</th>
								<th>Qualification</th>
								<th>Year</th>
								<th>Grade</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.name}>
									<td className="font-medium text-ink">{r.institution || "—"}</td>
									<td>{r.qualification || "—"}</td>
									<td>{r.year_completed || "—"}</td>
									<td>{r.grade || "—"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p className="mt-4 text-sm text-ink-soft">No schools or colleges added.</p>
			)}
		</Section>
	)
}

function DocumentsSection({ app, options, checklist }) {
	const docs = (app.documents || []).filter((d) => d.file)
	const verified = docs.filter((d) => d.verified).length
	const flagged = docs.filter(needsReupload).length
	const summary = [`${docs.length} uploaded`, `${verified} verified`, flagged ? `${flagged} need${flagged === 1 ? "s" : ""} a new copy` : null].filter(Boolean).join(" · ")
	return (
		<div id="documents" className="scroll-mt-24">
			<Panel title="Documents" icon={FileText} subtitle={docs.length ? <span className="whitespace-normal">{summary}</span> : "Nothing uploaded yet"}>
				<div className="mb-5 rounded-2xl border border-line bg-cream/40 p-4">
					<DocChecklist checklist={checklist} compact />
				</div>
				<ApplicationDocuments app={app} options={options} />
			</Panel>
		</div>
	)
}

function FeePanel({ app, fee, feeData, canPay, onPay }) {
	if (!(app.application_fee > 0) && !feeData?.required) {
		return (
			<Panel title="Application fee" icon={Banknote}>
				<p className="text-sm text-ink-muted">No application fee is required for this programme.</p>
			</Panel>
		)
	}
	const payment = feeData?.payment
	const pending = feeData?.pending_requests || []
	return (
		<Panel title="Application fee" icon={Banknote} actions={<FeeBadge status={feeData?.fee_status || app.fee_status} appStatus={app.status} size="xs" />}>
			<div className="text-2xl font-bold text-ink">{money(feeData?.application_fee ?? app.application_fee)}</div>
			{fee.isError ? (
				<p className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
					<CircleAlert size={13} /> Payment details are unavailable right now.
				</p>
			) : null}
			{payment ? (
				<div className="mt-3 divide-y divide-line rounded-xl border border-line px-3">
					<InfoRow label="Paid on" value={date(payment.posting_date)} />
					<InfoRow label="Method" value={payment.mode_of_payment} />
					{payment.reference_no ? <InfoRow label="M-Pesa ref" value={<span className="font-mono">{payment.reference_no}</span>} /> : null}
					<InfoRow label="Receipt" value={payment.name} />
				</div>
			) : null}
			{pending.length && !payment ? (
				<p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
					A payment request is awaiting confirmation on your phone. It may take a minute to reflect.
				</p>
			) : null}
			<div className="mt-4 flex flex-wrap gap-2">
				{payment ? (
					<a href={receiptUrl(payment.name)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
						<Receipt size={14} /> Receipt (PDF)
					</a>
				) : null}
				{canPay ? (
					<Button variant="gold" size="sm" icon={Smartphone} onClick={onPay}>
						Pay with M-Pesa
					</Button>
				) : null}
				{!payment && !canPay && CLOSED_STATUSES.includes(app.status) ? <span className="text-xs text-ink-soft">This application is closed.</span> : null}
			</div>
			{canPay && app.status === "Draft" ? <p className="mt-2 text-xs text-ink-soft">You can pay now or right after you submit.</p> : null}
		</Panel>
	)
}

function ActivityPanel({ log = [] }) {
	// Applicants only receive status changes; ignore anything else defensively.
	const rows = (log || []).filter((l) => l.to_status && l.from_status !== l.to_status).reverse()
	if (!rows.length) return null
	return (
		<Panel title="Activity">
			<ul className="space-y-3">
				{rows.map((l, i) => (
					<li key={l.name || `${l.timestamp}-${i}`} className="flex items-start gap-2.5 text-sm">
						<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />
						<div className="min-w-0">
							<div className="text-ink">
								{l.from_status ? (
									<>
										{l.from_status} → <span className="font-semibold">{l.to_status}</span>
									</>
								) : (
									<span className="font-semibold">{l.to_status}</span>
								)}
							</div>
							<div className="text-xs text-ink-soft">{dateTime(l.timestamp)}</div>
						</div>
					</li>
				))}
			</ul>
		</Panel>
	)
}
