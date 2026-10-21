import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import clsx from "clsx"
import {
	ArrowLeft,
	ArrowRight,
	Award,
	BookOpen,
	Briefcase,
	Building2,
	CalendarDays,
	CheckCircle2,
	Clock,
	GraduationCap,
	Laptop,
	Layers,
	ListChecks,
	MapPin,
	Wallet,
} from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Empty, ErrorState, Html, Skeleton, Tabs } from "@/shared/components/ui"
import { date, daysUntil, money, num } from "@/shared/utils/format"
import { Band, Breadcrumbs, Container, CtaBand } from "../components/Blocks"
import { REQUIREMENTS, STUDY_MODES } from "../content"
import { W, isHtml, lines, usePageMeta } from "../lib"

function Rich({ html, className }) {
	if (!html) return null
	if (isHtml(html)) return <Html html={html} className={className} />
	const items = lines(html)
	if (items.length > 1)
		return (
			<ul className={clsx("space-y-2", className)}>
				{items.map((l, i) => (
					<li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-muted">
						<CheckCircle2 size={18} className="mt-0.5 shrink-0 text-gold-600" /> {l}
					</li>
				))}
			</ul>
		)
	return <p className={clsx("whitespace-pre-line text-[15px] leading-7 text-ink-muted", className)}>{html}</p>
}

function Block({ id, icon: Icon, title, children }) {
	return (
		<section id={id} className="scroll-mt-28 border-b border-line py-10 first:pt-0 last:border-b-0">
			<h2 className="mb-5 flex items-center gap-3 font-serif text-2xl text-ink">
				<span className="grid h-10 w-10 place-items-center rounded-xl bg-cream text-gold-700 ring-1 ring-gold-200">
					<Icon size={19} />
				</span>
				{title}
			</h2>
			{children}
		</section>
	)
}

function Curriculum({ terms }) {
	const years = useMemo(() => [...new Set(terms.map((t) => t.year))].sort((a, b) => a - b), [terms])
	const [year, setYear] = useState(years[0])
	const current = terms.filter((t) => t.year === (years.includes(year) ? year : years[0]))
	return (
		<div>
			{years.length > 1 ? <Tabs tabs={years.map((y) => ({ id: y, label: `Year ${y}` }))} active={years.includes(year) ? year : years[0]} onChange={setYear} className="mb-5" /> : null}
			<div className="space-y-5">
				{current.map((t) => (
					<div key={t.label} className="overflow-hidden rounded-2xl border border-line">
						<div className="flex items-center justify-between gap-3 bg-cream/70 px-5 py-3">
							<div className="font-semibold text-ink">{t.label || `Year ${t.year}, Term ${t.term}`}</div>
							{t.credits ? <span className="text-xs font-semibold text-ink-soft">{num(t.credits)} credits</span> : null}
						</div>
						<ul className="divide-y divide-line">
							{t.courses.map((c) => (
								<li key={`${c.course_code}-${c.title}`} className="flex items-center gap-3 px-5 py-3 text-sm">
									<span className="w-20 shrink-0 font-mono text-xs text-ink-soft">{c.course_code}</span>
									<span className="min-w-0 flex-1 font-medium text-ink">{c.title}</span>
									{c.type && c.type !== "Core" ? <Badge tone={c.type === "Elective" ? "blue" : "gold"}>{c.type}</Badge> : null}
									{c.credits ? <span className="w-12 shrink-0 text-right text-xs text-ink-soft">{num(c.credits)} cr</span> : null}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</div>
	)
}

function ApplyCard({ p, intakes, className }) {
	const next = intakes[0]
	const days = next ? daysUntil(next.application_close_date) : null
	return (
		<div className={clsx("card overflow-hidden", className)}>
			<div className="hero-wash relative px-6 py-5 text-white">
				<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
				<div className="relative">
					<div className="text-[11px] font-bold uppercase tracking-widest text-gold-300">Applications open</div>
					<div className="mt-1 font-serif text-xl leading-snug">{p.name}</div>
				</div>
			</div>
			<dl className="divide-y divide-line px-6 text-sm">
				{p.indicative_fee_per_term ? (
					<div className="flex justify-between gap-3 py-3">
						<dt className="text-ink-soft">Tuition (indicative)</dt>
						<dd className="text-right font-semibold text-ink">{money(p.indicative_fee_per_term, { currency: p.fees?.currency })}/term</dd>
					</div>
				) : null}
				{p.application_fee ? (
					<div className="flex justify-between gap-3 py-3">
						<dt className="text-ink-soft">Application fee</dt>
						<dd className="text-right font-semibold text-ink">{money(p.application_fee, { currency: p.fees?.currency })}</dd>
					</div>
				) : null}
				{p.duration ? (
					<div className="flex justify-between gap-3 py-3">
						<dt className="text-ink-soft">Duration</dt>
						<dd className="text-right font-semibold text-ink">{p.duration}</dd>
					</div>
				) : null}
				<div className="flex justify-between gap-3 py-3">
					<dt className="text-ink-soft">Next intake</dt>
					<dd className="text-right font-semibold text-ink">
						{next ? (
							<>
								{next.name}
								{days != null && days >= 0 ? <span className="block text-xs font-medium text-gold-700">Closes {date(next.application_close_date)}</span> : null}
							</>
						) : (
							"Contact admissions"
						)}
					</dd>
				</div>
			</dl>
			<div className="space-y-2 p-6 pt-3">
				<Link to={`/apply?programme=${encodeURIComponent(p.code)}`} className="btn btn-gold btn-lg w-full">
					Apply for this programme <ArrowRight size={18} />
				</Link>
				<Link to="/contact?type=Admissions" className="btn btn-ghost w-full">
					Ask a question
				</Link>
			</div>
		</div>
	)
}

function DetailSkeleton() {
	return (
		<>
			<section className="hero-wash">
				<Container className="space-y-4 py-16">
					<div className="h-3 w-40 animate-pulse rounded bg-white/15" />
					<div className="h-10 w-2/3 animate-pulse rounded-lg bg-white/15" />
					<div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
				</Container>
			</section>
			<Container className="grid gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_360px]">
				<div className="space-y-4">
					<Skeleton className="h-6 w-1/3" />
					<Skeleton className="h-4" />
					<Skeleton className="h-4 w-5/6" />
					<Skeleton className="h-40 rounded-2xl" />
				</div>
				<Skeleton className="h-80 rounded-2xl" />
			</Container>
		</>
	)
}

/** True once `ref` has scrolled into (or above) the viewport, so the mobile apply bar gets out of the way. */
function usePassed() {
	const ref = useRef(null)
	const [passed, setPassed] = useState(false)
	useEffect(() => {
		const el = ref.current
		if (!el || typeof IntersectionObserver === "undefined") return undefined
		const io = new IntersectionObserver(([e]) => setPassed(e.isIntersecting || e.boundingClientRect.top < 0))
		io.observe(el)
		return () => io.disconnect()
	})
	return [ref, passed]
}

export default function ProgrammeDetail() {
	const { code } = useParams()
	const [sentinel, barHidden] = usePassed()
	const q = useApi(`${W}programme`, { code }, { guest: true })
	const p = q.data
	usePageMeta(p?.name || (q.isError ? "Programme not found" : "Programme"), p?.overview || p?.short_description)

	if (q.isLoading) return <DetailSkeleton />
	if (q.isError) {
		const missing = q.error?.status === 404 || q.error?.exc_type === "DoesNotExistError"
		return (
			<Band>
				<div className="card">
					{missing ? (
						<Empty
							icon={GraduationCap}
							title="We couldn't find that programme"
							subtitle={`There is no published programme with the code “${code}”. It may have been renamed or withdrawn.`}
							action={
								<Link to="/programmes" className="btn btn-primary">
									<ArrowLeft size={16} /> Browse all programmes
								</Link>
							}
						/>
					) : (
						<ErrorState error={q.error} onRetry={() => q.refetch()} />
					)}
				</div>
			</Band>
		)
	}

	const terms = p.curriculum || []
	const intakes = p.intakes || []
	const structures = p.fees?.structures || []
	const requirementsFallback = REQUIREMENTS.find((r) => r.level === p.level || (r.level === "Degree" && p.level === "Bachelor"))
	const modeInfo = (m) => STUDY_MODES.find((s) => s.name === m)?.description
	const nav = [
		["overview", "Overview"],
		["entry", "Entry requirements"],
		terms.length ? ["curriculum", "Curriculum"] : null,
		["fees", "Fees"],
		["study", "Study options"],
		p.career_paths ? ["careers", "Careers"] : null,
	].filter(Boolean)

	return (
		<>
			<section className="hero-wash relative overflow-hidden text-white">
				<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
				{p.image ? <img src={p.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" /> : null}
				<div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full border border-white/10" />
				<Container className="relative py-12 sm:py-16">
					<Breadcrumbs items={[{ label: "Programmes", to: "/programmes" }, { label: p.name }]} />
					<div className="flex flex-wrap items-center gap-2">
						<span className="rounded-full bg-gold-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-900">{p.level}</span>
						<span className="rounded-full border border-white/20 px-3 py-1 font-mono text-[11px] text-white/80">{p.code}</span>
						{p.department ? <span className="text-xs text-white/60">{p.department}</span> : null}
					</div>
					<h1 className="mt-4 max-w-4xl animate-fade-up font-serif text-[32px] text-white leading-[1.15] sm:text-5xl">{p.name}</h1>
					{p.award_title ? <div className="mt-2 text-sm font-semibold text-gold-200">Award: {p.award_title}</div> : null}
					{p.overview || p.short_description ? <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/75 sm:text-lg">{p.overview || p.short_description}</p> : null}
					<dl className="mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
						{[
							[Clock, "Duration", p.duration || "—"],
							[Layers, "Terms / year", p.terms_per_year || "—"],
							[Award, "Credits", p.total_credits ? num(p.total_credits) : "—"],
							[Laptop, "Study modes", p.study_modes?.length || "—"],
						].map(([Icon, label, value]) => (
							<div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
								<Icon size={18} className="text-gold-300" />
								<dt className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">{label}</dt>
								<dd className="font-serif text-lg">{value}</dd>
							</div>
						))}
					</dl>
				</Container>
			</section>

			<div className="no-print sticky top-[76px] z-30 border-b border-line bg-surface/95 backdrop-blur">
				<Container>
					<nav className="scroll-thin -mx-1 flex gap-1 overflow-x-auto py-2" aria-label="On this page">
						{nav.map(([id, label]) => (
							<a key={id} href={`#${id}`} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-brand-50 hover:text-ink">
								{label}
							</a>
						))}
					</nav>
				</Container>
			</div>

			<Container className="grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-16">
				<div className="min-w-0">
					<Block id="overview" icon={BookOpen} title="Programme overview">
						{p.description ? (
							<Rich html={p.description} />
						) : (
							<p className="text-[15px] leading-7 text-ink-muted">
								{p.overview || p.short_description || "Full programme details will be published soon. Contact admissions for the current prospectus."}
							</p>
						)}
						{p.min_cgpa_to_graduate ? (
							<p className="mt-5 rounded-xl bg-cream px-4 py-3 text-sm text-ink-muted ring-1 ring-gold-200">
								To graduate you need to pass all required courses
								{p.total_credits ? ` (${num(p.total_credits)} credits)` : ""} with a cumulative GPA of at least{" "}
								<strong className="text-ink">{p.min_cgpa_to_graduate}</strong>.
							</p>
						) : null}
					</Block>

					<Block id="entry" icon={ListChecks} title="Entry requirements">
						{p.entry_requirements ? (
							<Rich html={p.entry_requirements} />
						) : p.minimum_entry ? (
							<Rich html={p.minimum_entry} />
						) : (
							<p className="text-[15px] leading-7 text-ink-muted">
								{requirementsFallback?.text || "A clear Christian testimony, a recommendation from your church and the academic qualifications for this level."}
							</p>
						)}
						{p.entry_requirements && p.minimum_entry ? (
							<p className="mt-4 text-sm text-ink-muted">
								<strong className="text-ink">Minimum entry:</strong> {p.minimum_entry}
							</p>
						) : null}
						<Link to="/admissions#documents" className="link mt-5 inline-flex items-center gap-1 text-sm">
							Documents you will need <ArrowRight size={14} />
						</Link>
					</Block>

					{terms.length ? (
						<Block id="curriculum" icon={GraduationCap} title="Curriculum">
							<Curriculum terms={terms} />
							<p className="mt-4 text-xs text-ink-soft">The curriculum is reviewed regularly; course offerings may change slightly from year to year.</p>
						</Block>
					) : null}

					<Block id="fees" icon={Wallet} title="Fees">
						{structures.length ? (
							<div className="space-y-5">
								{structures.map((s, i) => (
									<div key={`${s.title}-${i}`} className="overflow-hidden rounded-2xl border border-line">
										<div className="flex flex-wrap items-center justify-between gap-2 bg-cream/70 px-5 py-3">
											<div>
												<div className="font-semibold text-ink">{s.title}</div>
												<div className="text-xs text-ink-soft">
													{[s.year_of_study ? `Year ${s.year_of_study}` : null, s.academic_term, s.study_mode, s.campus].filter(Boolean).join(" · ")}
												</div>
											</div>
											<div className="font-serif text-lg font-bold text-brand-800">{money(s.total, { currency: p.fees?.currency })}</div>
										</div>
										{s.items?.length ? (
											<ul className="divide-y divide-line text-sm">
												{s.items.map((it, j) => (
													<li key={j} className="flex justify-between gap-3 px-5 py-2.5">
														<span className="text-ink-muted">{it.description || it.component}</span>
														<span className="font-medium text-ink">{money(it.amount, { currency: p.fees?.currency })}</span>
													</li>
												))}
											</ul>
										) : null}
									</div>
								))}
							</div>
						) : p.indicative_fee_per_term ? (
							<div className="flex items-center gap-4 rounded-2xl border border-line p-5">
								<span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-800 text-gold-300">
									<Wallet size={20} />
								</span>
								<div>
									<div className="font-serif text-2xl font-bold text-brand-800">
										{money(p.indicative_fee_per_term, { currency: p.fees?.currency })}
										<span className="text-sm font-normal text-ink-soft"> per term (indicative)</span>
									</div>
									<div className="text-xs text-ink-soft">The detailed fee structure is issued with your admission letter.</div>
								</div>
							</div>
						) : (
							<p className="text-[15px] text-ink-muted">The fee structure for this programme will be published soon. Contact the finance office for the current fees.</p>
						)}
						<p className="mt-4 text-sm text-ink-muted">
							Pay by M-Pesa from the student portal, in instalments each term. Church sponsorship and bursaries are available.{" "}
							<Link to="/fees" className="link">
								Fees and funding
							</Link>
						</p>
					</Block>

					<Block id="study" icon={Laptop} title="Study options">
						{p.study_modes?.length ? (
							<div className="grid gap-3 sm:grid-cols-2">
								{p.study_modes.map((m) => (
									<div key={m} className="rounded-2xl border border-line p-4">
										<div className="font-semibold text-ink">{m}</div>
										{modeInfo(m) ? <p className="mt-1 text-sm text-ink-muted">{modeInfo(m)}</p> : null}
									</div>
								))}
							</div>
						) : (
							<p className="text-[15px] text-ink-muted">Study modes for this programme will be confirmed at admission.</p>
						)}
						{(p.campus_details?.length || p.campuses?.length) ? (
							<div className="mt-6">
								<h3 className="label">Offered at</h3>
								<div className="grid gap-3 sm:grid-cols-2">
									{(p.campus_details?.length ? p.campus_details : p.campuses.map((name) => ({ name }))).map((c) => (
										<div key={c.name} className="flex gap-3 rounded-2xl border border-line p-4 text-sm">
											<Building2 size={18} className="mt-0.5 shrink-0 text-gold-600" />
											<div>
												<div className="font-semibold text-ink">{c.name}</div>
												{[c.town, c.county].some(Boolean) ? (
													<div className="flex items-center gap-1 text-xs text-ink-soft">
														<MapPin size={12} /> {[c.town, c.county].filter(Boolean).join(", ")}
													</div>
												) : null}
											</div>
										</div>
									))}
								</div>
							</div>
						) : null}
						{intakes.length ? (
							<div className="mt-6">
								<h3 className="label">Open intakes</h3>
								<ul className="grid gap-3 sm:grid-cols-2">
									{intakes.map((i) => (
										<li key={i.name} className="flex gap-3 rounded-2xl border border-line p-4 text-sm">
											<CalendarDays size={18} className="mt-0.5 shrink-0 text-gold-600" />
											<div>
												<div className="font-semibold text-ink">{i.name}</div>
												<div className="text-xs text-ink-soft">
													Starts {date(i.start_date)}
													{i.application_close_date ? ` · apply by ${date(i.application_close_date)}` : ""}
												</div>
											</div>
										</li>
									))}
								</ul>
							</div>
						) : null}
					</Block>

					{p.career_paths ? (
						<Block id="careers" icon={Briefcase} title="Where this leads">
							<Rich html={p.career_paths} />
						</Block>
					) : null}
				</div>

				<aside className="hidden lg:block">
					<ApplyCard p={p} intakes={intakes} className="sticky top-[140px]" />
				</aside>
			</Container>

			{/* Mobile apply bar */}
			<div
				className={clsx(
					"no-print fixed inset-x-0 bottom-0 z-30 transition-transform duration-300 lg:hidden",
					barHidden && "translate-y-full"
				)}
			>
				<div className="border-t border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur safe-bottom">
					<div className="mx-auto flex max-w-xl items-center gap-3">
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold text-ink">{p.name}</div>
							<div className="text-xs text-ink-soft">{p.indicative_fee_per_term ? `${money(p.indicative_fee_per_term)}/term` : p.duration || p.level}</div>
						</div>
						<Link to={`/apply?programme=${encodeURIComponent(p.code)}`} className="btn btn-gold shrink-0">
							Apply <ArrowRight size={16} />
						</Link>
					</div>
				</div>
			</div>

			<div ref={sentinel} aria-hidden />
			<CtaBand
				title="Your calling deserves careful preparation"
				text="Create your account, complete the application form and pay the application fee by M-Pesa, all online."
				primary={{ label: "Apply for this programme", to: `/apply?programme=${encodeURIComponent(p.code)}` }}
				secondary={{ label: "All programmes", to: "/programmes" }}
			/>
		</>
	)
}
