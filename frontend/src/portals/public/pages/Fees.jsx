import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, Building, Church, GraduationCap, HandCoins, HandHeart, Landmark, Receipt, ShieldCheck, Smartphone, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Chip, Empty, ErrorState, Skeleton } from "@/shared/components/ui"
import { money } from "@/shared/utils/format"
import { Band, CtaBand, Feature, PageHero, Scripture, SectionHeading, Steps } from "../components/Blocks"
import { FaqBlock } from "../components/FaqBlock"
import { VERSES } from "../content"
import { W, sortLevels, useParamState, usePageMeta } from "../lib"

const COVERS = [
	["Tuition", "Teaching, course materials and supervision for every registered course."],
	["Registration and examinations", "Term registration, continuous assessment and end-of-term exams."],
	["Library and Digital Campus", "E-Library access, online lessons, assignments and exams."],
	["Ministry practicum", "Placement, supervision and assessment in partner churches."],
]

export default function Fees() {
	usePageMeta("Fees and funding", "Programme fees, how to pay by M-Pesa, instalments, church sponsorship and scholarships.")
	const [level, setLevel] = useParamState("level")
	const progs = useApi(`${W}programmes`, {}, { guest: true })
	const lookups = useApi(`${W}apply_lookups`, {}, { guest: true })
	const giving = useApi("mahanaim.api.church.giving_options", {}, { guest: true, retry: false })
	const paybill = giving.data?.paybill
	const rows = (progs.data?.data || []).filter((p) => !level || p.level === level)
	const levels = sortLevels(progs.data?.facets?.levels || [])
	const currency = lookups.data?.currency
	const appFee = lookups.data?.application_fee

	return (
		<>
			<PageHero
				eyebrow="Fees and funding"
				title="Affordable training, transparent fees"
				subtitle="Fees are charged per term and can be paid in instalments by M-Pesa. Churches and sponsors can pay on a student’s behalf, and bursaries are available for those in need."
				crumbs={[{ label: "Admissions", to: "/admissions" }, { label: "Fees and funding" }]}
				actions={
					<>
						<a href="#programme-fees" className="btn btn-gold">
							Programme fees
						</a>
						<a href="#pay" className="btn border border-white/25 text-white hover:bg-white/10">
							How to pay
						</a>
					</>
				}
				aside={
					<div className="grid grid-cols-2 gap-3">
						{[
							["Application fee", lookups.isLoading ? "…" : appFee ? money(appFee, { currency }) : "—"],
							["Billing", "Per term"],
							["Pay with", "M-Pesa"],
							["Receipts", "Instant"],
						].map(([label, value]) => (
							<div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
								<div className="text-[11px] font-semibold uppercase tracking-wider text-white/55">{label}</div>
								<div className="mt-1 font-serif text-xl text-white">{value}</div>
							</div>
						))}
					</div>
				}
			/>

			<Band id="programme-fees">
				<SectionHeading
					eyebrow="Programme fees"
					title="What each programme costs"
					subtitle="Indicative tuition per term. Your detailed fee structure, including any campus or study-mode charges, is issued with your admission letter."
				/>
				{levels.length > 1 ? (
					<div className="mb-6 flex flex-wrap gap-2">
						<Chip active={!level} onClick={() => setLevel("")}>
							All levels
						</Chip>
						{levels.map((l) => (
							<Chip key={l} active={level === l} onClick={() => setLevel(level === l ? "" : l)}>
								{l}
							</Chip>
						))}
					</div>
				) : null}
				{progs.isLoading ? (
					<Skeleton className="h-64 rounded-2xl" />
				) : progs.isError ? (
					<ErrorState error={progs.error} onRetry={() => progs.refetch()} />
				) : rows.length ? (
					<>
						<div className="card hidden overflow-hidden md:block">
							<table className="table-base">
								<thead>
									<tr>
										<th>Programme</th>
										<th>Duration</th>
										<th>Study modes</th>
										<th className="text-right">Tuition / term</th>
										<th className="text-right">Application fee</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{rows.map((p) => (
										<tr key={p.code}>
											<td>
												<div className="font-semibold text-ink">{p.name}</div>
												<div className="text-xs text-ink-soft">
													{p.level} · {p.code}
												</div>
											</td>
											<td className="text-ink-muted">{p.duration || "—"}</td>
											<td className="text-ink-muted">{p.study_modes?.join(", ") || "—"}</td>
											<td className="text-right font-semibold text-ink">{p.indicative_fee_per_term ? money(p.indicative_fee_per_term, { currency }) : "On request"}</td>
											<td className="text-right text-ink-muted">{p.application_fee ? money(p.application_fee, { currency }) : "—"}</td>
											<td className="text-right">
												<Link to={`/programmes/${encodeURIComponent(p.code)}#fees`} className="link text-xs">
													Details
												</Link>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="space-y-3 md:hidden">
							{rows.map((p) => (
								<Link key={p.code} to={`/programmes/${encodeURIComponent(p.code)}#fees`} className="card block p-4">
									<div className="text-xs text-ink-soft">
										{p.level} · {p.duration}
									</div>
									<div className="font-semibold text-ink">{p.name}</div>
									<div className="mt-2 flex items-center justify-between text-sm">
										<span className="text-ink-soft">Tuition / term</span>
										<span className="font-semibold text-ink">{p.indicative_fee_per_term ? money(p.indicative_fee_per_term, { currency }) : "On request"}</span>
									</div>
								</Link>
							))}
						</div>
					</>
				) : (
					<div className="card">
						<Empty
							icon={GraduationCap}
							title="Fee schedules are being updated"
							subtitle="Contact the finance office for the current fee structure of any programme."
							action={
								<Link to="/contact?type=Fees" className="btn btn-primary">
									Contact the finance office
								</Link>
							}
						/>
					</div>
				)}
				<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{COVERS.map(([title, text]) => (
						<div key={title} className="rounded-2xl border border-line bg-surface p-5">
							<div className="font-semibold text-ink">{title}</div>
							<p className="mt-1 text-sm leading-relaxed text-ink-muted">{text}</p>
						</div>
					))}
				</div>
				<p className="mt-4 text-xs text-ink-soft">
					Accommodation, meals, graduation and optional charges, where applicable, are shown separately on your fee structure.
				</p>
			</Band>

			<Band tone="surface" id="pay">
				<SectionHeading eyebrow="How to pay" title="Pay from your phone in seconds" subtitle="Every payment is matched to your account and receipted automatically. No queues and no lost bank slips." />
				<div className="grid gap-6 lg:grid-cols-3">
					<div className="card relative overflow-hidden p-6 ring-2 ring-gold-400">
						<span className="absolute right-4 top-4 rounded-full bg-gold-500 px-2.5 py-0.5 text-[11px] font-bold text-brand-900">Recommended</span>
						<span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-800 text-gold-300">
							<Smartphone size={22} />
						</span>
						<h3 className="mt-4 font-serif text-xl text-ink">M-Pesa from the portal</h3>
						<ol className="mt-3 space-y-2 text-sm text-ink-muted">
							{["Sign in to the student or applicant portal", "Open Fees and choose “Pay with M-Pesa”", "Confirm the prompt on your phone with your PIN", "Your receipt appears instantly"].map((s, i) => (
								<li key={s} className="flex gap-2.5">
									<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cream text-[11px] font-bold text-gold-800">{i + 1}</span>
									{s}
								</li>
							))}
						</ol>
						<Link to="/signin" className="btn btn-primary mt-5 w-full">
							Sign in to pay
						</Link>
					</div>
					<div className="card p-6">
						<span className="grid h-12 w-12 place-items-center rounded-2xl bg-cream text-gold-700 ring-1 ring-gold-200">
							<Receipt size={22} />
						</span>
						<h3 className="mt-4 font-serif text-xl text-ink">M-Pesa {paybill?.type === "Till" ? "Till" : "Paybill"}</h3>
						<dl className="mt-3 space-y-2 text-sm">
							<div className="flex justify-between gap-3 rounded-xl bg-cream/70 px-3 py-2">
								<dt className="text-ink-soft">{paybill?.type === "Till" ? "Till number" : "Business number"}</dt>
								<dd className={paybill?.shortcode ? "font-mono font-semibold text-ink" : "font-semibold text-ink"}>{giving.isLoading ? "…" : paybill?.shortcode || "Shown in your portal"}</dd>
							</div>
							{paybill?.type !== "Till" ? (
								<div className="flex justify-between gap-3 rounded-xl bg-cream/70 px-3 py-2">
									<dt className="text-ink-soft">Account number</dt>
									<dd className="text-right font-semibold text-ink">Your student number</dd>
								</div>
							) : null}
						</dl>
						<p className="mt-3 text-sm leading-relaxed text-ink-muted">
							From the M-Pesa menu choose Lipa na M-Pesa, then Pay Bill. Applicants use their application number as the account.
						</p>
					</div>
					<div className="card p-6">
						<span className="grid h-12 w-12 place-items-center rounded-2xl bg-cream text-gold-700 ring-1 ring-gold-200">
							<Landmark size={22} />
						</span>
						<h3 className="mt-4 font-serif text-xl text-ink">Bank or sponsor payment</h3>
						<p className="mt-3 text-sm leading-relaxed text-ink-muted">
							Bank details appear on every invoice. Churches and sponsors can view statements and pay for the students they support from the sponsor
							portal.
						</p>
						<Link to="/contact?type=Fees" className="link mt-4 inline-flex items-center gap-1 text-sm">
							Talk to the finance office <ArrowRight size={14} />
						</Link>
					</div>
				</div>
				<div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center">
					<div>
						<h3 className="font-serif text-2xl text-ink">Paying in instalments</h3>
						<Steps
							cols={3}
							className="mt-5"
							steps={[
								{ title: "Invoice", text: "Your term invoice is posted to the portal at the start of each term." },
								{ title: "Instalments", text: "Pay any amount at any time; your balance updates immediately." },
								{ title: "Clearance", text: "Clear the required minimum before registration and examinations." },
							]}
						/>
					</div>
					<div className="rounded-2xl bg-cream p-6 ring-1 ring-gold-200">
						<Scripture verse={VERSES.honest} size="sm" />
					</div>
				</div>
			</Band>

			<Band id="funding">
				<SectionHeading eyebrow="Scholarships and sponsorship" title="Don’t let finances stop your calling" subtitle="Most of our students are supported by someone: their church, a sponsor, or a bursary from the college." />
				<div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
					<Feature icon={Church} title="Church sponsorship">
						Your home church can sponsor all or part of your fees. Choose “Church” as your sponsor on the application form and we bill them directly.
					</Feature>
					<Feature icon={Users} title="Individual sponsors">
						Family members, friends or ministry partners can sponsor you and follow your progress through the sponsor portal.
					</Feature>
					<Feature icon={HandCoins} title="College bursaries">
						A limited number of needs-based bursaries are awarded each intake. Ask the admissions office how to apply.
					</Feature>
					<Feature icon={Building} title="Employer support">
						Ministries, NGOs and schools often fund staff development. We can issue invoices and progress reports to your employer.
					</Feature>
				</div>
				<div className="mt-12 flex flex-col items-start justify-between gap-5 rounded-3xl bg-brand-800 p-7 text-white sm:flex-row sm:items-center sm:p-9">
					<div className="flex items-start gap-4">
						<span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold-500 text-brand-900">
							<HandHeart size={22} />
						</span>
						<div>
							<h3 className="font-serif text-2xl text-white">Sponsor a student</h3>
							<p className="mt-1 max-w-xl text-sm text-white/75">Give to the scholarship fund and help a called student who cannot afford fees complete their training.</p>
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						<Link to="/give" className="btn btn-gold">
							Give online
						</Link>
						<Link to="/contact?type=Partnership" className="btn border border-white/25 text-white hover:bg-white/10">
							Become a sponsor
						</Link>
					</div>
				</div>
				<p className={clsx("mt-6 flex items-center gap-2 text-xs text-ink-soft")}>
					<ShieldCheck size={14} className="text-emerald-600" /> All payments are processed securely through Safaricom M-Pesa; we never see your PIN.
				</p>
			</Band>

			<Band tone="cream" narrow id="faqs">
				<SectionHeading eyebrow="Questions" title="Fees FAQs" align="center" />
				<FaqBlock category="Fees" />
			</Band>

			<CtaBand />
		</>
	)
}
