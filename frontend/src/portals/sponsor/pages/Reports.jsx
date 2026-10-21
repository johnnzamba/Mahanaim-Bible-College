import { Printer } from "lucide-react"
import { ExportButton } from "@/shared/components/kit"
import { Badge, PageHeader, Skeleton } from "@/shared/components/ui"
import { date, dateTime, money, num } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { contributionText, coverageLabel } from "../lib"
import { useContributions, useReport } from "../hooks"
import { CONTRIBUTION_CSV } from "../components/ContributionsTable"
import { SponsorQuery } from "../components/SponsorQuery"

// PortalShell's sidebar isn't marked no-print, so isolate the statement when printing.
const PRINT_CSS = `
@media print {
	@page { margin: 14mm; }
	body * { visibility: hidden !important; }
	#sponsor-statement, #sponsor-statement * { visibility: visible !important; color: black !important; box-shadow: none !important; }
	#sponsor-statement { position: absolute; left: 0; top: 0; width: 100%; border: 0 !important; background: white !important; padding: 0 !important; }
	#sponsor-statement .stmt-band { background: transparent !important; border-color: silver !important; }
	#sponsor-statement table { page-break-inside: auto; }
	#sponsor-statement tr { page-break-inside: avoid; }
}`

const STUDENT_CSV = [
	{ key: "full_name", label: "Student" },
	{ key: "student_number", label: "Student number" },
	{ key: "programme_name", label: "Programme" },
	{ key: "year_of_study", label: "Year" },
	{ key: "cgpa", label: "CGPA" },
	{ key: "academic_standing", label: "Standing" },
	{ key: "attendance_pct", label: "Attendance %", exportValue: (r) => (r.attendance_pct != null ? Math.round(r.attendance_pct) : "") },
	{ key: "coverage", label: "Coverage", exportValue: (r) => coverageLabel(r.sponsorship) },
	{ key: "fee_balance", label: "Fee balance" },
]

export default function Reports() {
	const q = useReport()
	const all = useContributions()
	return (
		<>
			<style>{PRINT_CSS}</style>
			<div className="no-print">
				<PageHeader
					eyebrow="Partnership"
					title="Sponsor statement"
					subtitle="A printable summary of your students' progress and your contributions."
					actions={
						q.data ? (
							<>
								<ExportButton filename="sponsored-students" cols={STUDENT_CSV} rows={q.data.students} label="Students CSV" />
								<ExportButton filename="contributions" cols={CONTRIBUTION_CSV} rows={all.data?.data || q.data.contributions.recent} label="Contributions CSV" />
								<button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
									<Printer size={14} /> Print / save PDF
								</button>
							</>
						) : null
					}
				/>
			</div>
			<SponsorQuery query={q} skeleton={<Skeleton className="h-[720px]" />}>
				{(r) => <Statement r={r} />}
			</SponsorQuery>
		</>
	)
}

function Statement({ r }) {
	const inst = r.institution || {}
	const sp = r.sponsor || {}
	const sum = r.summary || {}
	const c = r.contributions || {}
	const fmt = (v) => money(v, { currency: inst.currency })
	return (
		<article id="sponsor-statement" className="card mx-auto w-full min-w-0 max-w-4xl p-4 text-sm sm:p-10">
			<header className="flex flex-col gap-5 border-b-2 border-brand-800 pb-6 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-start gap-4">
					{safeUrl(inst.logo) ? <img src={safeUrl(inst.logo)} alt="" className="h-16 w-16 object-contain" /> : null}
					<div>
						<div className="font-serif text-xl text-ink">{inst.name}</div>
						{inst.address ? <div className="whitespace-pre-line text-xs text-ink-muted">{inst.address}</div> : null}
						<div className="text-xs text-ink-muted">{[inst.email, inst.phone].filter(Boolean).join(" · ")}</div>
					</div>
				</div>
				<div className="sm:text-right">
					<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-700">Sponsor statement</div>
					<div className="mt-1 font-semibold text-ink">{sp.sponsor_name}</div>
					<div className="text-xs text-ink-soft">Ref. {sp.name}</div>
					<div className="text-xs text-ink-soft">Generated {dateTime(r.generated_on)}</div>
				</div>
			</header>

			<section className="grid gap-6 py-6 sm:grid-cols-2">
				<div>
					<h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Prepared for</h2>
					<div className="font-semibold text-ink">{sp.sponsor_name}</div>
					{sp.contact_person ? <div className="text-ink-muted">Attn: {sp.contact_person}</div> : null}
					{sp.partner_church_name ? <div className="text-ink-muted">{sp.partner_church_name}</div> : null}
					{sp.address ? <div className="whitespace-pre-line text-ink-muted">{sp.address}</div> : null}
					<div className="text-ink-muted">{[sp.email, sp.phone].filter(Boolean).join(" · ")}</div>
				</div>
				<dl className="stmt-band grid grid-cols-2 gap-3 rounded-xl border border-line bg-cream/50 p-4">
					<Fig label="Students sponsored" value={sum.students} />
					<Fig label="Average CGPA" value={sum.average_cgpa != null ? num(sum.average_cgpa, 2) : "—"} />
					<Fig label="Total committed" value={fmt(sum.committed)} />
					<Fig label="Disbursed" value={fmt(sum.disbursed)} />
					<Fig label={`Contributed in ${String(r.generated_on || "").slice(0, 4)}`} value={fmt(c.this_year)} />
					<Fig label="Student fees outstanding" value={fmt(sum.outstanding_for_students)} />
				</dl>
			</section>

			<Block title="Sponsored students">
				{r.students?.length ? (
					<div className="overflow-x-auto">
						<table className="table-base text-sm">
							<thead>
								<tr>
									<th>Student</th>
									<th>Programme</th>
									<th className="text-right">CGPA</th>
									<th>Standing</th>
									<th className="text-right">Attendance</th>
									<th>Coverage</th>
									<th className="text-right">Balance</th>
								</tr>
							</thead>
							<tbody>
								{r.students.map((s) => (
									<tr key={s.student}>
										<td>
											<div className="font-medium text-ink">{s.full_name}</div>
											<div className="text-xs text-ink-soft">{s.student_number}</div>
										</td>
										<td>
											{s.programme_name}
											{s.year_of_study ? <div className="text-xs text-ink-soft">Year {s.year_of_study}</div> : null}
										</td>
										<td className="text-right tabular-nums">{s.cgpa ? num(s.cgpa, 2) : "—"}</td>
										<td>{s.academic_standing || "—"}</td>
										<td className="text-right tabular-nums">{s.attendance_pct != null ? `${Math.round(s.attendance_pct)}%` : "—"}</td>
										<td>{coverageLabel(s.sponsorship)}</td>
										<td className="whitespace-nowrap text-right font-semibold tabular-nums text-ink">{fmt(Math.max(s.fee_balance, 0))}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p className="text-ink-muted">No students are currently linked to this sponsorship.</p>
				)}
			</Block>

			<div className="grid gap-6 sm:grid-cols-[1fr,2fr]">
				<Block title="Contributions by year">
					<table className="table-base text-sm">
						<tbody>
							{(c.by_year || []).map((y) => (
								<tr key={y.year}>
									<td>{y.year}</td>
									<td className="whitespace-nowrap text-right font-semibold tabular-nums text-ink">{fmt(y.amount)}</td>
								</tr>
							))}
							<tr>
								<td className="font-semibold text-ink">All time</td>
								<td className="whitespace-nowrap text-right font-bold tabular-nums text-ink">{fmt(c.all_time)}</td>
							</tr>
						</tbody>
					</table>
					<div className="mt-3 space-y-1 text-xs text-ink-muted">
						<div className="flex justify-between">
							<span>Student fees</span>
							<span className="tabular-nums">{fmt(c.fees)}</span>
						</div>
						<div className="flex justify-between">
							<span>Gifts</span>
							<span className="tabular-nums">{fmt(c.giving)}</span>
						</div>
					</div>
				</Block>
				<Block title="Recent contributions">
					{c.recent?.length ? (
						<div className="overflow-x-auto">
							<table className="table-base text-sm">
								<thead>
									<tr>
										<th>Date</th>
										<th>Description</th>
										<th>Ref.</th>
										<th className="text-right">Amount</th>
									</tr>
								</thead>
								<tbody>
									{c.recent.map((x) => (
										<tr key={`${x.type}-${x.name}`}>
											<td className="whitespace-nowrap">{date(x.date)}</td>
											<td>
												<div className="text-ink">{contributionText(x)}</div>
												<Badge size="xs" tone={x.type === "Giving" ? "gold" : "brand"}>
													{x.type === "Giving" ? "Gift" : x.type}
												</Badge>
											</td>
											<td className="font-mono text-xs">{x.type === "Sponsor Credit" ? x.name : x.reference || x.name}</td>
											<td className="whitespace-nowrap text-right font-semibold tabular-nums text-ink">{fmt(x.amount)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p className="text-ink-muted">No contributions recorded yet.</p>
					)}
				</Block>
			</div>

			<footer className="mt-8 border-t border-line pt-5 text-xs text-ink-soft">
				<p className="text-ink-muted">
					Thank you for partnering with {inst.short_name || inst.name} in training men and women for ministry. Your support changes lives.
				</p>
				<p className="mt-2">
					This statement was generated electronically on {date(r.generated_on)} and is valid without a signature. Fee balances reflect the students' accounts
					at the time of generation. For queries contact {inst.email || "the finance office"}.
				</p>
			</footer>
		</article>
	)
}

function Fig({ label, value }) {
	return (
		<div className="min-w-0">
			<dt className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
			<dd className="mt-0.5 truncate text-base font-bold text-ink">{value ?? "—"}</dd>
		</div>
	)
}

function Block({ title, children }) {
	return (
		<section className="mb-6 min-w-0">
			<h2 className="mb-2 border-b border-line pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h2>
			{children}
		</section>
	)
}
