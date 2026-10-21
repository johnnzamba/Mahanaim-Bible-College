import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Award, BookOpenCheck, FileText, GraduationCap, Printer, ScrollText, Send, TrendingUp } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Badge, Empty, PageHeader, Panel, ProgressBar, QueryState, Skeleton, StatCard, Tabs } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { TrendChart } from "@/shared/components/Charts"
import { date, num } from "@/shared/utils/format"
import { API, gradeTone } from "../components/lib"
import { TranscriptRequestModal } from "../components/TranscriptRequestModal"

const fmt2 = (v) => (v == null || v === "" ? "—" : Number(v).toFixed(2))

export default function Results() {
	const q = useApi(API.results)
	const [tab, setTab] = useState("terms")
	const [requesting, setRequesting] = useState(false)
	const d = q.data || {}
	const terms = d.terms || []
	const trend = useMemo(() => terms.map((t) => ({ label: t.label.replace(/\s*\d{4}-\d{4}$/, ""), gpa: t.gpa, cgpa: t.cgpa })), [terms])
	const minCredits = Number(d.min_credits_to_graduate) || 0

	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Results"
				subtitle="Published results by term, your GPA trend and an unofficial transcript."
				actions={
					<button type="button" className="btn btn-primary btn-sm" onClick={() => setRequesting(true)}>
						<Send size={14} /> Request official transcript
					</button>
				}
			/>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="CGPA" value={fmt2(d.cgpa)} icon={TrendingUp} tone="brand" loading={q.isLoading} hint="On a 4.0 scale" />
				<StatCard
					label="Credits earned"
					value={num(d.credits_earned)}
					icon={BookOpenCheck}
					tone="green"
					loading={q.isLoading}
					hint={minCredits ? `of ${num(minCredits)} to graduate` : `${num(d.credits_attempted)} attempted`}
				/>
				<StatCard label="Standing" value={d.standing || "—"} icon={Award} tone="gold" loading={q.isLoading} />
				<StatCard label="Classification" value={d.classification || "—"} icon={GraduationCap} tone="purple" loading={q.isLoading} hint="If you graduated today" />
			</div>

			<QueryState
				query={q}
				isEmpty={(x) => !(x.terms || []).length}
				empty={
					<div className="card">
						<Empty icon={FileText} title="No published results yet" subtitle="Results appear here once the Academic Board publishes them for a term." />
					</div>
				}
				skeleton={<Skeleton className="h-72 rounded-2xl" />}
			>
				{() => (
					<div className="space-y-5">
						{minCredits ? (
							<div className="card p-4">
								<div className="mb-1.5 flex justify-between text-xs">
									<span className="font-semibold text-ink-soft">Progress to graduation</span>
									<span className="font-semibold text-ink">
										{num(d.credits_earned)} / {num(minCredits)} credits
									</span>
								</div>
								<ProgressBar value={(Number(d.credits_earned) / minCredits) * 100} />
							</div>
						) : null}
						{terms.length > 1 ? (
							<Panel title="GPA trend" icon={TrendingUp} subtitle="Term GPA and cumulative GPA">
								<TrendChart data={trend} series={[{ key: "gpa", label: "Term GPA" }, { key: "cgpa", label: "CGPA" }]} height={220} area={false} format={fmt2} />
							</Panel>
						) : null}
						<Tabs className="pb-px"
							tabs={[
								{ id: "terms", label: "By term", count: terms.length },
								{ id: "transcript", label: "Transcript preview" },
							]}
							active={tab}
							onChange={setTab}
						/>
						{tab === "terms" ? (
							[...terms].reverse().map((t) => <TermPanel key={t.term} t={t} />)
						) : (
							<TranscriptPreview onRequest={() => setRequesting(true)} />
						)}
					</div>
				)}
			</QueryState>
			<TranscriptRequestModal open={requesting} onClose={() => setRequesting(false)} />
		</>
	)
}

function TermPanel({ t }) {
	return (
		<Panel
			title={t.label}
			subtitle={`${t.academic_year} · ${num(t.credits)} credits · ${num(t.quality_points, 1)} quality points`}
			icon={ScrollText}
			bodyClass="p-0"
			actions={
				<div className="flex items-center gap-2 text-xs">
					<span className="rounded-lg bg-cream px-2 py-1 font-semibold text-ink">GPA {fmt2(t.gpa)}</span>
					<span className="hidden rounded-lg bg-cream px-2 py-1 font-semibold text-ink sm:inline">CGPA {fmt2(t.cgpa)}</span>
				</div>
			}
		>
			<DataTable
				className="rounded-none border-0 shadow-none"
				rows={t.courses}
				rowKey="code"
				cols={[
					{
						key: "title",
						label: "Course",
						render: (c) => (
							<span className="block">
								<span className="block font-semibold text-ink">{c.title}</span>
								<span className="block text-xs text-ink-soft">
									{c.code}
									{c.attempt && c.attempt !== "First" ? ` · ${c.attempt}` : ""}
								</span>
							</span>
						),
					},
					{ key: "credits", label: "Credits", align: "right", render: (c) => num(c.credits) },
					{ key: "total", label: "Marks", align: "right", render: (c) => num(c.total, 0) },
					{ key: "grade", label: "Grade", align: "center", render: (c) => <Badge tone={gradeTone(c.grade_points)}>{c.grade || "—"}</Badge> },
					{ key: "grade_points", label: "Points", align: "right", render: (c) => fmt2(c.grade_points), hideOnMobile: true },
					{ key: "status", label: "Status", render: (c) => <Badge status={c.status} dot />, hideOnMobile: true },
				]}
			/>
		</Panel>
	)
}

function TranscriptPreview({ onRequest }) {
	const q = useApi(API.transcript)
	const { settings } = useSession()
	return (
		<QueryState query={q} skeleton={<Skeleton className="h-96 rounded-2xl" />}>
			{(d) => {
				const s = d.student || {}
				return (
					<div className="space-y-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm text-ink-muted">This is an unofficial preview. Official transcripts carry a seal and verification code.</p>
							<div className="flex gap-2">
								<button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>
									<Printer size={14} /> Print
								</button>
								<button type="button" className="btn btn-primary btn-sm" onClick={onRequest}>
									<Send size={14} /> Request official copy
								</button>
							</div>
						</div>
						<article className="card relative overflow-hidden p-5 sm:p-8">
							<div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
								<span className="-rotate-12 select-none font-serif text-6xl font-bold uppercase tracking-widest text-ink/[0.04] sm:text-8xl">Unofficial</span>
							</div>
							<header className="relative border-b-2 border-gold-500 pb-4 text-center">
								<div className="font-serif text-xl text-ink sm:text-2xl">{settings?.institution_name || "Mahanaim Bible College"}</div>
								{settings?.motto ? <div className="text-xs italic text-ink-soft">{settings.motto}</div> : null}
								<div className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-gold-700">Academic transcript · preview</div>
							</header>
							<dl className="relative mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
								<Row label="Name" value={s.full_name} />
								<Row label="Student number" value={s.student_number} />
								<Row label="Programme" value={s.programme_name} />
								<Row label="Level" value={s.level} />
								<Row label="Campus" value={s.campus} />
								<Row label="Mode of study" value={s.study_mode} />
								<Row label="Status" value={s.status} />
								<Row label="Generated" value={date(d.generated_on)} />
							</dl>
							<div className="relative mt-6 space-y-5">
								{(d.terms || []).map((t) => (
									<section key={t.term}>
										<div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-line pb-1">
											<h3 className="text-sm font-bold text-ink">{t.label}</h3>
											<span className="text-xs text-ink-soft">
												GPA {fmt2(t.gpa)} · CGPA {fmt2(t.cgpa)}
											</span>
										</div>
										<div className="overflow-x-auto">
											<table className="w-full min-w-[28rem] text-sm">
												<thead>
													<tr className="text-left text-[11px] uppercase tracking-wide text-ink-soft">
														<th className="py-1 pr-2 font-semibold">Code</th>
														<th className="py-1 pr-2 font-semibold">Course</th>
														<th className="py-1 pr-2 text-right font-semibold">Cr</th>
														<th className="py-1 pr-2 text-center font-semibold">Grade</th>
														<th className="py-1 text-right font-semibold">Points</th>
													</tr>
												</thead>
												<tbody>
													{t.courses.map((c) => (
														<tr key={c.code} className="border-t border-line/60">
															<td className="py-1.5 pr-2 font-mono text-xs text-ink-muted">{c.code}</td>
															<td className="py-1.5 pr-2 text-ink">{c.title}</td>
															<td className="py-1.5 pr-2 text-right tabular-nums">{num(c.credits)}</td>
															<td className="py-1.5 pr-2 text-center font-semibold">{c.grade}</td>
															<td className="py-1.5 text-right tabular-nums">{fmt2(c.grade_points)}</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</section>
								))}
							</div>
							<footer className="relative mt-6 grid gap-3 rounded-xl bg-cream/70 p-4 text-center sm:grid-cols-4">
								<Sum label="Credits attempted" value={num(d.credits_attempted)} />
								<Sum label="Credits earned" value={num(d.total_credits)} />
								<Sum label="CGPA" value={fmt2(d.cgpa)} />
								<Sum label="Classification" value={d.classification || "—"} />
							</footer>
							{s.min_cgpa_to_graduate ? (
								<p className="relative mt-3 text-center text-[11px] text-ink-soft">
									Minimum CGPA to graduate: {fmt2(s.min_cgpa_to_graduate)}. Only published results are shown.
								</p>
							) : null}
						</article>
						<p className="text-center text-xs text-ink-soft">
							Already issued transcripts are in <Link to="/student/documents" className="link">Documents</Link>.
						</p>
					</div>
				)
			}}
		</QueryState>
	)
}

function Row({ label, value }) {
	return (
		<div className="flex justify-between gap-3 border-b border-dashed border-line py-1">
			<dt className="text-ink-soft">{label}</dt>
			<dd className="text-right font-medium text-ink">{value || "—"}</dd>
		</div>
	)
}

function Sum({ label, value }) {
	return (
		<div>
			<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
			<div className="text-lg font-bold text-ink">{value}</div>
		</div>
	)
}
