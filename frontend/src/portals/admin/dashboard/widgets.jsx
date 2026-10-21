import { Link } from "react-router-dom"
import {
	Activity,
	Banknote,
	BookOpen,
	Building2,
	CalendarDays,
	ClipboardCheck,
	ClipboardList,
	FileSpreadsheet,
	GraduationCap,
	HandCoins,
	HandHeart,
	Inbox,
	Library,
	Mail,
	Megaphone,
	MessageSquareWarning,
	Music,
	Presentation,
	ReceiptText,
	RefreshCw,
	Scale,
	Send,
	Smartphone,
	UserCog,
	UserPlus,
	Users,
	Wallet,
} from "lucide-react"
import { canAccess, isSuper } from "@/shared/access"
import { money, num, pct } from "@/shared/utils/format"

export const M = "mahanaim.api.dashboard."

/** "/admin/finance/mpesa" → can this user open it? Unknown or empty routes are treated as not linkable. */
export function linkable(roles, route) {
	if (!route || !String(route).startsWith("/admin")) return false
	const rel = String(route).replace(/^\/admin/, "").split(/[?#]/)[0] || "/"
	return canAccess(roles, rel)
}

export const monthLabel = (m) => {
	if (!m) return ""
	const d = new Date(`${String(m).slice(0, 7)}-01T00:00:00`)
	return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
}

export function fmtValue(value, format) {
	if (value == null) return "—"
	if (format === "currency") return money(value, { compact: true })
	if (format === "percent") return pct(value)
	return num(value)
}

/** Icon, tone and a one-line hint for each server KPI key (unknown keys fall back to a neutral card). */
export function kpiMeta(key, d) {
	const a = d.admissions || {}
	const s = d.students || {}
	const st = d.staff || {}
	const f = d.finance || {}
	const ac = d.academics || {}
	const c = d.communications || {}
	const l = d.library || {}
	const ch = d.church || {}
	const map = {
		applications: { icon: ClipboardList, tone: "brand", hint: a.intake ? `${a.intake} intake` : null },
		new_applications_7d: { icon: UserPlus, tone: "blue", hint: a.submitted_7d != null ? `${num(a.submitted_7d)} submitted this week` : null },
		active_students: { icon: GraduationCap, tone: "brand", hint: s.by_status?.Admitted ? `${num(s.by_status.Admitted)} newly admitted` : "Currently enrolled" },
		staff: { icon: UserCog, tone: "gray", hint: st.on_leave ? `${num(st.on_leave)} on leave` : "None on leave" },
		lecturers: { icon: Presentation, tone: "purple", hint: st.by_type?.Academic ? `${num(st.by_type.Academic)} academic staff` : null },
		billed: { icon: ReceiptText, tone: "blue", hint: f.term || null },
		collected: { icon: Wallet, tone: "green", hint: f.collection_rate != null ? `${pct(f.collection_rate, 1)} of billed` : null },
		outstanding: { icon: Scale, tone: "orange", hint: f.overdue_invoices ? `${num(f.overdue_invoices)} overdue invoices` : "Nothing overdue" },
		collections_today: { icon: Banknote, tone: "green", hint: f.collections_month != null ? `${money(f.collections_month, { compact: true })} this month` : null },
		unmatched_mpesa: { icon: Smartphone, tone: f.unmatched_mpesa ? "red" : "gray", hint: f.unmatched_mpesa ? "Needs reconciliation" : "All matched" },
		exams_this_week: { icon: ClipboardCheck, tone: "purple", hint: ac.exams_open_now ? `${num(ac.exams_open_now)} open now` : null },
		mark_sheets_pending: { icon: FileSpreadsheet, tone: ac.mark_sheets_pending_approval ? "orange" : "gray", hint: ac.offerings_this_term ? `${num(ac.offerings_this_term)} offerings this term` : null },
		lms_health: {
			icon: RefreshCw,
			tone: (ac.lms_sync?.health_pct ?? 0) >= 90 ? "green" : (ac.lms_sync?.health_pct ?? 0) >= 50 ? "orange" : "red",
			hint: ac.lms_sync ? `${num(ac.lms_sync.synced)} synced · ${num(ac.lms_sync.not_synced)} pending` : null,
		},
		unread_enquiries: { icon: Mail, tone: c.unread_enquiries ? "blue" : "gray", hint: c.open_enquiries != null ? `${num(c.open_enquiries)} open in total` : null },
		overdue_loans: { icon: Library, tone: l.overdue ? "red" : "gray", hint: l.on_loan != null ? `${num(l.on_loan)} items on loan` : null },
		active_sponsorships: { icon: HandHeart, tone: "gold", hint: ch.sponsored_students != null ? `${num(ch.sponsored_students)} students supported` : null },
	}
	return map[key] || { icon: Activity, tone: "brand" }
}

/**
 * Extra cards for roles whose server KPI list is short (Chaplain, Library, Communications), so their
 * dashboard still opens with a full row. Only numbers from sections the caller can already see.
 */
export function extraStats(d) {
	const out = []
	const ch = d.church
	const l = d.library
	const c = d.communications
	const s = d.students
	const f = d.finance
	if (f) {
		out.push({ key: "collection_rate", label: "Collection rate", value: pct(f.collection_rate, 1), icon: Activity, tone: f.collection_rate >= 75 ? "green" : f.collection_rate >= 50 ? "orange" : "red", route: "/admin/finance", hint: f.term ? `Billed vs collected, ${f.term}` : "Billed vs collected" })
		out.push({ key: "overdue_invoices", label: "Overdue invoices", value: num(f.overdue_invoices), icon: ReceiptText, tone: f.overdue_invoices ? "orange" : "gray", route: "/admin/finance/defaulters", hint: "Past their due date" })
		out.push({ key: "collections_month", label: "Collected this month", value: money(f.collections_month, { compact: true }), icon: Banknote, tone: "green", route: "/admin/finance/payments" })
	}
	if (ch) {
		out.push({ key: "partner_churches", label: "Partner churches", value: num(ch.partner_churches), icon: Building2, tone: "brand", route: "/admin/church/churches", hint: "Churches walking with the college" })
		out.push({ key: "sponsored_students", label: "Sponsored students", value: num(ch.sponsored_students), icon: Users, tone: "purple", route: "/admin/church/sponsorships", hint: `${num(ch.active_sponsorships)} active sponsorships` })
		out.push({ key: "giving_this_month", label: "Giving this month", value: money(ch.giving_this_month, { compact: true }), icon: HandCoins, tone: "green", route: "/admin/church/giving", hint: "Recorded church giving" })
	}
	if (l) {
		out.push({ key: "library_items", label: "Catalogue items", value: num(l.items), icon: BookOpen, tone: "brand", route: "/admin/library", hint: "In the library catalogue" })
		out.push({ key: "on_loan", label: "On loan", value: num(l.on_loan), icon: Library, tone: "blue", route: "/admin/library", hint: "Currently borrowed" })
		out.push({ key: "library_requests", label: "Reservations", value: num(l.requests), icon: Inbox, tone: l.requests ? "orange" : "gray", route: "/admin/library", hint: "Waiting to be served" })
	}
	if (c) {
		out.push({ key: "messages_sent", label: "Messages sent (7 days)", value: num(c.messages_7d?.Sent), icon: Send, tone: "green", route: "/admin/communication", hint: c.messages_7d?.Queued ? `${num(c.messages_7d.Queued)} queued` : "Outbox clear" })
		out.push({ key: "upcoming_events", label: "Upcoming events", value: num(c.upcoming_events), icon: CalendarDays, tone: "purple", route: "/admin/website", hint: c.scheduled_announcements ? `${num(c.scheduled_announcements)} announcements scheduled` : "No announcements scheduled" })
		out.push({ key: "open_enquiries", label: "Open enquiries", value: num(c.open_enquiries), icon: Mail, tone: "brand", route: "/admin/website/enquiries" })
	}
	if (s) {
		out.push({ key: "programmes", label: "Programmes with students", value: num((s.by_programme || []).length), icon: GraduationCap, tone: "brand", route: "/admin/students" })
	}
	return out
}

/**
 * "Needs your attention": every open count the caller's sections expose, in priority order, each
 * linking to the screen that resolves it. Items the user cannot open are kept but not linked.
 */
export function attentionItems(d, roles) {
	const items = []
	const add = (cond, it) => cond && items.push(it)
	const a = d.admissions
	const f = d.finance
	const ac = d.academics
	const c = d.communications
	const l = d.library
	const st = d.staff
	if (a) {
		add(a.awaiting_review > 0, { key: "review", tone: "orange", icon: ClipboardList, count: a.awaiting_review, title: "Applications awaiting review", sub: a.intake ? `${a.intake} intake` : "Submitted and waiting for a decision", to: "/admin/admissions" })
	}
	if (f) {
		add(f.unmatched_mpesa > 0, { key: "mpesa", tone: "red", icon: Smartphone, count: f.unmatched_mpesa, title: "Unmatched M-Pesa payments", sub: "Match each to a student so it reaches their account", to: "/admin/finance/mpesa?tab=unmatched" })
		add(f.overdue_invoices > 0, { key: "overdue", tone: "orange", icon: ReceiptText, count: f.overdue_invoices, title: "Overdue invoices", sub: `${money(f.outstanding_total, { compact: true })} outstanding in total`, to: "/admin/finance/defaulters" })
	}
	if (ac) {
		add(ac.mark_sheets_pending_approval > 0, { key: "marks", tone: "orange", icon: FileSpreadsheet, count: ac.mark_sheets_pending_approval, title: "Mark sheets awaiting approval", sub: "Results can be published once approved", to: "/admin/academics/results" })
		add(ac.pending_requests > 0, { key: "requests", tone: "blue", icon: Inbox, count: ac.pending_requests, title: "Student requests pending", sub: "Transcripts, deferments and other requests", to: "/admin/students/requests" })
		add(ac.lms_sync?.error > 0, { key: "lms_err", tone: "red", icon: RefreshCw, count: ac.lms_sync.error, title: "LMS sync errors", sub: "Offerings that failed to reach the LMS", to: isSuper(roles) ? "/admin/settings/integrations?tab=lms" : "/admin/academics/offerings" })
		add(ac.lms_sync?.not_synced > 0, { key: "lms_wait", tone: "gray", icon: RefreshCw, count: ac.lms_sync.not_synced, title: "Offerings not yet on the LMS", sub: "Run a sync so lecturers and students see their classes", to: isSuper(roles) ? "/admin/settings/integrations?tab=lms" : "/admin/academics/offerings" })
		add(ac.exams_open_now > 0, { key: "exams", tone: "purple", icon: ClipboardCheck, count: ac.exams_open_now, title: "Exams open right now", sub: "Students are sitting these at the moment", to: "/admin/academics/exams" })
	}
	if (c) {
		add(c.unread_enquiries > 0, { key: "enq", tone: "blue", icon: Mail, count: c.unread_enquiries, title: "Unread website enquiries", sub: "Prospective students waiting for a reply", to: "/admin/website/enquiries" })
		add(c.failed_sms_7d > 0, { key: "sms", tone: "red", icon: MessageSquareWarning, count: c.failed_sms_7d, title: "SMS failed this week", sub: "Check numbers and the SMS gateway", to: "/admin/communication" })
		add(c.messages_7d?.Queued > 0, { key: "queued", tone: "gray", icon: Megaphone, count: c.messages_7d.Queued, title: "Messages queued to send", sub: "Waiting in the outbox", to: "/admin/communication" })
	}
	if (l) {
		add(l.overdue > 0, { key: "loans", tone: "red", icon: Library, count: l.overdue, title: "Overdue library loans", sub: "Remind borrowers to return items", to: "/admin/library" })
		add(l.requests > 0, { key: "reserve", tone: "blue", icon: BookOpen, count: l.requests, title: "Library reservations", sub: "Items requested by readers", to: "/admin/library" })
	}
	if (st) {
		add(st.on_leave > 0, { key: "leave", tone: "gray", icon: UserCog, count: st.on_leave, title: "Staff on leave", sub: "Plan cover for their classes and duties", to: "/admin/staff" })
	}
	const rank = { red: 0, orange: 1, blue: 2, purple: 3, gray: 4 }
	return items
		.map((it) => ({ ...it, link: linkable(roles, it.to) }))
		.sort((x, y) => (rank[x.tone] ?? 9) - (rank[y.tone] ?? 9))
}

/** Shortcut tiles, filtered by what the user can open. */
export const SHORTCUTS = [
	{ to: "/admin/admissions", label: "Admissions", sub: "Applications & intake", icon: ClipboardList, tone: "brand" },
	{ to: "/admin/students", label: "Students", sub: "Records & requests", icon: GraduationCap, tone: "brand" },
	{ to: "/admin/academics", label: "Academics", sub: "Offerings, exams, results", icon: BookOpen, tone: "purple" },
	{ to: "/admin/finance/payments?new=1", label: "Record payment", sub: "Cash, bank or cheque", icon: Banknote, tone: "green", roles: ["Finance Officer"] },
	{ to: "/admin/finance", label: "Finance", sub: "Billing & collections", icon: Wallet, tone: "green" },
	{ to: "/admin/church/sponsors", label: "Sponsors", sub: "Sponsorships & donors", icon: HandHeart, tone: "gold" },
	{ to: "/admin/church/chapel", label: "Chapel", sub: "Services & attendance", icon: Music, tone: "purple" },
	{ to: "/admin/church/churches", label: "Partner churches", sub: "Denominations & parishes", icon: Building2, tone: "brand" },
	{ to: "/admin/alumni", label: "Alumni", sub: "Graduates & ministry", icon: Users, tone: "blue" },
	{ to: "/admin/communication", label: "Communication", sub: "SMS, email, announcements", icon: Megaphone, tone: "blue" },
	{ to: "/admin/library", label: "Library", sub: "Catalogue & loans", icon: Library, tone: "brand" },
	{ to: "/admin/staff", label: "Staff", sub: "Directory & leave", icon: UserCog, tone: "gray" },
	{ to: "/admin/reports", label: "Reports", sub: "Run & export", icon: FileSpreadsheet, tone: "brand" },
	{ to: "/admin/audit", label: "Audit trail", sub: "Changes & sign-ins", icon: ClipboardCheck, tone: "gray" },
]

export function AttentionRow({ item }) {
	const Icon = item.icon
	const body = (
		<div className="flex items-center gap-3 px-5 py-3">
			<span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${TONE_SOFT[item.tone] || TONE_SOFT.gray}`}>
				<Icon size={17} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-semibold text-ink">{item.title}</div>
				<div className="truncate text-xs text-ink-soft">{item.sub}</div>
			</div>
			<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${TONE_SOFT[item.tone] || TONE_SOFT.gray}`}>{num(item.count)}</span>
		</div>
	)
	return item.link ? (
		<Link to={item.to} className="block transition hover:bg-cream">
			{body}
		</Link>
	) : (
		body
	)
}

const TONE_SOFT = {
	red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
	orange: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
	blue: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
	purple: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
	gray: "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300",
}
