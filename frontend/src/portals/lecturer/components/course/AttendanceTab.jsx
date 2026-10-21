import { useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, CalendarPlus, ClipboardCheck, Pencil, XCircle } from "lucide-react"
import { Badge, Button, ConfirmDialog, IconButton, Panel, Tabs, Textarea } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { pct } from "@/shared/utils/format"
import { SessionDialog } from "../SessionDialog"
import { StatusBadge } from "../bits"
import { M, P, dayLabel, hm, pctTone, ymd } from "../lib"

export function SessionsTable({ query, rows, showCourse, onEdit, onCancel, empty = "No sessions" }) {
	const today = ymd()
	return (
		<DataTable
			query={query}
			rows={rows}
			empty={empty}
			emptyIcon={ClipboardCheck}
			cols={[
				{
					key: "session_date",
					label: "When",
					sortValue: (s) => `${s.session_date} ${hm(s.start_time)}`,
					render: (s) => (
						<div className="min-w-0">
							<div className="font-semibold text-ink">{dayLabel(s.session_date)}</div>
							<div className="text-xs text-ink-soft">
								{hm(s.start_time)}–{hm(s.end_time)}
								{showCourse ? ` · ${s.course_title}` : ""}
							</div>
						</div>
					),
				},
				{ key: "topic", label: "Topic", render: (s) => <span className="line-clamp-1">{s.topic || "—"}</span> },
				{ key: "venue", label: "Venue", hideOnMobile: true, render: (s) => (s.mode === "Online" ? "Online" : s.venue || "—") },
				{
					key: "present_count",
					label: "Present",
					align: "right",
					render: (s) =>
						s.attendance_taken ? (
							<span className="tabular-nums">
								{s.present_count}/{(s.present_count || 0) + (s.absent_count || 0)}
							</span>
						) : (
							<span className="text-ink-soft">—</span>
						),
				},
				{ key: "status", label: "Status", render: (s) => <StatusBadge kind="session" status={s.status} /> },
				{
					key: "actions",
					label: "",
					sortable: false,
					render: (s) => {
						const canRoll = s.status !== "Cancelled" && s.session_date <= today
						return (
							<div className="flex items-center justify-end gap-1">
								{canRoll ? (
									<Link to={`/lecturer/attendance/${s.name}`} className={`btn btn-sm ${s.attendance_taken ? "btn-secondary" : "btn-gold"}`}>
										<ClipboardCheck size={14} /> {s.attendance_taken ? "Edit roll" : "Roll call"}
									</Link>
								) : null}
								{onEdit && s.status !== "Cancelled" && s.status !== "Held" ? <IconButton icon={Pencil} label="Edit session" onClick={() => onEdit(s)} /> : null}
								{onCancel && s.status === "Scheduled" && !s.attendance_taken ? <IconButton icon={XCircle} label="Cancel session" tone="danger" onClick={() => onCancel(s)} /> : null}
							</div>
						)
					},
				},
			]}
		/>
	)
}

export function CancelSessionDialog({ session, onClose }) {
	const [reason, setReason] = useState("")
	const cancel = useAction(M.cancelSession, {
		invalidate: [P.acad, P.lec],
		success: "Session cancelled",
		onSuccess: () => {
			setReason("")
			onClose()
		},
	})
	return (
		<ConfirmDialog
			open={Boolean(session)}
			onClose={onClose}
			tone="danger"
			title="Cancel this session?"
			message={session ? `${session.course_title || ""} on ${dayLabel(session.session_date)} at ${hm(session.start_time)}.` : ""}
			confirmLabel="Cancel session"
			cancelLabel="Keep it"
			loading={cancel.isPending}
			onConfirm={() => cancel.mutate({ session: session.name, reason })}
		>
			<Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-3" placeholder="e.g. Public holiday" />
		</ConfirmDialog>
	)
}

const EXPORT_COLS = [
	{ key: "student_number", label: "Number" },
	{ key: "student_name", label: "Student" },
	{ key: "held", label: "Held" },
	{ key: "present", label: "Present" },
	{ key: "late", label: "Late" },
	{ key: "absent", label: "Absent" },
	{ key: "excused", label: "Excused" },
	{ key: "percentage", label: "Attendance %" },
	{ key: "flag", label: "Below 75%", exportValue: (s) => (s.held && Number(s.percentage) < 75 ? "Yes" : "") },
]

function Report({ offering, title }) {
	const q = useApi(M.attendanceReport, { offering })
	const d = q.data
	const low = (d?.students || []).filter((s) => s.held && Number(s.percentage) < 75)
	const cols = [
		{
			key: "student_name",
			label: "Student",
			render: (s) => (
				<div>
					<div className="font-semibold text-ink">{s.student_name}</div>
					<div className="text-xs text-ink-soft">{s.student_number}</div>
				</div>
			),
		},
		{ key: "present", label: "Present", align: "right" },
		{ key: "late", label: "Late", align: "right", hideOnMobile: true },
		{ key: "absent", label: "Absent", align: "right" },
		{ key: "excused", label: "Excused", align: "right", hideOnMobile: true },
		{ key: "held", label: "Held", align: "right", hideOnMobile: true },
		{
			key: "percentage",
			label: "Attendance",
			align: "right",
			render: (s) => (
				<span className="inline-flex items-center gap-1.5">
					{s.held && Number(s.percentage) < 75 ? <AlertTriangle size={14} className="text-red-600" aria-label="Below 75%" /> : null}
					<Badge tone={s.held ? pctTone(s.percentage) : "gray"}>{s.held ? pct(s.percentage) : "—"}</Badge>
				</span>
			),
		},
	]
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<p className="text-sm text-ink-muted">
					{d ? (
						<>
							{d.held} session{d.held === 1 ? "" : "s"} held · class average <b className="text-ink">{pct(d.average_percentage)}</b>
							{low.length ? (
								<>
									{" "}· <span className="font-semibold text-red-700 dark:text-red-300">{low.length} below 75%</span>
								</>
							) : null}
						</>
					) : (
						"Loading…"
					)}
				</p>
				<div className="ml-auto">
					<ExportButton filename={`${title}-attendance`} cols={EXPORT_COLS} rows={d?.students || []} />
				</div>
			</div>
			<DataTable query={q} rows={d?.students} rowKey="student" cols={cols} initialSort={{ key: "percentage", dir: "asc" }} empty="No students yet" pageSize={30} />
		</div>
	)
}

export default function AttendanceTab({ offering, data: d }) {
	const [view, setView] = useState("sessions")
	const [when, setWhen] = useState("upcoming")
	const [dialog, setDialog] = useState(null)
	const [cancel, setCancel] = useState(null)
	const q = useApi(M.listSessions, { offering })
	const today = ymd()
	const list = q.data?.data || []
	const rows = list
		.filter((s) => (when === "upcoming" ? s.session_date >= today : when === "past" ? s.session_date < today : true))
		.sort((a, b) => (when === "past" ? -1 : 1) * `${a.session_date}${hm(a.start_time)}`.localeCompare(`${b.session_date}${hm(b.start_time)}`))
	const due = list.filter((s) => s.session_date <= today && s.status === "Scheduled" && !s.attendance_taken)

	return (
		<div className="space-y-4">
			<Tabs
				className="overflow-y-hidden pb-px"
				size="sm"
				tabs={[
					{ id: "sessions", label: "Sessions", count: list.length },
					{ id: "report", label: "Attendance report" },
				]}
				active={view}
				onChange={setView}
			/>
			{view === "sessions" ? (
				<>
					{due.length ? (
						<Panel title={`Roll call due (${due.length})`} icon={ClipboardCheck} bodyClass="p-0">
							<SessionsTable rows={due} onEdit={setDialog} onCancel={setCancel} />
						</Panel>
					) : null}
					<Toolbar
						chips={[
							{ id: "upcoming", label: "Upcoming" },
							{ id: "past", label: "Past" },
							{ id: "all", label: "All" },
						]}
						active={when}
						onChip={setWhen}
						right={
							<Button size="sm" icon={CalendarPlus} onClick={() => setDialog({})}>
								New session
							</Button>
						}
					/>
					<SessionsTable
						query={q}
						rows={q.isSuccess ? rows : undefined}
						onEdit={setDialog}
						onCancel={setCancel}
						empty={when === "upcoming" ? "No upcoming sessions. Schedule one, or a weekly series." : "No sessions"}
					/>
				</>
			) : (
				<Report offering={offering} title={d?.offering?.course || offering} />
			)}
			<SessionDialog open={Boolean(dialog)} onClose={() => setDialog(null)} offering={offering} session={dialog?.name ? dialog : null} />
			<CancelSessionDialog session={cancel} onClose={() => setCancel(null)} />
		</div>
	)
}
