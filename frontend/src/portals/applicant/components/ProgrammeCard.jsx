import { Link } from "react-router-dom"
import { ArrowRight, Clock, GraduationCap, MapPin } from "lucide-react"
import { Badge } from "@/shared/components/ui"
import { money } from "@/shared/utils/format"

export const years = (n) => {
	const v = Number(n || 0)
	if (!v) return "—"
	if (v < 1) return `${Math.round(v * 12)} months`
	return `${v % 1 ? v.toFixed(1) : v} year${v === 1 ? "" : "s"}`
}

/** A programme open for applications, with a deep link into the wizard. */
export function ProgrammeCard({ programme: p }) {
	return (
		<div className="card flex h-full flex-col p-4">
			<div className="flex items-start gap-3">
				<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
					<GraduationCap size={19} aria-hidden />
				</span>
				<div className="min-w-0 flex-1">
					<Badge tone="gold" size="xs">
						{p.level || "Programme"}
					</Badge>
					<h3 className="mt-1 font-semibold leading-snug text-ink">{p.programme_name}</h3>
				</div>
			</div>
			<dl className="mt-3 space-y-1.5 text-xs text-ink-muted">
				<div className="flex items-center gap-1.5">
					<Clock size={13} aria-hidden /> <dt className="sr-only">Duration</dt>
					<dd>{years(p.duration_years)}</dd>
				</div>
				{p.campuses?.length ? (
					<div className="flex items-center gap-1.5">
						<MapPin size={13} aria-hidden /> <dt className="sr-only">Campuses</dt>
						<dd className="truncate">{p.campuses.join(", ")}</dd>
					</div>
				) : null}
				{p.minimum_entry ? (
					<div className="text-ink-soft">
						<dt className="inline font-semibold text-ink-muted">Entry: </dt>
						<dd className="inline">{p.minimum_entry}</dd>
					</div>
				) : null}
			</dl>
			<div className="mt-auto flex items-center justify-between gap-2 pt-4">
				<span className="text-xs text-ink-soft">
					Application fee <span className="font-semibold text-ink">{money(p.application_fee)}</span>
				</span>
				<Link to={`/applicant/apply?programme=${encodeURIComponent(p.code || p.name)}`} className="btn btn-primary btn-sm" aria-label={`Apply for ${p.programme_name}`}>
					Apply <ArrowRight size={14} />
				</Link>
			</div>
		</div>
	)
}
