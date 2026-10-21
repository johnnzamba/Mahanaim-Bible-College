import { Link } from "react-router-dom"
import clsx from "clsx"
import { CheckCircle2, Circle, CircleAlert, FileWarning } from "lucide-react"
import { Donut } from "@/shared/components/ui"

/** Completeness meter + list for the required documents. `checklist` comes from lib.docChecklist. */
export function DocChecklist({ checklist, uploadTo, compact }) {
	if (!checklist) return null
	const tone = checklist.pct >= 100 ? "green" : checklist.pct >= 50 ? "gold" : "red"
	return (
		<div>
			<div className="flex items-center gap-4">
				<Donut value={checklist.pct} size={compact ? 64 : 76} tone={tone}>
					<span className="text-sm font-bold text-ink">{checklist.pct}%</span>
				</Donut>
				<div className="min-w-0">
					<div className="font-semibold text-ink">
						{checklist.done} of {checklist.total} required
					</div>
					<div className="text-xs text-ink-muted">
						{checklist.missing.length ? `${checklist.missing.length} still to upload` : "All required documents are in"}
					</div>
					{checklist.flagged?.length ? (
						<div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
							{checklist.flagged.length} need{checklist.flagged.length === 1 ? "s" : ""} a new copy
						</div>
					) : null}
					{uploadTo && checklist.missing.length ? (
						<Link to={uploadTo} className="link mt-1 inline-block text-xs font-semibold">
							Upload now
						</Link>
					) : null}
				</div>
			</div>
			<ul className="mt-4 space-y-2">
				{checklist.items.map((it) => (
					<li key={it.key} className="flex items-start gap-2.5 text-sm">
						{it.flagged ? (
							<FileWarning size={17} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
						) : it.done ? (
							<CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
						) : it.required ? (
							<CircleAlert size={17} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
						) : (
							<Circle size={17} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden />
						)}
						<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
							<span className={clsx("min-w-0 break-words", it.done ? "text-ink" : "text-ink-muted")}>
								{it.label}
								<span className="sr-only">{it.flagged ? " — new copy needed" : it.done ? " — uploaded" : " — missing"}</span>
							</span>
							<span
								className={clsx(
									"ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-wide",
									it.flagged ? "text-amber-700 dark:text-amber-300" : it.doc?.verified ? "text-emerald-700 dark:text-emerald-300" : "text-ink-soft"
								)}
							>
								{it.flagged ? "New copy" : it.done ? (it.doc?.verified ? "Verified" : "Uploaded") : it.required ? "Required" : "Recommended"}
							</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	)
}
