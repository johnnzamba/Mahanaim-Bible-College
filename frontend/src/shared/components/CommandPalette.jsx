import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import clsx from "clsx"
import { ArrowRight, CornerDownLeft, FileText, GraduationCap, Hash, Search, User, Wallet, BookOpen, Handshake, Users } from "lucide-react"
import { frappe } from "../api/frappe"
import { useDebounced } from "./kit"

const TYPE_ICON = {
	Student: GraduationCap,
	Application: FileText,
	Invoice: Wallet,
	Payment: Wallet,
	Course: BookOpen,
	Sponsor: Handshake,
	Staff: Users,
	User,
}

/** Rank nav screens: prefix of label > word-start > substring; section name counts a little. */
export function rankScreens(items, q) {
	const s = q.trim().toLowerCase()
	if (!s) return items.slice(0, 8)
	return items
		.map((it) => {
			const l = it.label.toLowerCase()
			const sec = (it.section || "").toLowerCase()
			let score = 0
			if (l.startsWith(s)) score = 100
			else if (l.split(/\s+/).some((w) => w.startsWith(s))) score = 70
			else if (l.includes(s)) score = 50
			else if (sec.includes(s)) score = 20
			else if ((it.keywords || "").toLowerCase().includes(s)) score = 15
			return { it, score }
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 8)
		.map((x) => x.it)
}

/**
 * ⌘K / Ctrl+K palette: jump to any screen in the current portal, plus (admin) live records
 * from mahanaim.api.dashboard.global_search.
 */
export function CommandPalette({ items, placeholder = "Search…", serverSearch = false, trigger = "bar" }) {
	const [open, setOpen] = useState(false)
	const [q, setQ] = useState("")
	const [idx, setIdx] = useState(0)
	const inputRef = useRef(null)
	const navigate = useNavigate()
	const dq = useDebounced(q, 250)

	useEffect(() => {
		const onKey = (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault()
				setOpen((v) => !v)
			} else if (e.key === "/" && !open && !/input|textarea|select/i.test(document.activeElement?.tagName || "") && !document.activeElement?.isContentEditable) {
				e.preventDefault()
				setOpen(true)
			}
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [open])

	useEffect(() => {
		if (open) {
			setQ("")
			setIdx(0)
			setTimeout(() => inputRef.current?.focus(), 10)
		}
	}, [open])

	const records = useQuery({
		queryKey: ["mahanaim.api.dashboard.global_search", dq],
		queryFn: () => frappe.call("mahanaim.api.dashboard.global_search", { q: dq, limit: 8 }),
		enabled: open && serverSearch && dq.trim().length >= 2,
		staleTime: 15_000,
		retry: false,
	})

	const screens = useMemo(() => rankScreens(items, q), [items, q])
	const results = useMemo(() => {
		const rs = (records.data || []).map((r) => ({ kind: "record", ...r, to: r.route }))
		const ss = screens.map((s) => ({ kind: "screen", ...s }))
		return q.trim() ? [...ss, ...rs] : ss
	}, [screens, records.data, q])

	useEffect(() => setIdx(0), [q, records.data])

	const go = (r) => {
		if (!r?.to) return
		setOpen(false)
		navigate(r.to)
	}

	const onKeyDown = (e) => {
		if (e.key === "ArrowDown") {
			e.preventDefault()
			setIdx((i) => Math.min(results.length - 1, i + 1))
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setIdx((i) => Math.max(0, i - 1))
		} else if (e.key === "Enter") {
			e.preventDefault()
			go(results[idx])
		} else if (e.key === "Escape") setOpen(false)
	}

	return (
		<>
			{trigger === "bar" ? (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="hidden h-9 w-full max-w-md items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 text-left text-sm text-ink-soft transition hover:border-brand-300 md:flex"
				>
					<Search size={16} />
					<span className="flex-1 truncate">{placeholder}</span>
					<kbd className="rounded-md border border-line bg-cream px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">Ctrl K</kbd>
				</button>
			) : null}
			<button
				type="button"
				aria-label="Search"
				onClick={() => setOpen(true)}
				className="grid h-9 w-9 place-items-center rounded-xl text-ink-muted hover:bg-brand-50 hover:text-ink md:hidden"
			>
				<Search size={18} />
			</button>
			{open
				? createPortal(
						<div className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[10vh]" role="dialog" aria-modal="true">
							<button type="button" aria-label="Close" className="absolute inset-0 bg-brand-900/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
							<div className="relative w-full max-w-xl animate-fade-up overflow-hidden rounded-2xl border border-line bg-surface shadow-lift">
								<div className="flex items-center gap-3 border-b border-line px-4">
									<Search size={18} className="text-ink-soft" />
									<input
										ref={inputRef}
										value={q}
										onChange={(e) => setQ(e.target.value)}
										onKeyDown={onKeyDown}
										placeholder={placeholder}
										className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft"
									/>
									<kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">Esc</kbd>
								</div>
								<ul className="scroll-thin max-h-[55vh] overflow-y-auto p-2">
									{results.length === 0 ? (
										<li className="px-3 py-10 text-center text-sm text-ink-soft">
											{records.isFetching ? "Searching…" : q ? `No matches for “${q}”` : "Type to search"}
										</li>
									) : (
										results.map((r, i) => {
											const Icon = r.kind === "screen" ? r.icon || Hash : TYPE_ICON[r.type] || FileText
											return (
												<li key={`${r.kind}-${r.to}-${i}`}>
													<button
														type="button"
														onMouseEnter={() => setIdx(i)}
														onClick={() => go(r)}
														className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === idx ? "bg-brand-50" : "hover:bg-cream")}
													>
														<span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", r.kind === "screen" ? "bg-cream text-gold-700" : "bg-brand-50 text-brand-700")}>
															<Icon size={15} />
														</span>
														<span className="min-w-0 flex-1">
															<span className="block truncate text-sm font-semibold text-ink">{r.kind === "screen" ? r.label : r.title}</span>
															<span className="block truncate text-xs text-ink-soft">{r.kind === "screen" ? r.section : [r.type, r.subtitle].filter(Boolean).join(" · ")}</span>
														</span>
														{i === idx ? <CornerDownLeft size={14} className="text-ink-soft" /> : <ArrowRight size={14} className="text-ink-soft opacity-0" />}
													</button>
												</li>
											)
										})
									)}
								</ul>
							</div>
						</div>,
						document.body
					)
				: null}
		</>
	)
}
