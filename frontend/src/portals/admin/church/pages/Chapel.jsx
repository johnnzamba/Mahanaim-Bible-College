import { useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CalendarPlus, Church, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Button, Input, PageHeader, Select, StatCard } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { API, CHAPEL_STATUSES, ChurchTabs, RoleGate, toneOf, useChurchRoles } from "../components/common"
import { ChapelForm } from "../components/ChapelForm"
import { today, useLookups, usePaged } from "../components/kit"

const CHIPS = [
	{ id: "upcoming", label: "Upcoming" },
	{ id: "", label: "All" },
	...CHAPEL_STATUSES.map((s) => ({ id: s, label: s })),
]

const weekday = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", { weekday: "short" }) : "")

const COLS = [
	{
		key: "service_date",
		label: "Date",
		render: (r) => (
			<span className="block">
				<span className="block font-semibold text-ink">{date(r.service_date)}</span>
				<span className="block text-xs text-ink-soft">{weekday(r.service_date)}</span>
			</span>
		),
		sortValue: (r) => r.service_date,
		exportValue: (r) => r.service_date,
	},
	{
		key: "service_type",
		label: "Service",
		render: (r) => (
			<span className="block min-w-0">
				<span className="block truncate font-medium text-ink">{r.service_type}</span>
				<span className="block truncate text-xs text-ink-soft">{[r.theme, r.scripture].filter(Boolean).join(" · ") || "No theme yet"}</span>
			</span>
		),
	},
	{ key: "preacher", label: "Preacher", hideOnMobile: true, render: (r) => r.preacher || "—" },
	{ key: "campus", label: "Campus", hideOnMobile: true, render: (r) => r.campus || "All" },
	{ key: "total_attendance", label: "Attendance", align: "right", render: (r) => (r.status === "Held" ? num(r.total_attendance) : "—") },
	{ key: "offering_total", label: "Offering", align: "right", hideOnMobile: true, render: (r) => (r.offering_total ? money(r.offering_total) : "—") },
	{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" />, exportValue: (r) => r.status },
]

export default function Chapel() {
	return (
		<RoleGate need="chapel" title="Chapel">
			<ChapelPage />
		</RoleGate>
	)
}

function ChapelPage() {
	const nav = useNavigate()
	const { isChaplain } = useChurchRoles()
	const lookups = useLookups()
	const [params, setParams] = useSearchParams()
	const [chip, setChip] = useState("upcoming")
	const [campus, setCampus] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const upcoming = chip === "upcoming"
	const args = upcoming
		? { status: "Scheduled", campus, from_date: from > today() ? from : today(), to_date: to }
		: { status: chip, campus, from_date: from, to_date: to }
	const { query, rows, total, pager } = usePaged(`${API}list_chapel_services`, args)
	const held = useApi(`${API}list_chapel_services`, { status: "Held", page_length: 12 })
	const heldRows = held.data?.data || []
	const avg = heldRows.length ? heldRows.reduce((s, r) => s + (r.total_attendance || 0), 0) / heldRows.length : 0
	const offering = heldRows.reduce((s, r) => s + (r.offering_total || 0), 0)
	const newParam = isChaplain && params.get("new") === "1"
	const creating = useMemo(() => (newParam ? {} : null), [newParam])
	const [createState, setCreateState] = useState(null)
	const formInitial = createState || creating
	const closeForm = () => {
		setCreateState(null)
		if (params.get("new")) {
			const next = new URLSearchParams(params)
			next.delete("new")
			setParams(next, { replace: true })
		}
	}
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))

	return (
		<>
			<ChurchTabs />
			<PageHeader
				title="Chapel"
				subtitle="The worship calendar: services, preachers, who came and what was given."
				actions={
					isChaplain ? (
						<Button icon={CalendarPlus} onClick={() => setCreateState({})}>
							Schedule a service
						</Button>
					) : null
				}
			/>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label={upcoming ? "Upcoming services" : "Services listed"} value={num(total)} icon={Church} />
				<StatCard label="Average attendance" value={num(Math.round(avg))} hint={`Last ${heldRows.length} services held`} icon={Users} tone="blue" />
				<StatCard label="Offerings" value={money(offering, { compact: true })} hint={`Last ${heldRows.length} services`} tone="gold" />
				<StatCard label="Last service" value={heldRows[0] ? date(heldRows[0].service_date) : "—"} hint={heldRows[0] ? `${num(heldRows[0].total_attendance)} attended` : null} tone="green" />
			</div>
			<Toolbar chips={CHIPS} active={chip} onChip={setChip} right={<ExportButton filename="chapel-services.csv" cols={COLS} rows={rows} />} />
			<div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:max-w-3xl">
				<Select label="Campus" placeholder="All campuses" options={campuses} value={campus} onChange={(e) => setCampus(e.target.value)} />
				<Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
				<Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
			</div>
			<DataTable
				cols={COLS}
				query={query}
				rowTo={(r) => `/admin/church/chapel/${encodeURIComponent(r.name)}`}
				empty={upcoming ? "Nothing scheduled yet" : "No services match these filters"}
				emptyIcon={Church}
				emptyAction={
					isChaplain && upcoming ? (
						<Button size="sm" icon={CalendarPlus} onClick={() => setCreateState({})}>
							Schedule a service
						</Button>
					) : null
				}
				footer={pager}
			/>
			<ChapelForm initial={formInitial} onClose={closeForm} onSaved={(doc) => nav(`/admin/church/chapel/${encodeURIComponent(doc.name)}`)} />
		</>
	)
}
