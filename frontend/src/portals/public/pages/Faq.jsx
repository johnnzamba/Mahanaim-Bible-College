import { useMemo, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { BookOpen, CircleHelp, GraduationCap, Laptop, MessageCircle, Phone, SearchX, Wallet } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { Chip, Empty, ErrorState, Skeleton } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { Band, PageHero } from "../components/Blocks"
import { FaqBlockAccordion, mergeFaqs } from "../components/FaqBlock"
import { DEFAULT_FAQS } from "../content"
import { W, useHashScroll, useParamState, usePageMeta } from "../lib"

const CAT_ICON = { Admissions: GraduationCap, Fees: Wallet, "Online Learning": Laptop, Academics: BookOpen }
const slug = (s) =>
	String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")

export default function Faq() {
	usePageMeta("Frequently asked questions", "Answers to common questions about admissions, fees, online learning, academics and life at the college.")
	const q = useApi(`${W}faqs`, {}, { guest: true })
	const [category, setCategory] = useParamState("category")
	const [search, setSearch] = useState("")
	const { hash } = useLocation()
	const all = useMemo(() => {
		const rows = mergeFaqs(q.data?.data || [], DEFAULT_FAQS, 8)
		return rows.map((f, i) => ({ ...f, category: f.category || "General", anchor: f.name ? slug(f.name) : `${slug(f.category)}-${i + 1}` }))
	}, [q.data])
	const categories = useMemo(() => [...new Set(all.map((f) => f.category))], [all])
	const needle = search.trim().toLowerCase()
	const rows = all.filter(
		(f) => (!category || f.category === category) && (!needle || `${f.question} ${plainText(f.answer || "")}`.toLowerCase().includes(needle))
	)
	const groups = categories.map((c) => [c, rows.filter((f) => f.category === c)]).filter(([, r]) => r.length)
	const openId = hash ? decodeURIComponent(hash.slice(1)) : undefined
	useHashScroll(!q.isLoading)

	return (
		<>
			<PageHero
				eyebrow="Help centre"
				title="Frequently asked questions"
				subtitle="Quick answers about applying, fees, online study and life at the college. Can't find what you need? We're a message away."
				crumbs={[{ label: "FAQ" }]}
				compact
			>
				<div className="mt-7 max-w-xl">
					<SearchInput value={search} onChange={setSearch} placeholder="Search questions, e.g. M-Pesa, intake, online" className="[&_input]:h-12 [&_input]:text-base" />
				</div>
			</PageHero>

			<Band className="!pt-10">
				<div className="grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
					<aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
						<div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
							<Chip active={!category} onClick={() => setCategory("")} className="shrink-0 lg:justify-start">
								<CircleHelp size={14} /> All topics
							</Chip>
							{categories.map((c) => {
								const Icon = CAT_ICON[c] || MessageCircle
								return (
									<Chip key={c} active={category === c} onClick={() => setCategory(category === c ? "" : c)} className="shrink-0 lg:justify-start">
										<Icon size={14} /> {c}
									</Chip>
								)
							})}
						</div>
						<div className="mt-6 hidden rounded-2xl bg-cream/80 p-5 ring-1 ring-gold-200 lg:block">
							<div className="font-semibold text-ink">Still have a question?</div>
							<p className="mt-1 text-sm text-ink-muted">Our team replies within two working days.</p>
							<Link to="/contact" className="btn btn-primary btn-sm mt-4 w-full">
								<Phone size={14} /> Contact us
							</Link>
						</div>
					</aside>

					<div className="min-w-0 space-y-10">
						{q.isLoading ? (
							<div className="space-y-3">
								{Array.from({ length: 6 }).map((_, i) => (
									<Skeleton key={i} className="h-14 rounded-xl" />
								))}
							</div>
						) : q.isError ? (
							<ErrorState error={q.error} onRetry={() => q.refetch()} />
						) : !groups.length ? (
							<div className="card">
								<Empty
									icon={SearchX}
									title="No answers match your search"
									subtitle="Try different words, or ask us directly."
									action={
										<Link to="/contact" className="btn btn-secondary">
											Ask a question
										</Link>
									}
								/>
							</div>
						) : (
							groups.map(([c, list]) => {
								const Icon = CAT_ICON[c] || MessageCircle
								return (
									<section key={c} id={`topic-${slug(c)}`} className="scroll-mt-24">
										<h2 className="mb-4 flex items-center gap-2.5 font-serif text-2xl text-ink">
											<span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
												<Icon size={18} />
											</span>
											{c}
											<span className="text-sm font-normal text-ink-soft">({list.length})</span>
										</h2>
										<FaqBlockAccordion rows={list} openId={openId} multiple={Boolean(needle)} />
									</section>
								)
							})
						)}
						<div className="rounded-2xl bg-cream/80 p-5 ring-1 ring-gold-200 lg:hidden">
							<div className="font-semibold text-ink">Still have a question?</div>
							<p className="mt-1 text-sm text-ink-muted">Our team replies within two working days.</p>
							<Link to="/contact" className="btn btn-primary btn-sm mt-4">
								<Phone size={14} /> Contact us
							</Link>
						</div>
					</div>
				</div>
			</Band>
		</>
	)
}
