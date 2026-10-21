import { useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import {
	BarChart3,
	CalendarClock,
	ClipboardCheck,
	ClipboardList,
	ExternalLink,
	FileSpreadsheet,
	GraduationCap,
	Pencil,
	Plus,
	Trash2,
	UserPlus,
	Users,
} from "lucide-react"
import {
	Alert,
	Avatar,
	Badge,
	Button,
	Checkbox,
	Drawer,
	Empty,
	ErrorState,
	IconButton,
	Input,
	KeyValueGrid,
	MetricRow,
	Modal,
	PageHeader,
	Panel,
	ProgressBar,
	Select,
	SkeletonRows,
	StatCard,
	Tabs,
	Textarea,
} from "@/shared/components/ui"
import { BarRow, DataTable, SearchInput } from "@/shared/components/kit"
import { BarsChart } from "@/shared/components/Charts"
import { useAction, useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { date, dateTime, num } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { ACAD, ASSESS, BASE, EXAMS, OFFERING_STATUS, RESULTS, fmtScore, nameOptions, rate, rowsOf, useAcademicRoles, useLookups } from "../lib"
import { Facts, ResultBadge, SheetBadge } from "../components/common"
import { SessionsTab } from "../components/SessionsTab"

const LECTURER_ROLES = ["Lead", "Assistant", "Tutor"]

function LecturersModal({ open, onClose, offering, current, lookups }) {
	const [rows, setRows] = useState([])
	const [search, setSearch] = useState("")
	useEffect(() => {
		if (open) {
			setRows(current.map((l) => ({ staff_member: l.staff_member, staff_name: l.staff_name, role: l.role || "Lead" })))
			setSearch("")
		}
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps
	const save = useAction(`${ACAD}assign_lecturers`, {
		invalidate: [ACAD],
		success: "Lecturers updated",
		onSuccess: onClose,
	})
	const pool = (lookups?.lecturers || []).filter((l) => !rows.some((r) => r.staff_member === l.name)).filter((l) => !search || `${l.full_name} ${l.name} ${l.department || ""}`.toLowerCase().includes(search.toLowerCase()))
	const noLead = rows.length > 0 && !rows.some((r) => r.role === "Lead")
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Lecturers"
			subtitle="The lead lecturer owns the mark sheet; assistants and tutors can teach and mark."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={() => save.mutate({ offering, staff_members: rows.map((r) => ({ staff_member: r.staff_member, role: r.role })) })}>
						Save lecturers
					</Button>
				</>
			}
		>
			{rows.length ? (
				<ul className="mb-4 divide-y divide-line rounded-xl border border-line">
					{rows.map((r, i) => (
						<li key={r.staff_member} className="flex items-center gap-3 px-3 py-2">
							<Avatar name={r.staff_name} size={32} />
							<span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.staff_name}</span>
							<Select aria-label="Role" className="w-32" value={r.role} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} options={LECTURER_ROLES} />
							<IconButton icon={Trash2} tone="danger" label={`Remove ${r.staff_name}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
						</li>
					))}
				</ul>
			) : (
				<Alert tone="warning" className="mb-4" title="No lecturer assigned">
					Students cannot be taught or marked until someone is assigned.
				</Alert>
			)}
			{noLead ? (
				<p className="mb-3 text-xs text-orange-600">Nobody is marked Lead, so sessions default to the first lecturer listed.</p>
			) : null}
			<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Add a lecturer</p>
			<SearchInput value={search} onChange={setSearch} placeholder="Search staff…" />
			<ul className="scroll-thin mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line">
				{pool.length ? (
					pool.slice(0, 50).map((l) => (
						<li key={l.name}>
							<button
								type="button"
								className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-cream/60"
								onClick={() => setRows([...rows, { staff_member: l.name, staff_name: l.full_name, role: rows.length ? "Assistant" : "Lead" }])}
							>
								<UserPlus size={15} className="text-brand-700" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-semibold text-ink">{l.full_name}</span>
									<span className="block truncate text-xs text-ink-soft">{[l.department, l.campus].filter(Boolean).join(" · ") || l.name}</span>
								</span>
							</button>
						</li>
					))
				) : (
					<li className="px-3 py-4 text-center text-sm text-ink-soft">No other lecturers found.</li>
				)}
			</ul>
		</Modal>
	)
}

function EditDrawer({ open, onClose, o, lookups }) {
	const [v, setV] = useState(null)
	const scales = useApi("frappe.client.get_list", { doctype: "Grading Scale", fields: ["name", "is_default"], limit_page_length: 50 }, { enabled: open })
	useEffect(() => {
		if (open)
			setV({
				status: o.status,
				section: o.section || "A",
				study_mode: o.study_mode || "",
				capacity: o.capacity || "",
				start_date: o.start_date || "",
				end_date: o.end_date || "",
				grading_scale: o.grading_scale || "",
				require_fee_clearance: o.require_fee_clearance ? 1 : 0,
				description: o.description || "",
			})
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps
	const save = useAction(`${ACAD}save_offering`, { invalidate: [ACAD], success: "Offering saved", onSuccess: onClose })
	if (!open || !v) return null
	const set = (k) => (e) => setV((cur) => ({ ...cur, [k]: e.target.value }))
	return (
		<Drawer
			open
			onClose={onClose}
			title="Edit offering"
			subtitle={`${o.course} · ${o.academic_term} · ${o.campus}`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						loading={save.isPending}
						onClick={() =>
							save.mutate({
								name: o.name,
								data: { ...v, capacity: v.capacity === "" ? 0 : Number(v.capacity), start_date: v.start_date || null, end_date: v.end_date || null, grading_scale: v.grading_scale || null, study_mode: v.study_mode || null },
							})
						}
					>
						Save
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Select label="Status" value={v.status} onChange={set("status")} options={OFFERING_STATUS} hint="Students can register while it is Open" />
				<div className="grid gap-4 sm:grid-cols-2">
					<Input label="Section" value={v.section} onChange={set("section")} />
					<Input label="Capacity" type="number" min="0" value={v.capacity} onChange={set("capacity")} hint="Blank or 0 for no limit" />
					<Input label="Starts" type="date" value={v.start_date} onChange={set("start_date")} />
					<Input label="Ends" type="date" value={v.end_date} onChange={set("end_date")} />
				</div>
				<Select label="Study mode" value={v.study_mode} onChange={set("study_mode")} placeholder="Not set" options={nameOptions(lookups?.study_modes, "study_mode_name")} />
				<Select
					label="Grading scale"
					value={v.grading_scale}
					onChange={set("grading_scale")}
					placeholder="College default"
					options={(scales.data || []).map((s) => ({ value: s.name, label: `${s.name}${s.is_default ? " (default)" : ""}` }))}
				/>
				<Checkbox label="Require fee clearance" description="Students with a balance cannot register or sit exams" checked={Boolean(v.require_fee_clearance)} onChange={(c) => setV((cur) => ({ ...cur, require_fee_clearance: c ? 1 : 0 }))} />
				<Textarea label="Description" rows={4} value={v.description} onChange={set("description")} />
			</div>
		</Drawer>
	)
}

function OverviewTab({ o, canEdit, onLecturers }) {
	const weights = o.assessment_weights || []
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="space-y-5 lg:col-span-2">
				<Panel title="Offering details">
					<KeyValueGrid
						cols={3}
						items={[
							{ label: "Course", value: <Link to={`${BASE}/courses/${encodeURIComponent(o.course)}`} className="font-semibold text-brand-700 hover:underline">{o.course}</Link> },
							{ label: "Term", value: o.academic_term },
							{ label: "Campus", value: o.campus },
							{ label: "Study mode", value: o.study_mode || "—" },
							{ label: "Section", value: o.section || "A" },
							{ label: "Credits", value: fmtScore(o.credits) },
							{ label: "Runs", value: o.start_date ? `${date(o.start_date)} – ${date(o.end_date)}` : "Term dates" },
							{ label: "Grading scale", value: o.grading_scale || "College default" },
							{ label: "Fee clearance", value: o.require_fee_clearance ? "Required" : "Not required" },
						]}
					/>
					{o.description ? <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm text-ink-muted">{plainText(o.description.replace(/<br\s*\/?>|<\/p>\s*<p[^>]*>/gi, "\n"))}</p> : null}
				</Panel>
				<Panel title="Capacity">
					<div className="flex items-end justify-between gap-4">
						<div>
							<div className="text-3xl font-bold text-ink">{num(o.enrolled_count)}</div>
							<div className="text-sm text-ink-soft">{o.capacity ? `of ${num(o.capacity)} places taken` : "enrolled · no capacity limit"}</div>
						</div>
						{o.capacity ? <Badge tone={o.enrolled_count >= o.capacity ? "red" : "green"}>{o.enrolled_count >= o.capacity ? "Full" : `${num(o.capacity - o.enrolled_count)} left`}</Badge> : null}
					</div>
					{o.capacity ? <ProgressBar className="mt-3" value={Math.min(100, (o.enrolled_count / o.capacity) * 100)} tone={o.enrolled_count >= o.capacity ? "red" : "brand"} /> : null}
				</Panel>
			</div>
			<div className="space-y-5">
				<Panel
					title="Lecturers"
					icon={Users}
					actions={
						canEdit ? (
							<Button size="sm" variant="secondary" icon={UserPlus} onClick={onLecturers}>
								Manage
							</Button>
						) : null
					}
				>
					{o.lecturers?.length ? (
						<ul className="space-y-3">
							{o.lecturers.map((l) => (
								<li key={l.staff_member} className="flex items-center gap-3">
									<Avatar name={l.staff_name} size={36} />
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-semibold text-ink">{l.staff_name}</div>
										<div className="truncate text-xs text-ink-soft">{l.user || l.staff_member}</div>
									</div>
									<Badge size="xs" tone={l.role === "Lead" ? "brand" : "gray"}>
										{l.role}
									</Badge>
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={UserPlus} title="No lecturer yet" subtitle="Assign one so classes and marking can start." action={canEdit ? <Button size="sm" icon={Plus} onClick={onLecturers}>Assign</Button> : null} />
					)}
				</Panel>
				<Panel title="Assessment weights" subtitle={weights.length ? "Set on this offering" : "Inherited from the course or college defaults"}>
					{weights.length ? (
						<div className="space-y-3">
							{weights.map((w) => (
								<BarRow key={w.component} label={w.label || w.component} value={w.weight} max={100} caption={`${fmtScore(w.weight)}%`} />
							))}
						</div>
					) : (
						<p className="text-sm text-ink-soft">
							See the <Link to={`${BASE}/courses/${encodeURIComponent(o.course)}`} className="font-semibold text-brand-700 hover:underline">course</Link> weights.
						</p>
					)}
				</Panel>
				<Panel title="Learning platform">
					<div className="flex items-center justify-between gap-3">
						<Badge status={o.lms_sync_status || "Not Synced"} size="xs" />
						{safeUrl(o.lms_url) ? (
							<a href={safeUrl(o.lms_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
								Open course <ExternalLink size={13} />
							</a>
						) : null}
					</div>
					<MetricRow
						className="mt-4"
						items={[
							{ label: "Modules", value: num(o.counts?.modules) },
							{ label: "Resources", value: num(o.counts?.resources) },
						]}
					/>
					{o.lms_sync_error ? <p className="mt-3 text-xs text-red-600">{o.lms_sync_error}</p> : null}
				</Panel>
			</div>
		</div>
	)
}

function AttendanceTab({ offering }) {
	const q = useApi(`${ACAD}attendance_report`, { offering })
	const [search, setSearch] = useState("")
	const d = q.data
	if (q.isLoading) return <SkeletonRows rows={6} />
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	const students = (d?.students || []).filter((s) => !search || `${s.student_name} ${s.student_number}`.toLowerCase().includes(search.toLowerCase()))
	const sessions = d?.sessions || []
	const held = Array.isArray(d?.held) ? d.held.length : Number(d?.held || 0)
	const cols = [
		{
			key: "student_name",
			label: "Student",
			render: (r) => (
				<Link to={`/admin/students/${encodeURIComponent(r.student)}`} className="block min-w-0" onClick={(e) => e.stopPropagation()}>
					<div className="truncate font-semibold text-ink hover:text-brand-700">{r.student_name || r.student}</div>
					<div className="text-xs text-ink-soft">{r.student_number}</div>
				</Link>
			),
			sortValue: (r) => r.student_name,
			exportValue: (r) => r.student_name,
		},
		{ key: "present", label: "Present", align: "right" },
		{ key: "late", label: "Late", align: "right", hideOnMobile: true },
		{ key: "excused", label: "Excused", align: "right", hideOnMobile: true },
		{ key: "absent", label: "Absent", align: "right" },
		{
			key: "percentage",
			label: "Attendance",
			width: "10rem",
			render: (r) => (r.held ? <ProgressBar size="sm" value={r.percentage} label={`${fmtScore(r.percentage)}%`} tone={r.percentage >= 75 ? "green" : r.percentage >= 50 ? "orange" : "red"} /> : <span className="text-xs text-ink-soft">No sessions</span>),
			sortValue: (r) => Number(r.percentage || 0),
		},
	]
	return (
		<>
			<div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Sessions scheduled" value={num(sessions.length)} icon={CalendarClock} />
				<StatCard label="Held with register" value={num(held)} icon={ClipboardCheck} tone="green" />
				<StatCard label="Average attendance" value={d?.average_percentage != null ? `${fmtScore(d.average_percentage)}%` : "—"} icon={BarChart3} tone="gold" />
				<StatCard label="Students" value={num(d?.students?.length)} icon={Users} tone="purple" />
			</div>
			<div className="mb-3 max-w-sm">
				<SearchInput value={search} onChange={setSearch} placeholder="Find a student…" />
			</div>
			<DataTable rows={students} cols={cols} rowKey="student" dense initialSort={{ key: "percentage", dir: "asc" }} empty="No students enrolled yet" emptyIcon={Users} />
		</>
	)
}

function AssessmentsTab({ offering }) {
	const q = useApi(`${ASSESS}list_assignments`, { offering })
	const rows = rowsOf(q.data)
	const toGrade = rows.reduce((a, r) => a + Number(r.to_grade || 0), 0)
	const cols = [
		{
			key: "title",
			label: "Assessment",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.title}</div>
					<div className="text-xs text-ink-soft">
						{r.assessment_component} · out of {fmtScore(r.max_score)}
					</div>
				</div>
			),
			sortValue: (r) => r.title,
		},
		{ key: "due_date", label: "Due", render: (r) => dateTime(r.due_date), sortValue: (r) => r.due_date },
		{
			key: "submission_count",
			label: "Submitted",
			width: "9rem",
			render: (r) => (
				<div className="w-28">
					<div className="mb-1 text-xs text-ink-muted">
						{num(r.submission_count)} / {num(r.enrolled_count)}
					</div>
					<ProgressBar size="sm" value={r.enrolled_count ? (r.submission_count / r.enrolled_count) * 100 : 0} />
				</div>
			),
			sortValue: (r) => Number(r.submission_count || 0),
		},
		{ key: "to_grade", label: "To grade", align: "right", render: (r) => (r.to_grade ? <span className="font-semibold text-orange-600">{num(r.to_grade)}</span> : "0") },
		{ key: "released_count", label: "Released", align: "right", hideOnMobile: true },
		{ key: "average_score", label: "Average", align: "right", hideOnMobile: true, render: (r) => (r.graded_count ? fmtScore(r.average_score) : "—") },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" /> },
	]
	return (
		<>
			<Alert tone="info" className="mb-4" title="Read-only oversight">
				Lecturers create, publish and grade CATs and assignments from the staff portal.
				{toGrade ? ` ${num(toGrade)} submission${toGrade === 1 ? " is" : "s are"} waiting to be graded.` : ""}
			</Alert>
			<DataTable query={q} cols={cols} empty="No CATs or assignments yet" emptyIcon={ClipboardList} />
		</>
	)
}

function ExamsTab({ offering }) {
	const q = useApi(`${EXAMS}list_exams`, { offering })
	const cols = [
		{
			key: "title",
			label: "Exam",
			render: (r) => (
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{r.title}</div>
					<div className="text-xs text-ink-soft">
						{r.exam_type} · {num(r.question_count)} questions · {num(r.duration_minutes)} min
					</div>
				</div>
			),
		},
		{ key: "start_datetime", label: "Window", render: (r) => (r.start_datetime ? dateTime(r.start_datetime) : "Not scheduled"), sortValue: (r) => r.start_datetime },
		{ key: "submitted_count", label: "Submitted", align: "right", render: (r) => `${num(r.submitted_count)} / ${num(r.attempt_count)}` },
		{ key: "to_mark", label: "To mark", align: "right", render: (r) => (r.to_mark ? <span className="font-semibold text-orange-600">{num(r.to_mark)}</span> : "0") },
		{ key: "average_score", label: "Average", align: "right", hideOnMobile: true, render: (r) => (r.submitted_count ? fmtScore(r.average_score) : "—") },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" /> },
	]
	return <DataTable query={q} cols={cols} rowTo={(r) => `${BASE}/exams/${encodeURIComponent(r.name)}`} empty="No exams for this offering" emptyIcon={FileSpreadsheet} />
}

function MarksTab({ o }) {
	const q = useApi(`${RESULTS}grade_distribution`, { offering: o.name })
	const d = q.data
	if (q.isLoading) return <SkeletonRows rows={5} />
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	const sheet = d?.mark_sheet || o.mark_sheet
	const statuses = d?.statuses || {}
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<Panel
				title="Mark sheet"
				icon={FileSpreadsheet}
				actions={
					sheet ? (
						<Link to={`${BASE}/mark-sheets/${encodeURIComponent(sheet)}`} className="btn btn-primary btn-sm">
							Open mark sheet
						</Link>
					) : null
				}
			>
				<div className="flex items-center gap-2">
					<SheetBadge status={d?.status || o.results_status} />
					{sheet ? <span className="text-xs text-ink-soft">{sheet}</span> : null}
				</div>
				{sheet ? (
					<MetricRow
						className="mt-4"
						items={[
							{ label: "Students", value: num(d?.count) },
							{ label: "Average", value: fmtScore(d?.average) },
							{ label: "Pass rate", value: d?.count ? `${fmtScore(rate(statuses.Pass, d.count))}%` : "—", tone: "green" },
						]}
					/>
				) : (
					<p className="mt-3 text-sm text-ink-soft">The lead lecturer starts the mark sheet from the staff portal once CATs and the exam are marked.</p>
				)}
				{Object.keys(statuses).length ? (
					<div className="mt-4 flex flex-wrap gap-1.5">
						{Object.entries(statuses).map(([k, n]) => (
							<span key={k} className="inline-flex items-center gap-1">
								<ResultBadge status={k} />
								<span className="text-xs text-ink-muted">{num(n)}</span>
							</span>
						))}
					</div>
				) : null}
			</Panel>
			<Panel title="Grade distribution" className="lg:col-span-2" subtitle={d?.count ? `Highest ${fmtScore(d.highest)} · lowest ${fmtScore(d.lowest)}` : null}>
				{d?.grades?.length ? <BarsChart data={d.grades.map((g) => ({ label: g.grade, Students: g.count }))} series={[{ key: "Students", label: "Students" }]} height={220} /> : <Empty compact icon={GraduationCap} title="No marks yet" />}
			</Panel>
		</div>
	)
}

export default function OfferingDetail() {
	const { name } = useParams()
	const [params, setParams] = useSearchParams()
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const q = useApi(`${ACAD}get_offering`, { offering: name })
	const [editing, setEditing] = useState(false)
	const [lecturers, setLecturers] = useState(false)
	const tab = params.get("tab") || "overview"
	const setTab = (t) =>
		setParams(
			(p) => {
				const n = new URLSearchParams(p)
				if (t === "overview") n.delete("tab")
				else n.set("tab", t)
				return n
			},
			{ replace: true }
		)
	const o = q.data
	const canEdit = roles.admin
	const tabs = useMemo(
		() => [
			{ id: "overview", label: "Overview" },
			{ id: "timetable", label: "Timetable", count: o?.counts?.sessions },
			{ id: "attendance", label: "Attendance" },
			{ id: "assessments", label: "CATs & assignments", count: o?.counts?.assignments },
			{ id: "exams", label: "Exams", count: o?.counts?.exams },
			{ id: "marks", label: "Mark sheet" },
		],
		[o?.counts]
	)

	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	if (!o)
		return (
			<>
				<PageHeader title="Offering" back={{ to: `${BASE}/offerings`, label: "Offerings" }} />
				<SkeletonRows rows={8} />
			</>
		)

	return (
		<>
			<PageHeader
				back={{ to: `${BASE}/offerings?term=${encodeURIComponent(o.academic_term)}`, label: "Offerings" }}
				eyebrow={`${o.course} · ${o.academic_term}`}
				title={o.course_title}
				actions={
					<>
						{safeUrl(o.lms_url) ? (
							<a href={safeUrl(o.lms_url)} target="_blank" rel="noreferrer" className="btn btn-secondary">
								<ExternalLink size={16} /> LMS course
							</a>
						) : null}
						{canEdit ? (
							<Button icon={Pencil} variant="secondary" onClick={() => setEditing(true)}>
								Edit
							</Button>
						) : null}
					</>
				}
			>
				<Facts
					items={[
						{ label: "Status", value: <Badge status={o.status} size="xs" /> },
						{ label: "Campus", value: `${o.campus}${o.study_mode ? ` · ${o.study_mode}` : ""}` },
						{ label: "Section", value: o.section || "A" },
						{ label: "Mark sheet", value: <SheetBadge status={o.results_status} size="xs" /> },
					]}
				/>
			</PageHeader>

			{!o.lecturers?.length && o.status !== "Cancelled" ? (
				<Alert
					tone="warning"
					className="mb-4"
					title="No lecturer assigned"
					action={
						canEdit ? (
							<Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setLecturers(true)}>
								Assign
							</Button>
						) : null
					}
				>
					Sessions, CATs and the mark sheet need a lecturer.
				</Alert>
			) : null}

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Enrolled" icon={Users} value={num(o.enrolled_count)} hint={!o.enrolled_count && o.results_status === "Published" ? "Completed" : o.capacity ? `of ${num(o.capacity)} places` : "No capacity limit"} />
				<StatCard label="Sessions" icon={CalendarClock} value={num(o.counts?.sessions)} tone="blue" />
				<StatCard label="Assessments" icon={ClipboardList} value={num(o.counts?.assignments)} tone="purple" />
				<StatCard label="Exams" icon={FileSpreadsheet} value={num(o.counts?.exams)} tone="gold" />
			</div>

			<Tabs className="mb-5" tabs={tabs} active={tab} onChange={setTab} />

			{tab === "overview" ? <OverviewTab o={o} canEdit={canEdit} onLecturers={() => setLecturers(true)} /> : null}
			{tab === "timetable" ? <SessionsTab offering={o.name} lecturers={o.lecturers || []} canEdit={roles.admin && o.status !== "Cancelled"} /> : null}
			{tab === "attendance" ? <AttendanceTab offering={o.name} /> : null}
			{tab === "assessments" ? <AssessmentsTab offering={o.name} /> : null}
			{tab === "exams" ? <ExamsTab offering={o.name} /> : null}
			{tab === "marks" ? <MarksTab o={o} /> : null}

			<EditDrawer open={editing} onClose={() => setEditing(false)} o={o} lookups={lookups.data} />
			<LecturersModal open={lecturers} onClose={() => setLecturers(false)} offering={o.name} current={o.lecturers || []} lookups={lookups.data} />
		</>
	)
}
