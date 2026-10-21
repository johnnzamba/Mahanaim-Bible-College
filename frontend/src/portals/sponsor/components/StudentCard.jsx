import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, Smartphone } from "lucide-react"
import { Avatar, Badge, Button, ProgressBar, Skeleton } from "@/shared/components/ui"
import { money, num } from "@/shared/utils/format"
import { coverageLabel, feeSummary, standingTone } from "../lib"

function Metric({ label, value, className }) {
	return (
		<div className={clsx("min-w-0", className)}>
			<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
			<div className="mt-0.5 truncate text-sm font-semibold text-ink">{value ?? "—"}</div>
		</div>
	)
}

/** A sponsored student at a glance: programme, standing, attendance and fee progress. */
export function StudentCard({ s, progress, onPay }) {
	const fees = progress?.data ? feeSummary(progress.data) : null
	const balance = Math.max(Number(s.fee_balance || 0), 0)
	const to = `/sponsor/students/${s.student}`
	return (
		<article className="card flex flex-col p-4 transition hover:shadow-soft">
			<div className="flex items-start gap-3">
				<Avatar name={s.full_name} src={s.photo} size={52} />
				<div className="min-w-0 flex-1">
					<Link to={to} className="block truncate font-semibold text-ink hover:text-brand-700">
						{s.full_name}
					</Link>
					<div className="truncate text-xs text-ink-soft">
						{s.student_number || s.student}
						{s.year_of_study ? ` · Year ${s.year_of_study}` : ""}
					</div>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{s.academic_standing ? (
							<Badge tone={standingTone(s.academic_standing)} size="xs">
								{s.academic_standing}
							</Badge>
						) : null}
						{s.status && s.status !== "Active" ? <Badge status={s.status} size="xs" /> : null}
						{s.sponsorship?.status && s.sponsorship.status !== "Active" ? <Badge status={s.sponsorship.status} size="xs" /> : null}
					</div>
				</div>
			</div>
			<p className="mt-3 truncate text-sm text-ink-muted" title={s.programme_name}>
				{s.programme_name}
				{s.campus_name ? <span className="text-ink-soft"> · {s.campus_name}</span> : null}
			</p>
			<div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-cream/60 px-3 py-2.5">
				<Metric label="CGPA" value={s.cgpa ? num(s.cgpa, 2) : "—"} />
				<Metric label="Attendance" value={s.attendance_pct != null ? `${Math.round(s.attendance_pct)}%` : "—"} />
				<Metric label="Covers" value={coverageLabel(s.sponsorship, { short: true })} />
			</div>
			<div className="mt-4">
				<div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
					<span className="font-semibold text-ink-muted">Fees</span>
					<span className={clsx("font-semibold", balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>
						{balance > 0 ? `${money(balance)} due` : "Fully paid"}
					</span>
				</div>
				{progress?.isLoading ? (
					<Skeleton className="h-2 w-full" />
				) : fees && fees.billed > 0 ? (
					<>
						<ProgressBar value={fees.pct} tone={fees.pct >= 100 ? "green" : fees.pct >= 50 ? "gold" : "orange"} size="sm" />
						<div className="mt-1 text-[11px] text-ink-soft">
							{money(fees.paid)} paid of {money(fees.billed)} billed
						</div>
					</>
				) : (
					<ProgressBar value={balance > 0 ? 0 : 100} tone={balance > 0 ? "orange" : "green"} size="sm" />
				)}
			</div>
			<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
				<Link to={to} className="btn btn-ghost btn-sm">
					View progress <ArrowRight size={14} />
				</Link>
				<span className="flex-1" />
				{onPay && s.sponsorship?.status !== "Completed" ? (
					<Button variant={balance > 0 ? "gold" : "secondary"} size="sm" icon={Smartphone} onClick={() => onPay(s)}>
						Pay fees
					</Button>
				) : null}
			</div>
		</article>
	)
}

export function StudentCardSkeleton() {
	return (
		<div className="card space-y-3 p-4">
			<div className="flex gap-3">
				<Skeleton className="h-12 w-12 rounded-full" />
				<div className="flex-1 space-y-2">
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-3 w-1/3" />
				</div>
			</div>
			<Skeleton className="h-14" />
			<Skeleton className="h-3" />
		</div>
	)
}
