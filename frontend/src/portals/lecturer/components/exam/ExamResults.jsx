import { BarChart3, CheckCircle2, ClipboardCheck, Percent } from "lucide-react"
import { Badge, Empty, Panel, QueryState, SkeletonRows, StatCard } from "@/shared/components/ui"
import { BarsChart } from "@/shared/components/Charts"
import { DataTable } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { pct } from "@/shared/utils/format"
import { StatusBadge } from "../bits"
import { M, score } from "../lib"

/** Post-exam analytics from exam_stats (finalised attempts only). */
export function ExamResults({ exam }) {
	const q = useApi(M.examStats, { exam })
	return (
		<QueryState query={q} skeleton={<SkeletonRows rows={6} />}>
			{(s) =>
				!s.count ? (
					<div className="card">
						<Empty icon={BarChart3} title="No marked attempts yet" subtitle="Results appear here once attempts are marked and finalised." />
					</div>
				) : (
					<div className="space-y-6">
						<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-4">
							<StatCard label="Marked attempts" value={s.count} icon={ClipboardCheck} />
							<StatCard label="Average" value={pct(s.average, 1)} tone="gold" icon={Percent} />
							<StatCard label="Pass rate" value={pct(s.pass_rate, 0)} tone={s.pass_rate >= 50 ? "green" : "red"} icon={CheckCircle2} />
							<StatCard label="Range" value={`${score(s.lowest, 0)}–${score(s.highest, 0)}%`} tone="blue" icon={BarChart3} />
						</div>
						<div className="grid gap-6 lg:grid-cols-2">
							<Panel title="Score distribution" subtitle="% of total marks">
								<BarsChart data={s.distribution} xKey="range" series={[{ key: "count", label: "Students" }]} height={240} />
							</Panel>
							<Panel title="Grades">
								{s.grades.length ? <BarsChart data={s.grades} xKey="grade" series={[{ key: "count", label: "Students" }]} height={240} /> : <p className="text-sm text-ink-soft">No grades.</p>}
							</Panel>
						</div>
						<div>
							<h3 className="mb-2 text-[15px] font-semibold text-ink">Question analysis</h3>
							<p className="mb-3 text-xs text-ink-soft">Facility = share of available marks students earned. Hardest questions first; consider reviewing any below 30%.</p>
							<DataTable
								rows={s.questions}
								rowKey="question"
								dense
								cols={[
									{ key: "title", label: "Question", render: (r) => <span className="line-clamp-2 text-ink">{r.title || r.question}</span>, sortValue: (r) => r.title },
									{ key: "question_type", label: "Type", render: (r) => <Badge tone="gray" size="xs">{r.question_type}</Badge>, sortValue: (r) => r.question_type },
									{ key: "answered", label: "Answered", align: "right", render: (r) => `${r.answered}/${r.responses}`, sortValue: (r) => r.answered },
									{ key: "correct_rate", label: "Correct", align: "right", render: (r) => pct(r.correct_rate, 0), sortValue: (r) => r.correct_rate },
									{
										key: "facility",
										label: "Facility",
										align: "right",
										render: (r) => (
											<span className="inline-flex items-center gap-2">
												{pct(r.facility, 0)} <StatusBadge kind="question" status={r.difficulty} size="xs" dot={false} />
											</span>
										),
										sortValue: (r) => r.facility,
									},
								]}
							/>
						</div>
					</div>
				)
			}
		</QueryState>
	)
}
