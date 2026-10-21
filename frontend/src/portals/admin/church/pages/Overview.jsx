import { Link, Navigate } from "react-router-dom"
import { CalendarDays, Church, HandCoins, HandHeart, Plus, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Empty, Panel, ProgressBar, QueryState, Skeleton, StatCard } from "@/shared/components/ui"
import { BarRow } from "@/shared/components/kit"
import { BarsChart, DonutChart, Legendary, TrendChart } from "@/shared/components/Charts"
import { date, money, num, pct } from "@/shared/utils/format"
import { API, ChurchTabs, toneOf, useChurchRoles } from "../components/common"
import { monthLabel } from "../components/kit"

function OverviewSkeleton() {
	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-24 rounded-2xl" />
				))}
			</div>
			<Skeleton className="h-72 rounded-2xl" />
		</div>
	)
}

function ChapelRow({ to, children }) {
	const cls = "flex items-center gap-3 px-5 py-3"
	return to ? (
		<Link to={to} className={`${cls} hover:bg-cream/60`}>
			{children}
		</Link>
	) : (
		<div className={cls}>{children}</div>
	)
}

export default function Overview() {
	const { canRead, canManage, isChaplain } = useChurchRoles()
	const q = useApi(`${API}church_dashboard`, {}, { enabled: canRead })
	if (!canRead) return <Navigate to="/admin/church/churches" replace />

	return (
		<>
			<ChurchTabs />
			<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div className="eyebrow mb-1">Church & sponsors</div>
					<h1 className="font-serif text-[1.6rem] leading-tight text-ink">Partnership at a glance</h1>
					<p className="mt-1 text-sm text-ink-muted">Partner churches, sponsors, giving and chapel life over the last twelve months.</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{isChaplain ? (
						<Link to="/admin/church/chapel?new=1" className="btn btn-secondary">
							<CalendarDays size={16} /> Schedule chapel
						</Link>
					) : null}
					{canManage ? (
						<Link to="/admin/church/giving?record=1" className="btn btn-primary">
							<Plus size={16} /> Record a gift
						</Link>
					) : null}
				</div>
			</div>
			<QueryState query={q} skeleton={<OverviewSkeleton />}>
				{(d) => <Dashboard d={d} />}
			</QueryState>
		</>
	)
}

function Dashboard({ d }) {
	const { canChapel } = useChurchRoles()
	const k = d.kpis || {}
	const trend = (d.giving_by_month || []).map((r) => ({ label: monthLabel(r.month), total: r.total }))
	const byType = (d.giving_by_type || []).filter((r) => r.total > 0).map((r) => ({ label: r.giving_type, value: r.total }))
	const chapel = (d.chapel_trend || []).map((r) => ({ label: monthLabel(r.month), attendance: r.attendance, services: r.services }))
	const sStatus = Object.entries(d.sponsorships_by_status || {})
	const sTotal = sStatus.reduce((a, [, n]) => a + n, 0)
	const churchMax = Math.max(1, ...(d.students_per_church || []).map((r) => r.students))
	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard label="Partner churches" value={num(k.partner_churches)} icon={Church} hint={`${num(k.active_churches)} active partnerships`} to="/admin/church/churches" />
				<StatCard label="Active sponsorships" value={num(k.active_sponsorships)} icon={HandHeart} tone="gold" hint={`${num(k.active_sponsors)} of ${num(k.sponsors)} sponsors active`} to="/admin/church/sponsorships" />
				<StatCard label="Giving this month" value={money(k.giving_this_month)} icon={HandCoins} tone="green" hint={`${money(k.giving_12m, { compact: true })} in 12 months`} to="/admin/church/giving" />
				<StatCard label="Sponsorship disbursed" value={pct(k.disbursed_pct)} icon={Users} tone="blue" hint={`${money(k.disbursed, { compact: true })} of ${money(k.committed, { compact: true })} committed`} to="/admin/church/sponsors" />
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Panel title="Giving trend" subtitle="Submitted gifts per month" className="lg:col-span-2">
					{trend.some((r) => r.total > 0) ? (
						<TrendChart data={trend} xKey="label" series={[{ key: "total", label: "Giving" }]} format={(v) => money(v, { compact: true })} />
					) : (
						<Empty compact title="No gifts in the last year" subtitle="Recorded and online gifts will chart here." />
					)}
				</Panel>
				<Panel title="Giving by type" subtitle="Last 12 months">
					{byType.length ? (
						<>
							<DonutChart data={byType} height={180} format={(v) => money(v, { compact: true })} centerLabel="total" />
							<div className="mt-3">
								<Legendary data={byType} format={(v) => money(v, { compact: true })} />
							</div>
						</>
					) : (
						<Empty compact title="Nothing to split yet" />
					)}
				</Panel>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Panel title="Sponsorships" subtitle={`${num(sTotal)} on record`} actions={<Link to="/admin/church/sponsorships" className="text-xs font-semibold text-brand-700">View all</Link>}>
					{sStatus.length ? (
						<ul className="space-y-3">
							{sStatus.map(([status, n]) => (
								<li key={status}>
									<div className="mb-1 flex items-center justify-between text-sm">
										<Badge status={status} tone={toneOf(status)} size="xs" />
										<span className="font-semibold text-ink">{num(n)}</span>
									</div>
									<ProgressBar value={(n * 100) / Math.max(1, sTotal)} size="sm" tone={status === "Active" ? "green" : "brand"} />
								</li>
							))}
						</ul>
					) : (
						<Empty compact title="No sponsorships yet" />
					)}
				</Panel>
				<Panel title="Students per church" subtitle="Current students by sending church">
					{(d.students_per_church || []).length ? (
						<div className="space-y-3">
							{d.students_per_church.map((r) => (
								<BarRow key={r.church} label={r.church_name} value={r.students} max={churchMax} caption={num(r.students)} />
							))}
						</div>
					) : (
						<Empty compact title="No students linked to churches" subtitle="Set the partner church on student records." />
					)}
				</Panel>
				<Panel title="Chapel attendance" subtitle="Total attendance at held services">
					{chapel.some((r) => r.attendance > 0) ? (
						<BarsChart data={chapel} xKey="label" series={[{ key: "attendance", label: "Attendance" }]} height={220} />
					) : (
						<Empty compact title="No services held yet" />
					)}
				</Panel>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<Panel title="Upcoming chapel services" icon={CalendarDays} bodyClass="p-0" actions={canChapel ? <Link to="/admin/church/chapel" className="text-xs font-semibold text-brand-700">Schedule</Link> : null}>
					{(d.upcoming_chapel || []).length ? (
						<ul className="divide-y divide-line">
							{d.upcoming_chapel.map((s) => (
								<li key={s.name}>
									<ChapelRow to={canChapel ? `/admin/church/chapel/${encodeURIComponent(s.name)}` : null}>
										<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold-50 text-center leading-none text-gold-800">
											<span>
												<span className="block text-[10px] font-semibold uppercase">{date(s.service_date, { month: "short" })}</span>
												<span className="block text-base font-bold">{date(s.service_date, { day: "numeric" })}</span>
											</span>
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-semibold text-ink">{s.theme || s.service_type}</span>
											<span className="block truncate text-xs text-ink-soft">{[s.service_type, s.preacher, s.campus].filter(Boolean).join(" · ")}</span>
										</span>
									</ChapelRow>
								</li>
							))}
						</ul>
					) : (
						<Empty compact title="Nothing scheduled" subtitle="Plan the coming chapel services from the Chapel screen." />
					)}
				</Panel>
				<Panel title="Recent gifts" icon={HandCoins} bodyClass="p-0" actions={<Link to="/admin/church/giving" className="text-xs font-semibold text-brand-700">All giving</Link>}>
					{(d.recent_giving || []).length ? (
						<ul className="divide-y divide-line">
							{d.recent_giving.map((g) => (
								<li key={g.name} className="flex items-center gap-3 px-5 py-3">
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-semibold text-ink">{g.giver_name || "Anonymous"}</span>
										<span className="block truncate text-xs text-ink-soft">{[g.giving_type, g.mode_of_payment, date(g.posting_date)].filter(Boolean).join(" · ")}</span>
									</span>
									<span className="shrink-0 text-sm font-bold tabular-nums text-ink">{money(g.amount)}</span>
								</li>
							))}
						</ul>
					) : (
						<Empty compact title="No gifts recorded yet" />
					)}
				</Panel>
			</div>
		</div>
	)
}
