import { Link } from "react-router-dom"
import { CheckCircle2, GraduationCap, Percent, Sheet, Trophy } from "lucide-react"
import { Alert, Panel, QueryState, SkeletonRows, StatCard } from "@/shared/components/ui"
import { BarsChart } from "@/shared/components/Charts"
import { useApi } from "@/shared/api/hooks"
import { num } from "@/shared/utils/format"
import { StatusBadge } from "../bits"
import { COMPONENTS, CONFLICT_RETRY, M, score } from "../lib"

export default function GradebookTab({ offering }) {
	const sheet = useApi(M.getMarkSheet, { offering }, CONFLICT_RETRY)
	const dist = useApi(M.gradeDistribution, { offering })
	return (
		<QueryState query={sheet} skeleton={<SkeletonRows rows={6} />}>
			{(s) => (
				<div className="space-y-6">
					{s.status === "Returned" ? (
						<Alert tone="error" title="Returned by the Dean">
							{s.return_reason || "Review the marks and resubmit."}
						</Alert>
					) : null}
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
						<div className="flex items-center gap-3">
							<StatusBadge kind="sheet" status={s.status} />
							<span className="text-sm text-ink-muted">
								{s.name} · pass mark {score(s.pass_mark)}%
							</span>
						</div>
						<Link to={`/lecturer/gradebook/${offering}`} className="btn btn-primary btn-sm sm:ml-auto">
							<GraduationCap size={14} /> {["Draft", "Returned"].includes(s.status) ? "Enter & review marks" : "View mark sheet"}
						</Link>
					</div>
					<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
						<StatCard label="Students" value={num(s.student_count)} icon={Sheet} />
						<StatCard label="Passing" value={num(s.pass_count)} tone="green" icon={CheckCircle2} hint={s.student_count ? `${Math.round((s.pass_count / s.student_count) * 100)}% of class` : undefined} />
						<StatCard label="Average" value={score(s.average_score, 1)} tone="gold" icon={Percent} hint="out of 100" />
						<StatCard label="Highest" value={score(s.highest_score, 1)} tone="blue" icon={Trophy} />
					</div>
					<div className="grid gap-6 lg:grid-cols-5">
						<Panel title="Weights" subtitle="How the final mark is built" className="lg:col-span-2">
							<ul className="space-y-3">
								{COMPONENTS.map(([k, w, , label]) => (
									<li key={k}>
										<div className="mb-1 flex justify-between text-sm">
											<span className="text-ink-muted">{label}</span>
											<span className="font-semibold tabular-nums text-ink">{score(s[w])}%</span>
										</div>
										<div className="h-2 overflow-hidden rounded-full bg-line/70">
											<div className="h-full rounded-full bg-brand-600" style={{ width: `${Number(s[w]) || 0}%` }} />
										</div>
									</li>
								))}
							</ul>
							<div className="mt-5 border-t border-line pt-4">
								<div className="label">Counted assessments</div>
								{s.assessments?.length ? (
									<ul className="space-y-1.5 text-sm">
										{s.assessments.map((a) => (
											<li key={a.name} className="flex items-center justify-between gap-2">
												<Link to={a.kind === "exam" ? `/lecturer/exams/${a.name}` : `/lecturer/assignments/${a.name}`} className="truncate text-ink hover:underline">
													{a.title}
												</Link>
												<span className="shrink-0 text-xs uppercase text-ink-soft">{a.bucket}</span>
											</li>
										))}
									</ul>
								) : (
									<p className="text-xs text-ink-soft">No published assignments or exams yet.</p>
								)}
							</div>
						</Panel>
						<Panel title="Grade distribution" className="lg:col-span-3">
							<QueryState query={dist} skeleton={<SkeletonRows rows={4} />}>
								{(g) =>
									g?.grades?.length ? (
										<BarsChart data={g.grades} xKey="grade" series={[{ key: "count", label: "Students" }]} height={240} />
									) : (
										<p className="text-sm text-ink-soft">No grades yet.</p>
									)
								}
							</QueryState>
						</Panel>
					</div>
				</div>
			)}
		</QueryState>
	)
}
