import { useEffect, useMemo, useState } from "react"
import { CalendarPlus, Link2, MapPin, Pencil, Repeat, XCircle } from "lucide-react"
import { Badge, Button, ConfirmDialog, IconButton, Input, Modal, Select, Textarea } from "@/shared/components/ui"
import { DataTable, Toolbar } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { date, num, time } from "@/shared/utils/format"
import { ACAD, rowsOf } from "../lib"

const MODES = ["In Person", "Online", "Hybrid"]
const MAX_REPEAT = 20
const hhmm = (t) =>
	t
		? String(t)
				.split(":")
				.slice(0, 2)
				.map((p) => p.padStart(2, "0"))
				.join(":")
		: ""
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (iso, n) => {
	const d = new Date(`${iso}T00:00:00`)
	d.setDate(d.getDate() + n)
	return d.toISOString().slice(0, 10)
}

function SessionForm({ open, onClose, offering, session, lecturers }) {
	const isNew = !session
	const [v, setV] = useState(null)
	useEffect(() => {
		if (!open) return
		setV(
			session
				? {
						date: session.session_date,
						start: hhmm(session.start_time),
						end: hhmm(session.end_time),
						venue: session.venue || "",
						topic: session.topic || "",
						mode: session.mode || "In Person",
						meeting_url: session.meeting_link || "",
						lecturer: session.lecturer || "",
						notes: session.notes || "",
					}
				: {
						date: today(),
						start: "08:00",
						end: "10:00",
						venue: "",
						topic: "",
						mode: "In Person",
						meeting_url: "",
						lecturer: "",
						notes: "",
						repeat_weeks: 0,
					}
		)
	}, [open, session])
	const create = useAction(`${ACAD}create_session`, {
		invalidate: [`${ACAD}list_sessions`, `${ACAD}get_offering`, `${ACAD}attendance_report`, `${ACAD}academics_stats`],
		success: (d) => (d.series?.length > 1 ? `${d.series.length} sessions scheduled` : "Session scheduled"),
		onSuccess: onClose,
	})
	const update = useAction(`${ACAD}update_session`, {
		invalidate: [`${ACAD}list_sessions`, `${ACAD}attendance_report`],
		success: "Session updated",
		onSuccess: onClose,
	})
	if (!open || !v) return null
	const set = (k) => (e) => setV((cur) => ({ ...cur, [k]: e.target.value }))
	const repeat = Math.max(0, Math.min(MAX_REPEAT, Number(v.repeat_weeks || 0)))
	const badTime = v.start && v.end && v.start >= v.end
	const needsLink = v.mode === "Online" && !v.meeting_url.trim()
	const badLink = v.meeting_url.trim() && !/^https?:\/\//i.test(v.meeting_url.trim())
	const invalid = !v.date || !v.start || !v.end || badTime || needsLink || badLink
	const busy = create.isPending || update.isPending
	const submit = () => {
		if (isNew)
			create.mutate({
				offering,
				date: v.date,
				start: v.start,
				end: v.end,
				venue: v.venue,
				topic: v.topic,
				mode: v.mode,
				meeting_url: v.meeting_url || undefined,
				lecturer: v.lecturer || undefined,
				notes: v.notes,
				repeat_weeks: repeat,
			})
		else {
			// The server marks a session Rescheduled when any slot field differs as a string, so send only real moves.
			const slot = {}
			if (v.date !== session.session_date) slot.session_date = v.date
			if (v.start !== hhmm(session.start_time)) slot.start_time = v.start
			if (v.end !== hhmm(session.end_time)) slot.end_time = v.end
			update.mutate({
				session: session.name,
				data: {
					...slot,
					venue: v.venue,
					topic: v.topic,
					mode: v.mode,
					meeting_url: v.meeting_url,
					lecturer: v.lecturer || undefined,
					notes: v.notes,
				},
			})
		}
	}
	return (
		<Modal
			open
			onClose={onClose}
			size="lg"
			title={isNew ? "Schedule a class session" : "Edit session"}
			subtitle={
				isNew
					? "Repeat it weekly to build the term's timetable in one go."
					: session.status === "Held"
						? "This session has been held; only the details can change."
						: "Moving the date or time marks it Rescheduled."
			}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={busy} disabled={invalid} onClick={submit}>
						{isNew ? (repeat ? `Schedule ${repeat + 1} sessions` : "Schedule session") : "Save session"}
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-3">
				<Input label="Date" type="date" required value={v.date} onChange={set("date")} disabled={session?.status === "Held"} />
				<Input label="Starts" type="time" required value={v.start} onChange={set("start")} disabled={session?.status === "Held"} />
				<Input label="Ends" type="time" required value={v.end} onChange={set("end")} error={badTime ? "Must end after it starts" : null} disabled={session?.status === "Held"} />
				<Input label="Topic" className="sm:col-span-2" value={v.topic} onChange={set("topic")} placeholder="e.g. The Pauline epistles" />
				<Select
					label="Lecturer"
					value={v.lecturer}
					onChange={set("lecturer")}
					placeholder={lecturers.length ? "Lead lecturer" : "No lecturer assigned"}
					options={lecturers.map((l) => ({
						value: l.staff_member,
						label: `${l.staff_name} (${l.role})`,
					}))}
				/>
				<Select label="Mode" value={v.mode} onChange={set("mode")} options={MODES} />
				<Input label="Venue" icon={MapPin} value={v.venue} onChange={set("venue")} placeholder={v.mode === "Online" ? "Optional" : "e.g. Hall B"} />
				<Input
					label="Meeting link"
					icon={Link2}
					value={v.meeting_url}
					onChange={set("meeting_url")}
					placeholder="https://"
					required={v.mode === "Online"}
					disabled={v.mode === "In Person"}
					error={needsLink ? "Required for online sessions" : badLink ? "Must start with https://" : null}
				/>
				<Textarea className="sm:col-span-3" label="Notes" rows={2} value={v.notes} onChange={set("notes")} />
				{isNew ? (
					<div className="rounded-xl bg-cream/70 p-4 sm:col-span-3">
						<div className="flex flex-wrap items-end gap-4">
							<Input label="Repeat weekly for" type="number" min="0" max={MAX_REPEAT} value={v.repeat_weeks} onChange={set("repeat_weeks")} className="w-36" hint={`more weeks (max ${MAX_REPEAT})`} />
							<p className="pb-6 text-sm text-ink-muted">
								<Repeat size={14} className="mr-1 inline" />
								{repeat ? (
									<>
										{repeat + 1} sessions, every {new Date(`${v.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" })} from {date(v.date)} to {date(addDays(v.date, 7 * repeat))}
									</>
								) : (
									"A single session"
								)}
							</p>
						</div>
					</div>
				) : null}
			</div>
		</Modal>
	)
}

export function SessionsTab({ offering, lecturers, canEdit }) {
	const q = useApi(`${ACAD}list_sessions`, { offering })
	const [filter, setFilter] = useState("upcoming")
	const [form, setForm] = useState(null)
	const [cancelling, setCancelling] = useState(null)
	const [reason, setReason] = useState("")
	const cancel = useAction(`${ACAD}cancel_session`, {
		invalidate: [`${ACAD}list_sessions`, `${ACAD}get_offering`, `${ACAD}attendance_report`],
		success: "Session cancelled",
		onSuccess: () => setCancelling(null),
	})
	const all = rowsOf(q.data)
	const t = today()
	const counts = {
		upcoming: all.filter((s) => s.session_date >= t && s.status !== "Cancelled").length,
		past: all.filter((s) => s.session_date < t && s.status !== "Cancelled").length,
		cancelled: all.filter((s) => s.status === "Cancelled").length,
		all: all.length,
	}
	const rows = useMemo(() => {
		if (filter === "upcoming") return all.filter((s) => s.session_date >= t && s.status !== "Cancelled")
		if (filter === "past") return all.filter((s) => s.session_date < t && s.status !== "Cancelled").reverse()
		if (filter === "cancelled") return all.filter((s) => s.status === "Cancelled")
		return all
	}, [all, filter, t])
	const nameOf = (id) => lecturers.find((l) => l.staff_member === id)?.staff_name || id || "—"

	const cols = [
		{
			key: "session_date",
			label: "When",
			render: (r) => (
				<div>
					<div className="font-semibold text-ink">
						{date(r.session_date, {
							weekday: "short",
							day: "numeric",
							month: "short",
						})}
					</div>
					<div className="text-xs text-ink-soft">
						{time(r.start_time)} – {time(r.end_time)}
					</div>
				</div>
			),
			sortValue: (r) => `${r.session_date} ${hhmm(r.start_time)}`,
		},
		{
			key: "topic",
			label: "Topic",
			render: (r) => r.topic || <span className="text-ink-soft">No topic</span>,
		},
		{
			key: "venue",
			label: "Where",
			hideOnMobile: true,
			render: (r) => (
				<div className="text-sm">
					{r.venue || (r.mode === "In Person" ? "—" : "")}
					{r.mode !== "In Person" ? (
						<div className="text-xs">
							<Badge size="xs" tone="blue">
								{r.mode}
							</Badge>
						</div>
					) : null}
				</div>
			),
		},
		{
			key: "lecturer",
			label: "Lecturer",
			hideOnMobile: true,
			render: (r) => nameOf(r.lecturer),
		},
		{
			key: "attendance",
			label: "Attendance",
			hideOnMobile: true,
			render: (r) =>
				r.attendance_taken ? (
					<span className="text-sm">
						<span className="font-semibold text-green-700">{num(r.present_count)}</span> present · <span className="text-red-600">{num(r.absent_count)}</span> absent
					</span>
				) : (
					<span className="text-xs text-ink-soft">Not taken</span>
				),
		},
		{
			key: "status",
			label: "Status",
			render: (r) => <Badge status={r.status} size="xs" />,
		},
		...(canEdit
			? [
					{
						key: "actions",
						label: "",
						align: "right",
						render: (r) =>
							r.status === "Cancelled" ? null : (
								<div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
									<IconButton icon={Pencil} label="Edit session" onClick={() => setForm({ session: r })} />
									{r.status !== "Held" ? (
										<IconButton
											icon={XCircle}
											label="Cancel session"
											tone="danger"
											onClick={() => {
												setReason("")
												setCancelling(r)
											}}
										/>
									) : null}
								</div>
							),
					},
				]
			: []),
	]

	return (
		<>
			<Toolbar
				chips={[
					{ id: "upcoming", label: "Upcoming", count: counts.upcoming },
					{ id: "past", label: "Past", count: counts.past },
					{ id: "cancelled", label: "Cancelled", count: counts.cancelled },
					{ id: "all", label: "All", count: counts.all },
				]}
				active={filter}
				onChip={setFilter}
				right={
					canEdit ? (
						<Button icon={CalendarPlus} onClick={() => setForm({})}>
							Add session
						</Button>
					) : null
				}
			/>
			<DataTable
				query={q}
				rows={q.isLoading || q.isError ? undefined : rows}
				cols={cols}
				dense
				empty={filter === "upcoming" ? "No upcoming sessions" : "No sessions here"}
				emptyIcon={CalendarPlus}
				emptyAction={
					canEdit && filter === "upcoming" ? (
						<Button size="sm" icon={CalendarPlus} onClick={() => setForm({})}>
							Build the timetable
						</Button>
					) : null
				}
			/>
			<SessionForm open={Boolean(form)} onClose={() => setForm(null)} offering={offering} session={form?.session} lecturers={lecturers} />
			<ConfirmDialog
				open={Boolean(cancelling)}
				title="Cancel this session?"
				message={cancelling ? `${date(cancelling.session_date)} ${time(cancelling.start_time)}${cancelling.topic ? ` · ${cancelling.topic}` : ""}. Students see it as cancelled.` : ""}
				confirmLabel="Cancel session"
				tone="danger"
				loading={cancel.isPending}
				onConfirm={() =>
					cancel.mutate({
						session: cancelling.name,
						reason: reason || undefined,
					})
				}
				onClose={() => setCancelling(null)}
			>
				<Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-3" />
			</ConfirmDialog>
		</>
	)
}
