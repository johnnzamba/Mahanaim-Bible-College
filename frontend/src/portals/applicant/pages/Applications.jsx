import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ClipboardList, FilePlus2 } from "lucide-react"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { PageHeader } from "@/shared/components/ui"
import { date } from "@/shared/utils/format"
import { CLOSED_STATUSES } from "../lib"
import { useMyApplications } from "../hooks"
import { AppStatus, FeeBadge } from "../components/AppStatus"

const GROUPS = {
	all: () => true,
	draft: (a) => a.status === "Draft",
	active: (a) => a.status !== "Draft" && !CLOSED_STATUSES.includes(a.status),
	closed: (a) => CLOSED_STATUSES.includes(a.status),
}

export default function Applications() {
	const q = useMyApplications()
	const [search, setSearch] = useState("")
	const [group, setGroup] = useState("all")
	const term = useDebounced(search, 200).trim().toLowerCase()
	const apps = useMemo(() => q.data?.data || [], [q.data])
	const rows = useMemo(
		() =>
			apps.filter(GROUPS[group]).filter((a) => !term || [a.name, a.programme_name, a.intake, a.status, a.campus].some((v) => String(v || "").toLowerCase().includes(term))),
		[apps, group, term]
	)
	const count = (g) => (q.data ? apps.filter(GROUPS[g]).length : undefined)

	return (
		<>
			<PageHeader
				eyebrow="Admissions"
				title="My applications"
				subtitle="Every application you've started, submitted or received a decision on."
				actions={
					<Link to="/applicant/apply" className="btn btn-primary">
						<FilePlus2 size={16} /> New application
					</Link>
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search programme, number or intake"
				chips={[
					{ id: "all", label: "All", count: count("all") },
					{ id: "draft", label: "Drafts", count: count("draft") },
					{ id: "active", label: "In progress", count: count("active") },
					{ id: "closed", label: "Closed", count: count("closed") },
				]}
				active={group}
				onChip={setGroup}
			/>
			<DataTable
				query={q}
				rows={q.data ? rows : undefined}
				rowKey="name"
				rowTo={(r) => `/applicant/application/${r.name}`}
				pageSize={15}
				initialSort={{ key: "modified", dir: "desc" }}
				emptyIcon={ClipboardList}
				empty={apps.length ? "No applications match your filters" : "You haven't started an application yet"}
				cols={[
					{
						key: "programme_name",
						label: "Programme",
						render: (r) => (
							<div className="min-w-0">
								<div className="truncate font-medium text-ink">{r.programme_name}</div>
								<div className="text-xs text-ink-soft">
									{r.name}
									{r.campus || r.study_mode ? ` · ${[r.campus, r.study_mode].filter(Boolean).join(" · ")}` : ""}
								</div>
							</div>
						),
					},
					{ key: "intake", label: "Intake", hideOnMobile: true },
					{ key: "status", label: "Status", render: (r) => <AppStatus status={r.status} size="xs" /> },
					{
						key: "fee_status",
						label: "Fee",
						hideOnMobile: true,
						render: (r) => (r.application_fee > 0 ? <FeeBadge status={r.fee_status} appStatus={r.status} size="xs" /> : <span className="text-ink-soft">No fee</span>),
					},
					{ key: "submitted_on", label: "Submitted", hideOnMobile: true, render: (r) => (r.submitted_on ? date(r.submitted_on) : <span className="text-ink-soft">—</span>) },
					{ key: "modified", label: "Updated", render: (r) => <span className="text-ink-muted">{date(r.modified)}</span>, sortValue: (r) => r.modified },
				]}
			/>
		</>
	)
}
