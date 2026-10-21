import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { Activity, ArrowRight, FileClock, History, LogIn, ShieldAlert, ShieldX, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Avatar, Badge, Chip, ErrorState, Panel, SkeletonRows, StatCard, TONE } from "@/shared/components/ui"
import { BarRow } from "@/shared/components/kit"
import { TrendChart } from "@/shared/components/Charts"
import { date, dateTime, num } from "@/shared/utils/format"
import { A, DateRange, KIND, RecordLink, auditLink, kindOf, since, ymd } from "../lib"

const PRESETS = [
	{ id: "7", label: "7 days", days: 7 },
	{ id: "30", label: "30 days", days: 30 },
	{ id: "90", label: "90 days", days: 90 },
	{ id: "365", label: "12 months", days: 365 },
]

const shift = (iso, days) => {
	const d = new Date(`${iso}T00:00:00`)
	d.setDate(d.getDate() + days)
	return ymd(d)
}

export default function Summary() {
	// The server's default (last 30 days) also tells us the server's "today", which can differ from the browser's.
	const base = useApi(`${A}audit_summary`, {}, { staleTime: 60_000 })
	const anchor = base.data?.to_date || ymd(new Date())
	const [preset, setPreset] = useState("30")
	const [custom, setCustom] = useState(null)
	const days = PRESETS.find((p) => p.id === preset)?.days
	const from = custom ? custom.from : shift(anchor, -((days || 30) - 1))
	const to = custom ? custom.to : anchor
	const pick = (p) => {
		setPreset(p.id)
		setCustom(null)
	}
	const span = from && to ? Math.round((new Date(to) - new Date(from)) / 86_400_000) + 1 : 0
	const invalid = !from || !to || span < 1 ? "Choose a start date on or before the end date." : span > 366 ? "Pick a range of 366 days or fewer." : null
	const isDefault = preset === "30" && !custom
	const ranged = useApi(`${A}audit_summary`, { from_date: from, to_date: to }, { enabled: !isDefault && !invalid && Boolean(base.data || base.isError), placeholderData: (prev) => prev, staleTime: 60_000 })
	const q = isDefault ? base : ranged
	const d = q.data
	const range = { from: d?.from_date || from, to: d?.to_date || to }
	const failed = d?.totals?.failed_logins || 0

	return (
		<div className="space-y-5">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center">
				<div className="scroll-thin flex gap-1.5 overflow-x-auto pb-0.5">
					{PRESETS.map((p) => (
						<Chip key={p.id} active={preset === p.id} onClick={() => pick(p)} className="shrink-0">
							Last {p.label}
						</Chip>
					))}
					<Chip
						active={preset === "custom"}
						onClick={() => {
							setPreset("custom")
							setCustom({ from, to })
						}}
						className="shrink-0"
					>
						Custom
					</Chip>
				</div>
				{custom ? <DateRange from={custom.from} to={custom.to} onFrom={(v) => setCustom((c) => ({ ...c, from: v }))} onTo={(v) => setCustom((c) => ({ ...c, to: v }))} /> : null}
				<span className="text-xs text-ink-soft lg:ml-auto">
					{date(range.from)} – {date(range.to)}
					{q.isFetching && d ? " · updating…" : ""}
				</span>
			</div>
			{invalid ? <Alert tone="warning">{invalid}</Alert> : null}

			{q.isError && !d ? (
				<ErrorState error={q.error} onRetry={q.refetch} className="card" />
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
						<StatCard label="Record changes" value={d ? num(d.totals?.changes) : null} loading={!d} icon={FileClock} tone="brand" hint={d ? `${num(d.changes_by_doctype?.length || 0)} record types` : null} to={auditLink({ tab: "changes", from: range.from, to: range.to })} />
						<StatCard label="Sign-ins" value={d ? num(d.totals?.logins) : null} loading={!d} icon={LogIn} tone="blue" hint="Successful" to={auditLink({ tab: "access", status: "Success", from: range.from, to: range.to })} />
						<StatCard label="Failed sign-ins" value={d ? num(failed) : null} loading={!d} icon={ShieldX} tone={failed ? "red" : "green"} hint={failed ? "Review the attempts" : "None in this period"} to={auditLink({ tab: "access", status: "Failed", from: range.from, to: range.to })} />
						<StatCard label="Active users" value={d ? num(d.totals?.active_users) : null} loading={!d} icon={Users} tone="gold" hint="Signed in at least once" />
					</div>

					<div className="grid gap-5 lg:grid-cols-3">
						<Panel title="Activity per day" subtitle="Record changes, sign-ins and failed attempts" icon={Activity} className="lg:col-span-2">
							{!d ? <div className="skeleton h-[260px] w-full" /> : <DailyChart daily={d.daily || []} />}
						</Panel>
						<Panel title="Most active users" subtitle="By record changes" icon={Users} bodyClass="p-0">
							{!d ? <SkeletonRows rows={5} className="p-4" /> : <TopUsers rows={d.top_users || []} range={range} />}
						</Panel>
					</div>

					<div className="grid gap-5 lg:grid-cols-3">
						<Panel title="Sensitive events" subtitle="Status changes, decisions, cancellations, revocations and settings changes" icon={ShieldAlert} className="lg:col-span-2" bodyClass="p-0">
							{!d ? <SkeletonRows rows={5} className="p-4" /> : <Sensitive events={d.sensitive_events || []} />}
						</Panel>
						<Panel title="Changes by record type" subtitle="Top 10 in this period" icon={History}>
							{!d ? <SkeletonRows rows={6} /> : <ByDoctype rows={d.changes_by_doctype || []} range={range} />}
						</Panel>
					</div>
				</>
			)}
		</div>
	)
}

function DailyChart({ daily }) {
	const data = useMemo(() => daily.map((r) => ({ ...r, label: date(r.date, { day: "numeric", month: "short" }) })), [daily])
	if (!data.some((r) => r.changes || r.logins || r.failed)) {
		return <p className="grid h-[260px] place-items-center text-sm text-ink-soft">No activity recorded in this period.</p>
	}
	return (
		<TrendChart
			data={data}
			xKey="label"
			height={260}
			format={(v) => num(v)}
			series={[
				{ key: "changes", label: "Record changes", color: "#1d4d3a" },
				{ key: "logins", label: "Sign-ins", color: "#3b82f6" },
				{ key: "failed", label: "Failed sign-ins", color: "#ef4444" },
			]}
		/>
	)
}

function TopUsers({ rows, range }) {
	if (!rows.length) return <p className="px-5 py-8 text-center text-sm text-ink-soft">Nobody changed records in this period.</p>
	const max = Math.max(...rows.map((r) => r.count || 0), 1)
	return (
		<ul className="divide-y divide-line">
			{rows.map((r) => (
				<li key={r.user}>
					<Link to={auditLink({ tab: "changes", user: r.user, from: range.from, to: range.to })} className="flex items-center gap-3 px-5 py-3 transition hover:bg-cream/60">
						<Avatar name={r.full_name || r.user} size={34} />
						<span className="min-w-0 flex-1">
							<span className="flex items-baseline justify-between gap-2">
								<span className="truncate text-sm font-semibold text-ink">{r.full_name || r.user}</span>
								<span className="shrink-0 text-sm font-bold text-ink">{num(r.count)}</span>
							</span>
							<span className="block truncate text-xs text-ink-soft">{r.user}</span>
							<span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line/70">
								<span className="block h-full rounded-full bg-brand-700" style={{ width: `${(100 * (r.count || 0)) / max}%` }} />
							</span>
						</span>
					</Link>
				</li>
			))}
		</ul>
	)
}

function ByDoctype({ rows, range }) {
	if (!rows.length) return <p className="py-6 text-center text-sm text-ink-soft">No record changes in this period.</p>
	const max = Math.max(...rows.map((r) => r.count || 0), 1)
	return (
		<div className="space-y-1">
			{rows.map((r) => (
				<Link key={r.doctype} to={auditLink({ tab: "changes", doctype: r.doctype, from: range.from, to: range.to })} className="-mx-2 block rounded-lg px-2 py-1.5 transition hover:bg-cream/70">
					<BarRow label={r.label || r.doctype} value={r.count} max={max} caption={num(r.count)} tone="bg-gold-500" />
				</Link>
			))}
		</div>
	)
}

function Sensitive({ events }) {
	const [kind, setKind] = useState("")
	const counts = useMemo(() => events.reduce((m, ev) => ({ ...m, [ev.kind]: (m[ev.kind] || 0) + 1 }), {}), [events])
	const shown = kind ? events.filter((ev) => ev.kind === kind) : events
	if (!events.length) {
		return <p className="px-5 py-10 text-center text-sm text-ink-soft">No sensitive events in this period.</p>
	}
	return (
		<div>
			<div className="scroll-thin flex gap-1.5 overflow-x-auto border-b border-line px-5 py-3">
				<Chip active={!kind} onClick={() => setKind("")} className="shrink-0">
					All <span className="opacity-70">{events.length}</span>
				</Chip>
				{Object.keys(KIND)
					.filter((k) => counts[k])
					.map((k) => (
						<Chip key={k} active={kind === k} onClick={() => setKind(k)} className="shrink-0">
							{KIND[k].label} <span className="opacity-70">{counts[k]}</span>
						</Chip>
					))}
			</div>
			<ul className="divide-y divide-line">
				{shown.map((ev) => {
					const k = kindOf(ev.kind)
					const Icon = k.icon
					return (
						<li key={`${ev.name}:${ev.kind}`} className="flex gap-3 px-5 py-3">
							<span className={clsx("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl", (TONE[k.tone] || TONE.gray).soft)}>
								<Icon size={17} />
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
									<span className="text-sm font-semibold text-ink">{ev.description || k.label}</span>
									<Badge tone={k.tone} size="xs">
										{k.label}
									</Badge>
								</div>
								<div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-soft">
									<span>{ev.ref_doctype}</span>
									{ev.docname && ev.docname !== ev.ref_doctype ? (
										<>
											<span aria-hidden>·</span>
											<RecordLink doctype={ev.ref_doctype} name={ev.docname} className="text-xs" />
										</>
									) : null}
									<span aria-hidden>·</span>
									<span>by {ev.owner_name || ev.owner}</span>
								</div>
							</div>
							<div className="shrink-0 text-right">
								<div className="text-xs text-ink-muted" title={dateTime(ev.creation)}>
									{since(ev.creation)}
								</div>
								<Link to={auditLink({ tab: "changes", doctype: ev.ref_doctype, docname: ev.docname })} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
									History <ArrowRight size={12} />
								</Link>
							</div>
						</li>
					)
				})}
			</ul>
		</div>
	)
}
