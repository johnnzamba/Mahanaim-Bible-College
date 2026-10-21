import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom"
import clsx from "clsx"
import { ChevronDown, ExternalLink, Globe, LogOut, Menu, MoreHorizontal, Repeat, ShieldCheck, UserCircle, X, CalendarRange } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "../api/frappe"
import { BRAND, PORTALS } from "../brand"
import { canAccess } from "../access"
import { useSession } from "../session"
import { Avatar, Loading } from "../components/ui"
import { NotificationBell } from "../components/NotificationBell"
import { ThemeSwitcher } from "../components/ThemeSwitcher"
import { CommandPalette } from "../components/CommandPalette"
import { InstallAppButton } from "../pwa"
import { ErrorBoundary } from "../components/ErrorBoundary"

/**
 * Shared chrome for every signed-in portal.
 *
 * nav:  [{ section, icon, items: [{ to, label, icon, roles?, badge?, keywords? }] }]  (absolute paths)
 * tabs: optional mobile bottom bar [{ to, label, icon }] (≤ 4; a "More" tab opens the drawer)
 *
 * Only one nav section is expanded at a time and by default it is the one holding the current
 * URL, so the rail answers "where am I" before "where else". Admin items are filtered through
 * access.canAccess; any item may also declare `roles`.
 */
export function PortalShell({ portal, nav, tabs, searchPlaceholder, serverSearch = false, profileTo, children }) {
	const session = useSession()
	const location = useLocation()
	const navigate = useNavigate()
	const qc = useQueryClient()
	const [open, setOpen] = useState(false)
	const meta = PORTALS[portal] || {}

	const allowed = useCallback(
		(i) => {
			if (i.roles && !session.hasRole(...i.roles)) return false
			if (portal === "admin") return canAccess(session.roles || [], i.to.replace(/^\/admin/, "") || "/")
			return true
		},
		[session, portal],
	)
	const visibleNav = useMemo(() => nav.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length), [nav, allowed])
	const visibleTabs = useMemo(() => (tabs ? tabs.filter(allowed) : null), [tabs, allowed])

	const allItems = useMemo(() => visibleNav.flatMap((g) => g.items.map((i) => ({ ...i, section: g.section }))), [visibleNav])
	// One highlighted item: the longest nav path that prefixes the URL, so detail pages (/admin/students/STU-1)
	// light up their parent without a sibling (/admin/students/registrations) also matching it. `end` items and the
	// portal home (/student) match exactly.
	const activeTo = useMemo(() => {
		const path = location.pathname.replace(/\/$/, "") || "/"
		let best = null
		for (const it of allItems) {
			const exact = it.end || it.to.split("/").filter(Boolean).length < 2
			const hit = path === it.to || (!exact && path.startsWith(`${it.to}/`))
			if (hit && (!best || it.to.length > best.length)) best = it.to
		}
		return best
	}, [allItems, location.pathname])

	const activeSection = useMemo(() => {
		const path = location.pathname.replace(/\/$/, "") || "/"
		let best = null
		let len = -1
		for (const g of visibleNav) {
			for (const it of g.items) {
				// Prefix match even for exact (link-highlight) items, so sub-screens without their own nav entry
				// (e.g. /admin/academics/courses) keep their section open; the longest prefix wins.
				const hit = path === it.to || path.startsWith(`${it.to}/`)
				if (hit && it.to.length > len) {
					best = g.section
					len = it.to.length
				}
			}
		}
		return best
	}, [location.pathname, visibleNav])

	const [pinned, setPinned] = useState(null)
	useEffect(() => {
		setPinned(null)
		setOpen(false)
		window.scrollTo({ top: 0 })
	}, [location.pathname])
	const openSection = pinned === null ? activeSection : pinned
	const singleSection = visibleNav.length === 1

	const logout = async () => {
		try {
			await frappe.logout()
		} catch {
			/* ignore */
		}
		qc.clear()
		window.location.href = "/signin"
	}

	const term = session.settings?.current_academic_term
	const sub =
		portal === "student"
			? session.student?.student_number
			: portal === "sponsor"
				? session.sponsor?.sponsor_name
				: session.staff?.designation || meta.tag

	return (
		<div className="min-h-screen bg-canvas">
			<aside
				className={clsx(
					"no-print fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-[var(--rail-bg)] text-[var(--rail-muted)] transition-transform duration-200",
					open ? "translate-x-0 shadow-lift" : "-translate-x-full lg:translate-x-0"
				)}
			>
				<div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--rail-line)] px-4">
					<Link to={meta.path || "/"} className="flex min-w-0 items-center gap-2.5">
						<img src={BRAND.logo} alt="" className="h-9 w-9 shrink-0" width={36} height={36} />
						<span className="min-w-0">
							<span className="line-clamp-2 block font-serif text-[14px] leading-[1.15] text-[var(--rail-ink)]">{BRAND.full}</span>
							<span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rail-soft)]">{meta.tag || BRAND.product}</span>
						</span>
					</Link>
					<button type="button" className="ml-auto text-[var(--rail-soft)] lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
						<X size={18} />
					</button>
				</div>

				<nav className="rail-scroll flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2.5">
					{visibleNav.map((g) => {
						const expanded = singleSection || openSection === g.section
						const holds = activeSection === g.section
						const SIcon = g.icon
						return (
							<div key={g.section}>
								{singleSection ? null : (
									<button
										type="button"
										onClick={() => setPinned(expanded ? "" : g.section)}
										aria-expanded={expanded}
										className={clsx(
											"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] transition-colors",
											expanded
												? "bg-[var(--rail-hover)] text-[var(--rail-ink)]"
												: holds
													? "text-[var(--rail-ink)] hover:bg-[var(--rail-hover)]"
													: "hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
										)}
									>
										{SIcon ? <SIcon size={16} className="shrink-0 opacity-80" /> : null}
										<span className="truncate text-left">{g.section}</span>
										<ChevronDown size={14} className={clsx("ml-auto shrink-0 text-[var(--rail-soft)] transition-transform", expanded && "rotate-180")} />
									</button>
								)}
								{expanded ? (
									<div className={clsx(singleSection ? "space-y-0.5" : "ml-[1.7rem] mr-1 space-y-0.5 border-l border-[var(--rail-line)] py-0.5 pl-2.5")}>
										{g.items.map((it) => (
											<Link
												key={it.to}
												to={it.to}
												aria-current={activeTo === it.to ? "page" : undefined}
												className={clsx(
													"relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
													activeTo === it.to
														? "bg-[var(--rail-active-bg)] text-[var(--rail-active-ink)] shadow-sm"
														: "hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
												)}
											>
												{it.icon ? <it.icon size={15} className="shrink-0" /> : null}
												<span className="truncate">{it.label}</span>
												{it.badge ? (
													<span className="ml-auto rounded-full bg-gold-500 px-1.5 text-[10px] font-bold text-brand-900">{it.badge}</span>
												) : null}
											</Link>
										))}
									</div>
								) : null}
							</div>
						)
					})}
				</nav>

				<div className="border-t border-[var(--rail-line)] p-3">
					{term ? (
						<div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-[var(--rail-soft)]">
							<CalendarRange size={14} />
							<span className="truncate">{term}</span>
						</div>
					) : null}
					<a href="/" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]">
						<Globe size={14} /> College website
					</a>
				</div>
			</aside>

			{open ? <button type="button" className="fixed inset-0 z-30 bg-brand-900/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu" /> : null}

			<div className={clsx("flex min-h-screen min-w-0 flex-col lg:pl-[264px] print:!pl-0", visibleTabs && "pad-for-tabbar lg:pb-0")}>
				<header
					className="no-print sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-line px-3 backdrop-blur-md lg:px-6"
					style={{ background: "var(--header-bg)" }}
				>
					<button type="button" className="grid h-9 w-9 place-items-center rounded-xl hover:bg-brand-50 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
						<Menu size={19} />
					</button>
					<Link to={meta.path || "/"} className="flex items-center gap-2 lg:hidden">
						<img src={BRAND.logo} alt="" className="h-7 w-7" />
						<span className="font-serif text-sm">{BRAND.short}</span>
					</Link>
					<div className="hidden flex-1 lg:block">
						<CommandPalette items={allItems} placeholder={searchPlaceholder || "Search screens…"} serverSearch={serverSearch} />
					</div>
					<div className="ml-auto flex items-center gap-1">
						<div className="lg:hidden">
							<CommandPalette items={allItems} placeholder={searchPlaceholder || "Search screens…"} serverSearch={serverSearch} trigger="icon" />
						</div>
						<InstallAppButton />
						<ThemeSwitcher />
						<NotificationBell />
						<span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
						<UserMenu session={session} sub={sub} portal={portal} profileTo={profileTo} onLogout={logout} navigate={navigate} />
					</div>
				</header>

				<main className="mx-auto flex w-full min-w-0 max-w-[1500px] flex-1 flex-col px-4 py-5 lg:px-8 lg:py-7">
					<ErrorBoundary resetKey={location.pathname}>
						<Suspense fallback={<Loading className="min-h-[50vh]" />}>{children}</Suspense>
					</ErrorBoundary>
				</main>

				<footer className="no-print border-t border-line px-5 py-4 text-xs text-ink-soft lg:px-8">
					<div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2">
						<span>
							© {new Date().getFullYear()} {BRAND.full}
							<span className="mx-1.5" aria-hidden="true">·</span>
							<span className="whitespace-nowrap">
								Powered by{" "}
								<a href={BRAND.vendor.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-muted hover:text-brand-700">
									{BRAND.vendor.name}
								</a>
							</span>
						</span>
						<span className="flex items-center gap-3">
							<Link to="/privacy" className="hover:text-brand-700">
								Privacy
							</Link>
							<Link to="/terms" className="hover:text-brand-700">
								Terms
							</Link>
							<Link to="/contact" className="hover:text-brand-700">
								Help
							</Link>
						</span>
					</div>
				</footer>
			</div>

			{visibleTabs ? <MobileTabBar tabs={visibleTabs} onMore={() => setOpen(true)} /> : null}
		</div>
	)
}

function UserMenu({ session, sub, portal, profileTo, onLogout, navigate }) {
	const [open, setOpen] = useState(false)
	const ref = useRef(null)
	useEffect(() => {
		if (!open) return undefined
		const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
		document.addEventListener("mousedown", onDoc)
		return () => document.removeEventListener("mousedown", onDoc)
	}, [open])
	const others = (session.portals || []).filter((p) => p !== portal)
	return (
		<div className="relative" ref={ref}>
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-brand-50" aria-label="Account menu">
				<Avatar name={session.full_name} src={session.image} size={32} />
				<span className="hidden min-w-0 text-left md:block">
					<span className="block max-w-[150px] truncate text-[13px] font-semibold leading-tight text-ink">{session.full_name}</span>
					<span className="block max-w-[150px] truncate text-[11px] text-ink-soft">{sub}</span>
				</span>
				<ChevronDown size={14} className="hidden text-ink-soft md:block" />
			</button>
			{open ? (
				<div className="absolute right-0 z-50 mt-2 w-64 animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
					<div className="border-b border-line px-4 py-3">
						<div className="truncate font-semibold text-ink">{session.full_name}</div>
						<div className="truncate text-xs text-ink-soft">{session.email}</div>
					</div>
					<div className="p-1.5">
						{profileTo ? (
							<MenuItem
								icon={UserCircle}
								onClick={() => {
									setOpen(false)
									navigate(profileTo)
								}}
							>
								My profile
							</MenuItem>
						) : null}
						{PORTALS[portal] ? (
							<MenuItem
								icon={ShieldCheck}
								onClick={() => {
									setOpen(false)
									navigate(`${PORTALS[portal].path}/account`)
								}}
							>
								Account & security
							</MenuItem>
						) : null}
						{others.map((p) => (
							<MenuItem
								key={p}
								icon={Repeat}
								onClick={() => {
									setOpen(false)
									navigate(PORTALS[p].path)
								}}
							>
								Switch to {PORTALS[p].label}
							</MenuItem>
						))}
						{session.isSuper || portal === "admin" ? (
							<MenuItem icon={ExternalLink} onClick={() => (window.location.href = "/desk")}>
								Open Desk
							</MenuItem>
						) : null}
					</div>
					<div className="border-t border-line p-1.5">
						<MenuItem icon={LogOut} onClick={onLogout} danger>
							Sign out
						</MenuItem>
					</div>
				</div>
			) : null}
		</div>
	)
}

function MenuItem({ icon: Icon, children, onClick, danger }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={clsx(
				"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium",
				danger ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950" : "text-ink-muted hover:bg-cream hover:text-ink"
			)}
		>
			<Icon size={16} /> {children}
		</button>
	)
}

function MobileTabBar({ tabs, onMore }) {
	return (
		<nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
			<div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0,1fr))` }}>
				{tabs.map((t) => (
					<NavLink
						key={t.to}
						to={t.to}
						end={t.end ?? t.to.split("/").filter(Boolean).length < 2}
						className={({ isActive }) =>
							clsx("flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold", isActive ? "text-brand-700" : "text-ink-soft")
						}
					>
						{({ isActive }) => (
							<>
								<span className={clsx("grid h-7 w-12 place-items-center rounded-full transition", isActive && "bg-brand-50")}>
									<t.icon size={19} />
								</span>
								{t.label}
							</>
						)}
					</NavLink>
				))}
				<button type="button" onClick={onMore} className="flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-semibold text-ink-soft">
					<span className="grid h-7 w-12 place-items-center">
						<MoreHorizontal size={19} />
					</span>
					More
				</button>
			</div>
		</nav>
	)
}
