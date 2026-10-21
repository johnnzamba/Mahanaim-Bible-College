import { useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, BookCopy, BookOpen, BookPlus, ClipboardList, Download, HandCoins, Library, Plus } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Badge, Button, Empty, PageHeader, Panel, QueryState, SkeletonRows, StatCard, Tabs } from "@/shared/components/ui"
import { BarRow } from "@/shared/components/kit"
import { BarsChart, DonutChart, Legendary, PALETTE } from "@/shared/components/Charts"
import { date, money, num } from "@/shared/utils/format"
import { API, INVALIDATE, LibTabs, NoAccess, dueText, sinceText, useLibRoles } from "../components/common"
import { monthLabel } from "../components/kit"
import { IssueLoanModal } from "../components/IssueLoan"

const loanLink = (r) => `/admin/library/loans?loan=${encodeURIComponent(r.name)}`

export default function Overview() {
	const { canRead, canManage } = useLibRoles()
	const q = useApi(`${API}library_dashboard`, {}, { enabled: canRead })
	const [issuing, setIssuing] = useState(false)
	if (!canRead) return <NoAccess />
	const loanDays = q.data?.settings?.loan_days || 14
	return (
		<>
			<LibTabs />
			<PageHeader
				title="Library"
				subtitle="Catalogue, circulation and e-library at a glance."
				actions={
					canManage ? (
						<>
							<Link to="/admin/library/catalogue/new" className="btn btn-secondary">
								<Plus size={16} /> Add item
							</Link>
							<Button icon={BookPlus} onClick={() => setIssuing(true)}>
								Issue a loan
							</Button>
						</>
					) : null
				}
			/>
			<QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
				{(d) => <Dashboard d={d} canManage={canManage} />}
			</QueryState>
			<IssueLoanModal open={issuing} onClose={() => setIssuing(false)} loanDays={loanDays} />
		</>
	)
}

function Dashboard({ d, canManage }) {
	const k = d.kpis || {}
	const [popular, setPopular] = useState("borrowed")
	const issue = useAction(`${API}issue_loan`, { invalidate: INVALIDATE, success: (x) => `Issued to ${x.borrower_name}, due ${date(x.due_date)}` })
	const months = (d.loans_per_month || []).map((m) => ({ label: monthLabel(m.month), loans: m.loans }))
	const types = (d.by_type || []).map((t, i) => ({ label: t.item_type, value: t.count, color: PALETTE[i % PALETTE.length] }))
	const subjects = d.by_subject || []
	const maxSubject = Math.max(1, ...subjects.map((s) => s.count))
	const top = popular === "borrowed" ? d.top_borrowed || [] : d.top_downloaded || []
	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Titles" value={num(k.items)} icon={Library} hint={`${num(k.available_copies)} of ${num(k.copies)} copies in`} to="/admin/library/catalogue" />
				<StatCard label="On loan" value={num(k.on_loan)} icon={BookCopy} tone="blue" hint={k.overdue ? `${num(k.overdue)} overdue` : "None overdue"} to="/admin/library/loans?tab=active" />
				<StatCard label="Requests" value={num(k.requests)} icon={ClipboardList} tone="orange" hint="Waiting to be issued" to="/admin/library/loans?tab=requests" />
				<StatCard label="Fines outstanding" value={money(k.fines_outstanding)} icon={HandCoins} tone={k.fines_outstanding ? "red" : "green"} hint={`${money(d.settings?.fine_per_day)} per day late`} />
			</div>

			<div className="grid gap-5 lg:grid-cols-2">
				<Panel title="Pending requests" subtitle="Oldest first. Issue hands the copy over now." icon={ClipboardList} actions={<Link to="/admin/library/loans?tab=requests" className="text-sm font-semibold text-brand-700 hover:underline">All requests</Link>}>
					{d.requests?.length ? (
						<ul className="-my-2 divide-y divide-line">
							{d.requests.map((r) => (
								<li key={r.name} className="flex items-center gap-3 py-2.5">
									<Link to={loanLink(r)} className="min-w-0 flex-1">
										<span className="block truncate text-sm font-semibold text-ink">{r.item_title}</span>
										<span className="block truncate text-xs text-ink-soft">
											{r.borrower_name} · {r.borrower_type} · {sinceText(r.issue_date)}
										</span>
									</Link>
									{canManage ? (
										<Button size="sm" variant="secondary" loading={issue.isPending && issue.variables?.loan === r.name} onClick={() => issue.mutate({ loan: r.name })}>
											Issue
										</Button>
									) : null}
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={ClipboardList} title="No pending requests" subtitle="Students request books from their portal." />
					)}
				</Panel>
				<Panel title="Overdue" subtitle="Most overdue first." icon={AlertTriangle} actions={<Link to="/admin/library/loans?tab=active" className="text-sm font-semibold text-brand-700 hover:underline">All loans</Link>}>
					{d.overdue?.length ? (
						<ul className="-my-2 divide-y divide-line">
							{d.overdue.map((r) => (
								<li key={r.name}>
									<Link to={loanLink(r)} className="flex items-center gap-3 py-2.5">
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-semibold text-ink">{r.item_title}</span>
											<span className="block truncate text-xs text-ink-soft">
												{r.borrower_name} · due {date(r.due_date)}
											</span>
										</span>
										<span className="shrink-0 text-right">
											<span className="block text-xs font-semibold text-red-600">{dueText(r)}</span>
											{Number(r.fine_amount) > 0 ? <span className="block text-xs text-ink-soft">{money(r.fine_amount)}</span> : null}
										</span>
									</Link>
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={BookOpen} title="Nothing overdue" subtitle="Every loan is within its due date." />
					)}
				</Panel>
			</div>

			<div className="grid gap-5 lg:grid-cols-3">
				<Panel title="Loans per month" subtitle="Copies issued over the last 12 months." className="lg:col-span-2">
					<BarsChart data={months} xKey="label" series={[{ key: "loans", label: "Loans" }]} height={320} />
				</Panel>
				<Panel title="Collection by type">
					{types.length ? (
						<>
							<DonutChart data={types} height={170} center={num(k.items)} centerLabel="titles" />
							<Legendary data={types} />
						</>
					) : (
						<Empty compact title="No items yet" />
					)}
				</Panel>
			</div>

			<div className="grid gap-5 lg:grid-cols-3">
				<Panel title="Popular items" className="lg:col-span-2" bodyClass="pt-0">
					<Tabs
						size="sm"
						className="mb-3"
						active={popular}
						onChange={setPopular}
						tabs={[
							{ id: "borrowed", label: "Most borrowed" },
							{ id: "downloaded", label: "Most downloaded" },
						]}
					/>
					{top.length ? (
						<ol className="space-y-1">
							{top.map((it, i) => (
								<li key={it.name}>
									<Link to={`/admin/library/catalogue/${encodeURIComponent(it.name)}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-cream">
										<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-100 text-xs font-bold text-gold-800">{i + 1}</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-semibold text-ink">{it.title}</span>
											<span className="block truncate text-xs text-ink-soft">
												{it.item_type} · {it.subject}
											</span>
										</span>
										<span className="shrink-0 text-right text-sm">
											{popular === "borrowed" ? (
												<>
													<span className="font-semibold text-ink">{num(it.loans_count)}</span> <span className="text-xs text-ink-soft">loans</span>
												</>
											) : (
												<>
													<Download size={12} className="mr-1 inline text-ink-soft" />
													<span className="font-semibold text-ink">{num(it.downloads)}</span>
												</>
											)}
										</span>
									</Link>
								</li>
							))}
						</ol>
					) : (
						<Empty compact icon={BookOpen} title={popular === "borrowed" ? "No loans yet" : "No downloads yet"} />
					)}
				</Panel>
				<Panel title="By subject">
					{subjects.length ? (
						<div className="space-y-3">
							{subjects.map((s) => (
								<BarRow key={s.subject || "none"} label={s.subject || "Unclassified"} value={s.count} max={maxSubject} caption={num(s.count)} />
							))}
						</div>
					) : (
						<Empty compact title="No items yet" />
					)}
				</Panel>
			</div>

			<div className="flex flex-wrap gap-2 text-xs text-ink-soft">
				<Badge tone="gray" size="xs">
					Loan period {num(d.settings?.loan_days)} days
				</Badge>
				<Badge tone="gray" size="xs">
					Up to {num(d.settings?.max_active_loans)} items per borrower
				</Badge>
				<Badge tone="gray" size="xs">
					{num(k.digital_items)} digital items · {num(k.downloads)} downloads
				</Badge>
				{k.lost ? (
					<Badge tone="red" size="xs">
						{num(k.lost)} lost
					</Badge>
				) : null}
			</div>
		</div>
	)
}
