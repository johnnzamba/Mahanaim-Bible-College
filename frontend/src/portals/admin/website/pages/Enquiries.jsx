import { useState } from "react"
import { Inbox, UserCheck } from "lucide-react"
import { Alert, Badge, PageHeader, Select, Switch } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { ago, num } from "@/shared/utils/format"
import { useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { API, ENQ_STATUSES, ENQ_SUBJECTS, WebTabs, toneOf, useWebRoles } from "../components/common"
import { usePaged } from "../components/kit"

export default function Enquiries() {
	const { canEnquiries } = useWebRoles()
	const { user } = useSession()
	const me = user
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("open")
	const [subject, setSubject] = useState("")
	const [mine, setMine] = useState(false)
	const ds = useDebounced(search)
	const isOpen = status === "open"
	const filters = { search: ds || undefined, subject: subject || undefined, assigned_to: mine ? "me" : undefined }
	const paged = usePaged(`${API}list_enquiries`, { ...filters, status }, 25, { enabled: canEnquiries && !isOpen })
	const fresh = useApi(`${API}list_enquiries`, { ...filters, status: "New", page_length: 200 }, { enabled: canEnquiries && isOpen })
	const working = useApi(`${API}list_enquiries`, { ...filters, status: "In Progress", page_length: 200 }, { enabled: canEnquiries && isOpen })
	const query = isOpen ? (fresh.isError ? fresh : working.isError ? working : fresh.data && working.data ? working : fresh) : paged.query
	const { total, pager } = paged
	const counts = (isOpen ? fresh.data?.counts : paged.query.data?.counts) || {}
	const all = Object.values(counts).reduce((a, b) => a + b, 0)
	const rows = isOpen ? (fresh.data && working.data ? [...fresh.data.data, ...working.data.data].sort((a, b) => (a.creation < b.creation ? 1 : -1)) : undefined) : paged.query.data?.data
	const cols = [
		{
			key: "full_name",
			label: "From",
			render: (r) => (
				<span className="block min-w-0">
					<span className={`block truncate text-ink ${r.status === "New" ? "font-bold" : "font-semibold"}`}>{r.full_name}</span>
					<span className="block truncate text-xs text-ink-soft">{r.email}</span>
				</span>
			),
		},
		{
			key: "preview",
			label: "Enquiry",
			hideOnMobile: true,
			render: (r) => (
				<span className="block min-w-0 max-w-lg">
					<span className="text-xs font-semibold text-brand-700">{r.subject}</span>
					<span className="block truncate text-sm text-ink-muted">{r.preview}</span>
				</span>
			),
		},
		{
			key: "assigned_to",
			label: "With",
			hideOnMobile: true,
			render: (r) => (r.assigned_to ? <span className="text-sm">{r.assigned_to === me ? "You" : r.assigned_to}</span> : <span className="text-xs text-amber-700">Unassigned</span>),
		},
		{ key: "creation", label: "Received", render: (r) => <span className="whitespace-nowrap text-sm text-ink-soft">{ago(r.creation)}</span>, sortValue: (r) => r.creation },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" /> },
	]
	if (!canEnquiries) {
		return (
			<>
				<WebTabs />
				<PageHeader title="Enquiries" />
				<Alert tone="warning" title="Enquiries are handled by the communications and admissions offices" />
			</>
		)
	}
	return (
		<>
			<WebTabs />
			<PageHeader title="Enquiries" subtitle="Messages sent through the website contact form. Responding emails the enquirer." />
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, email, message or reference…"
				chips={[
					{ id: "open", label: "Open", count: (counts.New || 0) + (counts["In Progress"] || 0) },
					...ENQ_STATUSES.map((s) => ({ id: s, label: s, count: counts[s] || 0 })),
					{ id: "", label: "All", count: all },
				]}
				active={status}
				onChip={setStatus}
				right={
					<div className="flex flex-wrap items-center gap-3">
						<Select aria-label="Subject" className="w-40" placeholder="Any subject" options={ENQ_SUBJECTS} value={subject} onChange={(e) => setSubject(e.target.value)} />
						<Switch checked={mine} onChange={setMine} label={<span className="inline-flex items-center gap-1"><UserCheck size={14} /> Mine</span>} />
					</div>
				}
			/>
			<DataTable
				cols={cols}
				rows={rows}
				query={query}
				rowTo={(r) => `/admin/website/enquiries/${encodeURIComponent(r.name)}`}
				empty={isOpen && !ds && !subject && !mine ? "Inbox zero. Every enquiry has been answered." : "No enquiries match"}
				emptyIcon={Inbox}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">{isOpen ? `${num(rows?.length || 0)} open` : `${num(total)} enquiries`}</span>
						{isOpen ? null : pager}
					</div>
				}
			/>
		</>
	)
}
