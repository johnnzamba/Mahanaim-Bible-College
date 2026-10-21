import { Link } from "react-router-dom"
import clsx from "clsx"
import { CheckCircle2, Circle, CircleAlert } from "lucide-react"
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
						{it.done ? (
							<CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
						) : it.required ? (
							<CircleAlert size={17} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
						) : (
							<Circle size={17} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden />
						)}
						<span className={clsx("min-w-0 flex-1", it.done ? "text-ink" : "text-ink-muted")}>
							{it.label}
							<span className="sr-only">{it.done ? " — uploaded" : " — missing"}</span>
						</span>
						<span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
							{it.done ? (it.doc?.verified ? "Verified" : "Uploaded") : it.required ? "Required" : "Recommended"}
						</span>
					</li>
				))}
			</ul>
		</div>
	)
}
