import { useState } from "react"
import { Link } from "react-router-dom"
import { CalendarDays, Plus, Radio } from "lucide-react"
import { Alert, Badge, PageHeader, ProgressBar, Select } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { dateTime, money, num } from "@/shared/utils/format"
import { API, EVENT_STATUSES, NoImage, WebTabs, toneOf, useWebRoles } from "../components/common"
import { usePaged } from "../components/kit"

const COLS = [
	{
		key: "title",
		label: "Event",
		render: (r) => (
			<span className="flex min-w-0 items-center gap-3">
				{r.cover_image ? <img src={r.cover_image} alt="" className="h-11 w-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : <NoImage className="h-11 w-16 shrink-0 rounded-lg" />}
				<span className="min-w-0">
					<span className="flex items-center gap-1.5 font-semibold text-ink">
						<span className="truncate">{r.title}</span>
						{r.livestream_url ? <Radio size={13} className="shrink-0 text-red-500" aria-label="Live-streamed" /> : null}
					</span>
					<span className="block truncate text-xs text-ink-soft">
						{r.event_type}
						{r.venue ? ` · ${r.venue}` : ""}
						{r.is_public ? "" : " · staff only"}
					</span>
				</span>
			</span>
		),
	},
	{ key: "start_datetime", label: "When", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-sm">{dateTime(r.start_datetime)}</span>, sortValue: (r) => r.start_datetime },
	{
		key: "registered_count",
		label: "Registrations",
		hideOnMobile: true,
		render: (r) =>
			r.registration_required ? (
				<span className="block w-36 text-xs text-ink-soft">
					{num(r.registered_count)}
					{r.capacity ? ` / ${num(r.capacity)}` : ""} registered
					{r.attended_count ? ` · ${num(r.attended_count)} came` : ""}
					{r.capacity ? <ProgressBar className="mt-1" size="sm" value={(r.registered_count / r.capacity) * 100} tone={r.seats_left === 0 ? "red" : "brand"} /> : null}
				</span>
			) : (
				<span className="text-xs text-ink-soft">No registration</span>
			),
	},
	{ key: "fee", label: "Fee", align: "right", hideOnMobile: true, render: (r) => (Number(r.fee) > 0 ? money(r.fee) : "Free") },
	{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" /> },
]

export default function Events() {
	const { canEvents } = useWebRoles()
	const [search, setSearch] = useState("")
	const [scope, setScope] = useState("upcoming")
	const [status, setStatus] = useState("")
	const ds = useDebounced(search)
	const { query, total, pager } = usePaged(`${API}list_events`, { search: ds, scope, status }, 20, { enabled: canEvents })
	if (!canEvents) {
		return (
			<>
				<WebTabs />
				<PageHeader title="Events" />
				<Alert tone="warning" title="Events are managed by the communications office and the chaplaincy" />
			</>
		)
	}
	return (
		<>
			<WebTabs />
			<PageHeader
				title="Events"
				subtitle="Conferences, open days, retreats and services, with online registration and check-in."
				actions={
					<Link to="/admin/website/events/new" className="btn btn-primary">
						<Plus size={16} /> New event
					</Link>
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search title or venue…"
				chips={[
					{ id: "upcoming", label: "Upcoming" },
					{ id: "past", label: "Past" },
					{ id: "", label: "All" },
				]}
				active={scope}
				onChip={setScope}
				right={<Select aria-label="Status" className="w-40" placeholder="Any status" options={EVENT_STATUSES} value={status} onChange={(e) => setStatus(e.target.value)} />}
			/>
			<DataTable
				cols={COLS}
				query={query}
				rowTo={(r) => `/admin/website/events/${encodeURIComponent(r.name)}`}
				empty={ds || status ? "No events match" : scope === "upcoming" ? "Nothing coming up" : "No events yet"}
				emptyIcon={CalendarDays}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">{num(total)} events</span>
						{pager}
					</div>
				}
			/>
		</>
	)
}
