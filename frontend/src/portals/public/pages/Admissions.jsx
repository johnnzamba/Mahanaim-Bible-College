import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, CalendarDays, CheckCircle2, Clock, FileText, Smartphone, UserCheck, Wallet } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Skeleton } from "@/shared/components/ui"
import { date, daysUntil, money } from "@/shared/utils/format"
import { Band, CtaBand, PageHero, Scripture, SectionHeading, Steps } from "../components/Blocks"
import { FaqBlock } from "../components/FaqBlock"
import { DEFAULT_STEPS, DOCUMENTS, REQUIREMENTS, VERSES } from "../content"
import { W, useHashScroll, usePageMeta } from "../lib"

const STEP_NOTES = [
	"Sign up with your email address and confirm it with a one-time code.",
	"Pick the programme, campus, study mode and intake that suit you.",
	"Tell us about yourself, your church and your previous education.",
	"Upload your ID, certificates, photo and pastor’s recommendation.",
	"Pay the application fee from your phone; we confirm it instantly.",
	"Follow every stage online and download your admission letter.",
]

export default function Admissions() {
	usePageMeta("Admissions", "How to apply to the college: entry requirements, intakes and deadlines, documents and the application fee.")
	const home = useApi(`${W}home`, {}, { guest: true })
	const lookups = useApi(`${W}apply_lookups`, {}, { guest: true })
	const adm = home.data?.admissions || {}
	const steps = (adm.steps?.length ? adm.steps : DEFAULT_STEPS).map((title, i) => ({
		title,
		text: adm.steps?.length && adm.steps[i] !== DEFAULT_STEPS[i] ? null : STEP_NOTES[i],
	}))
	const intakes = lookups.data?.intakes?.length ? lookups.data.intakes : adm.intakes || []
	const fee = lookups.data?.application_fee
	const currency = lookups.data?.currency
	useHashScroll(home.isSuccess && lookups.isSuccess)

	return (
		<>
			<PageHero
				eyebrow="Admissions"
				title="Your journey to ministry training starts here"
				subtitle={adm.intro || "Apply online in about 20 minutes. We review every application prayerfully and personally, and most applicants hear from us within two weeks."}
				crumbs={[{ label: "Admissions" }]}
				actions={
					<>
						<Link to="/apply" className="btn btn-gold btn-lg">
							Start your application <ArrowRight size={18} />
						</Link>
						<Link to="/fees" className="btn btn-lg border border-white/25 text-white hover:bg-white/10">
							Fees and funding
						</Link>
					</>
				}
				aside={
					<div className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-sm">
						<ul className="space-y-4 text-sm">
							{[
								[Clock, "About 20 minutes", "to complete the online form"],
								[Wallet, fee ? money(fee, { currency }) : "Small application fee", "application fee, paid by M-Pesa"],
								[UserCheck, "Around two weeks", "for a decision on a complete application"],
								[Smartphone, "Track everything online", "and download your admission letter"],
							].map(([Icon, title, text]) => (
								<li key={title} className="flex items-start gap-3">
									<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-500 text-brand-900">
										<Icon size={18} />
									</span>
									<span>
										<span className="block font-semibold text-white">{title}</span>
										<span className="text-white/65">{text}</span>
									</span>
								</li>
							))}
						</ul>
					</div>
				}
			/>

			<Band id="process">
				<SectionHeading eyebrow="How to apply" title="Six steps from enquiry to admission" subtitle="You can save your application and come back to it at any time; nothing is submitted until you are ready." />
				<Steps steps={steps} />
			</Band>

			<Band tone="surface" id="requirements">
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
					<div>
						<SectionHeading eyebrow="Entry requirements" title="Who can apply" className="mb-8" />
						<div className="grid gap-4 sm:grid-cols-2">
							{REQUIREMENTS.map((r) => (
								<div key={r.level} className="rounded-2xl border border-line p-5">
									<div className="font-serif text-lg text-ink">{r.level}</div>
									<p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{r.text}</p>
								</div>
							))}
						</div>
						<p className="mt-5 text-sm text-ink-soft">
							Requirements for each programme are listed on its page.{" "}
							<Link to="/programmes" className="link">
								Browse programmes
							</Link>
						</p>
					</div>
					<div className="space-y-5">
						<div className="rounded-2xl bg-brand-800 p-6 text-white">
							<div className="eyebrow text-gold-300">Every applicant</div>
							<ul className="mt-4 space-y-3 text-sm">
								{[
									"A personal faith in Jesus Christ and a clear Christian testimony",
									"A recommendation from your pastor or church leadership",
									"A sense of call to Christian ministry or service",
									"Agreement to the college’s statement of faith and code of conduct",
								].map((t) => (
									<li key={t} className="flex gap-2.5">
										<CheckCircle2 size={18} className="mt-0.5 shrink-0 text-gold-300" /> <span className="text-white/85">{t}</span>
									</li>
								))}
							</ul>
						</div>
						<div className="rounded-2xl bg-cream p-6 ring-1 ring-gold-200">
							<Scripture verse={VERSES.sendMe} size="sm" />
						</div>
					</div>
				</div>
			</Band>

			<Band id="intakes">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<SectionHeading eyebrow="Intakes and deadlines" title="When you can start" className="mb-8" />
						{lookups.isLoading ? (
							<div className="space-y-3">
								<Skeleton className="h-20 rounded-2xl" />
								<Skeleton className="h-20 rounded-2xl" />
							</div>
						) : intakes.length ? (
							<ul className="space-y-3">
								{intakes.map((i) => {
									const days = daysUntil(i.application_close_date)
									return (
										<li key={i.name} className="card flex items-start gap-4 p-4 sm:items-center sm:p-5">
											<span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-cream text-gold-700 ring-1 ring-gold-200">
												<CalendarDays size={20} />
											</span>
											<div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
												<div className="min-w-0 flex-1">
													<div className="font-semibold text-ink">{i.name}</div>
													<div className="text-xs text-ink-soft">
														{i.academic_year ? `${i.academic_year} · ` : ""}Classes begin {date(i.start_date)}
													</div>
													<div className="text-xs text-ink-soft">
														{i.application_close_date ? `Applications close ${date(i.application_close_date)}` : "Applications open until the class is full"}
													</div>
												</div>
												{days != null ? (
													<span
														className={clsx(
															"self-start rounded-full px-3 py-1 text-xs font-bold sm:shrink-0 sm:self-auto",
															days <= 14 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
														)}
													>
														{days <= 0 ? "Closes today" : `${days} days left`}
													</span>
												) : (
													<span className="self-start rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 sm:shrink-0 sm:self-auto">Open</span>
												)}
											</div>
										</li>
									)
								})}
							</ul>
						) : (
							<div className="card p-6">
								<div className="font-semibold text-ink">Applications are open</div>
								<p className="mt-1 text-sm leading-relaxed text-ink-muted">
									We admit students several times a year. Start your application now; you will choose from the intakes open at the time, and our
									admissions team will confirm your start date.
								</p>
								<Link to="/contact?type=Admissions" className="link mt-3 inline-flex items-center gap-1 text-sm">
									Ask about the next intake <ArrowRight size={14} />
								</Link>
							</div>
						)}
					</div>
					<div id="documents" className="scroll-mt-24">
						<SectionHeading eyebrow="Documents checklist" title="Have these ready" className="mb-8" />
						<ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
							{DOCUMENTS.map((d) => (
								<li key={d.title} className="flex gap-4 p-4">
									<span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
										<FileText size={17} />
									</span>
									<div>
										<div className="font-semibold text-ink">{d.title}</div>
										<p className="text-sm leading-relaxed text-ink-muted">{d.text}</p>
									</div>
								</li>
							))}
						</ul>
						<p className="mt-3 text-xs text-ink-soft">Upload clear PDF, JPG or PNG files. Phone photos are fine as long as the text is readable.</p>
					</div>
				</div>
			</Band>

			<Band tone="cream" id="fees">
				<div className="grid gap-8 lg:grid-cols-3">
					<div className="lg:col-span-1">
						<SectionHeading eyebrow="Fees overview" title="Counting the cost" className="mb-4" />
						<Scripture verse={VERSES.cost} size="sm" />
					</div>
					<div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
						<div className="card p-6">
							<div className="label">Application fee</div>
							<div className="font-serif text-2xl font-bold text-brand-800">{lookups.isLoading ? "…" : fee ? money(fee, { currency }) : "—"}</div>
							<p className="mt-2 text-sm text-ink-muted">Paid once, by M-Pesa, when you submit your application.</p>
						</div>
						<div className="card p-6">
							<div className="label">Tuition</div>
							<div className="font-serif text-2xl font-bold text-brand-800">Per term</div>
							<p className="mt-2 text-sm text-ink-muted">Varies by programme and study mode; pay in instalments.</p>
						</div>
						<div className="card p-6">
							<div className="label">Sponsorship</div>
							<div className="font-serif text-2xl font-bold text-brand-800">Flexible</div>
							<p className="mt-2 text-sm text-ink-muted">Tell us who is paying and we bill them directly.</p>
							<div className="mt-3 flex flex-wrap gap-1.5">
								{(lookups.data?.sponsorship_types || ["Self", "Church", "Sponsor"]).map((t) => (
									<span key={t} className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-semibold text-ink-muted ring-1 ring-gold-200">
										{t}
									</span>
								))}
							</div>
						</div>
						<Link to="/fees" className="link inline-flex items-center gap-1 text-sm sm:col-span-3">
							Full fees and funding information <ArrowRight size={14} />
						</Link>
					</div>
				</div>
			</Band>

			<Band id="faqs" narrow>
				<SectionHeading eyebrow="Questions" title="Admissions FAQs" align="center" />
				<FaqBlock category="Admissions" />
			</Band>

			<CtaBand />
		</>
	)
}
