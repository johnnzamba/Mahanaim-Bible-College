import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, CalendarDays, Compass, GraduationCap, Mail, Newspaper, Search as SearchIcon, ShieldCheck } from "lucide-react"
import { Container } from "../components/Blocks"
import { usePageMeta } from "../lib"

const LINKS = [
	{ to: "/programmes", label: "Programmes", text: "Certificates, diplomas and degrees in theology and ministry.", icon: GraduationCap },
	{ to: "/admissions", label: "Admissions", text: "How to apply, requirements, intakes and deadlines.", icon: Compass },
	{ to: "/news", label: "News", text: "Stories and announcements from campus.", icon: Newspaper },
	{ to: "/events", label: "Events", text: "Conferences, seminars and open days.", icon: CalendarDays },
	{ to: "/verify", label: "Verify a document", text: "Check a certificate or transcript.", icon: ShieldCheck },
	{ to: "/contact", label: "Contact us", text: "We're glad to help you find your way.", icon: Mail },
]

export default function NotFound() {
	usePageMeta("Page not found", "The page you were looking for could not be found.")
	const { pathname } = useLocation()
	const navigate = useNavigate()
	const last = pathname.split("/").filter(Boolean).pop() || ""
	let guess = last
	try {
		guess = decodeURIComponent(last)
	} catch {
		/* malformed escape: keep it raw */
	}
	guess = guess.replace(/[-_]+/g, " ")
	const [q, setQ] = useState(guess.length >= 2 && guess.length <= 40 ? guess : "")

	const submit = (e) => {
		e.preventDefault()
		if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
	}

	return (
		<>
			<section className="hero-wash relative overflow-hidden text-white">
				<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
				<div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-gold-400/20" />
				<Container className="relative py-16 text-center sm:py-24" narrow>
					<div className="animate-fade-up">
						<div className="font-serif text-7xl text-gold-300 sm:text-8xl">404</div>
						<h1 className="mt-4 font-serif text-3xl text-white sm:text-4xl">This page has wandered off</h1>
						<p className="mx-auto mt-4 max-w-xl text-white/75">
							We couldn't find <span className="break-all rounded bg-white/10 px-1.5 py-0.5 font-mono text-sm text-white/90">{pathname}</span>. It may have
							moved, or the link may be mistyped.
						</p>
						<blockquote className="mx-auto mt-6 max-w-lg font-serif text-sm italic text-white/70">
							"Thy word is a lamp unto my feet, and a light unto my path." <span className="not-italic text-gold-300">Psalm 119:105</span>
						</blockquote>
						<form role="search" onSubmit={submit} className="mx-auto mt-8 flex max-w-lg gap-2 rounded-2xl bg-white p-2 shadow-xl">
							<label htmlFor="nf-search" className="sr-only">
								Search the website
							</label>
							<div className="relative min-w-0 flex-1">
								<SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
								<input
									id="nf-search"
									type="search"
									value={q}
									onChange={(e) => setQ(e.target.value)}
									placeholder="Search the website"
									className="h-11 w-full rounded-xl border-0 bg-transparent pl-10 pr-3 text-[15px] text-ink placeholder:text-ink-soft focus:outline-none focus:ring-0"
								/>
							</div>
							<button type="submit" className="btn btn-primary shrink-0">
								Search
							</button>
						</form>
						<div className="mt-6 flex flex-wrap justify-center gap-3">
							<Link to="/" className="btn btn-gold">
								<ArrowLeft size={16} /> Back to home
							</Link>
							<button type="button" onClick={() => navigate(-1)} className="btn border border-white/25 bg-white/10 text-white hover:bg-white/20">
								Previous page
							</button>
						</div>
					</div>
				</Container>
			</section>
			<Container className="py-12 sm:py-16">
				<h2 className="text-center text-xs font-bold uppercase tracking-wider text-ink-soft">Popular destinations</h2>
				<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{LINKS.map(({ to, label, text, icon: Icon }) => (
						<Link key={to} to={to} className="card group flex items-start gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-md">
							<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-700 group-hover:text-white">
								<Icon size={20} />
							</span>
							<span className="min-w-0">
								<span className="flex items-center gap-1.5 font-semibold text-ink">
									{label} <ArrowRight size={14} className="text-ink-soft transition group-hover:translate-x-0.5" />
								</span>
								<span className="mt-1 block text-sm text-ink-muted">{text}</span>
							</span>
						</Link>
					))}
				</div>
			</Container>
		</>
	)
}
