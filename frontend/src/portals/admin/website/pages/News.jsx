import { useState } from "react"
import { Link } from "react-router-dom"
import { Eye, Newspaper, Plus, Star } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, PageHeader, Select } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, num } from "@/shared/utils/format"
import { API, NEWS_CATEGORIES, NoImage, WebTabs, toneOf, useWebRoles } from "../components/common"
import { usePaged } from "../components/kit"

const COLS = [
	{
		key: "title",
		label: "Article",
		render: (r) => (
			<span className="flex min-w-0 items-center gap-3">
				{r.cover_image ? <img src={r.cover_image} alt="" className="h-11 w-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : <NoImage className="h-11 w-16 shrink-0 rounded-lg" />}
				<span className="min-w-0">
					<span className="flex items-center gap-1.5 font-semibold text-ink">
						{r.is_featured ? <Star size={13} className="shrink-0 fill-gold-400 text-gold-500" aria-label="Featured" /> : null}
						<span className="truncate">{r.title}</span>
					</span>
					<span className="block truncate text-xs text-ink-soft">
						{r.category}
						{r.author ? ` · ${r.author}` : ""}
					</span>
				</span>
			</span>
		),
	},
	{ key: "published_on", label: "Date", hideOnMobile: true, render: (r) => (r.published_on ? date(r.published_on) : <span className="text-ink-soft">—</span>), sortValue: (r) => r.published_on || "" },
	{ key: "views", label: "Views", align: "right", hideOnMobile: true, render: (r) => num(r.views || 0) },
	{ key: "state", label: "Status", render: (r) => <Badge status={r.state} tone={toneOf(r.state)} size="xs" /> },
	{
		key: "open",
		label: "",
		export: false,
		hideOnMobile: true,
		align: "right",
		render: (r) =>
			r.state === "Published" ? (
				<a href={`/news/${r.route}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
					<Eye size={13} /> View
				</a>
			) : null,
	},
]

export default function News() {
	const { canCms } = useWebRoles()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [category, setCategory] = useState("")
	const ds = useDebounced(search)
	const { query, total, pager } = usePaged(`${API}list_news`, { search: ds, status, category }, 20, { enabled: canCms })
	const ov = useApi(`${API}cms_overview`, {}, { enabled: canCms })
	const c = ov.data?.counts || {}
	if (!canCms) {
		return (
			<>
				<WebTabs />
				<PageHeader title="News" />
				<Alert tone="warning" title="News is written by the communications office" />
			</>
		)
	}
	return (
		<>
			<WebTabs />
			<PageHeader
				title="News"
				subtitle="Stories, devotionals and announcements on the public website."
				actions={
					<Link to="/admin/website/news/new" className="btn btn-primary">
						<Plus size={16} /> Write news
					</Link>
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search title or tags…"
				chips={[
					{ id: "", label: "All" },
					{ id: "published", label: "Published", count: c.news_published },
					{ id: "scheduled", label: "Scheduled", count: c.news_scheduled },
					{ id: "draft", label: "Drafts", count: c.news_drafts },
				]}
				active={status}
				onChip={setStatus}
				right={<Select aria-label="Category" className="w-44" placeholder="All categories" options={NEWS_CATEGORIES} value={category} onChange={(e) => setCategory(e.target.value)} />}
			/>
			<DataTable
				cols={COLS}
				query={query}
				rowTo={(r) => `/admin/website/news/${encodeURIComponent(r.name)}`}
				empty={ds || status || category ? "No articles match" : "No news yet"}
				emptyIcon={Newspaper}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">{num(total)} articles</span>
						{pager}
					</div>
				}
			/>
		</>
	)
}
