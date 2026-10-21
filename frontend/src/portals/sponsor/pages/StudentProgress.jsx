import { useState } from "react"
import { useParams } from "react-router-dom"
import clsx from "clsx"
import { Award, BookOpenCheck, CalendarCheck, GraduationCap, HandCoins, Receipt, ShieldCheck, Smartphone, Wallet } from "lucide-react"
import { TrendChart } from "@/shared/components/Charts"
import { DataTable } from "@/shared/components/kit"
import { Avatar, Badge, Button, Empty, ErrorState, InfoRow, PageHeader, Panel, ProgressBar, Skeleton, StatCard } from "@/shared/components/ui"
import { date, money, num } from "@/shared/utils/format"
import { coverageLabel, feeSummary, isNoProfile, receiptUrl, standingTone } from "../lib"
import { useContributions, useProgress } from "../hooks"
import { NoSponsorProfile } from "../components/NoSponsorProfile"
import { PayForStudentDialog } from "../components/PayForStudentDialog"
import { Amount, Resp } from "../components/Amount"

export default function StudentProgress() {
	const { student } = useParams()
	const q = useProgress(student)
	if (q.isLoading) return <ProgressSkeleton />
	if (q.isError) {
		if (isNoProfile(q.error)) return <NoSponsorProfile />
		return (
			<>
				<PageHeader title="Student progress" back={{ to: "/sponsor/students", label: "My students" }} />
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load this student" />
				</div>
			</>
		)
	}
	return <Progress data={q.data} />
}

function ProgressSkeleton() {
	return (
		<div className="space-y-5">
			<Skeleton className="h-28" />
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-24" />
				))}
			</div>
			<Skeleton className="h-80" />
		</div>
	)
}

function Progress({ data }) {
	const s = data.student
	const fees = feeSummary(data)
	const sp = data.sponsorship
	const overall = data.attendance?.overall
	const termAtt = data.attendance?.current_term
	const [paying, setPaying] = useState(false)
	const contributions = useContributions()
	const mine = (contributions.data?.data || []).filter((c) => c.student === s.name)
	const payTarget = { ...s, student: s.name, fee_balance: fees.balance }
	const gpaTrend = data.terms.filter((t) => t.gpa != null).map((t) => ({ label: t.term_label, gpa: t.gpa }))
	const canPay = sp && ["Active", "Suspended"].includes(sp.status)

	return (
		<>
			<PageHeader
				eyebrow="Sponsored student"
				title={s.full_name}
				subtitle="Academic progress, attendance and fees"
				back={{ to: "/sponsor/students", label: "My students" }}
				actions={
					canPay ? (
						<Button variant="gold" icon={Smartphone} onClick={() => setPaying(true)}>
							Pay fees
						</Button>
					) : null
				}
			/>

			<section className="card mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
				<Avatar name={s.full_name} src={s.photo} size={76} ring />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-mono text-sm font-semibold text-ink">{s.student_number || s.name}</span>
						{s.status ? <Badge status={s.status} size="xs" dot /> : null}
						{s.academic_standing ? <Badge tone={standingTone(s.academic_standing)} size="xs">{s.academic_standing}</Badge> : null}
					</div>
					<dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
						<Info label="Programme" value={s.programme_name} />
						<Info label="Year of study" value={s.year_of_study ? `Year ${s.year_of_study}` : null} />
						<Info label="Campus" value={s.campus_name} />
						<Info label="Current term" value={s.current_term || data.attendance?.term} />
					</dl>
				</div>
			</section>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="CGPA" value={s.cgpa ? num(s.cgpa, 2) : "—"} icon={Award} tone="purple" hint="out of 4.00" />
				<StatCard label={<Resp short="Credits">Credits earned</Resp>} value={s.credits_earned ?? "—"} icon={BookOpenCheck} tone="brand" hint={<Resp short={`${data.terms.length} term${data.terms.length === 1 ? "" : "s"}`}>{`${data.terms.length} term${data.terms.length === 1 ? "" : "s"} of results`}</Resp>} />
				<StatCard
					label="Attendance"
					value={overall?.pct != null ? `${Math.round(overall.pct)}%` : "—"}
					icon={CalendarCheck}
					tone={overall?.pct == null ? "gray" : overall.pct >= 80 ? "green" : overall.pct >= 65 ? "orange" : "red"}
					hint={overall?.total ? <Resp short={`${overall.total} sessions`}>{`${overall.total} sessions recorded`}</Resp> : <Resp short="None yet">No sessions yet</Resp>}
				/>
				<StatCard label={<Resp short="Balance">Fee balance</Resp>} value={fees.balance > 0 ? <Amount value={fees.balance} /> : "Paid up"} icon={Wallet} tone={fees.balance > 0 ? "orange" : "green"} hint={fees.billed ? <Resp short={`${fees.pct}% paid`}>{`${fees.pct}% of invoices paid`}</Resp> : null} />
			</div>

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
				<div className="min-w-0 space-y-5">
					<Panel title="Academic results" icon={GraduationCap} subtitle="Published results by term">
						{gpaTrend.length > 1 ? (
							<div className="mb-5">
								<TrendChart data={gpaTrend} xKey="label" series={[{ key: "gpa", label: "Term GPA" }]} height={180} format={(v) => num(v, 2)} />
							</div>
						) : null}
						{data.terms.length ? (
							<div className="space-y-5">
								{[...data.terms].reverse().map((t) => (
									<TermResults key={t.academic_term} term={t} />
								))}
							</div>
						) : (
							<Empty compact icon={GraduationCap} title="No published results yet" subtitle="Results appear here once the college publishes them at the end of each term." />
						)}
					</Panel>

					<Panel title="Fee invoices" icon={Receipt} subtitle="Most recent invoices on the student's account" bodyClass="p-0">
						<DataTable
							className="rounded-none border-0 shadow-none"
							rows={fees.invoices}
							empty="No invoices yet"
							cols={[
								{ key: "name", label: "Invoice", render: (r) => <div><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-ink-soft">{r.academic_term || "—"}</div></div>, sortValue: (r) => r.name },
								{ key: "due_date", label: "Due", render: (r) => date(r.due_date || r.posting_date), sortValue: (r) => r.due_date },
								{ key: "total_amount", label: "Billed", align: "right", render: (r) => money(r.total_amount), sortValue: (r) => r.total_amount },
								{ key: "paid_amount", label: "Paid", align: "right", render: (r) => money(r.paid_amount), sortValue: (r) => r.paid_amount, hideOnMobile: true },
								{ key: "outstanding_amount", label: "Balance", align: "right", render: (r) => <span className="font-semibold text-ink">{money(r.outstanding_amount)}</span>, sortValue: (r) => r.outstanding_amount },
								{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" /> },
							]}
						/>
					</Panel>

					<Panel title="Your payments for this student" icon={HandCoins} bodyClass="p-0">
						{contributions.isLoading ? (
							<div className="space-y-2 p-5">
								<Skeleton className="h-10" />
								<Skeleton className="h-10" />
							</div>
						) : contributions.isError ? (
							<ErrorState error={contributions.error} onRetry={() => contributions.refetch()} />
						) : !mine.length ? (
							<Empty compact icon={HandCoins} title="No payments yet" subtitle="Fee payments and sponsorship credits you make for this student appear here." />
						) : (
							<ul className="divide-y divide-line">
								{mine.map((c) => (
									<li key={`${c.type}-${c.name}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
										<div className="min-w-0 flex-1">
											<div className="text-sm font-semibold text-ink">{c.type === "Sponsor Credit" ? "Sponsorship credit" : `Fee payment · ${c.mode || "—"}`}</div>
											<div className="text-xs text-ink-soft">
												{date(c.date)} · {c.type === "Sponsor Credit" ? c.reference || c.name : c.reference || c.name}
											</div>
										</div>
										<span className="text-sm font-bold text-ink">{money(c.amount)}</span>
										{c.type === "Fee Payment" ? (
											<a href={receiptUrl(c.name)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
												<Receipt size={14} /> Receipt
											</a>
										) : null}
									</li>
								))}
							</ul>
						)}
					</Panel>
				</div>

				<aside className="space-y-5">
					<Panel title="Your sponsorship" icon={ShieldCheck} actions={sp?.status ? <Badge status={sp.status} size="xs" /> : null}>
						{sp ? (
							<div className="divide-y divide-line">
								<InfoRow label="Coverage" value={coverageLabel(sp)} />
								{sp.coverage === "Fixed Amount" || sp.amount ? <InfoRow label="Committed" value={money(sp.amount)} /> : null}
								<InfoRow label="Disbursed so far" value={money(sp.amount_disbursed)} />
								<InfoRow label="Reference" value={<span className="font-mono text-xs">{sp.name}</span>} />
							</div>
						) : (
							<p className="text-sm text-ink-muted">No sponsorship details on record.</p>
						)}
					</Panel>

					<Panel title="Fees at a glance" icon={Wallet}>
						<div className="text-2xl font-bold text-ink">{fees.balance > 0 ? money(fees.balance) : "Paid up"}</div>
						<div className="text-xs text-ink-soft">{fees.balance > 0 ? "outstanding balance" : "No outstanding balance"}</div>
						{fees.billed > 0 ? (
							<>
								<ProgressBar className="mt-4" value={fees.pct} tone={fees.pct >= 100 ? "green" : fees.pct >= 50 ? "gold" : "orange"} label="Paid of recent invoices" />
								<div className="mt-3 divide-y divide-line">
									<InfoRow label="Billed" value={money(fees.billed)} />
									<InfoRow label="Paid" value={money(fees.paid)} />
								</div>
							</>
						) : null}
						{canPay ? (
							<Button variant={fees.balance > 0 ? "gold" : "secondary"} icon={Smartphone} className="mt-4 w-full justify-center" onClick={() => setPaying(true)}>
								Pay fees for {s.full_name.split(" ")[0]}
							</Button>
						) : null}
					</Panel>

					<Panel title="Attendance" icon={CalendarCheck}>
						{overall?.total ? (
							<div className="space-y-4">
								<AttendanceBlock title="Overall" a={overall} />
								{termAtt?.total ? <AttendanceBlock title={`This term${data.attendance?.term ? ` · ${data.attendance.term}` : ""}`} a={termAtt} /> : null}
							</div>
						) : (
							<p className="text-sm text-ink-muted">No class attendance has been recorded yet.</p>
						)}
					</Panel>
				</aside>
			</div>

			<PayForStudentDialog student={payTarget} open={paying} onClose={() => setPaying(false)} />
		</>
	)
}

function Info({ label, value }) {
	return (
		<div className="min-w-0">
			<dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
			<dd className="truncate font-medium text-ink">{value || "—"}</dd>
		</div>
	)
}

function TermResults({ term }) {
	return (
		<div className="overflow-hidden rounded-xl border border-line">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-cream/60 px-4 py-2.5">
				<span className="font-semibold text-ink">{term.term_label}</span>
				<span className="text-xs text-ink-soft">
					{term.credits} credits · {term.passed} passed{term.failed ? ` · ${term.failed} failed` : ""}
				</span>
				<span className="ml-auto text-sm font-bold text-ink">GPA {term.gpa != null ? num(term.gpa, 2) : "—"}</span>
			</div>
			<div className="overflow-x-auto">
				<table className="table-base">
					<thead>
						<tr>
							<th>Course</th>
							<th className="text-right">Credits</th>
							<th className="text-center">Grade</th>
							<th>Result</th>
						</tr>
					</thead>
					<tbody>
						{term.courses.map((c) => (
							<tr key={c.course}>
								<td>
									<div className="font-medium text-ink">{c.course_title || c.course}</div>
									<div className="text-xs text-ink-soft">{c.course}</div>
								</td>
								<td className="text-right tabular-nums">{c.credits ?? "—"}</td>
								<td className="text-center font-semibold text-ink">{c.grade || "—"}</td>
								<td>{c.result_status ? <Badge status={c.result_status} size="xs" /> : "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}

function AttendanceBlock({ title, a }) {
	const parts = [
		{ key: "present", label: "Present", cls: "bg-emerald-500" },
		{ key: "late", label: "Late", cls: "bg-amber-400" },
		{ key: "excused", label: "Excused", cls: "bg-sky-400" },
		{ key: "absent", label: "Absent", cls: "bg-red-500" },
	]
	return (
		<div>
			<div className="mb-1.5 flex items-baseline justify-between text-xs">
				<span className="font-semibold text-ink-muted">{title}</span>
				<span className="font-bold text-ink">{a.pct != null ? `${Math.round(a.pct)}%` : "—"}</span>
			</div>
			<div className="flex h-2.5 overflow-hidden rounded-full bg-line/70" role="img" aria-label={parts.map((p) => `${p.label} ${a[p.key] || 0}`).join(", ")}>
				{parts.map((p) => (a[p.key] ? <div key={p.key} className={p.cls} style={{ width: `${(a[p.key] / a.total) * 100}%` }} /> : null))}
			</div>
			<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-soft">
				{parts.map((p) => (
					<span key={p.key} className="inline-flex items-center gap-1">
						<span className={clsx("h-2 w-2 rounded-full", p.cls)} aria-hidden /> {p.label} {a[p.key] || 0}
					</span>
				))}
			</div>
		</div>
	)
}
