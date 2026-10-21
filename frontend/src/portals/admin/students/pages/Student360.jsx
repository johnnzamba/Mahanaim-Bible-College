import { useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowRightLeft, BookOpen, CalendarClock, ExternalLink, FileText, GraduationCap, Mail, Pencil, Phone, Receipt, ScrollText, Wallet } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess, ROLES } from "@/shared/access"
import { money, num, date, dateTime, ago } from "@/shared/utils/format"
import { DataTable, Timeline } from "@/shared/components/kit"
import { Alert, Avatar, Badge, Button, Checkbox, ConfirmDialog, Empty, ErrorState, InfoRow, KeyValueGrid, Modal, PageHeader, Panel, Select, SkeletonRows, StatCard, Tabs, Textarea } from "@/shared/components/ui"
import { API, FLAT, CAN, NoAccess, STUDENT_STATUSES, STUDENTS_FORBIDDEN, Standing, StudentStatus, isPermissionError, kv } from "../lib"

const CRED = "mahanaim.api.credentials."
const TABS = ["overview", "registrations", "results", "finance", "requests", "documents", "activity"]
const STATUS_HINT = {
	Withdrawn: "The student's enrolments for the current term are withdrawn and the portal account is disabled.",
	Deferred: "The student's enrolments for the current term are withdrawn. Resume later by setting the status back to Active.",
	Suspended: "The student keeps their records but cannot register or sit exams while suspended.",
	Completed: "Marks the programme as completed. Graduation moves the student to Alumni.",
	Alumni: "Moves the student to the alumni community.",
}

/** /admin/students/:name, the Student 360. */
export default function Student360() {
	const { name } = useParams()
	const { hasRole } = useSession()
	const q = useApi(`${API}student_360`, { name }, { enabled: hasRole(...CAN.read) })
	const back = { to: "/admin/students", label: "Students" }

	if (!hasRole(...CAN.read)) return <><PageHeader title="Student" back={back} /><NoAccess message={STUDENTS_FORBIDDEN} /></>
	if (q.isLoading)
		return (
			<>
				<PageHeader title="Loading student…" back={back} />
				<Panel><SkeletonRows rows={8} /></Panel>
			</>
		)
	if (isPermissionError(q.error)) return <><PageHeader title="Student" back={back} /><NoAccess message={STUDENTS_FORBIDDEN} /></>
	if (q.isError)
		return (
			<>
				<PageHeader title="Student" back={back} />
				<Panel>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Panel>
			</>
		)
	return <View data={q.data} />
}

function View({ data }) {
	const p = data.profile
	const { hasRole, isSuper, roles } = useSession()
	const [params, setParams] = useSearchParams()
	const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "overview"
	const setTab = (t) => setParams((prev) => { const n = new URLSearchParams(prev); t === "overview" ? n.delete("tab") : n.set("tab", t); return n }, { replace: true })
	const [statusOpen, setStatusOpen] = useState(false)
	const canWrite = hasRole(...CAN.write)
	const fin = data.finance || {}
	const balance = Number(fin.balance || 0)
	const res = data.results || {}
	const openRequests = (data.requests || []).filter((r) => ["Pending", "Under Review"].includes(r.status)).length

	return (
		<>
			<PageHeader
				back={{ to: "/admin/students", label: "Students" }}
				eyebrow="Student 360"
				title={p.full_name}
				actions={
					canWrite ? (
						<>
							<Link to={`/admin/students/${encodeURIComponent(p.name)}/edit`} className="btn btn-secondary btn-sm">
								<Pencil size={14} /> Edit profile
							</Link>
							<Button size="sm" icon={ArrowRightLeft} onClick={() => setStatusOpen(true)} disabled={!(p.allowed_transitions || []).length && !isSuper}>
								Change status
							</Button>
						</>
					) : null
				}
			/>

			<div className="card mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
				<Avatar name={p.full_name} src={p.photo || undefined} size={76} ring />
				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-sm font-semibold text-ink">{p.student_number || p.name}</span>
						<StudentStatus status={p.status} />
						<Standing value={p.academic_standing} size="sm" />
						{p.fee_category && p.fee_category !== "Standard" ? <Badge tone="purple">{p.fee_category}</Badge> : null}
					</div>
					<div className="text-sm font-semibold text-ink">{p.programme_name || p.programme || "No programme"}</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
						<span>{[p.campus_name || p.campus, p.study_mode].filter(Boolean).join(" · ")}</span>
						{p.year_of_study ? <span>Year {p.year_of_study}</span> : null}
						{p.term_label ? <span>{p.term_label}</span> : null}
					</div>
				</div>
				<div className="flex flex-col gap-1 text-sm sm:items-end">
					{p.email ? (
						<a href={`mailto:${p.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-ink-muted hover:text-brand-700">
							<Mail size={14} /> <span className="truncate">{p.email}</span>
						</a>
					) : null}
					{p.phone ? (
						<a href={`tel:${p.phone}`} className="inline-flex items-center gap-1.5 text-ink-muted hover:text-brand-700">
							<Phone size={14} /> {p.phone}
						</a>
					) : null}
				</div>
			</div>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="CGPA" value={res.cgpa ? Number(res.cgpa).toFixed(2) : "—"} icon={GraduationCap} tone="gold" hint={p.academic_standing || "No standing yet"} />
				<StatCard label="Credits earned" value={num(res.credits_earned || 0)} icon={BookOpen} hint={`${num(res.passed || 0)} passed · ${num(res.failed || 0)} to retake`} />
				<StatCard label="Fee balance" value={money(balance)} icon={Wallet} tone={balance > 0 ? "red" : "green"} hint={fin.registration_clearance ? (fin.registration_clearance.cleared ? "Cleared to register" : "Not cleared to register") : "—"} />
				<StatCard label="Open requests" value={num(openRequests)} icon={ScrollText} tone={openRequests ? "orange" : "brand"} hint={`${num((data.requests || []).length)} in total`} />
			</div>

			<Tabs
				className="mb-5"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "overview", label: "Overview" },
					{ id: "registrations", label: "Registrations", count: (data.registrations || []).length },
					{ id: "results", label: "Results", count: (res.rows || []).length },
					{ id: "finance", label: "Finance" },
					{ id: "requests", label: "Requests", count: (data.requests || []).length },
					{ id: "documents", label: "Documents" },
					{ id: "activity", label: "Activity" },
				]}
			/>

			{tab === "overview" ? <Overview data={data} /> : null}
			{tab === "registrations" ? <Registrations data={data} /> : null}
			{tab === "results" ? <Results data={data} /> : null}
			{tab === "finance" ? <Finance data={data} roles={roles} /> : null}
			{tab === "requests" ? <Requests data={data} /> : null}
			{tab === "documents" ? <Documents data={data} roles={roles} /> : null}
			{tab === "activity" ? <Activity data={data} /> : null}

			{canWrite ? <StatusDialog open={statusOpen} onClose={() => setStatusOpen(false)} profile={p} isSuper={isSuper} /> : null}
		</>
	)
}

function Overview({ data }) {
	const p = data.profile
	const { roles } = useSession()
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="min-w-0 space-y-5 lg:col-span-2">
				<Panel title="Programme">
					<KeyValueGrid
						cols={2}
						items={kv([
							{ label: "Programme", value: p.programme_name || p.programme },
							{ label: "Campus", value: p.campus_name || p.campus },
							{ label: "Study mode", value: p.study_mode },
							{ label: "Intake", value: p.intake },
							{ label: "Admission year", value: p.admission_year },
							{ label: "Year of study", value: p.year_of_study },
							{ label: "Current term", value: p.term_label || p.current_term },
							{ label: "Fee category", value: p.fee_category },
							{ label: "Enrolled", value: p.enrollment_date ? date(p.enrollment_date) : null },
							{ label: "Expected completion", value: p.expected_completion ? date(p.expected_completion) : null },
							p.completion_date ? { label: "Completed", value: date(p.completion_date) } : null,
							p.graduation_date ? { label: "Graduated", value: date(p.graduation_date) } : null,
						])}
					/>
				</Panel>
				<Panel title="Personal">
					<KeyValueGrid
						cols={2}
						items={kv([
							{ label: "Full name", value: p.full_name },
							{ label: "Gender", value: p.gender },
							{ label: "Date of birth", value: p.date_of_birth ? date(p.date_of_birth) : null },
							{ label: "Marital status", value: p.marital_status },
							{ label: "National ID / passport", value: p.national_id },
							{ label: "Nationality", value: p.nationality },
							{ label: "County", value: p.county },
							{ label: "Postal address", value: p.postal_address },
						])}
					/>
				</Panel>
				<div className="grid gap-5 md:grid-cols-2">
					<Panel title="Next of kin">
						<KeyValueGrid cols={1} items={kv([{ label: "Name", value: p.nok_name }, { label: "Relationship", value: p.nok_relationship }, { label: "Phone", value: p.nok_phone }])} />
					</Panel>
					<Panel title="Church and ministry">
						<KeyValueGrid
							cols={1}
							items={kv([
								{ label: "Home church", value: p.home_church },
								{ label: "Partner church", value: p.partner_church },
								{ label: "Denomination", value: p.denomination },
								{ label: "Pastor", value: [p.pastor_name, p.pastor_phone].filter(Boolean).join(" · ") },
								{ label: "Ministry role", value: p.ministry_role },
							])}
						/>
					</Panel>
				</div>
				{["Completed", "Alumni"].includes(p.status) ? (
					<Panel title="Alumni">
						<KeyValueGrid
							cols={2}
							items={kv([
								{ label: "Current ministry", value: p.current_ministry },
								{ label: "Current position", value: p.current_position },
								{ label: "Directory listing", value: p.alumni_consent ? "Listed (consent given)" : "Not listed" },
							])}
						/>
					</Panel>
				) : null}
			</div>
			<aside className="min-w-0 space-y-5">
				<Panel title="Portal account">
					{data.user ? (
						<div className="space-y-1">
							<InfoRow label="Sign-in" value={data.user.name} />
							<InfoRow label="Account" value={data.user.enabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="gray">Disabled</Badge>} />
							<InfoRow label="Last sign-in" value={data.user.last_login ? ago(data.user.last_login) : "Never"} />
						</div>
					) : (
						<p className="text-sm text-ink-soft">No portal account yet. One is created when the record has an email address and is saved.</p>
					)}
				</Panel>
				{data.application ? (
					<Panel title="Application">
						<div className="space-y-1">
							<InfoRow
								label="Application"
								value={
									canAccess(roles, "/admissions") ? (
										<Link className="font-semibold text-brand-700 hover:underline" to={`/admin/admissions/${encodeURIComponent(data.application.name)}`}>
											{data.application.name}
										</Link>
									) : (
										data.application.name
									)
								}
							/>
							<InfoRow label="Status" value={<Badge status={data.application.status} />} />
							<InfoRow label="Submitted" value={data.application.submitted_on ? date(data.application.submitted_on) : null} />
							<InfoRow label="Accepted" value={data.application.accepted_on ? date(data.application.accepted_on) : null} />
						</div>
					</Panel>
				) : null}
				<Panel title="Sponsorship">
					{data.sponsor || (data.sponsorships || []).length ? (
						<div className="space-y-3">
							{data.sponsor ? <InfoRow label="Primary sponsor" value={data.sponsor.sponsor_name} /> : null}
							{(data.sponsorships || []).map((s) => (
								<div key={s.name} className="rounded-lg border border-line p-3 text-sm">
									<div className="flex items-center justify-between gap-2">
										<span className="font-semibold">{s.sponsor_name || s.sponsor}</span>
										<Badge status={s.status} size="xs" />
									</div>
									<div className="mt-1 text-xs text-ink-soft">
										{s.coverage}
										{s.percentage ? ` · ${s.percentage}%` : ""}
										{s.amount ? ` · ${money(s.amount)}` : ""}
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-ink-soft">Self-sponsored.</p>
					)}
				</Panel>
				<Panel title="Status history">
					<StatusTimeline log={data.status_log} />
				</Panel>
			</aside>
		</div>
	)
}

function StatusTimeline({ log }) {
	const rows = [...(log || [])].reverse()
	if (!rows.length) return <p className="text-sm text-ink-soft">No status changes recorded yet.</p>
	return (
		<Timeline
			steps={rows.map((r, i) => ({
				label: r.from_status ? `${r.from_status} → ${r.to_status}` : r.to_status,
				date: [r.timestamp ? dateTime(r.timestamp) : null, r.user].filter(Boolean).join(" · "),
				note: r.note,
				status: i === 0 ? "current" : "done",
			}))}
		/>
	)
}

function Registrations({ data }) {
	const regs = data.registrations || []
	const enrolments = data.enrolments || []
	return (
		<div className="space-y-5">
			<Panel title="Semester registrations" subtitle="Course selections submitted each term" bodyClass="p-0">
				<DataTable className={FLAT}
					rows={regs}
					rowTo={(r) => `/admin/students/registrations/${encodeURIComponent(r.name)}`}
					empty="No semester registrations yet"
					emptyIcon={CalendarClock}
					cols={[
						{ key: "academic_term", label: "Term", render: (r) => <div><div className="font-semibold">{r.term_label || r.academic_term}</div><div className="text-xs text-ink-soft">{r.name}</div></div> },
						{ key: "courses", label: "Courses", render: (r) => <span className="text-sm">{(r.courses || []).map((c) => c.course).join(", ") || "—"}</span>, hideOnMobile: true },
						{ key: "total_credits", label: "Credits", align: "right", render: (r) => num(r.total_credits || 0) },
						{ key: "approved_on", label: "Approved", hideOnMobile: true, render: (r) => (r.approved_on ? date(r.approved_on) : "—") },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					]}
				/>
			</Panel>
			<Panel title="Course enrolments" subtitle="Every course the student has been enrolled on" bodyClass="p-0">
				<DataTable className={FLAT}
					rows={enrolments}
					empty="No course enrolments yet"
					emptyIcon={BookOpen}
					initialSort={{ key: "academic_term", dir: "desc" }}
					cols={[
						{ key: "course", label: "Course", render: (r) => <div className="min-w-0"><div className="font-semibold">{r.course}</div><div className="truncate text-xs text-ink-soft">{r.course_title}</div></div> },
						{ key: "academic_term", label: "Term", hideOnMobile: true },
						{ key: "enrolled_on", label: "Enrolled", hideOnMobile: true, render: (r) => (r.enrolled_on ? date(r.enrolled_on) : "—") },
						{ key: "final_grade", label: "Grade", align: "right", render: (r) => r.final_grade || "—" },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					]}
				/>
			</Panel>
		</div>
	)
}

function Results({ data }) {
	const { hasRole, roles } = useSession()
	const full = hasRole(...CAN.results)
	const q = useApi("mahanaim.api.results.student_results", { student: data.profile.name }, { enabled: full })
	const summary = data.results || {}

	if (!full) {
		return (
			<Panel title="Published results" subtitle="The full academic record is available to the registrar and the academic dean" bodyClass="p-0">
				<DataTable className={FLAT}
					rows={summary.rows || []}
					empty="No published results yet"
					cols={[
						{ key: "course", label: "Course", render: (r) => <div><div className="font-semibold">{r.course}</div><div className="text-xs text-ink-soft">{r.course_title}</div></div> },
						{ key: "academic_term", label: "Term", hideOnMobile: true },
						{ key: "credits", label: "Credits", align: "right" },
						{ key: "grade", label: "Grade", align: "right" },
						{ key: "result_status", label: "Result", render: (r) => <Badge status={r.result_status} /> },
					]}
				/>
			</Panel>
		)
	}
	if (q.isLoading) return <Panel><SkeletonRows rows={6} /></Panel>
	if (q.isError) return <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel>
	const r = q.data || {}
	const terms = r.terms || []
	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="CGPA" value={r.cgpa ? Number(r.cgpa).toFixed(2) : "—"} icon={GraduationCap} tone="gold" hint={r.classification || "—"} />
				<StatCard label="Credits earned" value={num(r.total_credits || 0)} icon={BookOpen} hint={`${num(r.credits_attempted || 0)} attempted`} />
				<StatCard label="Terms" value={num(terms.length)} icon={CalendarClock} />
				<StatCard label="Quality points" value={num(r.quality_points || 0)} icon={FileText} />
			</div>
			{canAccess(roles, "/academics/results") ? (
				<div className="flex justify-end">
					<Link to="/admin/academics/results" className="btn btn-ghost btn-sm">
						Results administration <ExternalLink size={13} />
					</Link>
				</div>
			) : null}
			{terms.length ? (
				terms.map((t) => (
					<Panel
						key={t.term}
						title={t.label}
						subtitle={t.academic_year}
						bodyClass="p-0"
						actions={
							<div className="flex gap-3 text-xs text-ink-soft">
								<span>
									GPA <b className="text-ink">{Number(t.gpa || 0).toFixed(2)}</b>
								</span>
								<span>
									CGPA <b className="text-ink">{Number(t.cgpa || 0).toFixed(2)}</b>
								</span>
							</div>
						}
					>
						<DataTable className={FLAT}
							rows={t.courses || []}
							rowKey="course_result"
							dense
							cols={[
								{ key: "code", label: "Course", render: (c) => <div className="min-w-0"><div className="font-semibold">{c.code}</div><div className="truncate text-xs text-ink-soft">{c.title}</div></div> },
								{ key: "credits", label: "Credits", align: "right" },
								{ key: "total", label: "Score", align: "right", hideOnMobile: true, render: (c) => num(c.total) },
								{ key: "grade", label: "Grade", align: "right", render: (c) => <b>{c.grade || "—"}</b> },
								{ key: "status", label: "Result", render: (c) => <div className="flex flex-wrap gap-1"><Badge status={c.status} size="xs" />{!c.is_published ? <Badge tone="gray" size="xs">Unpublished</Badge> : null}{c.attempt > 1 ? <Badge tone="orange" size="xs">Attempt {c.attempt}</Badge> : null}</div> },
							]}
						/>
					</Panel>
				))
			) : (
				<Panel>
					<Empty icon={GraduationCap} title="No results yet" subtitle="Results appear here once mark sheets are approved." />
				</Panel>
			)}
		</div>
	)
}

function Finance({ data, roles }) {
	const fin = data.finance || {}
	const totals = fin.totals || {}
	const clr = fin.registration_clearance
	const financeArea = canAccess(roles, "/finance")
	const name = data.profile.name
	const cur = fin.currency
	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
				<StatCard label="Billed" value={money(totals.debit || 0)} icon={Receipt} />
				<StatCard label="Paid" value={money(totals.credit || 0)} icon={Wallet} tone="green" />
				<StatCard label="Balance" value={money(fin.balance || 0)} icon={Wallet} tone={Number(fin.balance) > 0 ? "red" : "green"} className="col-span-2 lg:col-span-1" />
			</div>
			{clr ? (
				<Alert tone={clr.cleared ? "success" : "warning"} title={clr.cleared ? "Cleared for registration" : "Not cleared for registration"}>
					{clr.message}
				</Alert>
			) : null}
			{financeArea ? (
				<div className="flex flex-wrap justify-end gap-2">
					<Link to={`/admin/finance/students/${encodeURIComponent(name)}`} className="btn btn-secondary btn-sm">
						Open fee account <ExternalLink size={13} />
					</Link>
				</div>
			) : null}
			<Panel title="Invoices" subtitle="Latest 10" bodyClass="p-0">
				<DataTable className={FLAT}
					rows={fin.invoices || []}
					rowTo={financeArea ? (r) => `/admin/finance/invoices/${encodeURIComponent(r.name)}` : undefined}
					empty="No invoices yet"
					emptyIcon={Receipt}
					cols={[
						{ key: "name", label: "Invoice", render: (r) => <div><div className="font-semibold">{r.name}</div><div className="text-xs text-ink-soft">{r.academic_term || "—"}</div></div> },
						{ key: "posting_date", label: "Date", hideOnMobile: true, render: (r) => date(r.posting_date) },
						{ key: "due_date", label: "Due", hideOnMobile: true, render: (r) => (r.due_date ? date(r.due_date) : "—") },
						{ key: "total_amount", label: "Amount", align: "right", render: (r) => money(r.total_amount) },
						{ key: "outstanding_amount", label: "Outstanding", align: "right", render: (r) => <span className={Number(r.outstanding_amount) > 0 ? "font-semibold text-red-600" : ""}>{money(r.outstanding_amount)}</span> },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					]}
				/>
			</Panel>
			<Panel title="Payments" subtitle="Latest 10" bodyClass="p-0">
				<DataTable className={FLAT}
					rows={fin.payments || []}
					rowTo={financeArea ? (r) => `/admin/finance/payments/${encodeURIComponent(r.name)}` : undefined}
					empty="No payments yet"
					emptyIcon={Wallet}
					cols={[
						{ key: "name", label: "Receipt", render: (r) => <div><div className="font-semibold">{r.name}</div><div className="text-xs text-ink-soft">{r.reference_no || "—"}</div></div> },
						{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date) },
						{ key: "mode_of_payment", label: "Method", hideOnMobile: true },
						{ key: "amount", label: "Amount", align: "right", render: (r) => <b>{money(r.amount)}</b> },
					]}
				/>
			</Panel>
		</div>
	)
}

function Requests({ data }) {
	return (
		<Panel title="Requests" subtitle="Deferment, withdrawal, transfers, documents and clearance" bodyClass="p-0">
			<DataTable className={FLAT}
				rows={data.requests || []}
				rowTo={(r) => `/admin/students/requests/${encodeURIComponent(r.name)}`}
				empty="No requests from this student"
				emptyIcon={ScrollText}
				cols={[
					{ key: "request_type", label: "Request", render: (r) => <div><div className="font-semibold">{r.request_type}</div><div className="text-xs text-ink-soft">{r.name}</div></div> },
					{ key: "academic_term", label: "Term", hideOnMobile: true, render: (r) => r.academic_term || "—" },
					{ key: "creation", label: "Raised", render: (r) => date(r.creation) },
					{ key: "decision_date", label: "Decided", hideOnMobile: true, render: (r) => (r.decision_date ? date(r.decision_date) : "—") },
					{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
				]}
			/>
		</Panel>
	)
}

function Documents({ data, roles }) {
	const { hasRole } = useSession()
	const navigate = useNavigate()
	const name = data.profile.name
	const allowed = hasRole(...CAN.credentials)
	const link = canAccess(roles, "/credentials")
	const tq = useApi(`${CRED}list_transcripts`, { student: name, page_length: 50 }, { enabled: allowed })
	const cq = useApi(`${CRED}list_certificates`, { student: name, page_length: 50 }, { enabled: allowed })
	const [genOpen, setGenOpen] = useState(false)
	const [type, setType] = useState("Official")
	const gen = useAction(`${CRED}generate_transcript`, {
		invalidate: [CRED],
		success: (r) => `Transcript ${r.name} generated as a draft`,
		onSuccess: (r) => {
			setGenOpen(false)
			if (link) navigate(`/admin/credentials/transcripts/${encodeURIComponent(r.name)}`)
		},
	})

	if (!allowed) return <NoAccess message="Transcripts and certificates are open to the registrar, the academic dean and the auditor." />
	return (
		<div className="space-y-5">
			<Panel
				title="Transcripts"
				bodyClass="p-0"
				actions={
					hasRole(ROLES.REGISTRAR) ? (
						<Button size="sm" variant="secondary" icon={FileText} onClick={() => setGenOpen(true)}>
							Generate transcript
						</Button>
					) : null
				}
			>
				<DataTable className={FLAT}
					rows={tq.data?.data || []}
					query={tq}
					rowTo={link ? (r) => `/admin/credentials/transcripts/${encodeURIComponent(r.name)}` : undefined}
					empty="No transcripts generated"
					emptyIcon={FileText}
					cols={[
						{ key: "name", label: "Transcript", render: (r) => <div><div className="font-semibold">{r.name}</div><div className="text-xs text-ink-soft">{r.transcript_type}</div></div> },
						{ key: "cgpa", label: "CGPA", align: "right", hideOnMobile: true, render: (r) => (r.cgpa ? Number(r.cgpa).toFixed(2) : "—") },
						{ key: "issue_date", label: "Issued", hideOnMobile: true, render: (r) => (r.issue_date ? date(r.issue_date) : "—") },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					]}
				/>
			</Panel>
			<Panel title="Certificates" bodyClass="p-0">
				<DataTable className={FLAT}
					rows={cq.data?.data || []}
					query={cq}
					rowTo={link ? (r) => `/admin/credentials/certificates/${encodeURIComponent(r.name)}` : undefined}
					empty="No certificate issued"
					emptyIcon={GraduationCap}
					cols={[
						{ key: "certificate_serial", label: "Serial", render: (r) => <div><div className="font-semibold">{r.certificate_serial || r.name}</div><div className="text-xs text-ink-soft">{r.award_title}</div></div> },
						{ key: "classification", label: "Class", hideOnMobile: true, render: (r) => r.classification || "—" },
						{ key: "issue_date", label: "Issued", hideOnMobile: true, render: (r) => (r.issue_date ? date(r.issue_date) : "—") },
						{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					]}
				/>
			</Panel>
			<Modal
				open={genOpen}
				onClose={() => setGenOpen(false)}
				title="Generate transcript"
				subtitle={`${data.profile.full_name} · ${data.profile.student_number || name}`}
				size="sm"
				footer={
					<>
						<Button variant="secondary" onClick={() => setGenOpen(false)}>
							Cancel
						</Button>
						<Button loading={gen.isPending} onClick={() => gen.mutate({ student: name, type })}>
							Generate draft
						</Button>
					</>
				}
			>
				<div className="space-y-4">
					<Select label="Transcript type" value={type} onChange={(e) => setType(e.target.value)} options={["Official", "Provisional", "Final"]} />
					<p className="text-sm text-ink-soft">The draft is a snapshot of the published results. Review it, then issue it from the transcript page.</p>
				</div>
			</Modal>
		</div>
	)
}

function Activity({ data }) {
	const events = useMemo(() => {
		const out = []
		for (const s of data.status_log || []) out.push({ at: s.timestamp, label: `Status: ${s.from_status ? `${s.from_status} → ` : ""}${s.to_status}`, note: [s.note, s.user].filter(Boolean).join(" · ") })
		if (data.application?.submitted_on) out.push({ at: data.application.submitted_on, label: `Application ${data.application.name} submitted` })
		if (data.application?.accepted_on) out.push({ at: data.application.accepted_on, label: "Admission offer accepted" })
		for (const r of data.registrations || []) {
			out.push({ at: r.creation, label: `Registration for ${r.term_label || r.academic_term} created`, note: `${num(r.total_credits || 0)} credits` })
			if (r.approved_on) out.push({ at: r.approved_on, label: `Registration for ${r.term_label || r.academic_term} approved`, note: r.approved_by })
		}
		for (const r of data.requests || []) {
			const kind = /request$/i.test(r.request_type) ? r.request_type : `${r.request_type} request`
			out.push({ at: r.creation, label: `${kind} raised`, note: r.name })
			if (r.decision_date) out.push({ at: r.decision_date, label: `${kind} ${String(r.status).toLowerCase()}`, note: r.name })
		}
		for (const p of data.finance?.payments || []) out.push({ at: p.posting_date, label: `Payment of ${money(p.amount)} received`, note: [p.mode_of_payment, p.reference_no].filter(Boolean).join(" · ") })
		if (data.user?.last_login) out.push({ at: data.user.last_login, label: "Last signed in to the portal" })
		return out.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60)
	}, [data])
	return (
		<Panel title="Activity" subtitle="Status changes, registrations, requests and payments, newest first">
			{events.length ? (
				<Timeline steps={events.map((e, i) => ({ label: e.label, date: dateTime(e.at), note: e.note, status: i === 0 ? "current" : "done" }))} />
			) : (
				<Empty title="No activity yet" />
			)}
		</Panel>
	)
}

function StatusDialog({ open, onClose, profile, isSuper }) {
	const allowed = profile.allowed_transitions || []
	const [force, setForce] = useState(false)
	const [status, setStatus] = useState("")
	const [note, setNote] = useState("")
	const [err, setErr] = useState("")
	const options = force ? STUDENT_STATUSES.filter((s) => s !== profile.status) : allowed
	const act = useAction(`${API}change_student_status`, {
		invalidate: [API],
		success: (r) => `Status changed to ${r.status}`,
		onSuccess: () => {
			setStatus("")
			setNote("")
			setForce(false)
			onClose()
		},
	})
	const confirm = () => {
		if (!status) return setErr("Choose the new status")
		if (!note.trim()) return setErr("Add a note explaining the change")
		setErr("")
		act.mutate({ name: profile.name, status, note: note.trim(), force: force ? 1 : 0 })
	}
	return (
		<ConfirmDialog
			open={open}
			onClose={onClose}
			title="Change student status"
			message={`${profile.full_name} is currently ${profile.status}.`}
			confirmLabel="Change status"
			tone={["Withdrawn", "Suspended"].includes(status) ? "danger" : "primary"}
			loading={act.isPending}
			onConfirm={confirm}
		>
			<div className="space-y-4">
				{options.length ? (
					<Select label="New status" required value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Select…" options={options} />
				) : (
					<Alert tone="info">No further status changes are possible from {profile.status}.</Alert>
				)}
				{status && STATUS_HINT[status] ? <p className="text-xs text-ink-soft">{STATUS_HINT[status]}</p> : null}
				<Textarea label="Note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the change, kept in the status history" />
				{isSuper ? (
					<Checkbox
						label="Override the normal lifecycle"
						description="Administrators can set any status. Use only to correct mistakes."
						checked={force}
						onChange={(c) => {
							setForce(c)
							setStatus("")
						}}
					/>
				) : null}
				{err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
			</div>
		</ConfirmDialog>
	)
}
