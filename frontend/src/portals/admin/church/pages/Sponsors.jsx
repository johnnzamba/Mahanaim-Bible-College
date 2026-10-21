import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { HandHeart, Plus, Send, UserCheck } from "lucide-react"
import { Avatar, Badge, Button, ConfirmDialog, PageHeader, Select, StatCard } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { money, num, pct } from "@/shared/utils/format"
import { API, ChurchTabs, RoleGate, SPONSOR_STATUSES, SPONSOR_TYPES, useChurchRoles, useSendSponsorReports } from "../components/common"
import { usePaged } from "../components/kit"
import { SponsorForm } from "../components/SponsorForm"

const CHIPS = [{ id: "", label: "All" }, ...SPONSOR_STATUSES.map((s) => ({ id: s, label: s }))]

const COLS = [
	{
		key: "sponsor_name",
		label: "Sponsor",
		render: (r) => (
			<span className="flex min-w-0 items-center gap-3">
				<Avatar name={r.sponsor_name} size={34} />
				<span className="min-w-0">
					<span className="block truncate font-semibold text-ink">{r.sponsor_name}</span>
					<span className="block truncate text-xs text-ink-soft">{[r.email, r.phone].filter(Boolean).join(" · ") || r.name}</span>
				</span>
			</span>
		),
		sortValue: (r) => r.sponsor_name,
		exportValue: (r) => r.sponsor_name,
	},
	{ key: "sponsor_type", label: "Type", hideOnMobile: true },
	{ key: "partner_church", label: "Church", hideOnMobile: true, render: (r) => r.partner_church || "—" },
	{ key: "active_sponsorships", label: "Students", align: "right", render: (r) => num(r.active_sponsorships) },
	{ key: "total_committed", label: "Committed", align: "right", render: (r) => money(r.total_committed) },
	{
		key: "total_disbursed",
		label: "Disbursed",
		align: "right",
		render: (r) => (
			<span className="block">
				<span className="block">{money(r.total_disbursed)}</span>
				{r.total_committed ? <span className="block text-xs text-ink-soft">{pct((100 * r.total_disbursed) / r.total_committed)}</span> : null}
			</span>
		),
	},
	{
		key: "status",
		label: "Status",
		render: (r) => (
			<span className="flex items-center gap-1.5">
				<Badge status={r.status} size="xs" />
				{r.user ? <UserCheck size={14} className="text-emerald-600" aria-label="Has portal access" /> : null}
			</span>
		),
		exportValue: (r) => r.status,
	},
]

export default function Sponsors() {
	return (
		<RoleGate title="Sponsors">
			<SponsorsPage />
		</RoleGate>
	)
}

function SponsorsPage() {
	const nav = useNavigate()
	const { canManage } = useChurchRoles()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("Active")
	const [type, setType] = useState("")
	const [creating, setCreating] = useState(null)
	const [confirmReports, setConfirmReports] = useState(false)
	const reports = useSendSponsorReports(() => setConfirmReports(false))
	const ds = useDebounced(search)
	const { query, rows, total, pager } = usePaged(`${API}list_sponsors`, { search: ds, status, sponsor_type: type })
	const committed = rows.reduce((s, r) => s + (r.total_committed || 0), 0)
	const disbursed = rows.reduce((s, r) => s + (r.total_disbursed || 0), 0)

	return (
		<>
			<ChurchTabs />
			<PageHeader
				title="Sponsors"
				subtitle="People, churches and organisations carrying students' fees, with what they pledged and what has reached the student."
				actions={
					canManage ? (
						<>
							<Button variant="secondary" icon={Send} onClick={() => setConfirmReports(true)}>
								Send sponsor reports
							</Button>
							<Button icon={Plus} onClick={() => setCreating({})}>
								New sponsor
							</Button>
						</>
					) : null
				}
			/>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Sponsors listed" value={num(total)} icon={HandHeart} />
				<StatCard label="Students supported" value={num(rows.reduce((s, r) => s + (r.active_sponsorships || 0), 0))} hint="On this page" />
				<StatCard label="Committed" value={money(committed, { compact: true })} hint="On this page" />
				<StatCard label="Disbursed" value={money(disbursed, { compact: true })} hint={committed ? `${pct((100 * disbursed) / committed)} of pledges` : "On this page"} tone="green" />
			</div>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, email, phone, contact…"
				chips={CHIPS}
				active={status}
				onChip={setStatus}
				right={
					<div className="flex items-center gap-2">
						<Select aria-label="Sponsor type" className="w-40" placeholder="All types" options={SPONSOR_TYPES} value={type} onChange={(e) => setType(e.target.value)} />
						<ExportButton filename="sponsors.csv" cols={COLS} rows={rows} />
					</div>
				}
			/>
			<DataTable
				cols={COLS}
				query={query}
				rowTo={(r) => `/admin/church/sponsors/${encodeURIComponent(r.name)}`}
				empty={ds || type ? "No sponsors match these filters" : "No sponsors yet"}
				emptyIcon={HandHeart}
				footer={pager}
			/>
			<SponsorForm initial={creating} onClose={() => setCreating(null)} onSaved={(doc) => nav(`/admin/church/sponsors/${encodeURIComponent(doc.name)}`)} />
			<ConfirmDialog
				open={confirmReports}
				title="Send progress reports to all sponsors?"
				message="Every active sponsor with a current sponsorship is sent their progress report through the Sponsor Report template (email, SMS and portal as set there). It runs in the background. Reports also go out automatically after each term ends."
				confirmLabel="Send reports"
				loading={reports.isPending}
				onConfirm={() => reports.mutate({})}
				onClose={() => setConfirmReports(false)}
			/>
		</>
	)
}
