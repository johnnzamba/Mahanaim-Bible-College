import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import clsx from "clsx"
import { Bell, CheckCheck, Megaphone, Wallet, GraduationCap, CalendarClock, Info, AlertTriangle } from "lucide-react"
import { frappe } from "../api/frappe"
import { onRealtime } from "../api/realtime"
import { ago } from "../utils/format"
import { toast } from "./toast"

const CAT_ICON = {
	Finance: Wallet,
	Academic: GraduationCap,
	Academics: GraduationCap,
	Admissions: GraduationCap,
	Announcement: Megaphone,
	Reminder: CalendarClock,
	Alert: AlertTriangle,
	Info,
}

const KEY = ["mahanaim.api.communication.my_notifications"]

/**
 * Bell + dropdown over Portal Notification. Polls every 60s and refreshes instantly on the
 * `mbc_notification` realtime event pushed by services/communication.push_portal_notification.
 */
export function NotificationBell({ className, tone = "chrome" }) {
	const [open, setOpen] = useState(false)
	const ref = useRef(null)
	const qc = useQueryClient()
	const navigate = useNavigate()

	const q = useQuery({
		queryKey: KEY,
		queryFn: () => frappe.call("mahanaim.api.communication.my_notifications", { limit: 30 }),
		refetchInterval: 60_000,
		retry: false,
	})

	useEffect(
		() =>
			onRealtime("mbc_notification", (payload) => {
				qc.invalidateQueries({ queryKey: KEY })
				if (payload?.title) toast.info(payload.message ? String(payload.message).replace(/<[^>]+>/g, "").slice(0, 160) : "", { title: payload.title })
			}),
		[qc]
	)

	useEffect(() => {
		if (!open) return undefined
		const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
		document.addEventListener("mousedown", onDoc)
		return () => document.removeEventListener("mousedown", onDoc)
	}, [open])

	const unread = q.data?.unread || 0
	const items = q.data?.items || []

	const markAll = async () => {
		try {
			await frappe.call("mahanaim.api.communication.mark_notifications_read", { all: 1 })
			qc.invalidateQueries({ queryKey: KEY })
		} catch (e) {
			toast.error(e.message)
		}
	}

	const openItem = async (n) => {
		setOpen(false)
		if (!n.is_read) {
			frappe.call("mahanaim.api.communication.mark_notifications_read", { names: [n.name] }).then(() => qc.invalidateQueries({ queryKey: KEY })).catch(() => {})
		}
		if (n.link) {
			if (/^https?:/.test(n.link)) window.open(n.link, "_blank", "noopener")
			else navigate(n.link)
		}
	}

	return (
		<div className={clsx("relative", className)} ref={ref}>
			<button
				type="button"
				aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
				onClick={() => setOpen((v) => !v)}
				className={clsx(
					"relative grid h-9 w-9 place-items-center rounded-xl transition",
					tone === "light" ? "text-white/85 hover:bg-white/10" : "text-ink-muted hover:bg-brand-50 hover:text-ink"
				)}
			>
				<Bell size={18} />
				{unread ? (
					<span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-brand-900 ring-2 ring-surface">
						{unread > 99 ? "99+" : unread}
					</span>
				) : null}
			</button>
			{open ? (
				<div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
					<div className="flex items-center justify-between border-b border-line px-4 py-3">
						<div className="font-semibold text-ink">Notifications</div>
						{unread ? (
							<button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
								<CheckCheck size={14} /> Mark all read
							</button>
						) : null}
					</div>
					<ul className="scroll-thin max-h-[60vh] divide-y divide-line overflow-y-auto">
						{items.length === 0 ? (
							<li className="px-4 py-10 text-center text-sm text-ink-soft">{q.isError ? "Notifications are unavailable right now." : "You're all caught up."}</li>
						) : (
							items.map((n) => {
								const Icon = CAT_ICON[n.category] || Info
								return (
									<li key={n.name}>
										<button type="button" onClick={() => openItem(n)} className={clsx("flex w-full gap-3 px-4 py-3 text-left hover:bg-cream/60", !n.is_read && "bg-gold-50/50")}>
											<span className={clsx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", n.is_read ? "bg-line/60 text-ink-soft" : "bg-brand-50 text-brand-700")}>
												<Icon size={15} />
											</span>
											<span className="min-w-0 flex-1">
												<span className={clsx("block truncate text-sm", n.is_read ? "text-ink-muted" : "font-semibold text-ink")}>{n.title}</span>
												{n.message ? <span className="line-clamp-2 block text-xs text-ink-soft">{String(n.message).replace(/<[^>]+>/g, "")}</span> : null}
												<span className="mt-0.5 block text-[11px] text-ink-soft">{ago(n.creation)}</span>
											</span>
											{!n.is_read ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gold-500" /> : null}
										</button>
									</li>
								)
							})
						)}
					</ul>
				</div>
			) : null}
		</div>
	)
}
