import { Link } from "react-router-dom"
import { CalendarDays, FileText, HelpCircle, Inbox, MessageSquareQuote, Newspaper, Plus, Settings2 } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Empty, PageHeader, Panel, ProgressBar, QueryState, SkeletonRows, StatCard } from "@/shared/components/ui"
import { DonutChart, Legendary } from "@/shared/components/Charts"
import { ago, dateTime, num } from "@/shared/utils/format"
import { API, ENQ_STATUSES, WebTabs, toneOf, useWebRoles } from "../components/common"

const ENQ_COLORS = { New: "#d97706", "In Progress": "#0284c7", Responded: "#059669", Closed: "#94a3b8" }

export default function Overview() {
	const roles = useWebRoles()
	const q = useApi(`${API}cms_overview`, {}, { enabled: roles.any })
	if (!roles.any) {
		return (
			<>
				<PageHeader title="Website" />
				<Alert tone="warning" title="The website is managed by the communications office" />
			</>
		)
	}
	return (
		<>
			<WebTabs />
			<PageHeader
				title="Website"
				subtitle="What visitors see on the public site, and what they ask us."
				actions={
					<>
						{roles.canEvents ? (
							<Link to="/admin/website/events/new" className="btn btn-secondary">
								<CalendarDays size={16} /> New event
							</Link>
						) : null}
						{roles.canCms ? (
							<Link to="/admin/website/news/new" className="btn btn-primary">
								<Plus size={16} /> Write news
							</Link>
						) : null}
					</>
				}
			/>
			<QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
				{(d) => <Body d={d} roles={roles} />}
			</QueryState>
		</>
	)
}

function Body({ d, roles }) {
	const c = d.counts
	const enq = ENQ_STATUSES.map((s) => ({ label: s, value: c.enquiries?.[s] || 0, color: ENQ_COLORS[s] })).filter((x) => x.value)
	return (
		<>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Open enquiries" value={num(c.enquiries_open)} icon={Inbox} tone={c.enquiries?.New ? "orange" : "green"} hint={`${num(c.enquiries?.New || 0)} new`} to={roles.canEnquiries ? "/admin/website/enquiries" : undefined} />
				<StatCard label="News published" value={num(c.news_published)} icon={Newspaper} tone="brand" hint={`${num(c.news_drafts)} drafts · ${num(c.news_scheduled)} scheduled`} to={roles.canCms ? "/admin/website/news" : undefined} />
				<StatCard label="Upcoming events" value={num(c.events_upcoming)} icon={CalendarDays} tone="blue" hint={`${num(c.registrations_upcoming)} registered · ${num(c.events_draft)} drafts`} to={roles.canEvents ? "/admin/website/events" : undefined} />
				<StatCard label="FAQs · testimonials" value={`${num(c.faqs)} · ${num(c.testimonials)}`} icon={HelpCircle} tone="gold" hint="Published" to={roles.canFaqs ? "/admin/website/content" : undefined} />
			</div>
			<div className="grid gap-5 lg:grid-cols-3">
				<Panel
					className="lg:col-span-2"
					title="Latest enquiries"
					icon={Inbox}
					bodyClass="p-0"
					actions={
						roles.canEnquiries ? (
							<Link to="/admin/website/enquiries" className="text-sm font-semibold text-brand-700 hover:underline">
								Open inbox
							</Link>
						) : null
					}
				>
					{d.recent_enquiries?.length ? (
						<ul className="divide-y divide-line">
							{d.recent_enquiries.map((e) => (
								<li key={e.name}>
									<Link to={roles.canEnquiries ? `/admin/website/enquiries/${encodeURIComponent(e.name)}` : "#"} className="flex items-center gap-3 px-5 py-3 hover:bg-cream/60">
										<span className="min-w-0 flex-1">
											<span className="block truncate font-semibold text-ink">{e.full_name}</span>
											<span className="block truncate text-xs text-ink-soft">
												{e.subject} · {e.email}
												{e.assigned_to ? ` · with ${e.assigned_to}` : ""}
											</span>
										</span>
										<span className="text-xs text-ink-soft">{ago(e.creation)}</span>
										<Badge status={e.status} tone={toneOf(e.status)} size="xs" />
									</Link>
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={Inbox} title="No enquiries yet" subtitle="Messages from the website contact form appear here." />
					)}
				</Panel>
				<Panel title="Enquiries by status">
					{enq.length ? (
						<>
							<DonutChart data={enq} height={180} centerLabel="enquiries" />
							<Legendary data={enq} />
						</>
					) : (
						<Empty compact title="Nothing to chart yet" />
					)}
				</Panel>
				<Panel
					className="lg:col-span-2"
					title="Coming up"
					icon={CalendarDays}
					bodyClass="p-0"
					actions={
						roles.canEvents ? (
							<Link to="/admin/website/events" className="text-sm font-semibold text-brand-700 hover:underline">
								All events
							</Link>
						) : null
					}
				>
					{d.upcoming_events?.length ? (
						<ul className="divide-y divide-line">
							{d.upcoming_events.map((e) => (
								<li key={e.name}>
									<Link to={roles.canEvents ? `/admin/website/events/${encodeURIComponent(e.name)}` : "#"} className="grid gap-2 px-5 py-3 hover:bg-cream/60 sm:grid-cols-[1fr_12rem] sm:items-center">
										<span className="min-w-0">
											<span className="block truncate font-semibold text-ink">{e.title}</span>
											<span className="block text-xs text-ink-soft">{dateTime(e.start_datetime)}</span>
										</span>
										{e.registration_required ? (
											<span className="text-xs text-ink-soft">
												{num(e.registered_count)} registered{e.capacity ? ` of ${num(e.capacity)}` : ""}
												{e.capacity ? <ProgressBar className="mt-1" value={Math.min(100, (e.registered_count / e.capacity) * 100)} size="sm" tone={e.seats_left === 0 ? "red" : "brand"} /> : null}
											</span>
										) : (
											<span className="text-xs text-ink-soft">Open to all</span>
										)}
									</Link>
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={CalendarDays} title="No upcoming events" />
					)}
				</Panel>
				<Panel title="Quick links">
					<div className="grid gap-2">
						{roles.canCms ? <QuickLink to="/admin/website/content?tab=settings" icon={Settings2} label="Home page & contacts" /> : null}
						{roles.canFaqs ? <QuickLink to="/admin/website/content?tab=faqs" icon={HelpCircle} label="Frequently asked questions" /> : null}
						{roles.canCms ? <QuickLink to="/admin/website/content?tab=testimonials" icon={MessageSquareQuote} label="Testimonials" /> : null}
						<a href="/" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-cream">
							<FileText size={16} className="text-brand-700" /> View the public site
						</a>
					</div>
				</Panel>
			</div>
		</>
	)
}

function QuickLink({ to, icon: Icon, label }) {
	return (
		<Link to={to} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-cream">
			<Icon size={16} className="text-brand-700" /> {label}
		</Link>
	)
}
