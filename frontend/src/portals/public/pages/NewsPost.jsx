import { Link, useParams } from "react-router-dom"
import { ArrowLeft, CalendarDays, Clock, Eye, Newspaper, Tag, UserRound } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { Empty, ErrorState, Html, Skeleton } from "@/shared/components/ui"
import { date, num } from "@/shared/utils/format"
import { Band, Breadcrumbs, Container, CtaBand, ShareLinks } from "../components/Blocks"
import { NewsCard } from "../components/Cards"
import { W, usePageMeta } from "../lib"

export default function NewsPost() {
	const { route } = useParams()
	const q = useApi(`${W}news_post`, { route }, { guest: true, staleTime: 5 * 60_000 })
	const p = q.data
	usePageMeta(p?.title || (q.isError ? "Story not found" : "News"), p?.meta_description || p?.excerpt)

	if (q.isLoading)
		return (
			<Container narrow className="space-y-5 py-16">
				<Skeleton className="h-4 w-40" />
				<Skeleton className="h-10 w-4/5" />
				<Skeleton className="h-4 w-1/3" />
				<Skeleton className="h-72 rounded-3xl" />
				<Skeleton className="h-4" />
				<Skeleton className="h-4 w-11/12" />
			</Container>
		)
	if (q.isError) {
		const missing = q.error?.status === 404 || q.error?.exc_type === "DoesNotExistError"
		return (
			<Band>
				<div className="card">
					{missing ? (
						<Empty
							icon={Newspaper}
							title="We couldn't find that story"
							subtitle="It may have been moved or unpublished."
							action={
								<Link to="/news" className="btn btn-primary">
									<ArrowLeft size={16} /> All news
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

	const words = plainText(p.content || "").split(/\s+/).filter(Boolean).length
	const minutes = Math.max(1, Math.round(words / 200))

	return (
		<>
			<article>
				<header className="relative overflow-hidden border-b border-line bg-cream/60">
					<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-40" />
					<Container narrow className="relative pb-10 pt-10 sm:pt-14">
						<Breadcrumbs dark={false} items={[{ label: "News", to: "/news" }, { label: p.title }]} />
						{p.category ? (
							<Link to={`/news?category=${encodeURIComponent(p.category)}`} className="eyebrow hover:underline">
								{p.category}
							</Link>
						) : null}
						<h1 className="mt-3 animate-fade-up font-serif text-[32px] leading-[1.15] text-ink sm:text-[44px]">{p.title}</h1>
						{p.excerpt ? <p className="mt-4 text-lg leading-relaxed text-ink-muted">{plainText(p.excerpt)}</p> : null}
						<div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-soft">
							{p.author ? (
								<span className="inline-flex items-center gap-1.5">
									<UserRound size={15} /> {p.author}
								</span>
							) : null}
							<span className="inline-flex items-center gap-1.5">
								<CalendarDays size={15} /> {date(p.published_on, { day: "numeric", month: "long", year: "numeric" })}
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Clock size={15} /> {minutes} min read
							</span>
							{p.views ? (
								<span className="inline-flex items-center gap-1.5">
									<Eye size={15} /> {num(p.views)} views
								</span>
							) : null}
						</div>
					</Container>
				</header>

				<Container narrow className="py-10 sm:py-14">
					{p.cover_image ? (
						<img src={p.cover_image} alt="" className="mb-10 aspect-[16/9] w-full rounded-3xl object-cover shadow-card" />
					) : null}
					{p.content ? <Html html={p.content} className="text-base sm:text-[17px] sm:leading-8" /> : <p className="text-ink-muted">{plainText(p.excerpt)}</p>}

					{p.tags?.length ? (
						<div className="mt-10 flex flex-wrap items-center gap-2">
							<Tag size={15} className="text-ink-soft" />
							{p.tags.map((t) => (
								<span key={t} className="chip">
									{t}
								</span>
							))}
						</div>
					) : null}

					<div className="mt-10 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
						<div className="text-sm font-semibold text-ink">Share this story</div>
						<ShareLinks title={p.title} url={`/news/${p.route}`} />
					</div>
					<Link to="/news" className="link mt-8 inline-flex items-center gap-1.5 text-sm">
						<ArrowLeft size={16} /> Back to all news
					</Link>
				</Container>
			</article>

			{p.related?.length ? (
				<Band tone="cream">
					<h2 className="mb-8 font-serif text-3xl text-ink">More stories</h2>
					<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{p.related.map((r) => (
							<NewsCard key={r.name} post={r} />
						))}
					</div>
				</Band>
			) : null}
			<CtaBand />
		</>
	)
}
