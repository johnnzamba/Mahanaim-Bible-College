import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Activity, ArrowRight, Banknote, Building2, CircleCheck, ClipboardList, GraduationCap, HandHeart, Library, Megaphone, RefreshCw, School, Sparkles, UserCog } from "lucide-react"
import { useApi, useAction } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Badge, Button, Donut, Empty, ErrorState, InfoRow, PageHeader, Panel, ProgressBar, SkeletonRows, StatCard, Tile } from "@/shared/components/ui"
import { BarRow, DataTable } from "@/shared/components/kit"
import { BarsChart, DonutChart, Legendary, TrendChart } from "@/shared/components/Charts"
import { ROLES } from "@/shared/access"
import { ago, date, dateTime, greeting, money, num, pct, parseServerDate } from "@/shared/utils/format"
import { AttentionRow, M, SHORTCUTS, attentionItems, extraStats, fmtValue, kpiMeta, linkable, monthLabel } from "./widgets"

const PRIORITY = ["applications", "active_students", "collected", "outstanding", "mark_sheets_pending", "unmatched_mpesa", "unread_enquiries", "overdue_loans", "active_sponsorships", "exams_this_week"]
const STAFF_ROLES = Object.values(ROLES).filter((r) => ![ROLES.STUDENT, ROLES.APPLICANT, ROLES.SPONSOR, ROLES.ALUMNI, ROLES.LECTURER].includes(r))

const ROLE_INTRO = {
	[ROLES.CHAPLAIN]: "Shepherd chapel life, partner churches and the sponsors who carry our students.",
	[ROLES.LIBRARY]: "Keep the catalogue, loans and reservations moving for every reader.",
	[ROLES.COMMS]: "Reach students, applicants and partners through SMS, email and the website.",
	[ROLES.AUDITOR]: "Review billing, collections, changes and sign-ins. Everything here is read-only.",
}

/** /admin: role-aware management dashboard from dashboard.admin_overview. */
export default function Dashboard() {
	const session = useSession()
	const roles = session.roles
	const qc = useQueryClient()
	const q = useApi(`${M}admin_overview`, {}, { staleTime: 60_000 })
	const refresh = useAction(`${M}admin_overview`, {
		success: "Dashboard refreshed",
		onSuccess: (data) => {
			qc.setQueryData([`${M}admin_overview`, {}], data)
			qc.invalidateQueries({ queryKey: [`${M}campus_comparison`] })
		},
	})
	const d = q.data
	const first = String(session.full_name || "").split(" ")[0] || "there"
	const myRoles = session.isSuper ? ["Administrator"] : roles.filter((r) => STAFF_ROLES.includes(r))

	return (
		<div className="space-y-5">
			<PageHeader
				eyebrow={d?.term ? `Current term · ${d.term}` : date(new Date(), { weekday: "long", day: "numeric", month: "long" })}
				title={`${greeting()}, ${first}`}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span>{date(new Date(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
						{myRoles.length ? <span className="text-ink-soft">· Signed in as {myRoles.join(", ")}</span> : null}
					</span>
				}
				actions={
					<>
						{q.dataUpdatedAt ? <span className="hidden text-xs text-ink-soft sm:inline">Updated {ago(new Date(q.dataUpdatedAt))}</span> : null}
						<Button variant="secondary" size="sm" icon={RefreshCw} loading={refresh.isPending} onClick={() => refresh.mutate({ refresh: 1 })}>
							Refresh
						</Button>
					</>
				}
			/>
			{q.isLoading ? (
				<DashboardSkeleton />
			) : q.isError ? (
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</div>
			) : d ? (
				<Body d={d} roles={roles} isSuper={session.isSuper} />
			) : null}
		</div>
	)
}

function DashboardSkeleton() {
	return (
		<>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<StatCard key={i} label="Loading" loading />
				))}
			</div>
			<div className="grid gap-5 lg:grid-cols-3">
				<div className="card p-5 lg:col-span-2">
					<SkeletonRows rows={6} />
				</div>
				<div className="card p-5">
					<SkeletonRows rows={6} />
				</div>
			</div>
		</>
	)
}

function Body({ d, roles, isSuper }) {
	const sections = d.sections || []
	const kpis = useMemo(() => {
		const rank = (k) => (PRIORITY.includes(k) ? PRIORITY.indexOf(k) : 99)
		return [...(d.kpis || [])].sort((a, b) => rank(a.key) - rank(b.key))
	}, [d.kpis])
	const cards = useMemo(() => {
		const main = kpis.slice(0, 8).map((k) => {
			const meta = kpiMeta(k.key, d)
			return { key: k.key, label: k.label, value: fmtValue(k.value, k.format), icon: meta.icon, tone: meta.tone, hint: meta.hint, route: k.route }
		})
		if (main.length < 8 && main.length % 4) {
			const want = Math.min(8, Math.ceil(main.length / 4) * 4) - main.length
			const have = new Set(main.map((c) => c.key))
			main.push(...extraStats(d).filter((x) => !have.has(x.key)).slice(0, want))
		}
		return main
	}, [kpis, d])
	const more = kpis.slice(8)
	const attention = useMemo(() => attentionItems(d, roles), [d, roles])
	const charts = d.charts || {}
	const collections = charts.collections
	const enrolment = charts.enrolment_trend
	const hasTrends = Boolean(collections || enrolment || d.admissions)
	const low = sections.length <= 1 && !hasTrends
	const intro = roles.map((r) => ROLE_INTRO[r]).find(Boolean)

	return (
		<>
			{low ? <Welcome intro={intro} sections={sections} /> : null}

			{cards.length ? (
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{cards.map((c) => (
						<StatCard key={c.key} label={c.label} value={c.value} icon={c.icon} tone={c.tone} hint={c.hint} to={linkable(roles, c.route) ? c.route : undefined} />
					))}
				</div>
			) : null}
			{more.length ? <MoreNumbers items={more} d={d} roles={roles} /> : null}

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-5 lg:col-span-2">
					{collections ? <CollectionsPanel chart={collections} f={d.finance} roles={roles} /> : null}
					{enrolment || d.admissions ? (
						<div className={`grid gap-5 ${enrolment && d.admissions ? "md:grid-cols-2" : ""}`}>
							{enrolment ? <EnrolmentPanel chart={enrolment} /> : null}
							{d.admissions ? <FunnelPanel a={d.admissions} roles={roles} /> : null}
						</div>
					) : null}
					{d.students ? <StudentsPanel s={d.students} roles={roles} /> : null}
					{low ? <Shortcuts roles={roles} title="Your workspace" grid="grid-cols-2 sm:grid-cols-3" /> : !hasTrends ? <Glance d={d} roles={roles} cols="md:grid-cols-2" /> : null}
				</div>
				<div className="min-w-0 space-y-5">
					<AttentionPanel items={attention} />
					<ActivityPanel items={d.activity || []} roles={roles} />
				</div>
			</div>

			{hasTrends ? <Glance d={d} roles={roles} cols="md:grid-cols-2 xl:grid-cols-3" /> : null}
			{isSuper ? <CampusComparison /> : null}
			{low ? null : <Shortcuts roles={roles} />}
		</>
	)
}

function Welcome({ intro, sections }) {
	return (
		<div className="card relative overflow-hidden p-5 sm:p-6">
			<div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold-50 dark:bg-gold-500/10" aria-hidden />
			<div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
				<span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
					<Sparkles size={22} />
				</span>
				<div className="min-w-0 flex-1">
					<h2 className="font-serif text-lg text-ink">Welcome to your workspace</h2>
					<p className="mt-1 text-sm text-ink-muted">
						{intro || "Everything you look after at Mahanaim, gathered in one place."} Your numbers update as the college records them; the shortcuts below take you straight to the work.
					</p>
					<p className="mt-2 text-xs italic text-ink-soft">“This is God’s camp.” So he named that place Mahanaim. (Genesis 32:2)</p>
				</div>
				{sections.length ? (
					<div className="flex flex-wrap gap-1.5 sm:max-w-[40%] sm:justify-end">
						{sections.map((s) => (
							<Badge key={s} tone="brand">
								{s.charAt(0).toUpperCase() + s.slice(1)}
							</Badge>
						))}
					</div>
				) : null}
			</div>
		</div>
	)
}

function MoreNumbers({ items, d, roles }) {
	return (
		<div className="card grid grid-cols-2 overflow-hidden sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
			{items.map((k) => {
				const meta = kpiMeta(k.key, d)
				const Icon = meta.icon
				const body = (
					<div className="flex h-full min-w-0 items-start gap-2 border-b border-r border-line px-3 py-2.5">
						<Icon size={15} className="mt-0.5 shrink-0 text-ink-soft" />
						<div className="min-w-0">
							<div className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft" title={k.label}>
								{k.label}
							</div>
							<div className="truncate text-base font-bold text-ink">{fmtValue(k.value, k.format)}</div>
						</div>
					</div>
				)
				return linkable(roles, k.route) ? (
					<Link key={k.key} to={k.route} className="block transition hover:bg-cream">
						{body}
					</Link>
				) : (
					<div key={k.key}>{body}</div>
				)
			})}
		</div>
	)
}

function OpenLink({ to, roles, children = "Open" }) {
	if (!linkable(roles, to)) return null
	return (
		<Link to={to} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
			{children} <ArrowRight size={13} />
		</Link>
	)
}

function CollectionsPanel({ chart, f, roles }) {
	const values = chart.datasets?.[0]?.values || []
	const data = (chart.labels || []).map((l, i) => ({ label: monthLabel(l), value: Number(values[i] || 0) }))
	const total = data.reduce((a, r) => a + r.value, 0)
	return (
		<Panel
			title="Collections, last 12 months"
			subtitle={f ? `${money(f.collections_month, { compact: true })} this month · ${money(total, { compact: true })} in 12 months` : null}
			icon={Banknote}
			actions={<OpenLink to="/admin/finance" roles={roles}>Finance</OpenLink>}
		>
			{total > 0 ? (
				<TrendChart data={data} series={[{ key: "value", label: "Collected" }]} height={240} format={(v) => money(v, { compact: true })} />
			) : (
				<Empty compact icon={Banknote} title="No collections yet" subtitle="Payments recorded in the last 12 months will chart here." />
			)}
			{f ? (
				<div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
					<div>
						<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Billed this term</div>
						<div className="text-lg font-bold text-ink">{money(f.billed_this_term, { compact: true })}</div>
					</div>
					<div>
						<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Collected this term</div>
						<div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{money(f.collected_this_term, { compact: true })}</div>
					</div>
					<div>
						<ProgressBar value={f.collection_rate} tone={f.collection_rate >= 75 ? "green" : "orange"} label={`Collection rate · ${pct(f.collection_rate, 1)}`} />
					</div>
				</div>
			) : null}
		</Panel>
	)
}

function EnrolmentPanel({ chart }) {
	const values = chart.datasets?.[0]?.values || []
	const data = (chart.labels || []).map((l, i) => ({ label: l.replace(/ (\d{2})(\d{2})$/, " ’$2"), value: Number(values[i] || 0) }))
	const total = data.reduce((a, r) => a + r.value, 0)
	return (
		<Panel title="Enrolment by intake" subtitle={`${num(total)} students across ${data.length} intakes`} icon={GraduationCap}>
			{total > 0 ? <BarsChart data={data} series={[{ key: "value", label: "Students" }]} height={220} /> : <Empty compact title="No enrolment yet" />}
		</Panel>
	)
}

function FunnelPanel({ a, roles }) {
	const funnel = a.funnel || []
	const top = funnel[0]?.count || 0
	const tones = ["bg-brand-700", "bg-brand-600", "bg-brand-500", "bg-gold-500", "bg-emerald-600"]
	return (
		<Panel title="Admissions funnel" subtitle={a.intake ? `${a.intake} intake` : "Current intake"} icon={ClipboardList} actions={<OpenLink to="/admin/admissions" roles={roles} />}>
			{top ? (
				<div className="space-y-3">
					{funnel.map((s, i) => (
						<BarRow key={s.stage} label={s.stage} value={s.count} max={top} caption={`${num(s.count)} · ${pct(s.pct)}`} tone={tones[i] || "bg-brand-700"} />
					))}
					<div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-soft">
						<span>
							<b className="text-ink">{num(a.new_applications_7d)}</b> started this week
						</span>
						<span>
							<b className="text-ink">{num(a.awaiting_review)}</b> awaiting review
						</span>
					</div>
				</div>
			) : (
				<Empty compact icon={ClipboardList} title="No applications yet" subtitle="The funnel fills as applicants start applying." />
			)}
		</Panel>
	)
}

function StudentsPanel({ s, roles }) {
	const progs = s.by_programme || []
	const camps = (s.by_campus || []).map((c) => ({ label: c.label || c.campus, value: c.count }))
	const max = Math.max(1, ...progs.map((p) => p.count))
	return (
		<Panel title="Where our students are" subtitle={`${num(s.active_students)} active students`} icon={GraduationCap} actions={<OpenLink to="/admin/students" roles={roles} />}>
			<div className="grid gap-6 md:grid-cols-5">
				<div className="space-y-3 md:col-span-3">
					<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">By programme</div>
					{progs.length ? progs.slice(0, 7).map((p) => <BarRow key={p.programme} label={p.label || p.programme} value={p.count} max={max} />) : <p className="text-sm text-ink-soft">No students yet.</p>}
				</div>
				<div className="md:col-span-2">
					<div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">By campus</div>
					{camps.length ? (
						<>
							<DonutChart data={camps} height={150} center={num(camps.reduce((a, c) => a + c.value, 0))} centerLabel="students" />
							<div className="mt-3">
								<Legendary data={camps} />
							</div>
						</>
					) : (
						<p className="text-sm text-ink-soft">No campus data.</p>
					)}
				</div>
			</div>
			{s.by_status ? (
				<div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
					{Object.entries(s.by_status).map(([k, v]) => (
						<Badge key={k} status={k}>
							{k} · {num(v)}
						</Badge>
					))}
				</div>
			) : null}
		</Panel>
	)
}

function AttentionPanel({ items }) {
	const [all, setAll] = useState(false)
	const shown = all ? items : items.slice(0, 6)
	return (
		<Panel title="Needs your attention" subtitle={items.length ? `${items.length} open item${items.length === 1 ? "" : "s"}` : "Nothing waiting on you"} icon={CircleCheck} bodyClass="p-0">
			{items.length ? (
				<div className="divide-y divide-line">
					{shown.map((it) => (
						<AttentionRow key={it.key} item={it} />
					))}
					{items.length > 6 ? (
						<button type="button" onClick={() => setAll((v) => !v)} className="w-full px-5 py-2.5 text-left text-xs font-semibold text-brand-700 hover:bg-cream">
							{all ? "Show fewer" : `Show ${items.length - 6} more`}
						</button>
					) : null}
				</div>
			) : (
				<Empty compact icon={CircleCheck} title="All clear" subtitle="No approvals, reconciliations or follow-ups are waiting in your areas." />
			)}
		</Panel>
	)
}

/** Server timestamps are in site time; if the browser's clock zone is behind, avoid "in 2 hours". */
const since = (v) => {
	const t = (parseServerDate(v)?.getTime() ?? NaN)
	return Number.isFinite(t) && t > Date.now() + 60_000 ? dateTime(v) : ago(v)
}

const ACTIVITY_ICON = { payment: Banknote, application: ClipboardList, status: Activity }

function ActivityPanel({ items, roles }) {
	return (
		<Panel title="Recent activity" subtitle="Latest changes in your areas" icon={Activity} bodyClass="p-0">
			{items.length ? (
				<ul className="scroll-thin max-h-[440px] divide-y divide-line overflow-y-auto">
					{items.slice(0, 15).map((a, i) => {
						const Icon = ACTIVITY_ICON[a.kind] || Activity
						const body = (
							<div className="flex gap-3 px-5 py-3">
								<span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cream text-gold-700">
									<Icon size={15} />
								</span>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium leading-snug text-ink">{a.title}</div>
									{a.note ? <div className="truncate text-xs text-ink-muted">{a.note}</div> : null}
									<div className="mt-0.5 truncate text-[11px] text-ink-soft">
										{a.user ? `${a.user} · ` : ""}
										{since(a.timestamp)}
									</div>
								</div>
							</div>
						)
						return (
							<li key={`${a.doctype}-${a.name}-${i}`}>
								{linkable(roles, a.route) ? (
									<Link to={a.route} className="block transition hover:bg-cream">
										{body}
									</Link>
								) : (
									body
								)}
							</li>
						)
					})}
				</ul>
			) : (
				<Empty compact icon={Activity} title="Quiet for now" subtitle="New applications, payments and status changes in your areas appear here." />
			)}
		</Panel>
	)
}

/** One compact panel per visible section, with only the numbers that section returned. */
function Glance({ d, roles, cols }) {
	const panels = []
	const a = d.admissions
	const st = d.staff
	const ac = d.academics
	const c = d.communications
	const l = d.library
	const ch = d.church
	if (a?.applications_by_status && Object.keys(a.applications_by_status).length) {
		panels.push(
			<Panel key="adm" title="Applications by status" subtitle={`${num(a.applications_total)} this intake`} icon={ClipboardList} actions={<OpenLink to="/admin/admissions" roles={roles} />}>
				<div className="flex flex-wrap gap-1.5">
					{Object.entries(a.applications_by_status)
						.sort((x, y) => y[1] - x[1])
						.map(([k, v]) => (
							<Badge key={k} status={k}>
								{k} · {num(v)}
							</Badge>
						))}
				</div>
			</Panel>
		)
	}
	if (ac) {
		const lms = ac.lms_sync || {}
		panels.push(
			<Panel key="acad" title="Academics" subtitle={ac.term || "This term"} icon={School} actions={<OpenLink to="/admin/academics" roles={roles} />}>
				<div className="flex items-center gap-4">
					<Donut value={lms.health_pct} size={72} tone={lms.health_pct >= 90 ? "green" : lms.health_pct >= 50 ? "orange" : "red"}>
						<span className="text-sm font-bold">{pct(lms.health_pct)}</span>
					</Donut>
					<div className="min-w-0 flex-1 text-sm">
						<div className="font-semibold text-ink">LMS sync health</div>
						<div className="text-xs text-ink-soft">
							{num(lms.synced)} synced · {num(lms.not_synced)} pending · {num(lms.error)} errors
						</div>
					</div>
				</div>
				<div className="mt-3 divide-y divide-line border-t border-line">
					<InfoRow label="Offerings this term" value={num(ac.offerings_this_term)} />
					<InfoRow label="Exams this week" value={num(ac.exams_this_week)} />
					<InfoRow label="Exams open now" value={num(ac.exams_open_now)} />
					<InfoRow label="Mark sheets awaiting approval" value={num(ac.mark_sheets_pending_approval)} />
				</div>
			</Panel>
		)
	}
	if (st) {
		const types = Object.entries(st.by_type || {})
		const max = Math.max(1, ...types.map(([, v]) => v))
		panels.push(
			<Panel key="staff" title="Staff" subtitle={`${num(st.staff)} staff · ${num(st.lecturers)} lecturers`} icon={UserCog} actions={<OpenLink to="/admin/staff" roles={roles} />}>
				<div className="space-y-3">
					{types.map(([k, v]) => (
						<BarRow key={k} label={k} value={v} max={max} tone="bg-violet-600" />
					))}
					<InfoRow label="On leave today" value={num(st.on_leave)} className="border-t border-line" />
				</div>
			</Panel>
		)
	}
	if (c) {
		panels.push(
			<Panel key="comms" title="Communication" subtitle="Last 7 days" icon={Megaphone} actions={<OpenLink to="/admin/communication" roles={roles} />}>
				<div className="divide-y divide-line">
					<InfoRow label="Messages sent" value={num(c.messages_7d?.Sent)} />
					<InfoRow label="Queued" value={num(c.messages_7d?.Queued)} />
					<InfoRow label="SMS failed" value={<span className={c.failed_sms_7d ? "text-red-600" : ""}>{num(c.failed_sms_7d)}</span>} />
					<InfoRow label="Open enquiries" value={num(c.open_enquiries)} />
					<InfoRow label="Scheduled announcements" value={num(c.scheduled_announcements)} />
					<InfoRow label="Upcoming events" value={num(c.upcoming_events)} />
				</div>
			</Panel>
		)
	}
	if (l) {
		const loanPct = l.items ? (l.on_loan / l.items) * 100 : 0
		panels.push(
			<Panel key="lib" title="Library" subtitle={`${num(l.items)} catalogue items`} icon={Library} actions={<OpenLink to="/admin/library" roles={roles} />}>
				<ProgressBar value={loanPct} label={`On loan · ${num(l.on_loan)} of ${num(l.items)}`} />
				<div className="mt-3 divide-y divide-line border-t border-line">
					<InfoRow label="Overdue loans" value={<span className={l.overdue ? "text-red-600" : ""}>{num(l.overdue)}</span>} />
					<InfoRow label="Reservations" value={num(l.requests)} />
				</div>
			</Panel>
		)
	}
	if (ch) {
		panels.push(
			<Panel key="church" title="Church & sponsorship" subtitle="Partners who carry our students" icon={HandHeart} actions={<OpenLink to="/admin/church" roles={roles} />}>
				<div className="grid grid-cols-2 gap-3">
					<MiniFigure icon={Building2} label="Partner churches" value={num(ch.partner_churches)} />
					<MiniFigure icon={HandHeart} label="Active sponsorships" value={num(ch.active_sponsorships)} />
					<MiniFigure icon={GraduationCap} label="Sponsored students" value={num(ch.sponsored_students)} />
					<MiniFigure icon={Banknote} label="Giving this month" value={money(ch.giving_this_month, { compact: true })} />
				</div>
			</Panel>
		)
	}
	if (!panels.length) return null
	return <div className={`grid gap-5 ${panels.length > 1 ? cols : ""}`}>{panels}</div>
}

function MiniFigure({ icon: Icon, label, value }) {
	return (
		<div className="rounded-xl border border-line bg-cream/60 p-3">
			<div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
				<Icon size={13} /> <span className="truncate">{label}</span>
			</div>
			<div className="mt-1 text-lg font-bold text-ink">{value}</div>
		</div>
	)
}

function CampusComparison() {
	const q = useApi(`${M}campus_comparison`, {}, { staleTime: 5 * 60_000 })
	const d = q.data
	const chart = d?.chart
	const data = useMemo(() => {
		if (!chart) return []
		return (chart.labels || []).map((l, i) => {
			const row = { label: l }
			;(chart.datasets || []).forEach((ds, j) => {
				row[`s${j}`] = Number(ds.values?.[i] || 0)
			})
			return row
		})
	}, [chart])
	const series = (chart?.datasets || []).map((ds, j) => ({ key: `s${j}`, label: ds.name }))
	const cols = [
		{ key: "campus_name", label: "Campus", render: (r) => (
			<div className="min-w-0">
				<div className="font-semibold text-ink">
					{r.campus_name} {r.is_main_campus ? <Badge tone="gold" size="xs">Main</Badge> : null}
				</div>
				<div className="text-xs text-ink-soft">{[r.code, r.town].filter(Boolean).join(" · ")}</div>
			</div>
		) },
		{ key: "active_students", label: "Students", align: "right", render: (r) => num(r.active_students) },
		{ key: "applications", label: "Applications", align: "right", hideOnMobile: true, render: (r) => num(r.applications) },
		{ key: "lecturers", label: "Lecturers", align: "right", hideOnMobile: true, render: (r) => `${num(r.lecturers)} / ${num(r.staff)} staff` },
		{ key: "student_lecturer_ratio", label: "Students per lecturer", align: "right", hideOnMobile: true, render: (r) => (r.student_lecturer_ratio != null ? num(r.student_lecturer_ratio, 1) : "—") },
		{ key: "collected", label: "Collected", align: "right", render: (r) => (r.collected == null ? "—" : money(r.collected, { compact: true })) },
		{ key: "collection_rate", label: "Rate", align: "right", sortValue: (r) => r.collection_rate || 0, render: (r) => (r.collection_rate == null ? "—" : <span className={r.collection_rate >= 75 ? "text-emerald-700" : r.collection_rate >= 50 ? "text-amber-700" : "text-red-600"}>{pct(r.collection_rate, 1)}</span>) },
		{ key: "average_cgpa", label: "Avg CGPA", align: "right", hideOnMobile: true, render: (r) => (r.average_cgpa ? num(r.average_cgpa, 2) : "—") },
		{ key: "chapel_average_attendance", label: "Chapel avg", align: "right", hideOnMobile: true, render: (r) => num(r.chapel_average_attendance, 0) },
	]
	return (
		<Panel title="Campus comparison" subtitle={d ? `${d.term || ""}${d.intake ? ` · ${d.intake} intake` : ""}` : "How each campus is doing"} icon={Building2} bodyClass="p-0">
			{q.isLoading ? (
				<div className="p-5">
					<SkeletonRows rows={4} />
				</div>
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			) : !d?.campuses?.length ? (
				<Empty compact icon={Building2} title="No campuses yet" subtitle="Add campuses under Settings › Master data." />
			) : (
				<div className="grid gap-0 xl:grid-cols-5">
					<div className="border-b border-line p-5 xl:col-span-2 xl:border-b-0 xl:border-r">
						<BarsChart data={data} series={series} height={240} />
					</div>
					<div className="min-w-0 xl:col-span-3">
						<DataTable cols={cols} rows={d.campuses} rowKey="campus" dense />
					</div>
				</div>
			)}
		</Panel>
	)
}

function Shortcuts({ roles, title = "Shortcuts", grid = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" }) {
	const tiles = SHORTCUTS.filter((t) => linkable(roles, t.to) && (!t.roles || t.roles.some((r) => roles.includes(r)) || roles.includes(ROLES.SYS) || roles.includes(ROLES.ADMIN)))
	if (!tiles.length) return null
	return (
		<section>
			<h2 className="mb-3 text-base font-semibold text-ink">{title}</h2>
			<div className={`grid gap-3 ${grid}`}>
				{tiles.slice(0, 12).map((t) => (
					<Tile key={t.to} to={t.to} icon={t.icon} label={t.label} sub={t.sub} tone={t.tone} />
				))}
			</div>
		</section>
	)
}
