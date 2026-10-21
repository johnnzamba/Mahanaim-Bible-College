import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { GraduationCap, Mail, Pencil, Phone, Plus, RefreshCw, Repeat2, Send } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Avatar, Badge, Button, Card, Empty, KeyValueGrid, PageHeader, Panel, ProgressBar, QueryState, SkeletonRows, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, money, num, pct } from "@/shared/utils/format"
import { API, INVALIDATE, RoleGate, toneOf, useChurchRoles, useSendSponsorReports } from "../components/common"
import { SponsorForm } from "../components/SponsorForm"
import { SponsorshipForm, SponsorshipStatusDialog } from "../components/SponsorshipForm"

export default function SponsorDetail() {
	return (
		<RoleGate title="Sponsor">
			<SponsorDetailPage />
		</RoleGate>
	)
}

function SponsorDetailPage() {
	const { name } = useParams()
	const { canManage } = useChurchRoles()
	const [tab, setTab] = useState("students")
	const [editing, setEditing] = useState(null)
	const [sponsorship, setSponsorship] = useState(null)
	const [statusRow, setStatusRow] = useState(null)
	const q = useApi(`${API}sponsor_360`, { name })
	const refresh = useAction(`${API}refresh_sponsor`, { invalidate: INVALIDATE, success: "Totals recalculated from payments" })
	const report = useSendSponsorReports()
	const d = q.data
	const s = d?.sponsor

	return (
		<>
			<PageHeader
				back={{ to: "/admin/church/sponsors", label: "Sponsors" }}
				title={s?.sponsor_name || "Sponsor"}
				subtitle={s ? [s.sponsor_type, s.partner_church, s.country].filter(Boolean).join(" · ") : name}
				actions={
					canManage && s ? (
						<>
							<Button variant="secondary" icon={Send} loading={report.isPending} title="Email, SMS and portal notice about their students' progress and fees" onClick={() => report.mutate({ sponsor: name })}>
								Send progress report
							</Button>
							<Button variant="secondary" icon={RefreshCw} loading={refresh.isPending} onClick={() => refresh.mutate({ name })}>
								Refresh totals
							</Button>
							<Button variant="secondary" icon={Pencil} onClick={() => setEditing(s)}>
								Edit
							</Button>
							<Button icon={Plus} onClick={() => setSponsorship({ sponsor: s.name, sponsor_name: s.sponsor_name })}>
								Sponsor a student
							</Button>
						</>
					) : null
				}
			>
				{s ? (
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<Badge status={s.status} />
						{s.user ? <Badge tone="green">Portal access</Badge> : <Badge tone="gray">No portal login</Badge>}
					</div>
				) : null}
			</PageHeader>
			<QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
				{() => (
					<>
						<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
							<StatCard label="Committed" value={money(d.summary.committed, { compact: true })} />
							<StatCard
								label="Disbursed"
								value={money(d.summary.disbursed, { compact: true })}
								tone="green"
								hint={d.summary.committed ? `${pct((100 * d.summary.disbursed) / d.summary.committed)} of pledge` : null}
							/>
							<StatCard label="Students" value={num(d.summary.students)} icon={GraduationCap} hint={`${num(d.summary.active_sponsorships)} active`} tone="blue" />
							<StatCard label="Students still owe" value={money(d.summary.outstanding_for_students, { compact: true })} tone={d.summary.outstanding_for_students > 0 ? "orange" : "green"} />
							<StatCard label="Other giving" value={money(d.summary.giving_total, { compact: true })} tone="gold" />
						</div>
						<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
							<div className="min-w-0">
								<Tabs
									className="mb-4"
									active={tab}
									onChange={setTab}
									tabs={[
										{ id: "students", label: "Sponsored students", count: d.sponsorships.length },
										{ id: "payments", label: "Fee payments", count: d.payments.length },
										{ id: "giving", label: "Giving", count: d.giving.length },
									]}
								/>
								{tab === "students" ? (
									<StudentsTab rows={d.sponsorships} canManage={canManage} onEdit={setSponsorship} onStatus={setStatusRow} />
								) : tab === "payments" ? (
									<PaymentsTab rows={d.payments} />
								) : (
									<GivingTab rows={d.giving} />
								)}
							</div>
							<ProfileCard s={s} summary={d.summary} />
						</div>
					</>
				)}
			</QueryState>
			<SponsorForm initial={editing} onClose={() => setEditing(null)} />
			<SponsorshipForm initial={sponsorship} onClose={() => setSponsorship(null)} />
			<SponsorshipStatusDialog row={statusRow} onClose={() => setStatusRow(null)} />
		</>
	)
}

function StudentsTab({ rows, canManage, onEdit, onStatus }) {
	if (!rows.length) {
		return (
			<Card>
				<Empty icon={GraduationCap} title="No students sponsored yet" subtitle={canManage ? "Use “Sponsor a student” to link this sponsor to a student." : null} />
			</Card>
		)
	}
	return (
		<div className="grid gap-3 md:grid-cols-2">
			{rows.map((r) => {
				const pledge = r.coverage === "Percentage" ? null : r.amount
				const progress = pledge ? (100 * (r.amount_disbursed || 0)) / pledge : null
				return (
					<Card key={r.name} className="p-4">
						<div className="flex items-start gap-3">
							<Avatar name={r.student_name} src={r.photo} size={42} />
							<div className="min-w-0 flex-1">
								<Link to={`/admin/students/${encodeURIComponent(r.student)}`} className="block truncate font-semibold text-ink hover:text-brand-700">
									{r.student_name}
								</Link>
								<div className="truncate text-xs text-ink-soft">{[r.student_number, r.programme, r.year_of_study ? `Year ${r.year_of_study}` : null].filter(Boolean).join(" · ")}</div>
							</div>
							<Badge status={r.status} tone={toneOf(r.status)} size="xs" />
						</div>
						<div className="mt-3 grid grid-cols-3 gap-2 text-xs">
							<div>
								<div className="text-ink-soft">Coverage</div>
								<div className="font-semibold text-ink">{r.coverage === "Percentage" ? `${num(r.percentage)}%` : r.coverage}</div>
							</div>
							<div>
								<div className="text-ink-soft">Disbursed</div>
								<div className="font-semibold text-ink">{money(r.amount_disbursed)}</div>
							</div>
							<div>
								<div className="text-ink-soft">Fee balance</div>
								<div className={r.balance > 0 ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{money(r.balance)}</div>
							</div>
						</div>
						{progress != null ? (
							<div className="mt-3">
								<div className="mb-1 flex justify-between text-xs text-ink-soft">
									<span>Pledged {money(pledge)}</span>
									<span>{pct(progress)}</span>
								</div>
								<ProgressBar value={progress} tone={progress >= 100 ? "green" : "brand"} size="sm" />
							</div>
						) : null}
						<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-soft">
							<span>
								{[r.start_term, r.end_term].filter(Boolean).join(" → ") || "Open-ended"}
								{r.reporting_frequency && r.reporting_frequency !== "None" ? ` · ${r.reporting_frequency} reports` : ""}
							</span>
							{canManage ? (
								<span className="flex gap-1">
									<button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(r)}>
										<Pencil size={13} /> Edit
									</button>
									<button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus(r)}>
										<Repeat2 size={13} /> Status
									</button>
								</span>
							) : null}
						</div>
					</Card>
				)
			})}
		</div>
	)
}

const PAY_COLS = [
	{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date), sortValue: (r) => r.posting_date },
	{
		key: "name",
		label: "Receipt",
		render: (r) => (
			<Link to={`/admin/finance/payments/${encodeURIComponent(r.name)}`} className="font-semibold text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
				{r.name}
			</Link>
		),
	},
	{ key: "student", label: "Student", hideOnMobile: true },
	{ key: "mode_of_payment", label: "Mode", hideOnMobile: true },
	{ key: "reference_no", label: "Reference", hideOnMobile: true, render: (r) => r.reference_no || "—" },
	{ key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount), sortValue: (r) => r.amount },
]

function PaymentsTab({ rows }) {
	const total = rows.reduce((s, r) => s + (r.amount || 0), 0)
	return (
		<DataTable
			cols={PAY_COLS}
			rows={rows}
			empty="No fee payments from this sponsor yet. Finance records them against the student's account."
			footer={<div className="flex justify-between text-sm"><span className="text-ink-soft">{num(rows.length)} payments (latest 50)</span><span className="font-semibold">{money(total)}</span></div>}
		/>
	)
}

const GIVE_COLS = [
	{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date), sortValue: (r) => r.posting_date },
	{ key: "giving_type", label: "Type" },
	{ key: "purpose", label: "Purpose", hideOnMobile: true, render: (r) => r.purpose || "—" },
	{ key: "mode_of_payment", label: "Mode", hideOnMobile: true },
	{ key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount), sortValue: (r) => r.amount },
]

function GivingTab({ rows }) {
	return (
		<DataTable
			cols={GIVE_COLS}
			rows={rows}
			rowTo={() => "/admin/church/giving"}
			empty="No offerings or donations recorded for this sponsor."
		/>
	)
}

function ProfileCard({ s, summary }) {
	const pledgePct = summary.committed ? (100 * summary.disbursed) / summary.committed : 0
	return (
		<div className="space-y-4">
			<Panel title="Pledged vs paid">
				<div className="space-y-3">
					<ProgressBar value={pledgePct} tone={pledgePct >= 100 ? "green" : "gold"} />
					<div className="flex justify-between text-sm">
						<span className="text-ink-soft">Paid</span>
						<span className="font-semibold">{money(summary.disbursed)}</span>
					</div>
					<div className="flex justify-between text-sm">
						<span className="text-ink-soft">Pledged</span>
						<span className="font-semibold">{money(summary.committed)}</span>
					</div>
					<div className="flex justify-between text-sm">
						<span className="text-ink-soft">Still to come</span>
						<span className="font-semibold">{money(Math.max(0, summary.committed - summary.disbursed))}</span>
					</div>
				</div>
			</Panel>
			<Panel title="Profile">
				<KeyValueGrid
					className="sm:!grid-cols-1"
					items={[
						{ label: "Contact person", value: s.contact_person || "—" },
						{
							label: "Email",
							value: s.email ? (
								<a className="inline-flex max-w-full items-center gap-1 text-brand-700 hover:underline" href={`mailto:${s.email}`}>
									<Mail size={13} className="shrink-0" /> <span className="min-w-0 break-all">{s.email}</span>
								</a>
							) : (
								"—"
							),
						},
						{
							label: "Phone",
							value: s.phone ? (
								<a className="inline-flex max-w-full items-center gap-1 text-brand-700 hover:underline" href={`tel:${s.phone}`}>
									<Phone size={13} className="shrink-0" /> {s.phone}
								</a>
							) : (
								"—"
							),
						},
						{ label: "Prefers", value: s.preferred_communication || "—" },
						{
							label: "Partner church",
							value: s.partner_church ? (
								<Link className="text-brand-700 hover:underline" to={`/admin/church/churches?church=${encodeURIComponent(s.partner_church)}`}>
									{s.partner_church}
								</Link>
							) : (
								"—"
							),
						},
						{ label: "Address", value: s.address || "—" },
						{ label: "Portal login", value: s.user || "None" },
					]}
				/>
				{s.notes ? (
					<Alert tone="info" className="mt-4" title="Notes">
						<span className="whitespace-pre-line">{s.notes}</span>
					</Alert>
				) : null}
			</Panel>
		</div>
	)
}
