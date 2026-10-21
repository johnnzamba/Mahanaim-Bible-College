import { useState } from "react"
import { Link } from "react-router-dom"
import { Handshake, Pencil, Plus, Repeat2 } from "lucide-react"
import { Badge, Button, PageHeader, ProgressBar, Select } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { money, num, pct } from "@/shared/utils/format"
import { API, ChurchTabs, COVERAGES, RoleGate, SPONSORSHIP_STATUSES, toneOf, useChurchRoles } from "../components/common"
import { usePaged } from "../components/kit"
import { SponsorshipForm, SponsorshipStatusDialog } from "../components/SponsorshipForm"

const CHIPS = [{ id: "", label: "All" }, ...SPONSORSHIP_STATUSES.map((s) => ({ id: s, label: s }))]

const stop = (e) => e.stopPropagation()

export default function Sponsorships() {
	return (
		<RoleGate title="Sponsorships">
			<SponsorshipsPage />
		</RoleGate>
	)
}

function SponsorshipsPage() {
	const { canManage } = useChurchRoles()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("Active")
	const [coverage, setCoverage] = useState("")
	const [editing, setEditing] = useState(null)
	const [statusRow, setStatusRow] = useState(null)
	const ds = useDebounced(search)
	const { query, rows, total, pager } = usePaged(`${API}list_sponsorships`, { search: ds, status, coverage })

	const cols = [
		{
			key: "student_name",
			label: "Student",
			render: (r) => (
				<span className="block min-w-0">
					<Link to={`/admin/students/${encodeURIComponent(r.student)}`} onClick={stop} className="block truncate font-semibold text-ink hover:text-brand-700">
						{r.student_name}
					</Link>
					<span className="block truncate text-xs text-ink-soft">{[r.student, r.programme].filter(Boolean).join(" · ")}</span>
				</span>
			),
			sortValue: (r) => r.student_name,
			exportValue: (r) => r.student_name,
		},
		{
			key: "sponsor_name",
			label: "Sponsor",
			render: (r) => (
				<Link to={`/admin/church/sponsors/${encodeURIComponent(r.sponsor)}`} onClick={stop} className="font-medium text-brand-700 hover:underline">
					{r.sponsor_name}
				</Link>
			),
			exportValue: (r) => r.sponsor_name,
		},
		{ key: "coverage", label: "Coverage", hideOnMobile: true, render: (r) => (r.coverage === "Percentage" ? `${num(r.percentage)}% of fees` : r.coverage) },
		{ key: "amount", label: "Pledged", align: "right", render: (r) => (r.amount ? money(r.amount) : "—") },
		{
			key: "amount_disbursed",
			label: "Disbursed",
			align: "right",
			render: (r) => (
				<span className="ml-auto block w-28">
					<span className="block">{money(r.amount_disbursed)}</span>
					{r.amount ? <ProgressBar className="mt-1" size="sm" value={(100 * (r.amount_disbursed || 0)) / r.amount} tone="green" /> : null}
				</span>
			),
		},
		{ key: "terms", label: "Terms", hideOnMobile: true, render: (r) => [r.start_term, r.end_term].filter(Boolean).join(" → ") || "Open-ended", exportValue: (r) => [r.start_term, r.end_term].filter(Boolean).join(" - ") },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" />, exportValue: (r) => r.status },
		...(canManage
			? [
					{
						key: "actions",
						label: "",
						export: false,
						align: "right",
						render: (r) => (
							<span className="flex justify-end gap-1" onClick={stop}>
								<button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit sponsorship for ${r.student_name}`} onClick={() => setEditing(r)}>
									<Pencil size={14} />
								</button>
								<button type="button" className="btn btn-ghost btn-sm" aria-label={`Change status for ${r.student_name}`} onClick={() => setStatusRow(r)}>
									<Repeat2 size={14} />
								</button>
							</span>
						),
					},
				]
			: []),
	]

	const pledged = rows.reduce((s, r) => s + (r.amount || 0), 0)
	const paid = rows.reduce((s, r) => s + (r.amount_disbursed || 0), 0)

	return (
		<>
			<ChurchTabs />
			<PageHeader
				title="Sponsorships"
				subtitle="Each link between a sponsor and a student: what was pledged, what has been paid and for how long."
				actions={
					canManage ? (
						<Button icon={Plus} onClick={() => setEditing({})}>
							New sponsorship
						</Button>
					) : null
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search student or sponsor…"
				chips={CHIPS}
				active={status}
				onChip={setStatus}
				right={
					<div className="flex items-center gap-2">
						<Select aria-label="Coverage" className="w-40" placeholder="All coverage" options={COVERAGES} value={coverage} onChange={(e) => setCoverage(e.target.value)} />
						<ExportButton filename="sponsorships.csv" cols={cols} rows={rows} />
					</div>
				}
			/>
			<DataTable
				cols={cols}
				query={query}
				onRow={canManage ? (r) => setEditing(r) : undefined}
				empty={ds || coverage ? "No sponsorships match these filters" : `No ${status ? status.toLowerCase() : ""} sponsorships`}
				emptyIcon={Handshake}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">
							{num(total)} sponsorships · this page: pledged {money(pledged)}, paid {money(paid)}
							{pledged ? ` (${pct((100 * paid) / pledged)})` : ""}
						</span>
						{pager}
					</div>
				}
			/>
			<SponsorshipForm initial={editing} onClose={() => setEditing(null)} />
			<SponsorshipStatusDialog row={statusRow} onClose={() => setStatusRow(null)} />
		</>
	)
}
