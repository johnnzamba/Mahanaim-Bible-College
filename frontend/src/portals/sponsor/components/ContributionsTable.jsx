import { Link } from "react-router-dom"
import { HandCoins, Receipt } from "lucide-react"
import { DataTable } from "@/shared/components/kit"
import { Badge } from "@/shared/components/ui"
import { date, money } from "@/shared/utils/format"
import { CONTRIBUTION_TONE, contributionText, receiptUrl } from "../lib"

/** CSV columns for contributions (also used by the reports export). */
export const CONTRIBUTION_CSV = [
	{ key: "date", label: "Date" },
	{ key: "type", label: "Type" },
	{ key: "description", label: "Description", exportValue: (r) => contributionText(r) },
	{ key: "mode", label: "Method" },
	{ key: "reference", label: "Reference" },
	{ key: "amount", label: "Amount" },
	{ key: "name", label: "Document" },
]

export function ContributionsTable({ rows, query, pageSize, dense, empty = "No contributions recorded yet", className }) {
	const cols = [
		{ key: "date", label: "Date", render: (r) => date(r.date), sortValue: (r) => r.date },
		{
			key: "description",
			label: "Description",
			render: (r) => (
				<div className="min-w-0">
					{r.student ? (
						<Link to={`/sponsor/students/${r.student}`} className="font-medium text-ink hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
							{contributionText(r)}
						</Link>
					) : (
						<span className="font-medium text-ink">{contributionText(r)}</span>
					)}
					<div className="text-xs text-ink-soft">{r.type === "Sponsor Credit" ? r.reference || "Sponsorship credit" : r.name}</div>
				</div>
			),
			sortValue: (r) => contributionText(r),
		},
		{
			key: "type",
			label: "Type",
			render: (r) => (
				<Badge tone={CONTRIBUTION_TONE[r.type]} size="xs">
					{r.type === "Giving" ? "Gift" : r.type}
				</Badge>
			),
		},
		{
			key: "mode",
			label: "Method",
			hideOnMobile: true,
			render: (r) =>
				r.mode ? (
					<div>
						<div className="text-sm">{r.mode}</div>
						{r.reference && r.type !== "Sponsor Credit" ? <div className="font-mono text-[11px] text-ink-soft">{r.reference}</div> : null}
					</div>
				) : (
					"—"
				),
		},
		{ key: "amount", label: "Amount", align: "right", render: (r) => <span className="font-semibold text-ink">{money(r.amount)}</span>, sortValue: (r) => r.amount },
		{
			key: "receipt",
			label: "Receipt",
			align: "right",
			sortable: false,
			hideOnMobile: true,
			render: (r) =>
				r.type === "Fee Payment" ? (
					<a href={receiptUrl(r.name)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" onClick={(e) => e.stopPropagation()} aria-label={`Receipt ${r.name}`}>
						<Receipt size={14} /> PDF
					</a>
				) : (
					<span className="text-xs text-ink-soft">—</span>
				),
		},
	]
	return (
		<DataTable
			cols={cols}
			rows={rows}
			query={query}
			rowKey={(r) => `${r.type}-${r.name}`}
			pageSize={pageSize}
			dense={dense}
			empty={empty}
			emptyIcon={HandCoins}
			className={className}
		/>
	)
}
