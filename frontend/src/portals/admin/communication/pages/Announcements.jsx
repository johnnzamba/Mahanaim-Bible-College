import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Mail, Megaphone, MessageSquare, MonitorSmartphone, Pin, Plus, Send } from "lucide-react"
import { Alert, Badge, Button, Empty, PageHeader, Select, Card } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { dateTime, num } from "@/shared/utils/format"
import { ANN_STATUSES, API, AUDIENCES, CommsTabs, toneOf, useCommsRoles } from "../components/common"
import { DirectMessage } from "../components/DirectMessage"
import { usePaged } from "../components/kit"

const audienceLabel = (r) => (r.audience === "Programme" ? `Programme: ${r.programme}` : r.audience === "Campus" ? `Campus: ${r.campus}` : r.audience === "Course Offering" ? `Class: ${r.course_offering}` : r.audience)

const COLS = [
	{
		key: "title",
		label: "Announcement",
		render: (r) => (
			<span className="block min-w-0">
				<span className="flex items-center gap-1.5 font-semibold text-ink">
					{r.is_pinned ? <Pin size={13} className="shrink-0 text-gold-600" aria-label="Pinned" /> : null}
					<span className="truncate">{r.title}</span>
				</span>
				<span className="block truncate text-xs text-ink-soft">{audienceLabel(r)}</span>
			</span>
		),
	},
	{
		key: "channels",
		label: "Channels",
		hideOnMobile: true,
		render: (r) => (
			<span className="flex items-center gap-2 text-ink-soft">
				{r.show_in_portal ? <MonitorSmartphone size={15} aria-label="Portal" /> : null}
				{r.send_email ? <Mail size={15} aria-label="Email" /> : null}
				{r.send_sms ? <MessageSquare size={15} aria-label="SMS" /> : null}
			</span>
		),
	},
	{
		key: "when",
		label: "When",
		hideOnMobile: true,
		render: (r) =>
			r.status === "Sent" ? (
				<span className="text-sm">Sent {dateTime(r.sent_on)}</span>
			) : r.status === "Scheduled" ? (
				<span className="text-sm text-sky-700">For {dateTime(r.publish_on)}</span>
			) : (
				<span className="text-sm text-ink-soft">Edited {dateTime(r.modified)}</span>
			),
		sortValue: (r) => r.sent_on || r.publish_on || r.modified,
	},
	{ key: "recipients_count", label: "Reached", align: "right", render: (r) => (r.status === "Sent" || r.recipients_count ? num(r.recipients_count) : "—") },
	{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" /> },
]

export default function Announcements() {
	const nav = useNavigate()
	const { canAnnounce, canDirect, isComms } = useCommsRoles()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [audience, setAudience] = useState("")
	const [dm, setDm] = useState(false)
	const ds = useDebounced(search)
	const { query, total, pager } = usePaged(`${API}list_announcements`, { search: ds, status, audience }, 20, { enabled: canAnnounce })
	const counts = query.data?.counts || {}
	const all = Object.values(counts).reduce((a, b) => a + b, 0)
	const chips = [{ id: "", label: "All", count: all }, ...ANN_STATUSES.map((s) => ({ id: s, label: s, count: counts[s] || 0 }))]
	const actions = (
		<>
			{canDirect ? (
				<Button variant="secondary" icon={Send} onClick={() => setDm(true)}>
					Send a message
				</Button>
			) : null}
			{canAnnounce ? (
				<Button icon={Plus} onClick={() => nav("/admin/communication/announcements/new")}>
					New announcement
				</Button>
			) : null}
		</>
	)
	return (
		<>
			<CommsTabs />
			<PageHeader title="Announcements" subtitle="News for students, staff, sponsors and alumni, delivered in the portal, by email and by SMS." actions={actions} />
			{canAnnounce ? (
				<>
					<Toolbar
						search={search}
						onSearch={setSearch}
						placeholder="Search title or text…"
						chips={chips}
						active={status}
						onChip={setStatus}
						right={<Select aria-label="Audience" className="w-44" placeholder="Any audience" options={AUDIENCES} value={audience} onChange={(e) => setAudience(e.target.value)} />}
					/>
					<DataTable
						cols={COLS}
						query={query}
						rowTo={(r) => `/admin/communication/announcements/${encodeURIComponent(r.name)}`}
						empty={ds || status || audience ? "No announcements match" : "No announcements yet"}
						emptyIcon={Megaphone}
						footer={
							<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
								<span className="text-ink-soft">{num(total)} announcements</span>
								{pager}
							</div>
						}
					/>
				</>
			) : (
				<Card>
					<Empty
						icon={Megaphone}
						title="Announcements are posted by the communications office"
						subtitle={canDirect ? "You can still message applicants, students or staff directly." : "Ask the communications office to post one for you."}
						action={
							canDirect ? (
								<Button icon={Send} onClick={() => setDm(true)}>
									Send a message
								</Button>
							) : null
						}
					/>
				</Card>
			)}
			{isComms ? null : canAnnounce ? (
				<Alert tone="info" className="mt-4" title="Delivery reports">
					The communications office can see the message log for every announcement you send.
				</Alert>
			) : null}
			<DirectMessage open={dm} onClose={() => setDm(false)} />
		</>
	)
}
