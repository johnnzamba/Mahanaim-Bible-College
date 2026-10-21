import { useEffect, useState } from "react"
import { CalendarPlus, Repeat } from "lucide-react"
import { Alert, Button, Input, Modal, Select, Textarea } from "@/shared/components/ui"
import { useAction } from "@/shared/api/hooks"
import { OfferingSelect } from "./bits"
import { M, P, SESSION_MODES, addDays, hm, parseYmd, ymd } from "./lib"

const blank = (offering) => ({
	offering: offering || "",
	date: ymd(),
	start: "08:00",
	end: "10:00",
	venue: "",
	topic: "",
	mode: "In Person",
	meeting_url: "",
	notes: "",
	repeat_weeks: 0,
})

/** Create (optionally weekly-repeating) or edit a class session. */
export function SessionDialog({ open, onClose, offering, session, onSaved }) {
	const editing = Boolean(session?.name)
	const [f, setF] = useState(blank(offering))
	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))

	useEffect(() => {
		if (!open) return
		setF(
			session
				? {
						offering: session.course_offering,
						date: session.session_date,
						start: hm(session.start_time),
						end: hm(session.end_time),
						venue: session.venue || "",
						topic: session.topic || "",
						mode: session.mode || "In Person",
						meeting_url: session.meeting_link || "",
						notes: session.notes || "",
						repeat_weeks: 0,
					}
				: blank(offering)
		)
	}, [open, session, offering])

	const done = (r) => {
		onSaved?.(r)
		onClose()
	}
	const create = useAction(M.createSession, {
		invalidate: [P.acad, P.lec],
		success: (r) => (r?.series?.length > 1 ? `${r.series.length} sessions scheduled` : "Session scheduled"),
		onSuccess: done,
	})
	const update = useAction(M.updateSession, { invalidate: [P.acad, P.lec], success: "Session updated", onSuccess: done })
	const busy = create.isPending || update.isPending

	const timeBad = f.start && f.end && f.end <= f.start
	const online = f.mode !== "In Person"
	const linkBad = online && f.meeting_url.trim() && !/^https?:\/\/\S+$/i.test(f.meeting_url.trim())
	const valid = f.offering && f.date && f.start && f.end && !timeBad && !linkBad
	const repeats = Number(f.repeat_weeks) || 0
	const lastDate = repeats ? ymd(addDays(parseYmd(f.date), repeats * 7)) : null

	const save = () => {
		if (!valid) return
		if (editing) {
			update.mutate({
				session: session.name,
				data: {
					session_date: f.date,
					start_time: f.start,
					end_time: f.end,
					venue: f.venue,
					topic: f.topic,
					mode: f.mode,
					meeting_url: online ? f.meeting_url : "",
					notes: f.notes,
				},
			})
		} else {
			create.mutate({
				offering: f.offering,
				date: f.date,
				start: f.start,
				end: f.end,
				venue: f.venue,
				topic: f.topic,
				mode: f.mode,
				meeting_url: online ? f.meeting_url : undefined,
				notes: f.notes || undefined,
				repeat_weeks: repeats,
			})
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={editing ? "Edit session" : "Schedule a class session"}
			subtitle={editing ? `${session.course_title || ""} · ${session.name}` : "Students see it on their timetable straight away."}
			size="lg"
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
					<Button icon={CalendarPlus} onClick={save} loading={busy} disabled={!valid}>
						{editing ? "Save changes" : repeats ? `Schedule ${repeats + 1} sessions` : "Schedule session"}
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{editing || offering ? null : <OfferingSelect className="sm:col-span-2" value={f.offering} onChange={(v) => setF((x) => ({ ...x, offering: v }))} />}
				<Input label="Date" type="date" required value={f.date} onChange={set("date")} />
				<div className="grid grid-cols-2 gap-3">
					<Input label="Starts" type="time" required value={f.start} onChange={set("start")} />
					<Input label="Ends" type="time" required value={f.end} onChange={set("end")} error={timeBad ? "Must end after it starts" : undefined} />
				</div>
				<Input label="Topic" className="sm:col-span-2" placeholder="e.g. Genre and literary context" value={f.topic} onChange={set("topic")} />
				<Select label="Mode" value={f.mode} onChange={set("mode")} options={SESSION_MODES} />
				<Input label="Venue" placeholder="e.g. Room 4, Main block" value={f.venue} onChange={set("venue")} />
				{online ? (
					<Input
						label="Meeting link"
						className="sm:col-span-2"
						type="url"
						placeholder="https://meet.google.com/…"
						value={f.meeting_url}
						onChange={set("meeting_url")}
						error={linkBad ? "Use a full link starting with https://" : undefined}
					/>
				) : null}
				<Textarea label="Notes" className="sm:col-span-2" rows={2} value={f.notes} onChange={set("notes")} />
				{editing ? null : (
					<div className="sm:col-span-2">
						<Input
							label="Repeat weekly for"
							type="number"
							min={0}
							max={20}
							icon={Repeat}
							value={f.repeat_weeks}
							onChange={set("repeat_weeks")}
							hint="Extra weeks after this one (0–20). Each repeat is a separate session you can edit or cancel."
						/>
						{repeats ? (
							<Alert tone="brand" className="mt-3">
								{repeats + 1} weekly sessions, the last on {parseYmd(lastDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}.
							</Alert>
						) : null}
					</div>
				)}
			</div>
		</Modal>
	)
}
