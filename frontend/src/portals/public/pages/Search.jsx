import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowRight, CalendarDays, CircleHelp, GraduationCap, Newspaper, Search as SearchIcon, SearchX } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Empty, ErrorState, Skeleton } from "@/shared/components/ui"
import { date } from "@/shared/utils/format"
import { Container } from "../components/Blocks"
import { W, internalRoute, usePageMeta } from "../lib"

const TYPES = {
	Programme: { label: "Programmes", icon: GraduationCap, tone: "bg-brand-50 text-brand-700" },
	News: { label: "News", icon: Newspaper, tone: "bg-gold-50 text-gold-700" },
	Event: { label: "Events", icon: CalendarDays, tone: "bg-emerald-50 text-emerald-700" },
	FAQ: { label: "Questions", icon: CircleHelp, tone: "bg-cream text-ink-muted" },
}

const SUGGESTIONS = ["Theology", "Diploma", "Admissions", "Fees", "Online learning", "Graduation"]

const QUICK = [
	{ to: "/programmes", label: "All programmes", icon: GraduationCap },
	{ to: "/admissions", label: "How to apply", icon: ArrowRight },
	{ to: "/news", label: "Latest news", icon: Newspaper },
	{ to: "/events", label: "Upcoming events", icon: CalendarDays },
	{ to: "/faq", label: "FAQs", icon: CircleHelp },
]

function ResultsSkeleton() {
	return (
		<div className="space-y-4">
			{[0, 1, 2, 3].map((i) => (
				<div key={i} className="card p-5">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="mt-3 h-5 w-2/3" />
					<Skeleton className="mt-2 h-4 w-full" />
				</div>
			))}
		</div>
	)
}

function Highlight({ text, q }) {
	if (!text || !q) return text || null
	const i = text.toLowerCase().indexOf(q.toLowerCase())
	if (i < 0) return text
	return (
		<>
			{text.slice(0, i)}
			<mark className="rounded bg-gold-100 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
			{text.slice(i + q.length)}
		</>
	)
}

export default function Search() {
	const [params, setParams] = useSearchParams()
	const q = (params.get("q") || "").trim()
	const [draft, setDraft] = useState(q)
	usePageMeta(q ? `Search: ${q}` : "Search", "Search programmes, news, events and answers across the college website.")
	useEffect(() => setDraft(q), [q])

	const res = useApi(`${W}search`, { q }, { guest: true, enabled: q.length >= 2 })
	const results = res.data?.results || []
	const groups = Object.keys(TYPES)
		.map((t) => [t, results.filter((r) => r.type === t)])
		.concat([["Other", results.filter((r) => !TYPES[r.type])]])
		.filter(([, rows]) => rows.length)

	const submit = (e) => {
		e.preventDefault()
		const v = draft.trim()
		setParams(v ? { q: v } : {}, { replace: Boolean(q) })
	}
	const go = (v) => setParams({ q: v })

	return (
		<>
			<section className="hero-wash relative overflow-hidden text-white">
				<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
				<Container className="relative py-12 sm:py-16" narrow>
					<div className="eyebrow text-gold-300">Search</div>
					<h1 className="mt-3 font-serif text-3xl text-white sm:text-4xl">{q ? <>Results for "{q}"</> : "What are you looking for?"}</h1>
					<form role="search" onSubmit={submit} className="mt-6 flex gap-2 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/5">
						<label htmlFor="site-search" className="sr-only">
							Search the website
						</label>
						<div className="relative min-w-0 flex-1">
							<SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
							<input
								id="site-search"
								type="search"
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="Programmes, news, events, questions…"
								className="h-11 w-full rounded-xl border-0 bg-transparent pl-10 pr-3 text-[15px] text-ink placeholder:text-ink-soft focus:outline-none focus:ring-0"
								autoFocus={!q}
							/>
						</div>
						<button type="submit" className="btn btn-primary shrink-0">
							Search
						</button>
					</form>
					<div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
						<span className="text-white/60">Try:</span>
						{SUGGESTIONS.map((s) => (
							<button key={s} type="button" onClick={() => go(s)} className="rounded-full bg-white/10 px-3 py-1 text-white/85 ring-1 ring-white/15 transition hover:bg-white/20">
								{s}
							</button>
						))}
					</div>
				</Container>
			</section>

			<Container className="py-10 sm:py-14" narrow>
				{q.length < 2 ? (
					<div>
						<p className="text-ink-muted">{q ? "Type at least two characters to search." : "Search across our programmes, news, events and frequently asked questions, or jump straight to a popular page:"}</p>
						<div className="mt-6 grid gap-3 sm:grid-cols-2">
							{QUICK.map(({ to, label, icon: Icon }) => (
								<Link key={to} to={to} className="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
									<span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
										<Icon size={18} />
									</span>
									<span className="font-semibold text-ink">{label}</span>
									<ArrowRight size={16} className="ml-auto text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
								</Link>
							))}
						</div>
					</div>
				) : res.isLoading ? (
					<ResultsSkeleton />
				) : res.isError ? (
					<ErrorState error={res.error} onRetry={res.refetch} />
				) : !results.length ? (
					<Empty
						icon={SearchX}
						title={`Nothing matched "${q}"`}
						subtitle="Check the spelling, try a broader word, or browse the pages below."
						action={
							<div className="flex flex-wrap justify-center gap-2">
								<Link to="/programmes" className="btn btn-secondary btn-sm">
									Programmes
								</Link>
								<Link to="/faq" className="btn btn-secondary btn-sm">
									FAQs
								</Link>
								<Link to={`/contact?subject=${encodeURIComponent(q)}`} className="btn btn-primary btn-sm">
									Ask us
								</Link>
							</div>
						}
					/>
				) : (
					<div className="space-y-10">
						<p className="text-sm text-ink-muted" aria-live="polite">
							{results.length} result{results.length === 1 ? "" : "s"} for <span className="font-semibold text-ink">"{q}"</span>
						</p>
						{groups.map(([type, rows]) => {
							const meta = TYPES[type] || { label: "Other", icon: SearchIcon, tone: "bg-cream text-ink-muted" }
							const Icon = meta.icon
							return (
								<section key={type} aria-labelledby={`grp-${type}`}>
									<h2 id={`grp-${type}`} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-soft">
										<Icon size={14} /> {meta.label}
										<span className="rounded-full bg-line/60 px-2 py-0.5 text-[10px] text-ink-muted">{rows.length}</span>
									</h2>
									<ul className="mt-3 space-y-3">
										{rows.map((r, i) => (
											<li key={`${r.route}-${i}`}>
												<Link to={internalRoute(r.route)} className="card group flex gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-md sm:p-5">
													<span className={`hidden h-11 w-11 shrink-0 place-items-center rounded-xl sm:grid ${meta.tone}`}>
														<Icon size={20} />
													</span>
													<span className="min-w-0 flex-1">
														<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
															{r.subtitle ? <span className="font-semibold uppercase tracking-wide text-brand-700">{r.subtitle}</span> : null}
															{r.date ? <span>{date(r.date)}</span> : null}
														</span>
														<span className="mt-1 block font-serif text-lg leading-snug text-ink group-hover:text-brand-800">
															<Highlight text={r.title} q={q} />
														</span>
														{r.excerpt ? (
															<span className="mt-1 line-clamp-2 block text-sm text-ink-muted">
																<Highlight text={r.excerpt} q={q} />
															</span>
														) : null}
													</span>
													<ArrowRight size={18} className="mt-1 shrink-0 self-center text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
												</Link>
											</li>
										))}
									</ul>
								</section>
							)
						})}
					</div>
				)}
			</Container>
		</>
	)
}
