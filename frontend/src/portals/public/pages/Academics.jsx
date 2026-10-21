import { Link } from "react-router-dom"
import {
	ArrowRight,
	BarChart3,
	BookMarked,
	BookOpen,
	CalendarCheck,
	ClipboardCheck,
	FileCheck2,
	HandHeart,
	Laptop,
	Library,
	MonitorPlay,
	Smartphone,
	Users,
} from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Skeleton } from "@/shared/components/ui"
import { Band, CtaBand, Feature, PageHero, Scripture, SectionHeading, Steps } from "../components/Blocks"
import { NamedIcon } from "../components/NamedIcon"
import { PATHWAYS, STUDY_MODES, VERSES } from "../content"
import { W, usePageMeta } from "../lib"

const TERM_FLOW = [
	{ title: "Registration", text: "Register for the term's courses online once the minimum fee is paid." },
	{ title: "Teaching", text: "Lectures on campus or online, with notes, recordings and readings in the Digital Campus." },
	{ title: "Continuous assessment", text: "Assignments, CATs and ministry practicum reports through the term." },
	{ title: "Examinations", text: "End-of-term exams, on campus or supervised online." },
	{ title: "Results", text: "Moderated results and transcripts published in the student portal." },
]

export default function Academics() {
	usePageMeta("Academic life", "Study modes, levels of study, the academic year, assessment and the Digital Campus at the college.")
	const progs = useApi(`${W}programmes`, {}, { guest: true })
	const lookups = useApi(`${W}apply_lookups`, {}, { guest: true })
	const counts = {}
	for (const p of progs.data?.data || []) counts[p.level] = (counts[p.level] || 0) + 1
	const apiModes = lookups.data?.study_modes || []
	const modes = apiModes.length
		? apiModes.map((m) => ({ ...STUDY_MODES.find((s) => s.name === m.name), ...m, description: m.description || STUDY_MODES.find((s) => s.name === m.name)?.description }))
		: STUDY_MODES

	return (
		<>
			<PageHero
				eyebrow="Academics"
				title="Rigorous study. Faithful practice."
				subtitle="Our programmes join careful study of Scripture and theology with prayer, character formation and supervised ministry, so graduates are ready to serve."
				crumbs={[{ label: "Academics" }]}
				actions={
					<>
						<Link to="/programmes" className="btn btn-gold">
							Browse programmes <ArrowRight size={16} />
						</Link>
						<Link to="/e-library" className="btn border border-white/25 text-white hover:bg-white/10">
							<Library size={16} /> E-Library
						</Link>
					</>
				}
			/>

			{/* Levels */}
			<Band>
				<SectionHeading eyebrow="Levels of study" title="A pathway for every stage of ministry" subtitle="Start where you are. Many students progress from certificate to diploma to degree while serving in their churches." />
				<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
					{PATHWAYS.map((p) => (
						<Link
							key={p.level}
							to={`/programmes?level=${encodeURIComponent(p.level)}`}
							className="card group flex flex-col p-6 transition hover:-translate-y-1 hover:shadow-lift"
						>
							<div className="flex items-center justify-between">
								<span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-800 text-gold-300">
									<NamedIcon name={p.icon} size={22} />
								</span>
								{progs.isLoading ? (
									<Skeleton className="h-5 w-16 rounded-full" />
								) : counts[p.level] ? (
									<span className="rounded-full bg-gold-50 px-2.5 py-1 text-[11px] font-bold text-gold-800">
										{counts[p.level]} programme{counts[p.level] === 1 ? "" : "s"}
									</span>
								) : null}
							</div>
							<h3 className="mt-4 font-serif text-xl text-ink">{p.title}</h3>
							<div className="text-xs font-semibold uppercase tracking-wider text-gold-700">{p.duration}</div>
							<p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{p.text}</p>
							<span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
								View programmes <ArrowRight size={14} className="transition group-hover:translate-x-1" />
							</span>
						</Link>
					))}
				</div>
			</Band>

			{/* Study modes */}
			<Band tone="cream" id="modes">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
					<div>
						<SectionHeading eyebrow="Study modes" title="Keep serving while you study" className="mb-6" />
						<p className="text-[15px] leading-relaxed text-ink-muted">
							Most of our students are already in ministry. Choose the mode that fits your calling, your work and your family, and switch between
							modes as your circumstances change, subject to approval.
						</p>
						<div className="mt-8 rounded-2xl bg-surface p-6 ring-1 ring-gold-200">
							<Scripture verse={VERSES.study} size="sm" />
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						{lookups.isLoading
							? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)
							: modes.map((m) => (
									<div key={m.name} className="card p-5">
										<div className="flex items-center gap-3">
											<span className="grid h-10 w-10 place-items-center rounded-xl bg-cream text-gold-700 ring-1 ring-gold-200">
												<NamedIcon name={m.icon || (m.is_online ? "Laptop" : "School")} size={18} />
											</span>
											<h3 className="font-semibold text-ink">{m.name}</h3>
										</div>
										<p className="mt-3 text-sm leading-relaxed text-ink-muted">{m.description || "Contact admissions for the timetable."}</p>
									</div>
								))}
					</div>
				</div>
			</Band>

			{/* Term flow */}
			<Band>
				<SectionHeading eyebrow="The academic year" title="How each term runs" subtitle="The academic year is divided into terms. Dates for each term are published in the academic calendar in the student portal." />
				<Steps steps={TERM_FLOW} cols={5} />
			</Band>

			{/* Formation */}
			<Band tone="dark">
				<SectionHeading dark align="center" eyebrow="Beyond the classroom" title="Formed for ministry, not just informed" />
				<div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
					<Feature dark icon={ClipboardCheck} title="Assessment">
						Continuous assessment (assignments, CATs and practicum) and end-of-term examinations, moderated for fairness.
					</Feature>
					<Feature dark icon={HandHeart} title="Ministry practicum">
						Every student serves in a partner church under a supervising pastor, with regular reports and reflection.
					</Feature>
					<Feature dark icon={Users} title="Chapel and fellowship">
						Chapel services, prayer cells and mentoring groups shape character and community.
					</Feature>
					<Feature dark icon={FileCheck2} title="Verifiable awards">
						Transcripts and certificates carry a QR code that employers and churches can verify online.
					</Feature>
				</div>
			</Band>

			{/* Digital campus */}
			<Band>
				<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
					<div>
						<SectionHeading eyebrow="Digital Campus" title="Your whole college in your pocket" className="mb-6" />
						<p className="text-[15px] leading-relaxed text-ink-muted">
							Students, lecturers, sponsors and partner churches share one secure online campus. It works on any phone and makes distance learning
							as rich as being on campus.
						</p>
						<div className="mt-6 flex flex-wrap gap-3">
							<Link to="/apply" className="btn btn-primary">
								Apply online <ArrowRight size={16} />
							</Link>
							<Link to="/signin" className="btn btn-secondary">
								Student sign in
							</Link>
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						{[
							[MonitorPlay, "Lessons and live classes", "Recorded lectures, notes and live sessions for every course."],
							[BookOpen, "Assignments and exams", "Submit work, sit timed exams and get feedback online."],
							[BarChart3, "Results and transcripts", "See grades, GPA and progress through your programme."],
							[Smartphone, "M-Pesa payments", "Pay fees from your phone and download receipts instantly."],
							[BookMarked, "E-Library", "E-books, journals, commentaries and sermon archives."],
							[CalendarCheck, "Timetable and attendance", "Your classes, chapel and events in one calendar."],
						].map(([Icon, title, text]) => (
							<div key={title} className="card flex gap-3 p-4">
								<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-800 text-gold-300">
									<Icon size={18} />
								</span>
								<div>
									<div className="font-semibold text-ink">{title}</div>
									<p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{text}</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</Band>

			<Band tone="cream" className="!py-12">
				<div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
					<div className="flex items-center gap-4">
						<span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-800 text-gold-300">
							<Laptop size={24} />
						</span>
						<div>
							<h2 className="font-serif text-2xl text-ink">Explore the E-Library</h2>
							<p className="text-sm text-ink-muted">Search books, journals and theses; members can borrow and read online.</p>
						</div>
					</div>
					<Link to="/e-library" className="btn btn-primary">
						Open the catalogue <ArrowRight size={16} />
					</Link>
				</div>
			</Band>

			<CtaBand />
		</>
	)
}
