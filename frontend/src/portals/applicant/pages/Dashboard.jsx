import { useState } from "react"
import { Link } from "react-router-dom"
import {
	ArrowRight,
	BookOpenCheck,
	ClipboardList,
	CreditCard,
	FilePlus2,
	FileText,
	FolderOpen,
	LifeBuoy,
	MessageCircleQuestion,
	Smartphone,
	Upload,
} from "lucide-react"
import { useSession } from "@/shared/session"
import { Alert, Button, Empty, PageHeader, Panel, QueryState, Skeleton } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, greeting, money } from "@/shared/utils/format"
import { CLOSED_STATUSES, FEE_PAYABLE_STATUSES, docChecklist, draftProgress, journey, since } from "../lib"
import { useApplication, useMyApplications, useOptions } from "../hooks"
import { AppStatus, FeeBadge } from "../components/AppStatus"
import { DocChecklist } from "../components/DocChecklist"
import { NextActionCard, resolveNextAction } from "../components/NextAction"
import { PayFeeDialog } from "../components/PayFeeDialog"
import { ProgrammeCard } from "../components/ProgrammeCard"
import { JourneyTrack } from "../components/JourneyTrack"

const pickCurrent = (apps) => apps.find((a) => !CLOSED_STATUSES.includes(a.status)) || apps[0]

export default function Dashboard() {
	const session = useSession()
	const list = useMyApplications()
	const first = (session.full_name || "").split(" ")[0]
	return (
		<>
			<PageHeader
				eyebrow="Admissions"
				title={`${greeting()}${first ? `, ${first}` : ""}`}
				subtitle="Apply, upload your documents, pay and follow every step of your admission."
				actions={
					list.data?.data?.length ? (
						<Link to="/applicant/apply" className="btn btn-secondary">
							<FilePlus2 size={16} /> New application
						</Link>
					) : null
				}
			/>
			<QueryState query={list} skeleton={<DashboardSkeleton />} isEmpty={(d) => !d?.data?.length} empty={<Welcome name={first} />}>
				{(d) => <Overview apps={d.data} />}
			</QueryState>
		</>
	)
}

function DashboardSkeleton() {
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<Skeleton className="h-80 lg:col-span-2" />
			<Skeleton className="h-80" />
		</div>
	)
}

function Overview({ apps }) {
	const session = useSession()
	const current = pickCurrent(apps)
	const detail = useApplication(current.name)
	const options = useOptions()
	const [paying, setPaying] = useState(false)
	const app = detail.data ? { ...current, ...detail.data } : current
	const checklist = detail.data ? docChecklist(detail.data, options.data) : null
	const j = journey(app)
	const action = resolveNextAction(app, { checklist, progress: draftProgress(detail.data, options.data), portals: session.portals })
	const others = apps.filter((a) => a.name !== current.name)
	const docsLink = app.status === "Draft" ? `/applicant/apply?application=${app.name}&step=4` : "/applicant/documents"
	const feePayable = app.fee_status !== "Paid" && app.fee_status !== "Waived" && FEE_PAYABLE_STATUSES.includes(app.status)

	return (
		<div className="space-y-5">
			<div className="grid gap-5 lg:grid-cols-3">
				<section className="card overflow-hidden lg:col-span-2" aria-label="Current application">
					<div className="hero-wash relative px-5 py-5 text-white sm:px-6">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
									{app.status === "Draft" ? "Draft application" : `Application ${app.name}`}
								</div>
								<h2 className="mt-1 font-serif text-2xl leading-tight text-white">{app.programme_name}</h2>
								<p className="mt-1.5 text-sm text-white/75">
									{[app.intake, app.campus, app.study_mode].filter(Boolean).join(" · ")}
								</p>
							</div>
							<div className="flex flex-wrap gap-1.5">
								<AppStatus status={app.status} />
								{app.fee_status && app.status !== "Draft" ? <FeeBadge status={app.fee_status} /> : null}
							</div>
						</div>
					</div>
					<div className="space-y-5 p-5 sm:p-6">
						{j.closed ? (
							<Alert tone={app.status === "Rejected" ? "error" : "warning"} title={j.steps[j.current]?.label}>
								{j.steps[j.current]?.note || `This application was closed${app.modified ? ` ${since(app.modified)}` : ""}.`}
							</Alert>
						) : (
							<div>
								<div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Your journey</div>
								<JourneyTrack steps={j.steps} />
								{j.steps[j.current]?.note ? <p className="mt-2 text-sm text-ink-muted">{j.steps[j.current].note}</p> : null}
							</div>
						)}
						{detail.isLoading ? <Skeleton className="h-24" /> : <NextActionCard action={action} onPay={() => setPaying(true)} />}
						<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
							<span>
								{app.submitted_on ? `Submitted ${date(app.submitted_on)}` : `Started ${date(app.creation)}`}
								{app.modified ? ` · updated ${since(app.modified)}` : ""}
							</span>
							<Link to={`/applicant/application/${app.name}`} className="link inline-flex items-center gap-1 font-semibold">
								View full application <ArrowRight size={14} />
							</Link>
						</div>
					</div>
				</section>

				<div className="space-y-5">
					<Panel title="Documents" icon={FolderOpen} actions={<Link to={docsLink} className="link text-xs font-semibold">Manage</Link>}>
						{checklist ? <DocChecklist checklist={checklist} uploadTo={checklist.missing.length ? docsLink : null} /> : <Skeleton className="h-40" />}
					</Panel>
					<Panel title="Application fee" icon={CreditCard} actions={<Link to="/applicant/payments" className="link text-xs font-semibold">Payments</Link>}>
						<div className="flex items-center justify-between gap-3">
							<div>
								<div className="text-2xl font-semibold tabular-nums text-ink">{money(app.application_fee)}</div>
								<div className="mt-1">
									<FeeBadge status={app.fee_status} appStatus={app.status} />
								</div>
							</div>
							{feePayable ? (
								<Button variant="gold" icon={Smartphone} onClick={() => setPaying(true)}>
									Pay now
								</Button>
							) : null}
						</div>
						{app.fee_payment ? <p className="mt-3 text-xs text-ink-soft">Receipt {app.fee_payment}</p> : null}
						{feePayable && app.status === "Draft" ? (
							<p className="mt-3 text-xs text-ink-soft">You can pay now or straight after submitting. Review starts once it's paid.</p>
						) : null}
					</Panel>
				</div>
			</div>

			<div className="grid gap-5 lg:grid-cols-3">
				<Panel
					className="lg:col-span-2"
					title={others.length ? "Your other applications" : "Your applications"}
					icon={ClipboardList}
					bodyClass="p-0"
					actions={
						<div className="flex items-center gap-1">
							<Link to="/applicant/application" className="btn btn-ghost btn-sm hidden sm:inline-flex">
								View all
							</Link>
							<Link to="/applicant/apply" className="btn btn-ghost btn-sm">
								<FilePlus2 size={14} /> Apply for another
							</Link>
						</div>
					}
				>
					<DataTable
						rows={others.length ? others : apps}
						rowKey="name"
						rowTo={(r) => `/applicant/application/${r.name}`}
						pageSize={5}
						cols={[
							{
								key: "programme_name",
								label: "Programme",
								render: (r) => (
									<div className="min-w-0">
										<div className="truncate font-medium text-ink">{r.programme_name}</div>
										<div className="text-xs text-ink-soft">{r.name}</div>
									</div>
								),
							},
							{ key: "intake", label: "Intake", hideOnMobile: true },
							{ key: "status", label: "Status", render: (r) => <AppStatus status={r.status} size="xs" /> },
							{ key: "modified", label: "Updated", hideOnMobile: true, render: (r) => <span className="text-ink-muted">{date(r.modified)}</span>, sortValue: (r) => r.modified },
						]}
					/>
				</Panel>
				<HelpPanel />
			</div>
			<PayFeeDialog app={app} open={paying} onClose={() => setPaying(false)} />
		</div>
	)
}

function HelpPanel() {
	return (
		<Panel title="Need help?" icon={LifeBuoy}>
			<ul className="space-y-3 text-sm">
				<li className="flex gap-3">
					<BookOpenCheck size={18} className="mt-0.5 shrink-0 text-brand-700" aria-hidden />
					<span className="text-ink-muted">
						Check the <Link to="/admissions" className="link">entry requirements</Link> and <Link to="/programmes" className="link">programmes</Link>.
					</span>
				</li>
				<li className="flex gap-3">
					<Upload size={18} className="mt-0.5 shrink-0 text-brand-700" aria-hidden />
					<span className="text-ink-muted">Clear phone photos or scans of your documents are fine — PDF, JPG or PNG up to 10 MB.</span>
				</li>
				<li className="flex gap-3">
					<MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-brand-700" aria-hidden />
					<span className="text-ink-muted">
						Questions? <Link to="/contact?type=Admissions" className="link">Contact the admissions office</Link>.
					</span>
				</li>
			</ul>
		</Panel>
	)
}

const HOW = [
	{ icon: ClipboardList, title: "Choose a programme", text: "Pick your programme, campus, study mode and intake." },
	{ icon: FileText, title: "Tell us about yourself", text: "Personal details, church background and education." },
	{ icon: Upload, title: "Upload documents", text: "ID, passport photo, KCSE or equivalent, recommendation." },
	{ icon: Smartphone, title: "Pay & submit", text: "Pay the application fee by M-Pesa and get your number." },
]

function Welcome({ name }) {
	const options = useOptions()
	return (
		<div className="space-y-6">
			<section className="hero-wash relative overflow-hidden rounded-3xl px-6 py-8 text-white shadow-lift sm:px-10 sm:py-10">
				<div className="pattern-dots pointer-events-none absolute inset-0 opacity-20" aria-hidden />
				<div className="relative max-w-2xl">
					<div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-300">Welcome{name ? `, ${name}` : ""}</div>
					<h2 className="mt-2 font-serif text-3xl leading-tight text-white sm:text-4xl">Begin your journey at Mahanaim Bible College</h2>
					<p className="mt-3 text-white/80">
						Applying takes about 20 minutes. Your progress is saved as you go, so you can stop and come back any time.
					</p>
					<div className="mt-6 flex flex-wrap gap-3">
						<Link to="/applicant/apply" className="btn btn-gold btn-lg">
							Start an application <ArrowRight size={18} />
						</Link>
						<Link to="/programmes" className="btn btn-lg border border-white/30 bg-white/10 text-white hover:bg-white/20">
							Browse programmes
						</Link>
					</div>
				</div>
			</section>

			<ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{HOW.map((s, i) => (
					<li key={s.title} className="card flex gap-3 p-4">
						<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
							<s.icon size={19} aria-hidden />
						</span>
						<div>
							<div className="text-xs font-semibold text-gold-700">Step {i + 1}</div>
							<div className="font-semibold text-ink">{s.title}</div>
							<p className="mt-0.5 text-xs text-ink-muted">{s.text}</p>
						</div>
					</li>
				))}
			</ol>

			<section>
				<div className="mb-3 flex items-end justify-between gap-3">
					<div>
						<h2 className="font-serif text-xl text-ink">Programmes open for applications</h2>
						<p className="text-sm text-ink-muted">Choose one to start — you can change it before you submit.</p>
					</div>
				</div>
				<QueryState
					query={options}
					skeleton={
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{[0, 1, 2].map((i) => (
								<Skeleton key={i} className="h-48" />
							))}
						</div>
					}
					isEmpty={(d) => !d?.programmes?.length}
					empty={<Empty icon={ClipboardList} title="No programmes are open right now" subtitle="Please check back soon — new intakes are announced on our website." />}
				>
					{(d) => (
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{d.programmes.slice(0, 6).map((p) => (
								<ProgrammeCard key={p.name} programme={p} />
							))}
						</div>
					)}
				</QueryState>
			</section>
		</div>
	)
}
