import clsx from "clsx"
import { Check, X } from "lucide-react"

/**
 * Compact, non-scrolling horizontal progress track (steps shaped like lib.journey output).
 * With onStep, completed steps become buttons (used by the apply wizard).
 */
export function JourneyTrack({ steps = [], className, onStep, caption = true }) {
	const n = steps.length
	if (!n) return null
	const last = steps.reduce((a, s, i) => (s.status === "done" ? i : a), -1)
	const fill = n > 1 ? Math.max(0, Math.min(1, (last + (steps[last + 1]?.status === "current" ? 0.5 : 0)) / (n - 1))) : 0
	const curIdx = steps.findIndex((s) => s.status === "current" || s.status === "failed")
	const cur = steps[curIdx]
	const inset = `${50 / n}%`
	return (
		<div className={className}>
			<div className="relative">
				<div className="absolute top-[13px] h-1 rounded-full bg-line" style={{ left: inset, right: inset }} aria-hidden />
				<div
					className="absolute top-[13px] h-1 rounded-full bg-brand-600 transition-all"
					style={{ left: inset, width: `calc((100% - ${100 / n}%) * ${fill})` }}
					aria-hidden
				/>
				<ol className="relative flex">
					{steps.map((s, i) => {
						const on = s.status === "current"
						const Dot = onStep && s.status === "done" ? "button" : "span"
						return (
							<li key={s.key} className="flex min-w-0 flex-1 flex-col items-center text-center" aria-current={on ? "step" : undefined}>
								<Dot
									{...(Dot === "button" ? { type: "button", onClick: () => onStep(i), "aria-label": `Go back to ${s.label}` } : {})}
									className={clsx(
										"grid h-[30px] w-[30px] place-items-center rounded-full border-2 text-[11px] font-bold",
										Dot === "button" && "transition hover:ring-4 hover:ring-brand-500/20",
										s.status === "done" && "border-brand-700 bg-brand-700 text-white",
										on && "border-gold-500 bg-gold-500 text-brand-900 ring-4 ring-gold-500/20",
										s.status === "failed" && "border-red-600 bg-red-600 text-white",
										s.status === "pending" && "border-line bg-surface text-ink-soft"
									)}
									title={s.label}
								>
									{s.status === "done" ? <Check size={14} strokeWidth={3} /> : s.status === "failed" ? <X size={14} strokeWidth={3} /> : i + 1}
								</Dot>
								<span
									className={clsx(
										"mt-1.5 hidden px-0.5 text-[11px] font-semibold leading-tight sm:block",
										on ? "text-ink" : s.status === "failed" ? "text-red-700 dark:text-red-300" : s.status === "done" ? "text-ink-muted" : "text-ink-soft"
									)}
								>
									{s.short}
								</span>
								{s.date ? <span className="hidden text-[10.5px] text-ink-soft lg:block">{s.date}</span> : null}
							</li>
						)
					})}
				</ol>
			</div>
			{caption ? <p className="mt-2 text-xs font-semibold text-ink sm:hidden">{cur ? `Step ${curIdx + 1} of ${n} · ${cur.label}` : `All ${n} steps complete`}</p> : null}
		</div>
	)
}
