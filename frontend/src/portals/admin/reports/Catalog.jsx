import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, BarChart3, History, SlidersHorizontal } from "lucide-react"
import { PageHeader, SkeletonRows, Empty, ErrorState } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { BLURB, NoReports, categoryOf, recentReports, useCatalog, useReportsAccess } from "./lib"

const ORDER = ["Admissions", "Academic", "Finance", "Church & Sponsors", "Library", "Communication"]

/** /admin/reports: the role-filtered catalog from dashboard.reports_catalog, grouped by category. */
export default function Catalog() {
	const { allowed } = useReportsAccess()
	const q = useCatalog()
	const [search, setSearch] = useState("")
	const list = Array.isArray(q.data) ? q.data : []
	const groups = useMemo(() => {
		const s = search.trim().toLowerCase()
		const hit = (r) => !s || [r.label, r.category, BLURB[r.key], ...(r.filters || []).map((f) => f.label)].join(" ").toLowerCase().includes(s)
		const by = {}
		for (const r of list.filter(hit)) (by[r.category] ||= []).push(r)
		const rank = (c) => (ORDER.includes(c) ? ORDER.indexOf(c) : 99)
		return Object.entries(by).sort((a, b) => rank(a[0]) - rank(b[0]))
	}, [list, search])
	const recent = recentReports()
		.map((k) => list.find((r) => r.key === k))
		.filter(Boolean)

	if (!allowed) {
		return (
			<>
				<PageHeader eyebrow="Insights" title="Reports" />
				<NoReports />
			</>
		)
	}
	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Insights"
				title="Reports"
				subtitle="Run college reports with your own filters, see the trend at a glance and export the rows to a spreadsheet."
				actions={<SearchInput value={search} onChange={setSearch} placeholder="Find a report…" className="w-full sm:w-64" />}
			/>
			{recent.length ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
						<History size={14} /> Recently run
					</span>
					{recent.map((r) => (
						<Link key={r.key} to={`/admin/reports/${r.key}`} className="chip">
							{r.label}
						</Link>
					))}
				</div>
			) : null}
			{q.isLoading ? (
				<div className="card p-5">
					<SkeletonRows rows={6} />
				</div>
			) : q.isError ? (
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</div>
			) : !groups.length ? (
				<div className="card">
					<Empty icon={BarChart3} title={search ? "No report matches" : "No reports for your role yet"} subtitle={search ? "Try another word, such as fees, students or attendance." : "Reports appear here as your role is given access to them."} />
				</div>
			) : (
				groups.map(([cat, reports]) => {
					const meta = categoryOf(cat)
					const Icon = meta.icon
					return (
						<section key={cat}>
							<div className="mb-3 flex items-center gap-2.5">
								<span className={`grid h-8 w-8 place-items-center rounded-lg ${meta.tone}`}>
									<Icon size={16} />
								</span>
								<h2 className="text-base font-semibold text-ink">{cat}</h2>
								<span className="text-xs text-ink-soft">
									{reports.length} report{reports.length === 1 ? "" : "s"}
								</span>
							</div>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{reports.map((r) => (
									<Link key={r.key} to={`/admin/reports/${r.key}`} className="card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:shadow-soft">
										<div className="flex items-start justify-between gap-3">
											<h3 className="font-semibold text-ink">{r.label}</h3>
											<ArrowRight size={16} className="mt-0.5 shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
										</div>
										<p className="mt-1 flex-1 text-sm text-ink-muted">{BLURB[r.key] || "Run with filters and export the rows."}</p>
										{r.filters?.length ? (
											<div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
												<SlidersHorizontal size={12} />
												{r.filters.slice(0, 4).map((f) => (
													<span key={f.key} className="rounded-full bg-cream px-2 py-0.5">
														{f.label}
													</span>
												))}
												{r.filters.length > 4 ? <span>+{r.filters.length - 4}</span> : null}
											</div>
										) : null}
									</Link>
								))}
							</div>
						</section>
					)
				})
			)}
		</div>
	)
}
