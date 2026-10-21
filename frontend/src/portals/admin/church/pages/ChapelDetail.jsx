import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import clsx from "clsx"
import { CheckCheck, ExternalLink, HandCoins, Pencil, Save, UserPlus, Users, X } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, Card, Checkbox, Empty, Input, KeyValueGrid, PageHeader, Panel, QueryState, SkeletonRows, StatCard } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { API, INVALIDATE, RoleGate, searchStudents, studentsOnCampus, toneOf, useChurchRoles } from "../components/common"
import { ChapelForm } from "../components/ChapelForm"
import { SearchPick, today } from "../components/kit"
import { safeUrl } from "@/shared/utils/sanitize"

const MARKS = [
	{ id: "Present", short: "P", cls: "bg-emerald-600 text-white border-emerald-600" },
	{ id: "Absent", short: "A", cls: "bg-red-600 text-white border-red-600" },
	{ id: "Excused", short: "E", cls: "bg-amber-500 text-white border-amber-500" },
]
const HEADS = [
	["men", "Men"],
	["women", "Women"],
	["children", "Children"],
	["visitors", "Visitors"],
]

export default function ChapelDetail() {
	return (
		<RoleGate need="chapel" title="Chapel service">
			<ChapelDetailPage />
		</RoleGate>
	)
}

function ChapelDetailPage() {
	const { name } = useParams()
	const { isChaplain, canManage } = useChurchRoles()
	const [editing, setEditing] = useState(null)
	const q = useApi(`${API}get_chapel_service`, { name })
	const s = q.data
	return (
		<>
			<PageHeader
				back={{ to: "/admin/church/chapel", label: "Chapel" }}
				title={s ? `${s.service_type} · ${date(s.service_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}` : "Chapel service"}
				subtitle={s ? [s.theme, s.scripture, s.preacher ? `Preacher: ${s.preacher}` : null].filter(Boolean).join(" · ") || s.name : name}
				actions={
					s ? (
						<>
							{canManage ? (
								<Link to={`/admin/church/giving?record=1&chapel_service=${encodeURIComponent(s.name)}`} className="btn btn-secondary">
									<HandCoins size={16} /> Record offering
								</Link>
							) : null}
							{isChaplain ? (
								<Button icon={Pencil} variant="secondary" onClick={() => setEditing(s)}>
									Edit details
								</Button>
							) : null}
						</>
					) : null
				}
			>
				{s ? (
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<Badge status={s.status} tone={toneOf(s.status)} />
						{s.campus ? <Badge tone="gray">{s.campus}</Badge> : null}
					</div>
				) : null}
			</PageHeader>
			<QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
				{(doc) => (
					<>
						<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
							<StatCard label="Total attendance" value={num(doc.total_attendance)} icon={Users} hint="Higher of headcount and students present" />
							<StatCard label="Students present" value={num(doc.present_count)} hint={`${num(doc.attendance?.length)} on the roll`} tone="green" />
							<StatCard label="Headcount" value={num(HEADS.reduce((t, [k]) => t + (doc[k] || 0), 0))} hint={HEADS.map(([k, l]) => `${l} ${num(doc[k])}`).join(" · ")} tone="blue" />
							<StatCard label="Offering" value={money(doc.offering_total || doc.giving.reduce((t, g) => t + g.amount, 0))} tone="gold" icon={HandCoins} />
						</div>
						<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
							{isChaplain ? <AttendanceEditor doc={doc} /> : <AttendanceView doc={doc} />}
							<div className="space-y-4">
								<Panel title="Service details">
									<KeyValueGrid
										cols={1}
										items={[
											{ label: "Service", value: doc.service_type },
											{ label: "Theme", value: doc.theme || "—" },
											{ label: "Scripture", value: doc.scripture || "—" },
											{ label: "Preacher", value: doc.preacher || "—" },
											{ label: "Campus", value: doc.campus || "All campuses" },
											{
												label: "Sermon media",
												value: safeUrl(doc.sermon_media_url) ? (
													<a href={safeUrl(doc.sermon_media_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
														Watch or listen <ExternalLink size={13} />
													</a>
												) : (
													"—"
												),
											},
											{ label: "Notes", value: doc.notes ? <span className="whitespace-pre-line">{doc.notes}</span> : "—" },
										]}
									/>
								</Panel>
								<Panel title="Gifts at this service" subtitle={doc.giving.length ? `${num(doc.giving.length)} recorded` : null}>
									{doc.giving.length ? (
										<ul className="divide-y divide-line">
											{doc.giving.map((g) => (
												<li key={g.name} className="flex items-center justify-between gap-3 py-2 text-sm">
													<span className="min-w-0">
														<span className="block truncate font-medium text-ink">{g.giving_type}</span>
														<span className="block truncate text-xs text-ink-soft">{g.giver_name || "Anonymous"}</span>
													</span>
													<span className="shrink-0 font-semibold">{money(g.amount)}</span>
												</li>
											))}
										</ul>
									) : (
										<p className="text-sm text-ink-soft">No gifts linked to this service yet.</p>
									)}
								</Panel>
							</div>
						</div>
					</>
				)}
			</QueryState>
			<ChapelForm initial={editing} onClose={() => setEditing(null)} />
		</>
	)
}

function AttendanceView({ doc }) {
	const rows = doc.attendance || []
	return (
		<Panel title="Student roll" subtitle={`${num(doc.present_count)} present of ${num(rows.length)}`} icon={Users}>
			{rows.length ? (
				<ul className="divide-y divide-line">
					{rows.map((r) => (
						<li key={r.student} className="flex items-center justify-between gap-3 py-2 text-sm">
							<span className="min-w-0 truncate">
								<span className="font-medium text-ink">{r.student_name || r.student}</span>
								<span className="ml-2 text-xs text-ink-soft">{r.student}</span>
							</span>
							<Badge status={r.status} tone={r.status === "Present" ? "green" : r.status === "Excused" ? "orange" : "red"} size="xs" />
						</li>
					))}
				</ul>
			) : (
				<Empty compact icon={Users} title="No roll taken" subtitle="The chaplaincy records attendance here." />
			)}
		</Panel>
	)
}

function AttendanceEditor({ doc }) {
	const [roll, setRoll] = useState([])
	const [heads, setHeads] = useState({})
	const [markHeld, setMarkHeld] = useState(true)
	const [filter, setFilter] = useState("")
	const [dirty, setDirty] = useState(false)
	const [loading, setLoading] = useState(false)
	const [seen, setSeen] = useState(null)
	if (doc !== seen) {
		setSeen(doc)
		setRoll((doc.attendance || []).map((r) => ({ student: r.student, student_name: r.student_name, status: r.status || "Present" })))
		setHeads(Object.fromEntries(HEADS.map(([k]) => [k, doc[k] ?? 0])))
		setMarkHeld(doc.status === "Scheduled" && doc.service_date <= today())
		setDirty(false)
	}
	const future = doc.service_date > today()
	const save = useAction(`${API}record_chapel_attendance`, {
		invalidate: INVALIDATE,
		success: (r) => `Attendance saved: ${num(r.present)} present, ${num(r.total_attendance)} in total${r.status === "Held" ? " · service marked held" : ""}`,
	})
	const update = (fn) => {
		setRoll(fn)
		setDirty(true)
	}
	const mark = (student, status) => update((rows) => rows.map((r) => (r.student === student ? { ...r, status } : r)))
	const markAll = (status) => update((rows) => rows.map((r) => ({ ...r, status })))
	const add = (student, label) => {
		if (!student) return
		if (roll.some((r) => r.student === student)) return toast.info(`${label || student} is already on the roll`)
		update((rows) => [...rows, { student, student_name: label, status: "Present" }])
	}
	const loadCampus = async () => {
		setLoading(true)
		try {
			const list = await studentsOnCampus(doc.campus)
			const have = new Set(roll.map((r) => r.student))
			const extra = (list || []).filter((s) => !have.has(s.name)).map((s) => ({ student: s.name, student_name: s.full_name, status: "Present" }))
			if (extra.length) update((rows) => [...rows, ...extra])
			toast.success(extra.length ? `Added ${num(extra.length)} students. Everyone starts as present; mark absences.` : "Everyone is already on the roll")
		} catch (e) {
			toast.error(e?.message || "Could not load students")
		} finally {
			setLoading(false)
		}
	}
	const counts = useMemo(() => {
		const c = { Present: 0, Absent: 0, Excused: 0 }
		for (const r of roll) c[r.status] = (c[r.status] || 0) + 1
		return c
	}, [roll])
	const shown = filter ? roll.filter((r) => `${r.student_name} ${r.student}`.toLowerCase().includes(filter.toLowerCase())) : roll
	const headTotal = HEADS.reduce((t, [k]) => t + (Number(heads[k]) || 0), 0)
	const submit = () => {
		if (HEADS.some(([k]) => Number(heads[k]) < 0)) return toast.error("Headcounts can't be negative")
		save.mutate(
			{
				service: doc.name,
				rows: roll.map(({ student, status }) => ({ student, status })),
				headcounts: Object.fromEntries(HEADS.map(([k]) => [k, Number(heads[k]) || 0])),
				mark_held: markHeld ? 1 : 0,
			},
			{ onSuccess: () => setDirty(false) }
		)
	}
	return (
		<Card className="min-w-0">
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
				<div>
					<h2 className="font-semibold text-ink">Attendance</h2>
					<p className="text-xs text-ink-soft">
						{num(counts.Present)} present · {num(counts.Absent)} absent · {num(counts.Excused)} excused · headcount {num(headTotal)}
					</p>
				</div>
				<Button icon={Save} loading={save.isPending} disabled={!dirty && doc.status !== "Scheduled"} onClick={submit}>
					Save attendance
				</Button>
			</div>
			<div className="space-y-5 p-5">
				{future ? (
					<Alert tone="info" title="This service is still ahead">
						You can prepare the roll now; it can only be marked as held on or after {date(doc.service_date)}.
					</Alert>
				) : null}
				<section>
					<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Headcount</h3>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{HEADS.map(([k, l]) => (
							<Input
								key={k}
								label={l}
								type="number"
								min="0"
								inputMode="numeric"
								value={heads[k]}
								onChange={(e) => {
									setHeads((h) => ({ ...h, [k]: e.target.value }))
									setDirty(true)
								}}
							/>
						))}
					</div>
				</section>
				<section>
					<div className="mb-2 flex flex-wrap items-end justify-between gap-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Student roll ({num(roll.length)})</h3>
						<div className="flex flex-wrap gap-2">
							<Button size="sm" variant="secondary" icon={Users} loading={loading} onClick={loadCampus}>
								{doc.campus ? "Load campus students" : "Load all students"}
							</Button>
							{roll.length ? (
								<>
									<Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => markAll("Present")}>
										All present
									</Button>
									<Button size="sm" variant="ghost" onClick={() => markAll("Absent")}>
										All absent
									</Button>
								</>
							) : null}
						</div>
					</div>
					<div className="mb-3 grid gap-3 sm:grid-cols-2">
						<SearchPick id="chapel-add" label="Add a student" value="" search={searchStudents} placeholder="Name or student number…" onChange={(v, r) => add(v, r?.label)} />
						{roll.length > 8 ? (
							<div>
								<span className="label">Find on the roll</span>
								<SearchInput value={filter} onChange={setFilter} placeholder="Filter names…" />
							</div>
						) : null}
					</div>
					{roll.length ? (
						<ul className="divide-y divide-line rounded-xl border border-line">
							{shown.map((r) => (
								<li key={r.student} className="flex items-center gap-3 px-3 py-2">
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-ink">{r.student_name || r.student}</span>
										<span className="block truncate text-xs text-ink-soft">{r.student}</span>
									</span>
									<span className="flex shrink-0 gap-1" role="group" aria-label={`Attendance for ${r.student_name || r.student}`}>
										{MARKS.map((m) => (
											<button
												key={m.id}
												type="button"
												title={m.id}
												aria-pressed={r.status === m.id}
												data-mark={`${r.student}:${m.id}`}
												onClick={() => mark(r.student, m.id)}
												className={clsx("h-8 min-w-8 rounded-lg border px-2 text-xs font-bold transition", r.status === m.id ? m.cls : "border-line text-ink-soft hover:bg-cream")}
											>
												<span className="sm:hidden">{m.short}</span>
												<span className="hidden sm:inline">{m.id}</span>
											</button>
										))}
										<button
											type="button"
											className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-cream hover:text-red-600"
											aria-label={`Remove ${r.student_name || r.student}`}
											onClick={() => update((rows) => rows.filter((x) => x.student !== r.student))}
										>
											<X size={15} />
										</button>
									</span>
								</li>
							))}
							{!shown.length ? <li className="px-3 py-3 text-sm text-ink-soft">No one on the roll matches “{filter}”.</li> : null}
						</ul>
					) : (
						<Empty compact icon={UserPlus} title="No one on the roll yet" subtitle="Load the campus students or add students one by one. Headcounts alone are fine for open services." />
					)}
				</section>
				{doc.status === "Scheduled" ? (
					<Checkbox
						checked={markHeld && !future}
						disabled={future}
						onChange={setMarkHeld}
						label="Mark the service as held"
						description={future ? "Available on the day of the service." : "Moves it from the calendar into attendance reports."}
					/>
				) : null}
			</div>
		</Card>
	)
}
