import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, Banknote, CalendarHeart, FileText, GraduationCap, HandCoins, HandHeart, Smartphone, Wallet } from "lucide-react"
import { Avatar, Badge, Empty, ErrorState, Modal, Panel, Skeleton, StatCard } from "@/shared/components/ui"
import { useSession } from "@/shared/session"
import { date, greeting, money } from "@/shared/utils/format"
import { CONTRIBUTION_TONE, contributionText, isNoProfile, thisYear } from "../lib"
import { useContributions, useProfile, useProgresses, useStudents } from "../hooks"
import { NoSponsorProfile } from "../components/NoSponsorProfile"
import { PayForStudentDialog } from "../components/PayForStudentDialog"
import { StudentCard, StudentCardSkeleton } from "../components/StudentCard"
import { Amount, Resp } from "../components/Amount"

export default function Dashboard() {
	const session = useSession()
	const profile = useProfile()
	const students = useStudents()
	const contributions = useContributions()
	const list = useMemo(() => students.data?.data || [], [students.data])
	const progresses = useProgresses(list.slice(0, 6).map((s) => s.student))
	const [payFor, setPayFor] = useState(null)
	const [picking, setPicking] = useState(false)

	if (profile.isError && isNoProfile(profile.error)) return <NoSponsorProfile />

	const p = profile.data?.profile
	const summary = profile.data?.summary
	const items = contributions.data?.data || []
	const year = thisYear()
	const thisYearTotal = items.filter((c) => String(c.date).startsWith(year)).reduce((s, c) => s + Number(c.amount || 0), 0)
	const name = p?.contact_person || session.full_name
	const payFees = () => (list.length === 1 ? setPayFor(list[0]) : setPicking(true))

	return (
		<>
			<section className="hero-wash relative mb-5 overflow-hidden rounded-2xl px-5 py-6 text-white sm:px-7">
				<div className="pattern-dots pointer-events-none absolute inset-0 opacity-20" aria-hidden />
				<div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
					<div className="min-w-0">
						<div className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-200">Partner portal</div>
						<h1 className="mt-1 font-serif text-[1.7rem] leading-tight text-white">
							{greeting()}, {String(name || "friend").split(" ").slice(0, 2).join(" ")}
						</h1>
						{profile.isLoading ? (
							<Skeleton className="mt-2 h-4 w-56 opacity-40" />
						) : p ? (
							<p className="mt-1 text-sm text-white/80">
								{p.sponsor_name}
								{p.sponsor_type ? ` · ${p.sponsor_type}` : ""}
								{p.partner_church_name ? ` · ${p.partner_church_name}` : ""}
							</p>
						) : null}
						<p className="mt-3 max-w-xl text-sm text-white/75">Thank you for investing in the next generation of ministers. Here's how your students are doing.</p>
					</div>
					<div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap">
						<button type="button" className="btn btn-gold" onClick={payFees} disabled={!list.length}>
							<Smartphone size={16} /> Pay student fees
						</button>
						<Link to="/sponsor/giving#give" className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20">
							<HandHeart size={16} /> Give online
						</Link>
						<Link to="/sponsor/reports" className="btn border border-white/30 bg-white/10 text-white hover:bg-white/20">
							<FileText size={16} /> Statement
						</Link>
					</div>
				</div>
			</section>

			{profile.isError ? <ErrorState error={profile.error} onRetry={() => profile.refetch()} className="card mb-5" /> : null}

			<div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard
					label="Students"
					value={summary?.students}
					icon={GraduationCap}
					tone="brand"
					loading={profile.isLoading}
					hint={summary ? <Resp short={`${summary.active_sponsorships} active`}>{`${summary.active_sponsorships} active sponsorship${summary.active_sponsorships === 1 ? "" : "s"}`}</Resp> : null}
					to="/sponsor/students"
				/>
				<StatCard label="Committed" value={summary ? <Amount value={summary.committed} /> : null} icon={HandCoins} tone="gold" loading={profile.isLoading} hint={summary ? <Resp short={`${money(summary.disbursed, { compact: true })} paid`}>{`${money(summary.disbursed)} disbursed`}</Resp> : null} />
				<StatCard
					label={<Resp short="This year">{`Given in ${year}`}</Resp>}
					value={<Amount value={thisYearTotal} />}
					icon={CalendarHeart}
					tone="green"
					loading={contributions.isLoading}
					hint={contributions.data ? <Resp short={`${money(contributions.data.totals?.all, { compact: true })} total`}>{`${money(contributions.data.totals?.all)} all time`}</Resp> : null}
					to="/sponsor/giving"
				/>
				<StatCard
					label={<Resp short="Fees due">Fees outstanding</Resp>}
					value={summary ? <Amount value={summary.outstanding_for_students} /> : null}
					icon={Wallet}
					tone={summary?.outstanding_for_students > 0 ? "orange" : "green"}
					loading={profile.isLoading}
					hint={<Resp short="all students">across your students</Resp>}
				/>
			</div>

			<section className="mb-6">
				<div className="mb-3 flex items-end justify-between gap-3">
					<div>
						<h2 className="font-serif text-xl text-ink">Your students</h2>
						<p className="text-sm text-ink-muted">Programme, academic standing and fees for each student you support.</p>
					</div>
					{list.length > 6 ? (
						<Link to="/sponsor/students" className="btn btn-ghost btn-sm">
							All {list.length} <ArrowRight size={14} />
						</Link>
					) : null}
				</div>
				{students.isLoading ? (
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<StudentCardSkeleton />
						<StudentCardSkeleton />
						<StudentCardSkeleton />
					</div>
				) : students.isError ? (
					<div className="card">
						<ErrorState error={students.error} onRetry={() => students.refetch()} />
					</div>
				) : !list.length ? (
					<div className="card">
						<Empty
							icon={GraduationCap}
							title="No sponsored students yet"
							subtitle="When the college links a student to your sponsorship, their progress and fees will appear here."
							action={
								<Link to="/contact?type=Partnerships" className="btn btn-secondary">
									Sponsor a student
								</Link>
							}
						/>
					</div>
				) : (
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						{list.slice(0, 6).map((s, i) => (
							<StudentCard key={s.student} s={s} progress={progresses[i]} onPay={setPayFor} />
						))}
					</div>
				)}
			</section>

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
				<Panel
					title="Recent contributions"
					icon={Banknote}
					bodyClass="p-0"
					actions={
						<Link to="/sponsor/giving" className="btn btn-ghost btn-sm">
							View all <ArrowRight size={14} />
						</Link>
					}
				>
					{contributions.isLoading ? (
						<div className="space-y-3 p-5">
							<Skeleton className="h-10" />
							<Skeleton className="h-10" />
							<Skeleton className="h-10" />
						</div>
					) : contributions.isError ? (
						<ErrorState error={contributions.error} onRetry={() => contributions.refetch()} />
					) : !items.length ? (
						<Empty compact icon={HandCoins} title="No contributions yet" subtitle="Fee payments and gifts you make will be listed here." />
					) : (
						<ul className="divide-y divide-line">
							{items.slice(0, 6).map((c) => (
								<li key={`${c.type}-${c.name}`} className="flex items-center gap-3 px-5 py-3">
									<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cream text-gold-700">
										{c.type === "Giving" ? <HandHeart size={16} aria-hidden /> : <GraduationCap size={16} aria-hidden />}
									</span>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-semibold text-ink">{contributionText(c)}</div>
										<div className="flex items-center gap-2 text-xs text-ink-soft">
											{date(c.date)}
											<Badge tone={CONTRIBUTION_TONE[c.type]} size="xs">
												{c.type === "Giving" ? "Gift" : c.type}
											</Badge>
										</div>
									</div>
									<div className="shrink-0 text-sm font-bold text-ink">{money(c.amount)}</div>
								</li>
							))}
						</ul>
					)}
				</Panel>
				<Panel title="Quick actions">
					<div className="space-y-2">
						<button type="button" onClick={payFees} disabled={!list.length} className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left transition hover:bg-cream/60 disabled:opacity-50">
							<span className="grid h-9 w-9 place-items-center rounded-lg bg-gold-50 text-gold-700">
								<Smartphone size={17} aria-hidden />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-semibold text-ink">Pay a student's fees</span>
								<span className="block text-xs text-ink-soft">M-Pesa STK push, receipt instantly</span>
							</span>
						</button>
						<QuickLink to="/sponsor/giving#give" icon={HandHeart} title="Give to the college" text="Scholarships, missions, projects" />
						<QuickLink to="/sponsor/reports" icon={FileText} title="Download a statement" text="Print or export your contributions" />
						<QuickLink to="/sponsor/profile" icon={GraduationCap} title="Update your details" text="Contact person and preferences" />
					</div>
				</Panel>
			</div>

			<Modal open={picking} onClose={() => setPicking(false)} title="Pay fees for…" subtitle="Choose the student you'd like to pay for" size="sm">
				<ul className="divide-y divide-line">
					{list.map((s) => (
						<li key={s.student}>
							<button
								type="button"
								className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-cream/60"
								onClick={() => {
									setPicking(false)
									setPayFor(s)
								}}
							>
								<Avatar name={s.full_name} src={s.photo} size={36} />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-semibold text-ink">{s.full_name}</span>
									<span className="block truncate text-xs text-ink-soft">{s.programme_name}</span>
								</span>
								<span className={s.fee_balance > 0 ? "text-sm font-semibold text-amber-700 dark:text-amber-300" : "text-xs text-ink-soft"}>
									{s.fee_balance > 0 ? money(s.fee_balance) : "Paid up"}
								</span>
							</button>
						</li>
					))}
				</ul>
			</Modal>
			<PayForStudentDialog student={payFor} open={Boolean(payFor)} onClose={() => setPayFor(null)} />
		</>
	)
}

function QuickLink({ to, icon: Icon, title, text }) {
	return (
		<Link to={to} className="flex items-center gap-3 rounded-xl border border-line p-3 transition hover:bg-cream/60">
			<span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700">
				<Icon size={17} aria-hidden />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-semibold text-ink">{title}</span>
				<span className="block text-xs text-ink-soft">{text}</span>
			</span>
			<ArrowRight size={15} className="text-ink-soft" aria-hidden />
		</Link>
	)
}
