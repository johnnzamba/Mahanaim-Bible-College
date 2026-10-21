import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { CalendarClock, CheckCheck, MapPin, MessageSquarePlus, Users, Video } from "lucide-react"
import { Alert, AvatarCell, Button, Card, Empty, ErrorState, Loading, PageHeader } from "@/shared/components/ui"
import { SearchInput, useDebounced } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { SaveBar, StatusBadge } from "../components/bits"
import { ATTENDANCE_STATUSES, M, P, dayLabel, hm, ymd } from "../components/lib"

const STYLE = {
	Present: "border-emerald-600 bg-emerald-600 text-white",
	Absent: "border-red-600 bg-red-600 text-white",
	Late: "border-orange-500 bg-orange-500 text-white",
	Excused: "border-sky-600 bg-sky-600 text-white",
}
const DOT = { Present: "bg-emerald-500", Absent: "bg-red-500", Late: "bg-orange-500", Excused: "bg-sky-500" }

function Toggle({ value, onChange, name, disabled }) {
	return (
		<div role="radiogroup" aria-label={`Attendance for ${name}`} className="grid grid-cols-4 gap-1.5">
			{ATTENDANCE_STATUSES.map((s) => {
				const on = value === s
				return (
					<button
						key={s}
						type="button"
						role="radio"
						aria-checked={on}
						disabled={disabled}
						onClick={() => onChange(s)}
						className={`min-h-[44px] rounded-xl border px-1 text-xs font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm ${
							on ? STYLE[s] : "border-line bg-surface text-ink-muted hover:bg-cream"
						}`}
					>
						{s}
					</button>
				)
			})}
		</div>
	)
}

export default function RollCall() {
	const { session } = useParams()
	const q = useApi(M.sessionRoster, { session })
	const [marks, setMarks] = useState({})
	const [notes, setNotes] = useState({})
	const [opened, setOpened] = useState({})
	const [search, setSearch] = useState("")
	const [filter, setFilter] = useState("")
	const s = useDebounced(search).toLowerCase()
	const save = useAction(M.takeAttendance, { invalidate: [P.acad, P.lec], success: "Attendance saved" })

	const rows = useMemo(() => q.data?.rows || [], [q.data])
	useEffect(() => {
		setMarks(Object.fromEntries(rows.map((r) => [r.student, r.status || "Present"])))
		setNotes(Object.fromEntries(rows.map((r) => [r.student, r.remarks || ""])))
	}, [rows])

	if (q.isError) {
		return (
			<div className="space-y-6">
				<PageHeader title="Roll call" back={{ to: "/lecturer/attendance", label: "Attendance" }} />
				<Card>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Card>
			</div>
		)
	}
	if (!q.data) return <Loading className="min-h-[50vh]" />

	const ses = q.data.session
	const future = ses.session_date > ymd()
	const cancelled = ses.status === "Cancelled"
	const locked = future || cancelled
	const online = ses.mode && ses.mode !== "In Person"
	const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((st) => [st, rows.filter((r) => (marks[r.student] || "Present") === st).length]))
	const changed = rows.filter((r) => (marks[r.student] || "Present") !== (r.status || "Present") || (notes[r.student] || "") !== (r.remarks || "")).length
	const dirty = changed > 0 || !ses.attendance_taken
	const shown = rows.filter((r) => (!s || `${r.student_name} ${r.student_number || ""}`.toLowerCase().includes(s)) && (!filter || marks[r.student] === filter))
	const setAll = (st) => setMarks(Object.fromEntries(rows.map((r) => [r.student, st])))
	const submit = () =>
		save.mutate({
			session,
			rows: rows.map((r) => ({ student: r.student, status: marks[r.student] || "Present", remarks: (notes[r.student] || "").trim() || null })),
		})

	return (
		<div className="mx-auto max-w-3xl space-y-5">
			<PageHeader
				back={{ to: `/lecturer/courses/${ses.course_offering}?tab=attendance`, label: ses.course_title }}
				eyebrow="Roll call"
				title={ses.course_title}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span className="inline-flex items-center gap-1">
							<CalendarClock size={14} /> {dayLabel(ses.session_date)} · {hm(ses.start_time)}–{hm(ses.end_time)}
						</span>
						<span className="inline-flex items-center gap-1">
							{online ? <Video size={14} /> : <MapPin size={14} />} {online ? ses.mode : ses.venue || "Venue TBC"}
						</span>
						<StatusBadge kind="session" status={ses.status} />
					</span>
				}
			/>
			{ses.topic ? <p className="-mt-2 text-sm text-ink-muted">Topic: {ses.topic}</p> : null}

			{cancelled ? <Alert tone="error">This session was cancelled, so attendance can't be taken.</Alert> : null}
			{future ? <Alert tone="info">Roll call opens on {dayLabel(ses.session_date)}.</Alert> : null}
			{!locked && !ses.attendance_taken ? (
				<Alert tone="info" title="Everyone starts as Present">
					Tap Absent, Late or Excused for anyone who isn't, then save.
				</Alert>
			) : null}

			<Card className="space-y-3 p-4">
				<div className="grid grid-cols-4 gap-2 text-center">
					{ATTENDANCE_STATUSES.map((st) => (
						<button
							key={st}
							type="button"
							onClick={() => setFilter((f) => (f === st ? "" : st))}
							aria-pressed={filter === st}
							className={`rounded-xl border px-1 py-2 transition ${filter === st ? "border-brand-400 bg-brand-50" : "border-line hover:bg-cream"}`}
						>
							<div className="text-xl font-bold tabular-nums text-ink">{counts[st]}</div>
							<div className="flex items-center justify-center gap-1 text-[11px] text-ink-soft">
								<span className={`h-1.5 w-1.5 rounded-full ${DOT[st]}`} />
								{st}
							</div>
						</button>
					))}
				</div>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
					<SearchInput value={search} onChange={setSearch} placeholder={`Search ${rows.length} students…`} className="w-full sm:max-w-xs" />
					{!locked ? (
						<div className="flex gap-2 sm:ml-auto">
							<Button size="sm" variant="secondary" icon={CheckCheck} className="flex-1 sm:flex-none" onClick={() => setAll("Present")}>
								Mark all present
							</Button>
							<Button size="sm" variant="ghost" className="flex-1 sm:flex-none" onClick={() => setAll("Absent")}>
								All absent
							</Button>
						</div>
					) : null}
				</div>
			</Card>

			{shown.length ? (
				<ul className="space-y-2.5">
					{shown.map((r) => {
						const st = marks[r.student] || "Present"
						const note = notes[r.student] ?? ""
						const showNote = note || r.remarks || opened[r.student]
						return (
							<li key={r.student} className="card space-y-3 p-3 sm:p-4">
								<div className="flex items-center gap-3">
									<div className="min-w-0 flex-1">
										<AvatarCell name={r.student_name} sub={r.student_number} image={r.photo} />
									</div>
									{!locked && !showNote ? (
										<button
											type="button"
											className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-soft hover:bg-cream hover:text-ink"
											onClick={() => setOpened((o) => ({ ...o, [r.student]: true }))}
											aria-label={`Add a note for ${r.student_name}`}
										>
											<MessageSquarePlus size={14} /> Note
										</button>
									) : null}
								</div>
								<Toggle value={st} onChange={(v) => setMarks((m) => ({ ...m, [r.student]: v }))} name={r.student_name} disabled={locked} />
								{showNote ? (
									<input
										className="input text-sm"
										maxLength={140}
										value={note}
										disabled={locked}
										onChange={(e) => setNotes((n) => ({ ...n, [r.student]: e.target.value }))}
										placeholder="Note, e.g. arrived 20 minutes late"
										aria-label={`Note for ${r.student_name}`}
									/>
								) : null}
							</li>
						)
					})}
				</ul>
			) : (
				<Card>
					<Empty compact icon={Users} title={rows.length ? "No students match" : "No students enrolled"} />
				</Card>
			)}

			{!locked ? (
				<SaveBar
					note={
						<span>
							<b className="text-ink">{counts.Present + counts.Late}</b>/{rows.length} in class
							{changed ? ` · ${changed} change${changed === 1 ? "" : "s"}` : ses.attendance_taken ? " · saved" : ""}
						</span>
					}
				>
					<Button disabled={!dirty || !rows.length} loading={save.isPending} onClick={submit}>
						{ses.attendance_taken ? "Save changes" : "Save attendance"}
					</Button>
				</SaveBar>
			) : null}
		</div>
	)
}
