import { useMemo } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import {
	Award,
	BookOpen,
	CalendarCheck,
	CalendarDays,
	ClipboardList,
	Clock,
	FileText,
	GraduationCap,
	Inbox,
	Library,
	ListChecks,
	MapPin,
	Megaphone,
	NotebookPen,
	Pin,
	Video,
	Wallet,
} from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Alert, Avatar, Badge, Empty, Panel, Skeleton, StatCard, Tile } from "@/shared/components/ui"
import { date, greeting, money } from "@/shared/utils/format"
import { plainText } from "@/shared/api/frappe"
import { API, hhmm, humanSpan, minutesOf, msUntil, safeUrl, serverNow, since } from "../components/lib"
import { CourseCard, DueBadge, GOLD_BTN, Hero, IconChip, useServerTime, useTick } from "../components/bits"

export default function Dashboard() {
	const session = useSession()
	const dash = useApi(API.dashboard)
	const exams = useApi(API.exams)
	const tt = useApi(API.timetable)
	const fees = useApi(API.fees)
	const att = useApi(API.attendance)
	const courses = useApi(API.courses)
	const ann = useApi(API.announcements, { limit: 4 })
	useServerTime(exams.data?.server_time, exams.dataUpdatedAt)

	const d = dash.data || {}
	const st = d.student || session.student || {}
	const first = (st.full_name || session.full_name || "").split(" ")[0]

	const attendance = useMemo(() => {
		const rows = (att.data?.data || []).filter((r) => Number(r.held) > 0)
		const held = rows.reduce((a, r) => a + Number(r.held), 0)
		if (!held) return null
		return rows.reduce((a, r) => a + Number(r.percentage || 0) * Number(r.held), 0) / held
	}, [att.data])

	const current = useMemo(() => (courses.data?.data || []).filter((c) => c.enrolment_status === "Enrolled"), [courses.data])
	const balance = Number(d.fee_balance ?? fees.data?.balance ?? 0)
	const examClear = fees.data?.clearance?.exam
	const regTerm = d.registration_term
	const reg = d.registration

	return (
		<div className="space-y-5">
			<Hero>
				<div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
					<div className="flex min-w-0 items-center gap-4">
						<Avatar name={st.full_name || session.full_name} src={st.photo || session.image} size={60} className="ring-2 ring-gold-400/60" />
						<div className="min-w-0">
							<p className="text-sm text-gold-200">{greeting()},</p>
							<h1 className="truncate font-serif text-2xl leading-tight sm:text-[1.8rem]">{first || "Student"}</h1>
							<p className="mt-1 truncate text-sm text-white/75">
								{st.student_number} · {st.programme_name || st.programme}
							</p>
						</div>
					</div>
					<div className="flex flex-wrap gap-2 text-xs">
						{st.year_of_study ? <HeroChip>Year {st.year_of_study}</HeroChip> : null}
						{d.term?.term_label ? <HeroChip>{d.term.term_label}</HeroChip> : null}
						{st.campus ? <HeroChip>{st.campus}</HeroChip> : null}
						{d.academic_standing ? <HeroChip gold>{d.academic_standing}</HeroChip> : null}
					</div>
				</div>
			</Hero>

			<div className="space-y-2.5">
				{regTerm?.window?.is_open && !reg ? (
					<Alert
						tone="brand"
						icon={ListChecks}
						title={`Course registration is open for ${regTerm.term_label || regTerm.name}`}
						action={
							<Link to="/student/registration" className="btn btn-primary btn-sm">
								Register
							</Link>
						}
					>
						{regTerm.window?.registration_end ? `Register before ${date(regTerm.window.registration_end)}.` : "Choose your courses for next term."}
					</Alert>
				) : null}
				{reg && ["Draft", "Submitted"].includes(reg.status) ? (
					<Alert tone="info" icon={ListChecks} title={`Registration ${reg.status === "Draft" ? "saved as draft" : "submitted"}`}
						action={<Link to="/student/registration" className="btn btn-secondary btn-sm">View</Link>}>
						{reg.status === "Draft" ? "Submit it before the window closes." : "Awaiting approval by the Registrar."}
					</Alert>
				) : null}
				{examClear && !examClear.cleared ? (
					<Alert
						tone="warning"
						icon={Wallet}
						title="Fee clearance needed for exams"
						action={
							<Link to="/student/fees/pay" className={`${GOLD_BTN} btn-sm`}>
								Pay now
							</Link>
						}
					>
						{examClear.message || `Clear your balance of ${money(examClear.balance)} to sit exams.`}
					</Alert>
				) : null}
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard
					label="CGPA"
					icon={Award}
					tone="gold"
					loading={dash.isLoading}
					value={d.cgpa != null ? Number(d.cgpa).toFixed(2) : "—"}
					hint={d.academic_standing || "Cumulative"}
					to="/student/results"
				/>
				<StatCard
					label={<Narrow sm="Balance" lg="Fee balance" />}
					icon={Wallet}
					tone={balance > 0 ? "red" : "green"}
					loading={dash.isLoading}
					value={<Narrow sm={money(Math.abs(balance), { compact: true })} lg={money(Math.abs(balance))} />}
					hint={balance > 0 ? "Tap to pay" : balance < 0 ? "In credit" : "All paid up"}
					to={balance > 0 ? "/student/fees/pay" : "/student/fees"}
				/>
				<StatCard
					label="Attendance"
					icon={CalendarCheck}
					tone={attendance == null ? "gray" : attendance >= 75 ? "green" : attendance >= 60 ? "orange" : "red"}
					loading={att.isLoading}
					value={attendance == null ? "—" : `${Math.round(attendance)}%`}
					hint="This term"
					to="/student/attendance"
				/>
				<StatCard
					label={<Narrow sm="Credits" lg="Credits earned" />}
					icon={GraduationCap}
					tone="brand"
					loading={dash.isLoading}
					value={Number(d.credits_earned || 0)}
					hint={d.credits_this_term ? `${d.credits_this_term} this term` : "Completed"}
					to="/student/results"
				/>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<TodayClasses query={tt} />
				<DueSoon query={dash} />
				<ExamsPanel query={exams} />
			</div>

			<Panel
				title="My courses this term"
				subtitle={d.term?.term_label}
				icon={BookOpen}
				actions={
					<Link to="/student/courses" className="link text-xs">
						All courses
					</Link>
				}
			>
				{courses.isLoading ? (
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{[0, 1, 2].map((i) => (
							<Skeleton key={i} className="h-36 rounded-2xl" />
						))}
					</div>
				) : current.length ? (
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{current.map((c) => (
							<CourseCard key={c.name} course={c} compact />
						))}
					</div>
				) : (
					<Empty
						compact
						icon={BookOpen}
						title="No courses this term"
						subtitle="Once your registration is approved, your courses appear here."
						action={
							<Link to="/student/registration" className="btn btn-secondary btn-sm">
								Go to registration
							</Link>
						}
					/>
				)}
			</Panel>

			<div className="grid gap-4 lg:grid-cols-5">
				<Panel
					className="lg:col-span-3"
					title="Announcements"
					icon={Megaphone}
					bodyClass="p-0"
					actions={
						<Link to="/student/announcements" className="link text-xs">
							See all
						</Link>
					}
				>
					{ann.isLoading ? (
						<div className="space-y-3 p-5">
							<Skeleton className="h-12" />
							<Skeleton className="h-12" />
						</div>
					) : (ann.data?.data || []).length ? (
						<ul className="divide-y divide-line">
							{ann.data.data.map((a) => (
								<li key={a.name}>
									<Link to={`/student/announcements?open=${encodeURIComponent(a.name)}`} className="flex gap-3 px-5 py-3.5 hover:bg-cream/60">
										<IconChip icon={a.is_pinned ? Pin : Megaphone} tone={a.is_pinned ? "gold" : "brand"} size={34} />
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="truncate text-sm font-semibold text-ink">{a.title}</span>
												{a.course_title ? <Badge tone="blue" size="xs">{a.course_title}</Badge> : null}
											</div>
											<p className="line-clamp-1 text-xs text-ink-soft">{a.summary || plainText(a.body)}</p>
										</div>
										<span className="shrink-0 text-[11px] text-ink-soft">{since(a.sent_on || a.publish_on)}</span>
									</Link>
								</li>
							))}
						</ul>
					) : (
						<Empty compact icon={Megaphone} title="No announcements" subtitle="Notices from the college and your lecturers appear here." />
					)}
				</Panel>
				<div className="grid grid-cols-2 gap-3 lg:col-span-2">
					<Tile icon={ListChecks} label="Registration" sub="Courses for next term" to="/student/registration" tone="brand" />
					<Tile icon={FileText} label="Documents" sub="Transcripts & letters" to="/student/documents" tone="gold" />
					<Tile icon={Library} label="Library" sub="Books & e-resources" to="/student/library" tone="blue" />
					<Tile
						icon={Inbox}
						label="Requests"
						sub="Deferment, clearance…"
						to="/student/requests"
						tone="purple"
						badge={d.open_requests ? <Badge tone="orange" size="xs">{d.open_requests} open</Badge> : null}
					/>
				</div>
			</div>
		</div>
	)
}

function HeroChip({ children, gold }) {
	return (
		<span className={clsx("rounded-full px-2.5 py-1 font-semibold", gold ? "bg-gold-400/20 text-gold-200" : "bg-white/10 text-white/85")}>{children}</span>
	)
}

function PanelSkeleton() {
	return (
		<div className="space-y-3 p-4">
			<Skeleton className="h-12" />
			<Skeleton className="h-12" />
			<Skeleton className="h-12" />
		</div>
	)
}

function TodayClasses({ query }) {
	useTick(60000)
	const today = query.data?.from_date
	const rows = (query.data?.sessions || []).filter((s) => s.session_date === today && s.status !== "Cancelled")
	const now = new Date(serverNow())
	const nowMin = now.getHours() * 60 + now.getMinutes()
	return (
		<Panel
			title="Today's classes"
			subtitle={today ? date(today, { weekday: "long", day: "numeric", month: "short" }) : null}
			icon={CalendarDays}
			bodyClass="p-0"
			actions={
				<Link to="/student/timetable" className="link text-xs">
					Week
				</Link>
			}
		>
			{query.isLoading ? (
				<PanelSkeleton />
			) : rows.length ? (
				<ul className="divide-y divide-line">
					{rows.map((s) => {
						const live = nowMin >= minutesOf(s.start_time) && nowMin < minutesOf(s.end_time)
						const past = nowMin >= minutesOf(s.end_time)
						return (
							<li key={s.name} className={clsx("flex gap-3 px-4 py-3", past && "opacity-60")}>
								<div className="w-12 shrink-0 text-center">
									<div className="text-sm font-bold tabular-nums text-ink">{hhmm(s.start_time)}</div>
									<div className="text-[11px] tabular-nums text-ink-soft">{hhmm(s.end_time)}</div>
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="truncate text-sm font-semibold text-ink">{s.course_title}</span>
										{live ? <Badge tone="green" size="xs" dot>Now</Badge> : null}
									</div>
									<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-soft">
										<span className="inline-flex items-center gap-1">
											{s.mode === "Online" ? <Video size={12} /> : <MapPin size={12} />}
											{s.mode === "Online" ? "Online" : s.venue || s.mode || "Venue TBC"}
										</span>
										{s.lecturer_name ? <span className="truncate">{s.lecturer_name}</span> : null}
									</div>
								</div>
								{safeUrl(s.meeting_link) && !past ? (
									<a href={safeUrl(s.meeting_link)} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm self-center">
										Join
									</a>
								) : null}
							</li>
						)
					})}
				</ul>
			) : (
				<Empty compact icon={CalendarDays} title="No classes today" subtitle="Enjoy some study time." />
			)}
		</Panel>
	)
}

function DueSoon({ query }) {
	const rows = (query.data?.upcoming_assignments || []).filter((a) => !a.submitted).slice(0, 5)
	return (
		<Panel
			title="Due soon"
			icon={ClipboardList}
			bodyClass="p-0"
			actions={
				<Link to="/student/assignments" className="link text-xs">
					All
				</Link>
			}
		>
			{query.isLoading ? (
				<PanelSkeleton />
			) : rows.length ? (
				<ul className="divide-y divide-line">
					{rows.map((a) => (
						<li key={a.name}>
							<Link to={`/student/assignments/${encodeURIComponent(a.name)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream/60">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-semibold text-ink">{a.title}</div>
									<div className="truncate text-xs text-ink-soft">{a.course_title}</div>
								</div>
								<DueBadge due={a.due_date} size="xs" />
							</Link>
						</li>
					))}
				</ul>
			) : (
				<Empty compact icon={ClipboardList} title="Nothing due" subtitle="You're all caught up." />
			)}
		</Panel>
	)
}

function ExamsPanel({ query }) {
	useTick(30000)
	const open = query.data?.open || []
	const upcoming = (query.data?.upcoming || []).slice(0, Math.max(0, 4 - open.length))
	return (
		<Panel
			title="Exams & CATs"
			icon={NotebookPen}
			bodyClass="p-0"
			actions={
				<Link to="/student/exams" className="link text-xs">
					All
				</Link>
			}
		>
			{query.isLoading ? (
				<PanelSkeleton />
			) : open.length || upcoming.length ? (
				<ul className="divide-y divide-line">
					{open.map((e) => (
						<li key={e.name}>
							<Link to={`/student/exams/${encodeURIComponent(e.name)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream/60">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-semibold text-ink">{e.title}</div>
									<div className="truncate text-xs text-ink-soft">
										{e.course_title} · {e.duration_minutes} min
									</div>
								</div>
								{e.in_progress_attempt ? (
									<Badge tone="orange" size="xs" dot>In progress</Badge>
								) : e.can_start ? (
									<span className="btn btn-primary btn-sm">Start</span>
								) : (
									<Badge tone="green" size="xs" dot>Open</Badge>
								)}
							</Link>
						</li>
					))}
					{upcoming.map((e) => (
						<li key={e.name}>
							<Link to={`/student/exams/${encodeURIComponent(e.name)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream/60">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-semibold text-ink">{e.title}</div>
									<div className="truncate text-xs text-ink-soft">
										{e.course_title} · {date(e.start_datetime, { weekday: "short", day: "numeric", month: "short" })}
									</div>
								</div>
								<Badge tone="blue" size="xs">
									<Clock size={11} /> in {humanSpan(msUntil(e.start_datetime))}
								</Badge>
							</Link>
						</li>
					))}
				</ul>
			) : (
				<Empty compact icon={NotebookPen} title="No exams scheduled" subtitle="Upcoming CATs and exams appear here." />
			)}
		</Panel>
	)
}


/** Shorter copy for half-width stat cards on phones. */
function Narrow({ sm, lg }) {
	return (
		<>
			<span className="sm:hidden">{sm}</span>
			<span className="hidden sm:inline">{lg}</span>
		</>
	)
}
