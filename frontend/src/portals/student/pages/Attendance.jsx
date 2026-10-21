import { useMemo, useState } from "react"
import { CalendarCheck, CalendarX, Clock, ShieldCheck, TrendingUp } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Donut, Drawer, Empty, PageHeader, ProgressBar, QueryState, Skeleton, StatCard, Switch } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, pct } from "@/shared/utils/format"
import { API, hhmm, pctTone } from "../components/lib"

const AT_RISK = 75

export default function Attendance() {
	const q = useApi(API.attendance)
	const [showAll, setShowAll] = useState(false)
	const [open, setOpen] = useState(null)
	const rows = q.data?.data || []
	const active = rows.filter((r) => Number(r.held) > 0)
	const list = showAll ? rows : active
	const totals = useMemo(() => {
		const t = { held: 0, present: 0, late: 0, absent: 0, excused: 0 }
		for (const r of active) for (const k of Object.keys(t)) t[k] += Number(r[k] || 0)
		t.percentage = t.held ? ((t.present + t.late + t.excused) / t.held) * 100 : null
		return t
	}, [active])
	const risky = active.filter((r) => Number(r.percentage) < AT_RISK)

	return (
		<>
			<PageHeader eyebrow="Learning" title="Attendance" subtitle="Class attendance per course and your session history." />
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Overall" value={totals.percentage == null ? "—" : pct(totals.percentage)} icon={TrendingUp} tone={totals.percentage == null ? "gray" : pctTone(totals.percentage)} loading={q.isLoading} />
				<StatCard label="Present" value={totals.present} icon={CalendarCheck} tone="green" loading={q.isLoading} hint={`of ${totals.held} sessions`} />
				<StatCard label="Late" value={totals.late} icon={Clock} tone="orange" loading={q.isLoading} />
				<StatCard label="Absent" value={totals.absent} icon={CalendarX} tone={totals.absent ? "red" : "gray"} loading={q.isLoading} hint={totals.excused ? `${totals.excused} excused` : null} />
			</div>
			{risky.length ? (
				<Alert tone="warning" title={`Attendance below ${AT_RISK}% in ${risky.length} ${risky.length === 1 ? "course" : "courses"}`} className="mb-4">
					{risky.map((r) => r.course_title).join(", ")}. Speak to your lecturer if you have a valid reason for missing classes.
				</Alert>
			) : null}
			<div className="mb-3 flex items-center justify-end">
				<Switch checked={showAll} onChange={setShowAll} label="Show courses with no sessions yet" />
			</div>
			<QueryState
				query={q}
				skeleton={<Skeleton className="h-64 rounded-2xl" />}
				isEmpty={() => !list.length}
				empty={
					<div className="card">
						<Empty icon={ShieldCheck} title="No attendance recorded yet" subtitle="Once lecturers mark class registers, your attendance appears here." />
					</div>
				}
			>
				{() => (
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{list.map((r) => (
							<button
								key={r.course_offering}
								type="button"
								onClick={() => setOpen(r)}
								className="card flex items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft"
							>
								<Donut value={r.percentage} size={64} stroke={7} tone={Number(r.held) ? pctTone(r.percentage) : "gray"}>
									{Number(r.held) ? undefined : "—"}
								</Donut>
								<div className="min-w-0 flex-1">
									<div className="line-clamp-2 font-semibold text-ink">{r.course_title}</div>
									<div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-soft">
										<span>{r.held} held</span>
										<span className="text-emerald-600">{r.present} present</span>
										{Number(r.late) ? <span className="text-amber-600">{r.late} late</span> : null}
										{Number(r.absent) ? <span className="text-red-600">{r.absent} absent</span> : null}
									</div>
									<ProgressBar className="mt-2" size="sm" value={r.percentage} tone={pctTone(r.percentage)} />
								</div>
							</button>
						))}
					</div>
				)}
			</QueryState>
			<SessionsDrawer row={open} onClose={() => setOpen(null)} />
		</>
	)
}

function SessionsDrawer({ row, onClose }) {
	const q = useApi(API.attendance, { offering: row?.course_offering }, { enabled: Boolean(row) })
	return (
		<Drawer open={Boolean(row)} onClose={onClose} title={row?.course_title} subtitle={row ? `${pct(row.percentage)} attendance · ${row.held} sessions` : null}>
			<DataTable
				query={q}
				rows={q.data ? q.data.sessions || [] : undefined}
				empty="No sessions recorded yet"
				emptyIcon={CalendarCheck}
				noCards
				dense
				cols={[
					{ key: "session_date", label: "Date", render: (s) => date(s.session_date, { weekday: "short", day: "numeric", month: "short" }) },
					{ key: "start_time", label: "Time", render: (s) => hhmm(s.start_time) },
					{
						key: "status",
						label: "Status",
						render: (s) => (
							<span className="flex flex-col items-start gap-0.5">
								<Badge status={s.status} dot size="xs" />
								{s.remarks ? <span className="text-[11px] text-ink-soft">{s.remarks}</span> : null}
							</span>
						),
					},
				]}
			/>
		</Drawer>
	)
}
