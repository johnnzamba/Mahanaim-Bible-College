import { useEffect, useRef, useState } from "react"
import clsx from "clsx"
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react"
import { RAILS, SCHEMES, getRail, getScheme, setRail, setScheme } from "../theme"

const SCHEME_ICON = { light: Sun, dark: Moon, system: Monitor }

export function ThemeSwitcher({ className }) {
	const [open, setOpen] = useState(false)
	const [scheme, setS] = useState(getScheme())
	const [rail, setR] = useState(getRail())
	const ref = useRef(null)

	useEffect(() => {
		if (!open) return undefined
		const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
		document.addEventListener("mousedown", onDoc)
		return () => document.removeEventListener("mousedown", onDoc)
	}, [open])

	return (
		<div className={clsx("relative", className)} ref={ref}>
			<button
				type="button"
				aria-label="Appearance"
				title="Appearance"
				onClick={() => setOpen((v) => !v)}
				className="grid h-9 w-9 place-items-center rounded-xl text-ink-muted transition hover:bg-brand-50 hover:text-ink"
			>
				<Palette size={18} />
			</button>
			{open ? (
				<div className="absolute right-0 z-50 mt-2 w-64 animate-fade-up rounded-2xl border border-line bg-surface p-3 shadow-lift">
					<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Mode</div>
					<div className="mb-3 grid grid-cols-3 gap-1.5">
						{SCHEMES.map((s) => {
							const Icon = SCHEME_ICON[s.id]
							return (
								<button
									key={s.id}
									type="button"
									onClick={() => {
										setScheme(s.id)
										setS(s.id)
									}}
									className={clsx(
										"flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition",
										scheme === s.id ? "border-brand-700 bg-brand-50 text-brand-700" : "border-line text-ink-muted hover:border-brand-300"
									)}
								>
									<Icon size={16} />
									{s.label}
								</button>
							)
						})}
					</div>
					<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Sidebar</div>
					<div className="space-y-1">
						{RAILS.map((r) => (
							<button
								key={r.id}
								type="button"
								onClick={() => {
									setRail(r.id)
									setR(r.id)
								}}
								className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-cream"
							>
								<span className="h-6 w-6 shrink-0 rounded-lg border border-line" style={{ background: r.swatch }} />
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-semibold text-ink">{r.label}</span>
									<span className="block truncate text-[11px] text-ink-soft">{r.hint}</span>
								</span>
								{rail === r.id ? <Check size={16} className="text-brand-700" /> : null}
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}
