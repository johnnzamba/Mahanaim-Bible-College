import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { keepPreviousData } from "@tanstack/react-query"
import { CalendarClock, CheckCircle2, ClipboardList, Columns3, FileClock, Inbox, List, RefreshCw, Wallet, X, XCircle, Hourglass } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { AvatarCell, Button, Input, PageHeader, Pagination, Panel, Select, StatCard } from "@/shared/components/ui"
import { BarRow, Board, DataTable, ExportButton, SelectionBar, Toolbar, useDebounced } from "@/shared/components/kit"
import { TrendChart } from "@/shared/components/Charts"
import { date, num, pct } from "@/shared/utils/format"
import { API, BOARD_COLUMNS, CAN, FeeBadge, NoAccess, STATUSES, StatusBadge, compact, isPermissionError, useLookups, useUrlFilters } from "../lib"
import DecisionModal from "../components/DecisionModal"

const PAGE = 20
const BOARD_LIMIT = 200
const EXPORT_COLS = [
	{ key: "name", label: "Application" },
	{ key: "full_name", label: "Applicant" },
	{ key: "email", label: "Email" },
	{ key: "phone", label: "Phone" },
	{ key: "programme_name", label: "Programme" },
	{ key: "campus", label: "Campus" },
	{ key: "study_mode", label: "Study mode" },
	{ key: "intake", label: "Intake" },
	{ key: "submitted_on", label: "Submitted on" },
	{ key: "fee_status", label: "Fee status" },
	{ key: "status", label: "Status" },
]
const SORTS = [
	{ value: "", label: "Newest first" },
	{ value: "creation asc", label: "Oldest first" },
	{ value: "submitted_on desc", label: "Recently submitted" },
	{ value: "modified desc", label: "Recently updated" },
	{ value: "full_name asc", label: "Name A–Z" },
]

export default function Applications() {
	const navigate = useNavigate()
	const { hasRole } = useSession()
	const canDecide = hasRole(...CAN.review)
	const [get, set] = useUrlFilters()
	const view = get("view") === "board" ? "board" : "list"
	const page = Number(get("page") || 1)
	const [search, setSearch] = useState(get("q"))
	const q = useDebounced(search.trim(), 350)
	const [selected, setSelected] = useState([])
	const [decide, setDecide] = useState(null)
	const invalidate = useInvalidate()

	useEffect(() => {
		if (q !== get("q")) set({ q })
	}, [q, get, set])

	const lookups = useLookups()
	const L = lookups.data || {}
	const filters = compact({
		programme: get("programme"),
		campus: get("campus"),
		intake: get("intake"),
		study_mode: get("mode"),
		awaiting_fee: get("fee") === "awaiting" ? 1 : undefined,
		from_date: get("from"),
		to_date: get("to"),
		search: q,
		order_by: get("sort"),
	})
	const listArgs =
		view === "board"
			? { ...filters, start: 0, page_length: BOARD_LIMIT }
			: { ...filters, status: get("status") || undefined, start: (page - 1) * PAGE, page_length: PAGE }
	const list = useApi(`${API}list_applications`, listArgs, { placeholderData: keepPreviousData })
	const stats = useApi(`${API}admissions_stats`, compact({ intake: get("intake") }))

	useEffect(() => setSelected([]), [view, get("status"), page, q])

	if (isPermissionError(list.error)) return <NoAccess message="Admissions is open to admissions officers, the registrar and the academic dean." />

	const data = list.data || {}
	const rows = data.data || []
	const counts = data.counts_by_status || {}
	const s = stats.data || {}
	const bs = s.by_status || {}
	const filtered = Object.keys(filters).some((k) => k !== "order_by" && k !== "search") || get("status")

	const chips = [
		{ id: "", label: "All", count: Object.values(counts).reduce((a, b) => a + b, 0) },
		...STATUSES.filter((st) => counts[st] || st === get("status")).map((st) => ({ id: st, label: st, count: counts[st] || 0 })),
	]

	const cols = [
		{
			key: "full_name",
			label: "Applicant",
			render: (r) => <AvatarCell name={r.full_name} sub={`${r.name} · ${r.email || r.phone || ""}`} />,
		},
		{
			key: "programme_name",
			label: "Programme",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-medium text-ink">{r.programme_name || r.programme}</div>
					<div className="truncate text-xs text-ink-soft">{r.study_mode}</div>
				</div>
			),
			sortValue: (r) => r.programme_name,
		},
		{ key: "campus", label: "Campus", hideOnMobile: true },
		{ key: "intake", label: "Intake", hideOnMobile: true },
		{ key: "submitted_on", label: "Submitted", render: (r) => (r.submitted_on ? date(r.submitted_on) : <span className="text-ink-soft">Not yet</span>), sortValue: (r) => r.submitted_on || "" },
		{ key: "fee_status", label: "Fee", render: (r) => <FeeBadge status={r.fee_status} awaiting={r.awaiting_fee} />, hideOnMobile: true },
		{ key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
	]

	const openDecide = (decision) => setDecide({ names: selected, decision })

	return (
		<>
			<PageHeader
				eyebrow="Admissions"
				title="Applications"
				subtitle="Review applications, schedule interviews and send offers."
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(API)}>
							Refresh
						</Button>
						<ExportButton filename={`applications-${new Date().toISOString().slice(0, 10)}`} cols={EXPORT_COLS} rows={rows} />
					</>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
				<StatCard label="Applications" value={num(s.total)} icon={ClipboardList} loading={stats.isLoading} hint={s.conversion ? `${pct(s.conversion.submission_rate)} submitted` : null} />
				<StatCard label="Awaiting review" value={num(bs.Submitted)} icon={Inbox} tone="gold" loading={stats.isLoading} to="?status=Submitted" hint="Submitted" />
				<StatCard
					label="In review"
					value={num((bs["Under Review"] || 0) + (bs.Interview || 0))}
					icon={CalendarClock}
					tone="purple"
					loading={stats.isLoading}
					hint={`${num(bs.Interview)} at interview`}
					to="?status=Interview"
				/>
				<StatCard
					label="Admitted"
					value={num((bs.Admitted || 0) + (bs.Accepted || 0))}
					icon={CheckCircle2}
					tone="green"
					loading={stats.isLoading}
					hint={s.conversion ? `${pct(s.conversion.acceptance_rate)} accepted` : null}
					to="?status=Admitted"
				/>
				<StatCard
					label="Fee pending"
					value={num(data.awaiting_fee_count)}
					icon={Wallet}
					tone="red"
					loading={list.isLoading}
					hint="Submitted, fee not settled"
					to="?fee=awaiting"
					className="col-span-2 lg:col-span-1"
				/>
			</div>

			<div className="mb-5 grid gap-4 lg:grid-cols-3">
				<Panel title="New applications" subtitle="Last 30 days" className="lg:col-span-2" bodyClass="px-2 pb-3 pt-4">
					<TrendChart data={(s.by_day || []).map((d) => ({ label: date(d.date, { day: "numeric", month: "short" }), value: d.count }))} series={[{ key: "value", label: "Applications" }]} height={190} />
				</Panel>
				<Panel title="Funnel" subtitle={get("intake") ? get("intake") : "All intakes"}>
					<div className="space-y-3">
						{(s.funnel || []).map((f) => (
							<BarRow key={f.stage} label={f.stage} value={f.count} max={Math.max(1, s.total || 0)} caption={num(f.count)} />
						))}
						{s.conversion ? (
							<div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center text-xs">
								<div>
									<div className="font-bold text-ink">{pct(s.conversion.submission_rate)}</div>
									<div className="text-ink-soft">Submitted</div>
								</div>
								<div>
									<div className="font-bold text-ink">{pct(s.conversion.admission_rate)}</div>
									<div className="text-ink-soft">Admit rate</div>
								</div>
								<div>
									<div className="font-bold text-ink">{pct(s.conversion.acceptance_rate)}</div>
									<div className="text-ink-soft">Accepted</div>
								</div>
							</div>
						) : null}
					</div>
				</Panel>
			</div>

			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, email, phone, ID…"
				chips={view === "list" ? chips : null}
				active={get("status")}
				onChip={(id) => set({ status: id })}
				right={
					<div className="inline-flex rounded-xl border border-line bg-surface p-0.5" role="group" aria-label="View">
						{[
							["list", "List", List],
							["board", "Board", Columns3],
						].map(([id, label, Icon]) => (
							<button
								key={id}
								type="button"
								onClick={() => set({ view: id === "list" ? "" : id })}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === id ? "bg-brand-800 text-white" : "text-ink-muted hover:text-ink"}`}
								aria-pressed={view === id}
							>
								<Icon size={14} /> {label}
							</button>
						))}
					</div>
				}
			/>

			<div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
				<Select aria-label="Programme" className="col-span-2 sm:col-span-1" value={get("programme")} onChange={(e) => set({ programme: e.target.value })} placeholder="All programmes" options={(L.programmes || []).map((p) => ({ value: p.name, label: p.programme_name }))} />
				<Select aria-label="Campus" value={get("campus")} onChange={(e) => set({ campus: e.target.value })} placeholder="All campuses" options={(L.campuses || []).map((c) => ({ value: c.name, label: c.campus_name }))} />
				<Select aria-label="Intake" value={get("intake")} onChange={(e) => set({ intake: e.target.value })} placeholder="All intakes" options={(L.intakes || []).map((i) => ({ value: i.name, label: i.intake_name || i.name }))} />
				<Select aria-label="Study mode" value={get("mode")} onChange={(e) => set({ mode: e.target.value })} placeholder="All study modes" options={(L.study_modes || []).map((m) => ({ value: m.name, label: m.study_mode_name || m.name }))} />
				<Select aria-label="Application fee" value={get("fee")} onChange={(e) => set({ fee: e.target.value })} placeholder="Any fee status" options={[{ value: "awaiting", label: "Awaiting fee" }]} />
			</div>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="flex w-full items-center gap-1.5 sm:w-auto">
					<span className="shrink-0 text-xs font-semibold text-ink-soft">Received</span>
					<Input className="min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Received from" type="date" value={get("from")} max={get("to") || undefined} onChange={(e) => set({ from: e.target.value })} />
					<span className="text-ink-soft">to</span>
					<Input className="min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Received to" type="date" value={get("to")} min={get("from") || undefined} onChange={(e) => set({ to: e.target.value })} />
				</div>
				<div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
					<span className="mr-auto text-xs text-ink-soft sm:mr-1">
						{list.isFetching && !list.isLoading ? "Updating… " : ""}
						{view === "board"
							? `${num(Math.min(data.total || 0, BOARD_LIMIT))} of ${num(data.total)} on the board`
							: `${num(data.total)} application${data.total === 1 ? "" : "s"}`}
					</span>
					<Select aria-label="Sort" className="w-44" value={get("sort")} onChange={(e) => set({ sort: e.target.value })} options={SORTS} />
					{filtered ? (
						<Button variant="ghost" size="sm" icon={X} onClick={() => set({ status: "", programme: "", campus: "", intake: "", mode: "", fee: "", from: "", to: "" })}>
							Clear
						</Button>
					) : null}
				</div>
			</div>

			{view === "board" ? (
				list.isLoading ? (
					<DataTable cols={cols} query={list} />
				) : (
					<Board
						columns={BOARD_COLUMNS}
						cards={rows}
						renderCard={(r) => (
							<div className="space-y-1.5">
								<div className="flex items-start justify-between gap-2">
									<span className="min-w-0 truncate text-sm font-semibold text-ink">{r.full_name}</span>
									<FeeBadge status={r.fee_status} awaiting={r.awaiting_fee} />
								</div>
								<div className="truncate text-xs text-ink-muted">{r.programme_name}</div>
								<div className="flex items-center justify-between text-[11px] text-ink-soft">
									<span>{r.intake || r.campus}</span>
									<span>{r.submitted_on ? date(r.submitted_on, { day: "numeric", month: "short" }) : "Draft"}</span>
								</div>
							</div>
						)}
						onCard={(r) => navigate(`/admin/admissions/${encodeURIComponent(r.name)}`)}
					/>
				)
			) : (
				<>
					<DataTable
						cols={cols}
						rows={list.isLoading ? undefined : rows}
						query={list}
						rowTo={(r) => `/admin/admissions/${encodeURIComponent(r.name)}`}
						selectable={canDecide}
						selected={selected}
						onSelect={setSelected}
						empty={filtered || q ? "No applications match these filters" : "No applications yet"}
						emptyIcon={FileClock}
					/>
					<Pagination page={page} pageSize={PAGE} total={data.total || 0} onChange={(p) => set({ page: p })} />
				</>
			)}

			<SelectionBar count={selected.length} onClear={() => setSelected([])}>
				<Button size="sm" icon={CheckCircle2} onClick={() => openDecide("Admitted")}>
					Admit
				</Button>
				<Button size="sm" variant="secondary" icon={Hourglass} onClick={() => openDecide("Waitlisted")}>
					Waitlist
				</Button>
				<Button size="sm" variant="danger" icon={XCircle} onClick={() => openDecide("Rejected")}>
					Reject
				</Button>
			</SelectionBar>

			<DecisionModal
				open={Boolean(decide)}
				names={decide?.names || []}
				initial={decide?.decision}
				onClose={() => setDecide(null)}
				onDone={(res) => setSelected((cur) => cur.filter((n) => !(res?.updated || []).includes(n)))}
			/>
		</>
	)
}
