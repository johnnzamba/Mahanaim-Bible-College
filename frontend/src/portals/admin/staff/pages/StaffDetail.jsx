import { useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { BookOpen, CalendarClock, KeyRound, Mail, Pencil, Phone, PlayCircle, PauseCircle, ShieldCheck, UserX, Users } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { Alert, Avatar, Badge, Button, ConfirmDialog, Empty, ErrorState, Html, InfoRow, KeyValueGrid, PageHeader, Panel, SkeletonRows, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { ago, date, dateTime, num } from "@/shared/utils/format"
import { API, CAN, FLAT, NoAccess, StaffStatus, StaffType, campusName, displayName, isPermissionError, kv, useLookups, workspaceAreas } from "../lib"

const TABS = ["overview", "teaching", "access"]

/** What each status move means for the person's login (Staff Member.sync_user_enabled). */
const MOVES = {
	Active: { label: "Reactivate", icon: PlayCircle, tone: "primary", effect: "Their sign-in account is enabled again and they reappear in lecturer pickers." },
	"On Leave": { label: "Mark on leave", icon: PauseCircle, tone: "primary", effect: "They stay able to sign in. Lecturers on leave still appear in pickers, so reassign their courses if needed." },
	Inactive: { label: "Deactivate", icon: UserX, tone: "danger", effect: "Their sign-in account is disabled straight away and they drop out of lecturer pickers. Their records are kept." },
}

/** /admin/staff/:name */
export default function StaffDetail() {
	const { name } = useParams()
	const q = useApi(`${API}get_staff`, { name })
	const back = { to: "/admin/staff", label: "Staff" }
	if (q.isLoading)
		return (
			<>
				<PageHeader title="Loading staff member…" back={back} />
				<Panel>
					<SkeletonRows rows={8} />
				</Panel>
			</>
		)
	if (isPermissionError(q.error))
		return (
			<>
				<PageHeader title="Staff member" back={back} />
				<NoAccess message="Staff profiles are open to college staff roles." />
			</>
		)
	if (q.isError)
		return (
			<>
				<PageHeader title="Staff member" back={back} />
				<Panel>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Panel>
			</>
		)
	return <View s={q.data} />
}

function View({ s }) {
	const { hasRole } = useSession()
	const canWrite = hasRole(...CAN.write)
	const lookups = useLookups()
	const L = lookups.data || {}
	const [params, setParams] = useSearchParams()
	const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "overview"
	const setTab = (t) =>
		setParams(
			(prev) => {
				const n = new URLSearchParams(prev)
				t === "overview" ? n.delete("tab") : n.set("tab", t)
				return n
			},
			{ replace: true }
		)
	const [move, setMove] = useState(null)

	const offerings = useApi("mahanaim.api.academics.list_offerings", { lecturer: s.name, page_length: 200 }, { enabled: Boolean(Number(s.is_lecturer)) || (s.teaching || []).length > 0 })
	const allTeaching = offerings.data?.data || []
	const current = s.teaching || []
	const studentsNow = current.reduce((a, r) => a + Number(r.enrolled_count || 0), 0)
	const years = s.date_joined ? Math.max(0, (Date.now() - new Date(s.date_joined).getTime()) / (365.25 * 86400000)) : null
	const ui = s.user_info
	const moves = Object.keys(MOVES).filter((k) => k !== s.status)

	return (
		<>
			<PageHeader
				back={{ to: "/admin/staff", label: "Staff" }}
				eyebrow={s.staff_number || s.name}
				title={displayName(s)}
				actions={
					canWrite ? (
						<>
							<Link to={`/admin/staff/${encodeURIComponent(s.name)}/edit`} className="btn btn-secondary btn-sm">
								<Pencil size={14} /> Edit profile
							</Link>
							{moves.map((m) => (
								<Button key={m} size="sm" variant={m === "Inactive" ? "danger" : m === "Active" ? "primary" : "secondary"} icon={MOVES[m].icon} onClick={() => setMove(m)}>
									{MOVES[m].label}
								</Button>
							))}
						</>
					) : null
				}
			/>

			{s.status === "Inactive" ? (
				<Alert tone="warning" className="mb-5" title="Inactive">
					This person can no longer sign in. Reactivate them to restore access.
				</Alert>
			) : null}

			<div className="card mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
				<Avatar name={s.full_name} src={s.photo || undefined} size={76} ring />
				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-sm font-semibold text-ink">{s.staff_number || s.name}</span>
						<StaffStatus status={s.status} />
						<StaffType type={s.staff_type} size="sm" />
						{Number(s.is_lecturer) ? <Badge tone="blue">Lecturer</Badge> : null}
						{Number(s.show_on_website) ? <Badge tone="gold">On website</Badge> : null}
					</div>
					<div className="text-sm font-semibold text-ink">{s.designation || "No designation"}</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
						<span>{s.department || "No department"}</span>
						<span>{[campusName(L, s.campus), ...(s.additional_campuses || []).map((c) => campusName(L, c))].filter(Boolean).join(" · ")}</span>
					</div>
				</div>
				<div className="flex flex-col gap-1 text-sm sm:items-end">
					{s.email ? (
						<a href={`mailto:${s.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-ink-muted hover:text-brand-700">
							<Mail size={14} /> <span className="truncate">{s.email}</span>
						</a>
					) : null}
					{s.phone ? (
						<a href={`tel:${s.phone}`} className="inline-flex items-center gap-1.5 text-ink-muted hover:text-brand-700">
							<Phone size={14} /> {s.phone}
						</a>
					) : null}
				</div>
			</div>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Teaching this term" value={num(current.length)} icon={BookOpen} tone="blue" hint={current.length ? "Course offerings" : Number(s.is_lecturer) ? "No courses this term" : "Not a lecturer"} />
				<StatCard label="Students taught" value={num(studentsNow)} icon={Users} tone="green" hint="Enrolled this term" />
				<StatCard label="Service" value={years == null ? "—" : years < 1 ? "< 1 yr" : `${Math.floor(years)} yr${Math.floor(years) === 1 ? "" : "s"}`} icon={CalendarClock} tone="gold" hint={s.date_joined ? `Joined ${date(s.date_joined)}` : "Join date not set"} />
				<StatCard
					label="Sign-in"
					value={ui ? (Number(ui.enabled) ? "Enabled" : "Disabled") : "None"}
					icon={KeyRound}
					tone={ui ? (Number(ui.enabled) ? "green" : "red") : "orange"}
					hint={ui ? (ui.last_login ? `Last seen ${ago(ui.last_login)}` : "Never signed in") : "No account linked"}
				/>
			</div>

			<Tabs
				className="mb-5"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "overview", label: "Profile" },
					{ id: "teaching", label: "Teaching load", count: offerings.data ? allTeaching.length : current.length },
					{ id: "access", label: "Roles and access", count: ui ? ui.roles.length : 0 },
				]}
			/>

			{tab === "overview" ? <Overview s={s} L={L} /> : null}
			{tab === "teaching" ? <Teaching s={s} q={offerings} current={current} /> : null}
			{tab === "access" ? <Access s={s} L={L} /> : null}

			{move ? <StatusDialog s={s} target={move} onClose={() => setMove(null)} /> : null}
		</>
	)
}

function Overview({ s, L }) {
	const quals = String(s.qualifications || "")
		.split(/\n|;/)
		.map((x) => x.trim())
		.filter(Boolean)
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="min-w-0 space-y-5 lg:col-span-2">
				<Panel title="Position">
					<KeyValueGrid
						items={kv([
							{ label: "Designation", value: s.designation },
							{ label: "Staff type", value: s.staff_type },
							{ label: "Department", value: s.department },
							{ label: "Date joined", value: s.date_joined ? date(s.date_joined) : null },
							{ label: "Home campus", value: campusName(L, s.campus) },
							{ label: "Also serves at", value: (s.additional_campuses || []).map((c) => campusName(L, c)).join(", ") },
						])}
					/>
				</Panel>
				<Panel title="Academic profile">
					<KeyValueGrid items={kv([{ label: "Specialisation", value: s.specialisation }, { label: "Teaches", value: Number(s.is_lecturer) ? "Yes, holds the Lecturer role" : "No" }])} />
					<div className="mt-4">
						<div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Qualifications</div>
						{quals.length ? (
							<ul className="list-disc space-y-0.5 pl-5 text-sm text-ink">
								{quals.map((x) => (
									<li key={x}>{x}</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-ink-soft">None recorded.</p>
						)}
					</div>
				</Panel>
			</div>
			<aside className="min-w-0 space-y-5">
				<Panel title="College website" subtitle={Number(s.show_on_website) ? "Listed on the faculty and staff page" : "Not listed publicly"}>
					<InfoRow label="Display order" value={Number(s.show_on_website) ? num(s.website_sequence || 0) : "—"} />
					<div className="mt-3 border-t border-line pt-3">
						<div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Bio</div>
						{s.bio ? <Html className="text-sm" html={s.bio} /> : <p className="text-sm text-ink-soft">No bio yet.</p>}
					</div>
				</Panel>
			</aside>
		</div>
	)
}

function Teaching({ s, q, current }) {
	const { roles } = useSession()
	const linkable = canAccess(roles, "/academics")
	const rows = q.data?.data || []
	const roleOf = useMemo(() => Object.fromEntries(current.map((r) => [r.name, r.role])), [current])
	const byTerm = useMemo(() => {
		const out = {}
		for (const r of rows) (out[r.academic_term] ||= []).push(r)
		return Object.entries(out)
	}, [rows])
	const currentCredits = rows.filter((r) => roleOf[r.name]).reduce((a, r) => a + Number(r.credits || 0), 0)

	if (!Number(s.is_lecturer) && !current.length && !rows.length)
		return (
			<Panel>
				<Empty icon={BookOpen} title="Not a lecturer" subtitle="Turn on “Teaches courses” in the profile to give this person the Lecturer role and assign them to course offerings." />
			</Panel>
		)
	if (q.isError) return <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel>

	const cols = [
		{
			key: "course",
			label: "Course",
			render: (r) => (
				<div className="min-w-0">
					<div className="font-semibold text-ink">{r.course}</div>
					<div className="truncate text-xs text-ink-soft">{r.course_title}</div>
				</div>
			),
		},
		{ key: "campus", label: "Campus", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap">{[r.campus, r.study_mode, r.section ? `Sec ${r.section}` : null].filter(Boolean).join(" · ")}</span> },
		{ key: "credits", label: "Credits", align: "right", hideOnMobile: true, render: (r) => num(r.credits || 0) },
		{
			key: "enrolled_count",
			label: "Students",
			align: "right",
			render: (r) => (
				<span className="tabular-nums">
					{num(r.enrolled_count || 0)}
					{r.capacity ? <span className="text-ink-soft"> / {num(r.capacity)}</span> : null}
				</span>
			),
		},
		{
			key: "role",
			label: "Role",
			hideOnMobile: true,
			render: (r) => {
				const lec = (r.lecturers || []).find((l) => l.staff_member === s.name)
				return lec?.role || roleOf[r.name] || "—"
			},
		},
		{
			key: "status",
			label: "Status",
			render: (r) => (
				<div className="flex flex-col items-start gap-1">
					<Badge status={r.status} size="xs" />
					{r.results_status ? <span className="text-[11px] text-ink-soft">Results: {r.results_status}</span> : null}
				</div>
			),
		},
	]

	return (
		<div className="space-y-5">
			{current.length ? (
				<Alert tone="info" title={`${num(current.length)} offering${current.length === 1 ? "" : "s"} this term`}>
					{num(currentCredits)} credit{currentCredits === 1 ? "" : "s"} and {num(current.reduce((a, r) => a + Number(r.enrolled_count || 0), 0))} enrolled students. Course assignments are managed on each offering in Academics.
				</Alert>
			) : null}
			{q.isLoading ? (
				<Panel>
					<SkeletonRows rows={4} />
				</Panel>
			) : byTerm.length ? (
				byTerm.map(([term, list]) => (
					<Panel key={term} title={term} subtitle={`${num(list.length)} offering${list.length === 1 ? "" : "s"} · ${num(list.reduce((a, r) => a + Number(r.credits || 0), 0))} credits`} bodyClass="p-0" actions={list.some((r) => roleOf[r.name]) ? <Badge tone="green" size="xs">Current term</Badge> : null}>
						<DataTable className={FLAT} cols={cols} rows={list} rowTo={linkable ? (r) => `/admin/academics/offerings/${encodeURIComponent(r.name)}` : undefined} noCards dense />
					</Panel>
				))
			) : (
				<Panel>
					<Empty icon={BookOpen} title="No courses assigned" subtitle="Assign this lecturer to an offering from Academics → Offerings." />
				</Panel>
			)}
		</div>
	)
}

function Access({ s, L }) {
	const ui = s.user_info
	const areas = workspaceAreas(ui?.roles || [])
	const lecturer = (ui?.roles || []).includes("Lecturer")
	if (!ui)
		return (
			<Panel>
				<Empty icon={KeyRound} title="No sign-in account" subtitle="This person cannot sign in. Edit the profile and save it with an email address to create an account." />
			</Panel>
		)
	return (
		<div className="grid gap-5 lg:grid-cols-3">
			<div className="min-w-0 space-y-5 lg:col-span-2">
				<Panel title="Roles" subtitle="Lecturer follows the “Teaches courses” switch. Other roles are assigned by a system manager in desk.">
					{ui.roles.length ? (
						<div className="flex flex-wrap gap-2">
							{ui.roles.map((r) => (
								<Badge key={r} tone={r === "Lecturer" ? "blue" : "brand"}>
									{r}
								</Badge>
							))}
						</div>
					) : (
						<p className="text-sm text-ink-soft">No roles yet, so the account can sign in but opens no portal.</p>
					)}
				</Panel>
				<Panel title="What they can open">
					<div className="space-y-3">
						<div className="flex items-start gap-3">
							<ShieldCheck size={18} className={areas.length ? "mt-0.5 text-brand-600" : "mt-0.5 text-ink-soft"} />
							<div className="min-w-0">
								<div className="text-sm font-semibold text-ink">Staff workspace</div>
								{areas.length ? (
									<div className="mt-1.5 flex flex-wrap gap-1.5">
										{areas.map((a) => (
											<Badge key={a.path} tone="gray" size="xs">
												{a.label}
											</Badge>
										))}
									</div>
								) : (
									<p className="text-xs text-ink-soft">No staff workspace role.</p>
								)}
							</div>
						</div>
						<div className="flex items-start gap-3">
							<BookOpen size={18} className={lecturer ? "mt-0.5 text-brand-600" : "mt-0.5 text-ink-soft"} />
							<div>
								<div className="text-sm font-semibold text-ink">Lecturer portal</div>
								<p className="text-xs text-ink-soft">{lecturer ? "Classes, attendance, marks and course content for their offerings." : "Not a lecturer."}</p>
							</div>
						</div>
					</div>
				</Panel>
			</div>
			<aside className="min-w-0 space-y-5">
				<Panel title="Account">
					<InfoRow label="Signs in as" value={<span className="break-all">{s.user}</span>} />
					<InfoRow label="Account" value={Number(ui.enabled) ? <Badge tone="green" size="xs">Enabled</Badge> : <Badge tone="red" size="xs">Disabled</Badge>} />
					<InfoRow label="Type" value={ui.user_type || "—"} />
					<InfoRow label="Last sign-in" value={ui.last_login ? dateTime(ui.last_login) : "Never"} />
				</Panel>
				<Panel title="Campus scope">
					<p className="mb-2 text-xs text-ink-soft">Campus-scoped roles only see records from these campuses. College administrators see every campus.</p>
					<div className="flex flex-wrap gap-1.5">
						{[s.campus, ...(s.additional_campuses || [])].filter(Boolean).map((c, i) => (
							<Badge key={c} tone={i === 0 ? "brand" : "gray"} size="xs">
								{campusName(L, c)}
								{i === 0 ? " (home)" : ""}
							</Badge>
						))}
					</div>
				</Panel>
			</aside>
		</div>
	)
}

function StatusDialog({ s, target, onClose }) {
	const m = MOVES[target]
	const act = useAction(`${API}set_staff_status`, {
		invalidate: [`${API}list_staff`, `${API}get_staff`, `${API}lookups`],
		success: `${s.full_name} is now ${target === "On Leave" ? "on leave" : target.toLowerCase()}`,
		onSuccess: onClose,
	})
	const teaching = (s.teaching || []).length
	return (
		<ConfirmDialog
			open
			title={`${m.label}: ${s.full_name}?`}
			message={m.effect}
			confirmLabel={m.label}
			tone={m.tone}
			loading={act.isPending}
			onClose={onClose}
			onConfirm={() => act.mutate({ name: s.name, status: target })}
		>
			{target !== "Active" && teaching ? (
				<Alert tone="warning" className="mt-3">
					They teach {num(teaching)} offering{teaching === 1 ? "" : "s"} this term. Reassign {teaching === 1 ? "it" : "them"} in Academics so students are not left without a lecturer.
				</Alert>
			) : null}
			<div className="mt-3 flex items-center justify-between rounded-xl bg-line/40 px-3 py-2 text-sm">
				<span className="text-ink-soft">Status</span>
				<span className="flex items-center gap-2">
					<StaffStatus status={s.status} size="xs" /> → <StaffStatus status={target} size="xs" />
				</span>
			</div>
		</ConfirmDialog>
	)
}
