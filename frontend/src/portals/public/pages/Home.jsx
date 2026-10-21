import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, CalendarDays, Clock, GraduationCap, HandHeart, Laptop, MapPin, Newspaper, PlayCircle, Sparkles, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Avatar, Empty, ErrorState } from "@/shared/components/ui"
import { date, daysUntil, num } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { Band, CtaBand, Container, Feature, Scripture, SectionHeading, Steps } from "../components/Blocks"
import { CardGridSkeleton, EventCard, ListSkeleton, NewsCard, ProgrammeCard } from "../components/Cards"
import { NamedIcon } from "../components/NamedIcon"
import { DEFAULT_STEPS, PATHWAYS, VERSES, WHY_MBC } from "../content"
import { W, bareName, useCountUp, useInstitution, usePageMeta } from "../lib"

function HeroSkeleton() {
	return (
		<div className="space-y-4" aria-hidden>
			<div className="h-3 w-48 animate-pulse rounded bg-white/15" />
			<div className="h-12 w-full max-w-xl animate-pulse rounded-lg bg-white/15" />
			<div className="h-12 w-4/5 max-w-lg animate-pulse rounded-lg bg-white/15" />
			<div className="h-4 w-3/4 max-w-md animate-pulse rounded bg-white/10" />
		</div>
	)
}

function Stat({ value, label }) {
	const [ref, n] = useCountUp(value)
	return (
		<div ref={ref} className="px-4 py-6 text-center sm:px-6">
			<div className="font-serif text-3xl font-bold text-brand-800 sm:text-4xl">
				{num(n)}
				<span className="text-gold-500">+</span>
			</div>
			<div className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">{label}</div>
		</div>
	)
}

function HeroAside({ hero, intake, inst }) {
	if (hero?.image) {
		return (
			<div className="relative mx-auto w-full max-w-md lg:max-w-none">
				<div className="overflow-hidden rounded-[2rem] shadow-lift ring-1 ring-white/20">
					<img src={hero.image} alt="" className="aspect-[4/5] w-full object-cover" />
				</div>
				<IntakeCard intake={intake} className="absolute -bottom-6 -left-4 sm:-left-8" />
			</div>
		)
	}
	return (
		<div className="relative mx-auto w-full max-w-md lg:max-w-none">
			<div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.06] p-7 shadow-lift backdrop-blur-sm sm:p-9">
				<div aria-hidden className="absolute -right-16 -top-16 h-48 w-48 rounded-full border-[18px] border-gold-500/15" />
				<div className="relative">
					<div className="eyebrow text-gold-300">Why “Mahanaim”?</div>
					<Scripture verse={VERSES.mahanaim} dark size="sm" className="mt-4" />
					<p className="mt-5 border-t border-white/10 pt-5 text-sm leading-relaxed text-white/70">
						Mahanaim means <em className="font-serif text-gold-200">“two camps”</em>, the place where God’s host met Jacob. {inst.short} is
						a meeting place where God meets those He is sending into His harvest.
					</p>
				</div>
			</div>
			<IntakeCard intake={intake} className="relative -mt-6 ml-auto mr-2 sm:-mr-4" />
		</div>
	)
}

function IntakeCard({ intake, className }) {
	const days = intake ? daysUntil(intake.application_close_date) : null
	return (
		<Link
			to="/admissions#intakes"
			className={clsx("flex w-[260px] items-center gap-3 rounded-2xl bg-surface p-4 text-ink shadow-lift ring-1 ring-line transition hover:-translate-y-0.5", className)}
		>
			<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold-500 text-brand-900">
				<CalendarDays size={20} />
			</span>
			<span className="min-w-0">
				<span className="block text-[11px] font-bold uppercase tracking-wider text-gold-700">{intake ? "Next intake" : "Admissions"}</span>
				<span className="block truncate text-sm font-semibold">{intake ? intake.name : "Applications are open"}</span>
				<span className="block text-xs text-ink-soft">
					{intake
						? days != null && days >= 0
							? `Apply by ${date(intake.application_close_date)}`
							: `Starts ${date(intake.start_date)}`
						: "Apply online in minutes"}
				</span>
			</span>
		</Link>
	)
}

export default function Home() {
	const inst = useInstitution()
	usePageMeta(null)
	const q = useApi(`${W}home`, {}, { guest: true })
	const d = q.data || {}
	const hero = d.hero || {}
	const stats = (d.stats || []).filter((s) => Number(s.value) > 0)
	const about = d.about || {}
	const intakes = (d.admissions?.intakes || []).filter((i) => (daysUntil(i.application_close_date) ?? 0) >= 0)
	const steps = d.admissions?.steps?.length ? d.admissions.steps : DEFAULT_STEPS
	const ctaTo = safeUrl(hero.cta_link) || "/apply"
	const ctaExternal = !ctaTo.startsWith("/")
	const videoUrl = safeUrl(hero.video_url)

	return (
		<>
			{/* ───────────── Hero ───────────── */}
			<section className="hero-wash relative overflow-hidden text-white">
				<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
				<div aria-hidden className="pointer-events-none absolute -left-40 top-1/3 h-[28rem] w-[28rem] rounded-full border border-white/5" />
				<div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[34rem] w-[34rem] rounded-full border border-gold-400/10" />
				<Container className="relative grid gap-14 pb-24 pt-[124px] sm:pb-28 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16 lg:pb-32 lg:pt-[150px]">
					<div className="min-w-0 animate-fade-up">
						{q.isLoading ? (
							<HeroSkeleton />
						) : (
							<>
								<div className="inline-flex items-center gap-2 rounded-full border border-gold-400/30 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-gold-300">
									<Sparkles size={13} /> {hero.eyebrow || inst.motto}
								</div>
								<h1 className="mt-6 font-serif text-[36px] text-white leading-[1.1] sm:text-5xl lg:text-[58px]">
									{hero.title || `Equipping servants for the harvest`}
								</h1>
								<p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg">
									{hero.subtitle || about.summary || "Biblical, practical theological training for pastors, evangelists, missionaries and lay leaders."}
								</p>
							</>
						)}
						<div className="mt-9 flex flex-wrap gap-3">
							{ctaExternal ? (
								<a href={ctaTo} className="btn btn-gold btn-lg">
									{hero.cta_label || "Apply now"} <ArrowRight size={18} />
								</a>
							) : (
								<Link to={ctaTo} className="btn btn-gold btn-lg">
									{hero.cta_label || "Apply now"} <ArrowRight size={18} />
								</Link>
							)}
							<Link to="/programmes" className="btn btn-lg border border-white/25 text-white hover:bg-white/10">
								Explore programmes
							</Link>
							{videoUrl ? (
								<a href={videoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-lg text-white/85 hover:bg-white/10">
									<PlayCircle size={20} /> Watch the story
								</a>
							) : null}
						</div>
						<ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/65">
							<li className="inline-flex items-center gap-2">
								<GraduationCap size={16} className="text-gold-300" /> Certificate to degree
							</li>
							<li className="inline-flex items-center gap-2">
								<Laptop size={16} className="text-gold-300" /> On campus or online
							</li>
							<li className="inline-flex items-center gap-2">
								<Clock size={16} className="text-gold-300" /> Day, evening and weekend classes
							</li>
						</ul>
					</div>
					<div className="min-w-0 animate-fade-up [animation-delay:120ms]">
						<HeroAside hero={hero} intake={intakes[0]} inst={inst} />
					</div>
				</Container>
			</section>

			{/* ───────────── Stats ───────────── */}
			<Container className="relative z-10 -mt-12 sm:-mt-14">
				<div className="card grid grid-cols-2 gap-px overflow-hidden bg-line shadow-lift lg:grid-cols-4 [&>*]:bg-surface">
					{q.isLoading
						? Array.from({ length: 4 }).map((_, i) => (
								<div key={i} className="space-y-2 px-6 py-6">
									<div className="skeleton mx-auto h-8 w-24" />
									<div className="skeleton mx-auto h-3 w-28" />
								</div>
							))
						: (stats.length
								? stats
								: [
										{ key: "modes", label: "Ways to study", value: 5 },
										{ key: "levels", label: "Levels of study", value: 4 },
										{ key: "campus", label: "Digital Campus", value: 1 },
										{ key: "open", label: "Intakes a year", value: 3 },
									]
							).map((s) => <Stat key={s.key || s.label} value={s.value} label={s.label} />)}
				</div>
			</Container>

			{/* ───────────── About ───────────── */}
			<Band>
				<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
					<div>
						<div className="eyebrow">Who we are</div>
						<h2 className="mt-2 font-serif text-[28px] leading-tight text-ink sm:text-4xl">A Bible college for the church in Africa</h2>
						<p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
							{about.summary ||
								`${inst.name} trains pastors, evangelists, missionaries and lay leaders with sound biblical knowledge, godly character and practical ministry skills.`}
						</p>
						{about.values?.length ? (
							<ul className="mt-6 flex flex-wrap gap-2">
								{about.values.map((v) => (
									<li key={v} className="rounded-full border border-gold-200 bg-cream px-3 py-1 text-xs font-semibold text-gold-800">
										{v}
									</li>
								))}
							</ul>
						) : null}
						<Link to="/about" className="link mt-7 inline-flex items-center gap-1.5">
							Our story and statement of faith <ArrowRight size={16} />
						</Link>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="card relative overflow-hidden p-6 sm:col-span-2">
							<div aria-hidden className="pattern-dots absolute inset-y-0 right-0 w-1/3 opacity-50" />
							<div className="eyebrow">Our mission</div>
							<p className="relative mt-2 font-serif text-lg leading-relaxed text-ink">
								{about.mission || "To equip Christian workers with sound biblical knowledge, godly character and practical ministry skills."}
							</p>
						</div>
						<div className="rounded-2xl bg-brand-800 p-6 text-white shadow-card">
							<div className="eyebrow text-gold-300">Our vision</div>
							<p className="mt-2 text-sm leading-relaxed text-white/85">
								{about.vision || "A Spirit-filled, biblically grounded generation of leaders transforming communities for Christ."}
							</p>
						</div>
						<div className="rounded-2xl bg-gold-50 p-6 ring-1 ring-gold-200">
							<Scripture verse={VERSES.faithfulMen} size="sm" />
						</div>
					</div>
				</div>
			</Band>

			{/* ───────────── Programmes ───────────── */}
			<Band tone="cream">
				<SectionHeading
					eyebrow="Programmes"
					title="Find your pathway into ministry"
					subtitle="From a first certificate to a full degree, every programme combines careful study of Scripture with supervised ministry in the local church."
					action={
						<Link to="/programmes" className="btn btn-secondary">
							All programmes <ArrowRight size={16} />
						</Link>
					}
				/>
				{q.isLoading ? (
					<CardGridSkeleton count={3} />
				) : q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : d.programmes?.length ? (
					<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{d.programmes.slice(0, 6).map((p) => (
							<ProgrammeCard key={p.code} p={p} />
						))}
					</div>
				) : (
					<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
						{PATHWAYS.map((p) => (
							<Link
								key={p.level}
								to={`/programmes?level=${encodeURIComponent(p.level)}`}
								className="card group flex flex-col p-6 transition hover:-translate-y-1 hover:shadow-lift"
							>
								<span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-800 text-gold-300">
									<NamedIcon name={p.icon} size={22} />
								</span>
								<h3 className="mt-4 font-serif text-xl text-ink">{p.title}</h3>
								<div className="text-xs font-semibold uppercase tracking-wider text-gold-700">{p.duration}</div>
								<p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{p.text}</p>
								<span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
									Explore <ArrowRight size={14} className="transition group-hover:translate-x-1" />
								</span>
							</Link>
						))}
					</div>
				)}
			</Band>

			{/* ───────────── Why MBC ───────────── */}
			<Band tone="dark">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
					<div>
						<SectionHeading dark eyebrow={`Why ${inst.short}`} title="Formed in the Word, sent into the harvest" className="mb-6" />
						<Scripture verse={VERSES.harvest} dark />
						<Link to="/academics" className="btn btn-gold mt-8">
							Academic life <ArrowRight size={16} />
						</Link>
					</div>
					<div className="grid gap-x-8 gap-y-10 sm:grid-cols-2">
						{WHY_MBC.map((w) => (
							<Feature key={w.title} dark title={w.title} icon={(props) => <NamedIcon name={w.icon} {...props} />}>
								{w.text}
							</Feature>
						))}
					</div>
				</div>
			</Band>

			{/* ───────────── Principal ───────────── */}
			{d.principal?.excerpt ? (
				<Band>
					<div className="card grid overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
						<div className="hero-wash relative flex items-center justify-center p-10">
							<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
							<Avatar name={bareName(d.principal.name)} src={d.principal.photo} size={168} className="relative ring-4 ring-gold-400/40" />
						</div>
						<div className="p-8 sm:p-10">
							<div className="eyebrow">A word from the {d.principal.title || "Principal"}</div>
							<p className="mt-4 font-serif text-xl leading-relaxed text-ink">“{d.principal.excerpt}”</p>
							<div className="mt-6 font-semibold text-ink">{d.principal.name}</div>
							<div className="text-sm text-ink-soft">
								{d.principal.title}, {inst.name}
							</div>
							<Link to="/about#principal" className="link mt-5 inline-flex items-center gap-1.5">
								Read the full welcome <ArrowRight size={16} />
							</Link>
						</div>
					</div>
				</Band>
			) : null}

			{/* ───────────── Testimonials ───────────── */}
			{d.testimonials?.length ? (
				<Band tone={d.principal?.excerpt ? "cream" : "plain"}>
					<SectionHeading align="center" eyebrow="Testimonies" title="Lives shaped for ministry" subtitle="Hear from students and graduates serving across Kenya and beyond." />
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
						{d.testimonials.slice(0, 6).map((t, i) => {
							const name = t.person_name || t.name
							return (
								<figure key={`${name}-${i}`} className="card flex flex-col p-6">
									<span aria-hidden className="font-serif text-5xl leading-none text-gold-400">“</span>
									<blockquote className="-mt-2 flex-1 font-serif text-[15px] italic leading-relaxed text-ink">{t.quote}</blockquote>
									<figcaption className="mt-6 flex items-center gap-3 border-t border-line pt-4">
										<Avatar name={bareName(name)} src={t.photo} size={44} />
										<span className="min-w-0">
											<span className="block truncate font-semibold text-ink">{name}</span>
											<span className="block truncate text-xs text-ink-soft">{[t.role_title, t.programme_name || t.programme].filter(Boolean).join(" · ")}</span>
										</span>
									</figcaption>
								</figure>
							)
						})}
					</div>
				</Band>
			) : null}

			{/* ───────────── Admissions ───────────── */}
			<Band tone="surface">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
					<div>
						<SectionHeading
							eyebrow="Admissions"
							title="Apply online in six simple steps"
							subtitle={d.admissions?.intro || "Everything happens online: create an account, apply, upload documents and pay the application fee by M-Pesa, then follow your application to admission."}
							className="mb-8"
						/>
						<Steps steps={steps} />
					</div>
					<aside id="intakes" className="space-y-4">
						<div className="card p-6">
							<h3 className="font-serif text-xl text-ink">Upcoming intakes</h3>
							{q.isLoading ? (
								<div className="mt-4 space-y-3">
									<div className="skeleton h-14" />
									<div className="skeleton h-14" />
								</div>
							) : intakes.length ? (
								<ul className="mt-4 divide-y divide-line">
									{intakes.slice(0, 4).map((i) => {
										const days = daysUntil(i.application_close_date)
										return (
											<li key={i.name} className="flex items-center justify-between gap-3 py-3">
												<span className="min-w-0">
													<span className="block truncate font-semibold text-ink">{i.name}</span>
													<span className="block text-xs text-ink-soft">Classes begin {date(i.start_date)}</span>
												</span>
												{days != null ? (
													<span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", days <= 14 ? "bg-red-50 text-red-700" : "bg-gold-50 text-gold-800")}>
														{days === 0 ? "Closes today" : `${days} days left`}
													</span>
												) : null}
											</li>
										)
									})}
								</ul>
							) : (
								<p className="mt-3 text-sm leading-relaxed text-ink-muted">
									We admit students several times a year. Start your application now and choose the next available intake.
								</p>
							)}
							<Link to="/apply" className="btn btn-primary mt-5 w-full">
								Start your application <ArrowRight size={16} />
							</Link>
							<Link to="/admissions" className="btn btn-ghost mt-2 w-full">
								Requirements and deadlines
							</Link>
						</div>
						<div className="rounded-2xl bg-cream p-5 text-sm leading-relaxed text-ink-muted ring-1 ring-gold-200">
							<div className="mb-1 font-semibold text-ink">Questions about fees?</div>
							See fee structures, church sponsorship and how to pay by M-Pesa.{" "}
							<Link to="/fees" className="link">
								Fees and funding
							</Link>
						</div>
					</aside>
				</div>
			</Band>

			{/* ───────────── News & events ───────────── */}
			<Band>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
					<div>
						<SectionHeading
							eyebrow="News"
							title="From the campus"
							className="mb-8"
							action={
								<Link to="/news" className="link inline-flex items-center gap-1 text-sm">
									All news <ArrowRight size={14} />
								</Link>
							}
						/>
						{q.isLoading ? (
							<CardGridSkeleton count={2} className="lg:grid-cols-2" />
						) : d.news?.length ? (
							<div className="grid gap-6 sm:grid-cols-2">
								{d.news.slice(0, 4).map((n) => (
									<NewsCard key={n.name} post={n} />
								))}
							</div>
						) : (
							<div className="card">
								<Empty icon={Newspaper} title="Stories are on the way" subtitle="Campus news, devotionals and ministry reports will appear here." />
							</div>
						)}
					</div>
					<div>
						<SectionHeading
							eyebrow="Events"
							title="Join us"
							className="mb-8"
							action={
								<Link to="/events" className="link inline-flex items-center gap-1 text-sm">
									All events <ArrowRight size={14} />
								</Link>
							}
						/>
						{q.isLoading ? (
							<ListSkeleton rows={3} />
						) : d.events?.length ? (
							<div className="space-y-4">
								{d.events.slice(0, 4).map((e) => (
									<EventCard key={e.name} ev={e} compact />
								))}
							</div>
						) : (
							<div className="card">
								<Empty icon={CalendarDays} title="No upcoming events yet" subtitle="Chapel services, conferences, open days and graduations will be listed here." />
							</div>
						)}
						<div className="mt-6 grid grid-cols-2 gap-3">
							<Link to="/contact" className="card flex items-center gap-3 p-4 text-sm font-semibold text-ink transition hover:shadow-soft">
								<MapPin size={18} className="text-gold-600" /> Visit campus
							</Link>
							<Link to="/faculty" className="card flex items-center gap-3 p-4 text-sm font-semibold text-ink transition hover:shadow-soft">
								<Users size={18} className="text-gold-600" /> Our faculty
							</Link>
						</div>
					</div>
				</div>
			</Band>

			{/* ───────────── Give ───────────── */}
			<Band tone="cream">
				<div className="grid gap-10 lg:grid-cols-2 lg:items-center">
					<div>
						<div className="eyebrow">Partner with us</div>
						<h2 className="mt-2 font-serif text-[28px] leading-tight text-ink sm:text-4xl">Send a labourer into the harvest</h2>
						<p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
							Many of our students are called pastors from rural churches who cannot meet the full cost of training. Your gift provides scholarships,
							books, mission outreaches and Digital Campus access, and you can give securely by M-Pesa in under a minute.
						</p>
						<div className="mt-7 flex flex-wrap gap-3">
							<Link to="/give" className="btn btn-primary btn-lg">
								<HandHeart size={18} /> Give online
							</Link>
							<Link to="/contact?type=Partnership" className="btn btn-secondary btn-lg">
								Become a partner church
							</Link>
						</div>
					</div>
					<div className="card p-7 sm:p-9">
						<Scripture verse={VERSES.cheerful} size="lg" />
					</div>
				</div>
			</Band>

			<CtaBand />
		</>
	)
}
