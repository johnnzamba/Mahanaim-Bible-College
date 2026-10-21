import { useEffect, useState } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import clsx from "clsx"
import { ArrowRight, ChevronDown, Facebook, Instagram, Mail, MapPin, Menu, Phone, X, Youtube, LayoutDashboard } from "lucide-react"
import { frappe } from "../api/frappe"
import { BRAND, PORTALS } from "../brand"
import { useSession, portalHome } from "../session"

/** Default nav; overridden by Website Settings (mahanaim.api.website.site_settings → nav) when set. */
export const PUBLIC_NAV = [
	{
		label: "About",
		to: "/about",
		children: [
			{ to: "/about", label: "Our story", desc: "History, vision, mission and statement of faith" },
			{ to: "/faculty", label: "Faculty & leadership", desc: "Meet the people who teach and shepherd" },
			{ to: "/about#campuses", label: "Campuses", desc: "Where we study and gather" },
		],
	},
	{
		label: "Academics",
		to: "/academics",
		children: [
			{ to: "/programmes", label: "Programmes", desc: "Certificate, diploma and degree pathways" },
			{ to: "/academics", label: "Academic life", desc: "Calendar, study modes and assessment" },
			{ to: "/e-library", label: "E-Library", desc: "Books, journals and sermon archives" },
		],
	},
	{
		label: "Admissions",
		to: "/admissions",
		children: [
			{ to: "/admissions", label: "How to apply", desc: "Requirements, intakes and deadlines" },
			{ to: "/fees", label: "Fees & funding", desc: "Fee structures, sponsorship and M-Pesa" },
			{ to: "/apply", label: "Apply online", desc: "Start or continue your application" },
		],
	},
	{ label: "News", to: "/news" },
	{ label: "Events", to: "/events" },
	{ label: "Contact", to: "/contact" },
]

export function useSiteSettings() {
	return useQuery({
		queryKey: ["mahanaim.api.website.site_settings"],
		queryFn: () => frappe.get("mahanaim.api.website.site_settings"),
		staleTime: 5 * 60_000,
		retry: false,
		initialData: window.mahanaim_boot?.site || undefined,
	})
}

export function PublicLayout({ children, transparentHeader = false }) {
	const site = useSiteSettings().data || {}
	const loc = useLocation()
	const [scrolled, setScrolled] = useState(false)
	const [mobile, setMobile] = useState(false)
	const session = useSession()
	const nav = site.nav?.length ? site.nav : PUBLIC_NAV

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 24)
		onScroll()
		window.addEventListener("scroll", onScroll, { passive: true })
		return () => window.removeEventListener("scroll", onScroll)
	}, [])
	useEffect(() => {
		setMobile(false)
		if (!loc.hash) window.scrollTo({ top: 0 })
		else setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: "smooth" }), 60)
	}, [loc.pathname, loc.hash])

	const solid = !transparentHeader || scrolled || mobile
	const bar = site.announcement_bar

	return (
		<div className="flex min-h-screen flex-col bg-canvas">
			{bar?.text ? (
				<div className="bg-gold-500 px-4 py-2 text-center text-[13px] font-semibold text-brand-900">
					{bar.link ? (
						<Link to={bar.link} className="inline-flex items-center gap-1.5 hover:underline">
							{bar.text} <ArrowRight size={14} />
						</Link>
					) : (
						bar.text
					)}
				</div>
			) : null}
			<header
				className={clsx(
					"no-print sticky top-0 z-40 transition-colors duration-300",
					solid ? "border-b border-line bg-surface/95 shadow-sm backdrop-blur" : "bg-transparent",
					transparentHeader && !solid && "-mb-[76px]"
				)}
			>
				<div className="mx-auto flex h-[76px] max-w-7xl items-center gap-6 px-4 lg:px-8">
					<Link to="/" className="flex min-w-0 items-center gap-3">
						<img src={BRAND.logo} alt="" className="h-11 w-11 shrink-0" width={44} height={44} />
						<span className="min-w-0">
							<span className={clsx("block truncate font-serif text-[17px] leading-tight", solid ? "text-brand-800 dark:text-ink" : "text-white")}>
								{BRAND.full}
							</span>
							<span className={clsx("hidden truncate text-[10.5px] font-semibold uppercase tracking-[0.18em] sm:block", solid ? "text-gold-600" : "text-gold-300")}>
								{BRAND.motto}
							</span>
						</span>
					</Link>

					<nav className="ml-auto hidden items-center gap-1 lg:flex">
						{nav.map((item) => (
							<DesktopNavItem key={item.label} item={item} solid={solid} />
						))}
					</nav>

					<div className="ml-auto flex items-center gap-2 lg:ml-2">
						{session.isGuest ? (
							<>
								<Link
									to="/signin"
									className={clsx("hidden rounded-xl px-3 py-2 text-sm font-semibold sm:inline-block", solid ? "text-ink hover:bg-brand-50" : "text-white hover:bg-white/10")}
								>
									Sign in
								</Link>
								<Link to="/apply" className="btn btn-gold hidden sm:inline-flex">
									Apply now
								</Link>
							</>
						) : (
							<Link to={portalHome(session)} className="btn btn-gold hidden sm:inline-flex">
								<LayoutDashboard size={16} /> My portal
							</Link>
						)}
						<button
							type="button"
							onClick={() => setMobile((v) => !v)}
							className={clsx("grid h-10 w-10 place-items-center rounded-xl lg:hidden", solid ? "text-ink hover:bg-brand-50" : "text-white hover:bg-white/10")}
							aria-label="Menu"
						>
							{mobile ? <X size={22} /> : <Menu size={22} />}
						</button>
					</div>
				</div>

				{mobile ? (
					<div className="scroll-thin max-h-[calc(100vh-76px)] overflow-y-auto border-t border-line bg-surface px-4 pb-6 pt-2 lg:hidden">
						{nav.map((item) => (
							<div key={item.label} className="border-b border-line/70 py-2">
								<NavLink to={item.to} className="block py-2 text-[15px] font-semibold text-ink">
									{item.label}
								</NavLink>
								{item.children ? (
									<div className="grid gap-1 pb-1 pl-3">
										{item.children.map((c) => (
											<Link key={c.to + c.label} to={c.to} className="py-1.5 text-sm text-ink-muted">
												{c.label}
											</Link>
										))}
									</div>
								) : null}
							</div>
						))}
						<div className="mt-4 grid grid-cols-2 gap-2">
							{session.isGuest ? (
								<>
									<Link to="/signin" className="btn btn-secondary">
										Sign in
									</Link>
									<Link to="/apply" className="btn btn-gold">
										Apply now
									</Link>
								</>
							) : (
								<Link to={portalHome(session)} className="btn btn-gold col-span-2">
									Open my portal
								</Link>
							)}
						</div>
					</div>
				) : null}
			</header>

			<main className="flex-1">{children}</main>

			<PublicFooter site={site} />
		</div>
	)
}

function DesktopNavItem({ item, solid }) {
	const [open, setOpen] = useState(false)
	const loc = useLocation()
	useEffect(() => setOpen(false), [loc.pathname])
	const base = clsx(
		"inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[14px] font-semibold transition",
		solid ? "text-ink-muted hover:bg-brand-50 hover:text-ink" : "text-white/90 hover:bg-white/10 hover:text-white"
	)
	if (!item.children?.length) {
		return (
			<NavLink to={item.to} className={({ isActive }) => clsx(base, isActive && (solid ? "text-brand-800" : "text-white"))}>
				{item.label}
			</NavLink>
		)
	}
	return (
		<div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
			<Link to={item.to} className={base} onFocus={() => setOpen(true)}>
				{item.label}
				<ChevronDown size={14} className={clsx("transition", open && "rotate-180")} />
			</Link>
			{open ? (
				<div className="absolute left-1/2 top-full z-50 w-80 -translate-x-1/2 pt-2">
					<div className="animate-fade-up rounded-2xl border border-line bg-surface p-2 shadow-lift">
						{item.children.map((c) => (
							<Link key={c.to + c.label} to={c.to} className="block rounded-xl px-3 py-2.5 hover:bg-cream">
								<span className="block text-sm font-semibold text-ink">{c.label}</span>
								{c.desc ? <span className="block text-xs text-ink-soft">{c.desc}</span> : null}
							</Link>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}

function PublicFooter({ site }) {
	const c = site.contact || {}
	const s = site.social || {}
	const socials = [
		[s.facebook, Facebook, "Facebook"],
		[s.youtube, Youtube, "YouTube"],
		[s.instagram, Instagram, "Instagram"],
	].filter(([u]) => u)
	const cols = site.footer_links?.length
		? site.footer_links
		: [
				{
					title: "Study",
					links: [
						{ label: "Programmes", to: "/programmes" },
						{ label: "Admissions", to: "/admissions" },
						{ label: "Fees & funding", to: "/fees" },
						{ label: "Apply online", to: "/apply" },
					],
				},
				{
					title: "College",
					links: [
						{ label: "About us", to: "/about" },
						{ label: "Faculty", to: "/faculty" },
						{ label: "News", to: "/news" },
						{ label: "Events", to: "/events" },
					],
				},
				{
					title: "Services",
					links: [
						{ label: "E-Library", to: "/e-library" },
						{ label: "Verify a certificate", to: "/verify" },
						{ label: "Give / Partner", to: "/give" },
						{ label: "FAQ", to: "/faq" },
					],
				},
			]

	return (
		<footer className="no-print hero-wash text-[rgb(244,239,227)]">
			<div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-8">
				<div>
					<div className="flex items-center gap-3">
						<img src={BRAND.logo} alt="" className="h-12 w-12" />
						<div>
							<div className="font-serif text-lg text-white">{BRAND.full}</div>
							<div className="text-xs uppercase tracking-[0.18em] text-gold-300">{BRAND.motto}</div>
						</div>
					</div>
					<ul className="mt-6 space-y-2.5 text-sm text-white/75">
						{c.address ? (
							<li className="flex gap-2.5">
								<MapPin size={16} className="mt-0.5 shrink-0 text-gold-400" /> {c.address}
							</li>
						) : null}
						{c.phone ? (
							<li className="flex gap-2.5">
								<Phone size={16} className="mt-0.5 shrink-0 text-gold-400" />
								<a href={`tel:${c.phone}`} className="hover:text-white">
									{c.phone}
								</a>
							</li>
						) : null}
						{c.email ? (
							<li className="flex gap-2.5">
								<Mail size={16} className="mt-0.5 shrink-0 text-gold-400" />
								<a href={`mailto:${c.email}`} className="hover:text-white">
									{c.email}
								</a>
							</li>
						) : null}
					</ul>
					{socials.length ? (
						<div className="mt-5 flex gap-2">
							{socials.map(([u, Icon, label]) => (
								<a key={label} href={u} target="_blank" rel="noreferrer" aria-label={label} className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 hover:bg-gold-500 hover:text-brand-900">
									<Icon size={17} />
								</a>
							))}
						</div>
					) : null}
				</div>
				{cols.map((col) => (
					<div key={col.title}>
						<div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-gold-300">{col.title}</div>
						<ul className="space-y-2 text-sm">
							{col.links.map((l) => (
								<li key={l.label}>
									{/^https?:/.test(l.to) ? (
										<a href={l.to} className="text-white/75 hover:text-white">
											{l.label}
										</a>
									) : (
										<Link to={l.to} className="text-white/75 hover:text-white">
											{l.label}
										</Link>
									)}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
			<div className="border-t border-white/10">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-white/60 lg:px-8">
					<span>
						© {new Date().getFullYear()} {BRAND.full}. All rights reserved.
					</span>
					<span className="flex gap-4">
						<Link to="/privacy" className="hover:text-white">
							Privacy
						</Link>
						<Link to="/terms" className="hover:text-white">
							Terms
						</Link>
						<Link to="/signin" className="hover:text-white">
							Portal sign in
						</Link>
					</span>
				</div>
			</div>
		</footer>
	)
}

export { PORTALS }
