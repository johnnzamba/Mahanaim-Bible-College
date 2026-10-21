import { Link } from "react-router-dom"
import { Newspaper, Rss } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Chip, Empty, ErrorState, Pagination } from "@/shared/components/ui"
import { Band, CtaBand, PageHero } from "../components/Blocks"
import { CardGridSkeleton, NewsCard } from "../components/Cards"
import { W, useParamState, usePageMeta } from "../lib"

const PAGE = 9

export default function News() {
	const [category, setCategory] = useParamState("category")
	const [pageParam, setPage] = useParamState("page", "1")
	const page = Math.max(1, Number(pageParam) || 1)
	usePageMeta(category ? `${category} · News` : "News and stories", "News, devotionals, ministry reports and announcements from the college.")
	const q = useApi(`${W}news`, { page, page_length: PAGE, category: category || undefined }, { guest: true, placeholderData: (prev) => prev })
	const d = q.data || {}
	const rows = d.data || []
	const cats = d.categories || []
	const featured = page === 1 && !category ? rows.find((r) => r.is_featured) || null : null
	const rest = featured ? rows.filter((r) => r !== featured) : rows
	const go = (p) => {
		setPage(String(p))
		window.scrollTo({ top: 0, behavior: "smooth" })
	}

	return (
		<>
			<PageHero
				eyebrow="News"
				title="Stories from the harvest field"
				subtitle="Campus news, devotionals, ministry reports and stories of graduates serving across Kenya and beyond."
				crumbs={[{ label: "News" }]}
				compact
			/>
			<Band className="!pt-10">
				{cats.length ? (
					<div className="mb-8 flex flex-wrap gap-2">
						<Chip active={!category} onClick={() => setCategory("")}>
							All stories
						</Chip>
						{cats.map((c) => (
							<Chip key={c.category} active={category === c.category} onClick={() => setCategory(category === c.category ? "" : c.category)}>
								{c.category}
								{c.count != null ? <span className="opacity-60">{c.count}</span> : null}
							</Chip>
						))}
					</div>
				) : null}

				{q.isLoading ? (
					<CardGridSkeleton count={6} />
				) : q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : !rows.length ? (
					<div className="card">
						<Empty
							icon={Newspaper}
							title={category ? `No ${category.toLowerCase()} stories yet` : "Stories are on the way"}
							subtitle="Check back soon for news, devotionals and reports from campus and the mission field."
							action={
								category ? (
									<button type="button" className="btn btn-secondary" onClick={() => setCategory("")}>
										See all stories
									</button>
								) : (
									<Link to="/events" className="btn btn-secondary">
										See upcoming events
									</Link>
								)
							}
						/>
					</div>
				) : (
					<div className={q.isFetching ? "opacity-70 transition" : ""}>
						{featured ? <NewsCard post={featured} featured className="mb-8" /> : null}
						<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							{rest.map((n) => (
								<NewsCard key={n.name} post={n} />
							))}
						</div>
						<Pagination page={page} pageSize={PAGE} total={d.total || 0} onChange={go} className="mt-8 border-t border-line pt-4" />
					</div>
				)}
				<div className="mt-12 flex items-center gap-3 rounded-2xl bg-cream px-5 py-4 text-sm text-ink-muted ring-1 ring-gold-200">
					<Rss size={18} className="shrink-0 text-gold-600" />
					<span>
						Have a story from your ministry or church to share?{" "}
						<Link to="/contact?type=Media" className="link">
							Tell the communications office
						</Link>
					</span>
				</div>
			</Band>
			<CtaBand />
		</>
	)
}
