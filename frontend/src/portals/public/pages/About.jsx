import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, BadgeCheck, BookOpen, Building2, Compass, Eye, Laptop, Mail, MapPin, Phone, QrCode, ScrollText, ShieldCheck, Target, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Avatar, ErrorState, Html, Skeleton } from "@/shared/components/ui"
import { num } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { Band, CtaBand, Feature, PageHero, Scripture, SectionHeading } from "../components/Blocks"
import { PersonCard } from "../components/Cards"
import { PersonModal } from "../components/PersonModal"
import { STATEMENT_OF_FAITH, VERSES } from "../content"
import { W, bareName, isHtml, prettyPhone, useHashScroll, useInstitution, usePageMeta } from "../lib"

function RichOr({ html, children }) {
	if (!html) return children
	return isHtml(html) ? <Html html={html} /> : <p className="whitespace-pre-line text-[15px] leading-7 text-ink-muted">{html}</p>
}

export default function About() {
	const inst = useInstitution()
	const q = useApi(`${W}about`, {}, { guest: true })
	const d = q.data || {}
	const [person, setPerson] = useState(null)
	usePageMeta("About us", d.summary)
	useHashScroll(q.isSuccess)
	const stats = d.stats || {}
	const statRows = [
		["students", "Students trained"],
		["graduates", "Graduates in ministry"],
		["churches", "Partner churches"],
		["years", "Years of training"],
	].filter(([k]) => Number(stats[k]) > 0)

	return (
		<>
			<PageHero
				eyebrow="About us"
				title={`${inst.motto.charAt(0).toUpperCase()}${inst.motto.slice(1)}`}
				subtitle={d.summary || `${inst.name} trains pastors, evangelists, missionaries and lay leaders for the church in Africa and beyond.`}
				crumbs={[{ label: "About" }]}
				actions={
					<>
						<a href="#faith" className="btn btn-gold">
							Statement of faith
						</a>
						<a href="#campuses" className="btn border border-white/25 text-white hover:bg-white/10">
							Our campuses
						</a>
					</>
				}
			/>

			{q.isError ? (
				<Band>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Band>
			) : null}

			{/* Mission, vision, values */}
			<Band>
				<div className="grid gap-6 md:grid-cols-3">
					{[
						{ icon: Target, title: "Our mission", text: d.mission || "To equip Christian workers with sound biblical knowledge, godly character and practical ministry skills." },
						{ icon: Eye, title: "Our vision", text: d.vision || "A Spirit-filled, biblically grounded generation of leaders transforming communities for Christ." },
						{ icon: Compass, title: "Our motto", text: `“${inst.motto}”: every course, chapel and practicum points to the harvest field.` },
					].map(({ icon: Icon, title, text }) => (
						<div key={title} className="card p-7">
							<span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-800 text-gold-300">
								<Icon size={22} />
							</span>
							<h2 className="mt-4 font-serif text-xl text-ink">{title}</h2>
							{q.isLoading ? (
								<div className="mt-3 space-y-2">
									<Skeleton className="h-3" />
									<Skeleton className="h-3 w-4/5" />
								</div>
							) : (
								<p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{text}</p>
							)}
						</div>
					))}
				</div>
				{d.values?.length ? (
					<div className="mt-10 rounded-2xl border border-gold-200 bg-cream/70 p-6 sm:p-8">
						<div className="eyebrow">Core values</div>
						<ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{d.values.map((v) => (
								<li key={v} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3 font-semibold text-ink ring-1 ring-line">
									<BadgeCheck size={18} className="shrink-0 text-gold-600" /> {v}
								</li>
							))}
						</ul>
					</div>
				) : null}
			</Band>

			{/* Story */}
			<Band tone="surface" id="history">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
					<div>
						<SectionHeading eyebrow="Our story" title="A meeting place with God’s host" className="mb-6" />
						{q.isLoading ? (
							<div className="space-y-3">
								<Skeleton className="h-4" />
								<Skeleton className="h-4 w-11/12" />
								<Skeleton className="h-4 w-4/5" />
							</div>
						) : (
							<RichOr html={d.history || d.body}>
								<div className="prose-mbc">
									<p>
										The college takes its name from Genesis 32, where Jacob, returning home, was met by the angels of God and called the place
										<em> Mahanaim</em>, “two camps”. It is a picture of what we long to be: a place where God meets His people and prepares them for
										the road ahead.
									</p>
									<p>
										{inst.name} began with a simple burden: that the church in Kenya would have shepherds who know the Word, love the flock and preach
										Christ faithfully. Many of the pastors and evangelists who came to us were already serving and could not leave their congregations,
										so we built our programmes around them, with day, evening and weekend classes and, today, a full Digital Campus.
									</p>
									<p>
										Today our students come from many denominations and regions. They study together, pray together and serve in partner churches
										across the country, and our graduates now pastor congregations, plant churches, lead missions and teach the next generation.
									</p>
								</div>
							</RichOr>
						)}
						{d.history && d.body ? (
							<div className="mt-6">
								<RichOr html={d.body} />
							</div>
						) : null}
					</div>
					<aside className="space-y-6">
						<div className="hero-wash relative overflow-hidden rounded-3xl p-8 text-white shadow-lift">
							<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
							<Scripture verse={VERSES.mahanaim} dark className="relative" />
						</div>
						{statRows.length ? (
							<div className="grid grid-cols-2 gap-3">
								{statRows.map(([k, label]) => (
									<div key={k} className="card p-5 text-center">
										<div className="font-serif text-3xl font-bold text-brand-800">
											{num(stats[k])}
											<span className="text-gold-500">+</span>
										</div>
										<div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{label}</div>
									</div>
								))}
							</div>
						) : null}
					</aside>
				</div>
			</Band>

			{/* Principal */}
			{d.principal?.message || d.principal?.name ? (
				<Band id="principal">
					<div className="card grid overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
						<div className="hero-wash relative flex flex-col items-center justify-center gap-4 p-10 text-center text-white">
							<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
							<Avatar name={bareName(d.principal.name) || "Principal"} src={d.principal.photo} size={176} className="relative ring-4 ring-gold-400/40" />
							<div className="relative">
								<div className="font-serif text-xl">{d.principal.name}</div>
								<div className="text-sm text-gold-200">{d.principal.title || "Principal"}</div>
							</div>
						</div>
						<div className="p-8 sm:p-10">
							<div className="eyebrow">Welcome from the {d.principal.title || "Principal"}</div>
							<div className="mt-4">
								<RichOr html={d.principal.message}>
									<p className="text-[15px] leading-7 text-ink-muted">
										Welcome to {inst.name}. Whether you are exploring a call to ministry or already serving, we would be glad to walk with you.
									</p>
								</RichOr>
							</div>
						</div>
					</div>
				</Band>
			) : null}

			{/* Statement of faith */}
			<Band tone="cream" id="faith">
				<SectionHeading
					eyebrow="What we believe"
					title="Statement of faith"
					subtitle="We are an evangelical, interdenominational college. Every member of faculty affirms these convictions, and students study within them."
				/>
				{q.isLoading ? (
					<div className="grid gap-4 md:grid-cols-2">
						{Array.from({ length: 4 }).map((_, i) => (
							<Skeleton key={i} className="h-24 rounded-2xl" />
						))}
					</div>
				) : d.statement_of_faith ? (
					<div className="card p-7 sm:p-10">
						<RichOr html={d.statement_of_faith} />
					</div>
				) : (
					<ol className="grid gap-4 md:grid-cols-2">
						{STATEMENT_OF_FAITH.map(([title, text], i) => (
							<li key={title} className="card flex gap-4 p-6">
								<span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-800 font-serif text-sm font-bold text-gold-300">{i + 1}</span>
								<div>
									<h3 className="font-serif text-lg text-ink">{title}</h3>
									<p className="mt-1 text-sm leading-relaxed text-ink-muted">{text}</p>
								</div>
							</li>
						))}
					</ol>
				)}
			</Band>

			{/* Leadership */}
			<Band id="leadership">
				<SectionHeading
					eyebrow="Leadership"
					title="Those who lead and teach"
					subtitle="Our leaders are scholars and practising ministers who model the life they teach."
					action={
						<Link to="/faculty" className="btn btn-secondary">
							Meet the faculty <ArrowRight size={16} />
						</Link>
					}
				/>
				<Scripture verse={VERSES.remember} size="sm" className="mb-10 max-w-2xl" />
				{q.isLoading ? (
					<div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
						{Array.from({ length: 4 }).map((_, i) => (
							<Skeleton key={i} className="h-64 rounded-2xl" />
						))}
					</div>
				) : d.leadership?.length ? (
					<div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
						{d.leadership.map((p) => (
							<PersonCard key={p.name} person={p} onClick={() => setPerson(p)} />
						))}
					</div>
				) : (
					<div className="card flex flex-col items-center gap-3 p-10 text-center">
						<span className="grid h-12 w-12 place-items-center rounded-2xl bg-cream text-gold-600">
							<Users size={22} />
						</span>
						<div className="font-semibold text-ink">Leadership profiles are being updated</div>
						<p className="max-w-md text-sm text-ink-soft">Visit the faculty page or contact us to learn more about the people who serve at {inst.short}.</p>
					</div>
				)}
			</Band>

			{/* Campuses */}
			<Band tone="surface" id="campuses">
				<SectionHeading eyebrow="Campuses" title="Where we study and gather" subtitle="Study on campus with a community of believers, or join from anywhere through the Digital Campus." />
				{q.isLoading ? (
					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{Array.from({ length: 3 }).map((_, i) => (
							<Skeleton key={i} className="h-56 rounded-2xl" />
						))}
					</div>
				) : (
					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{(d.campuses || []).map((c) => (
							<article key={c.name} className="card overflow-hidden">
								<div className="hero-wash relative h-32">
									{c.image ? <img src={c.image} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : null}
									<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
									<Building2 size={40} strokeWidth={1.25} className="absolute bottom-3 right-4 text-white/25" />
									{c.is_main_campus ? (
										<span className="absolute left-4 top-4 rounded-full bg-gold-500 px-2.5 py-1 text-[11px] font-bold text-brand-900">Main campus</span>
									) : null}
								</div>
								<div className="space-y-2 p-6 text-sm">
									<h3 className="font-serif text-xl text-ink">{c.name}</h3>
									{[c.address, c.town, c.county].some(Boolean) ? (
										<div className="flex gap-2 text-ink-muted">
											<MapPin size={16} className="mt-0.5 shrink-0 text-gold-600" />
											{[c.address, c.town, c.county].filter(Boolean).join(", ")}
										</div>
									) : null}
									{c.phone ? (
										<a href={`tel:${c.phone}`} className="flex gap-2 text-ink-muted hover:text-ink">
											<Phone size={16} className="mt-0.5 shrink-0 text-gold-600" /> {prettyPhone(c.phone)}
										</a>
									) : null}
									{c.email ? (
										<a href={`mailto:${c.email}`} className="flex gap-2 text-ink-muted hover:text-ink">
											<Mail size={16} className="mt-0.5 shrink-0 text-gold-600" /> {c.email}
										</a>
									) : null}
									{safeUrl(c.map_url) ? (
										<a href={safeUrl(c.map_url)} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 pt-1">
											Get directions <ArrowRight size={14} />
										</a>
									) : null}
								</div>
							</article>
						))}
						{!d.campuses?.length ? (
							<article className="card overflow-hidden">
								<div className="hero-wash relative h-32">
									<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
									<Building2 size={40} strokeWidth={1.25} className="absolute bottom-3 right-4 text-white/25" />
									<span className="absolute left-4 top-4 rounded-full bg-gold-500 px-2.5 py-1 text-[11px] font-bold text-brand-900">Main campus</span>
								</div>
								<div className="space-y-2 p-6 text-sm text-ink-muted">
									<h3 className="font-serif text-xl text-ink">{inst.name}</h3>
									<p>Day, evening and weekend classes, chapel, library and student fellowship.</p>
									<Link to="/contact" className="link inline-flex items-center gap-1 pt-1">
										Directions and contacts <ArrowRight size={14} />
									</Link>
								</div>
							</article>
						) : null}
						<article className="card overflow-hidden">
							<div className="relative h-32 bg-gradient-to-br from-gold-600 via-brand-800 to-brand-900">
								<div aria-hidden className="pattern-dots absolute inset-0 opacity-30" />
								<Laptop size={40} strokeWidth={1.25} className="absolute bottom-3 right-4 text-white/25" />
								<span className="absolute left-4 top-4 rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-brand-800">Online</span>
							</div>
							<div className="space-y-2 p-6 text-sm text-ink-muted">
								<h3 className="font-serif text-xl text-ink">Digital Campus</h3>
								<p>Recorded and live lessons, assignments, exams, the e-library and M-Pesa payments, all from your phone or laptop.</p>
								<Link to="/academics#modes" className="link inline-flex items-center gap-1 pt-1">
									Study online <ArrowRight size={14} />
								</Link>
							</div>
						</article>
					</div>
				)}
			</Band>

			{/* Quality */}
			<Band>
				<SectionHeading eyebrow="Quality and integrity" title="Credentials you can trust" align="center" subtitle="We hold ourselves accountable to the church, to our students and to employers." />
				<div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
					<Feature icon={ScrollText} title="Governed curriculum">
						Programmes are approved and reviewed by the Academic Board, with external examiners moderating assessment.
					</Feature>
					<Feature icon={BookOpen} title="Qualified faculty">
						Lecturers hold recognised theological qualifications and are actively serving in ministry.
					</Feature>
					<Feature icon={ShieldCheck} title="Protected records">
						Student records are kept securely in line with the Kenya Data Protection Act, 2019.
					</Feature>
					<Feature icon={QrCode} title="Verifiable documents">
						Every certificate and transcript carries a QR code employers can check instantly.{" "}
						<Link to="/verify" className="link">
							Verify a document
						</Link>
					</Feature>
				</div>
			</Band>

			<CtaBand />
			<PersonModal person={person} onClose={() => setPerson(null)} />
		</>
	)
}
