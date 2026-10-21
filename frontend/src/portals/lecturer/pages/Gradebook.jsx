import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, CheckCircle2, FileEdit, Inbox, Send, Undo2 } from "lucide-react"
import { Alert, PageHeader, Panel, Select, StatCard } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { frappe } from "@/shared/api/frappe"
import { num } from "@/shared/utils/format"
import { StatusBadge } from "../components/bits"
import { M, offeringLabel, score, useMyOfferings } from "../components/lib"

const STEPS = [
	["Draft", "You enter and review marks. Assignment and exam scores flow in automatically.", FileEdit],
	["Submitted", "The Dean of Studies reviews the sheet and approves it or returns it with remarks.", Send],
	["Approved", "The Registrar publishes approved results to students and transcripts.", CheckCircle2],
]

export default function Gradebook() {
	const [term, setTerm] = useState("")
	const q = useMyOfferings(term)
	const all = useMyOfferings("all")
	const offerings = q.data?.data || []
	const names = offerings.map((o) => o.name)
	const dist = useQuery({
		queryKey: [M.gradeDistribution, { across: names }],
		enabled: q.isSuccess && names.length > 0,
		queryFn: async () => {
			const out = {}
			await Promise.all(
				names.map((offering) =>
					frappe
						.call(M.gradeDistribution, { offering })
						.then((r) => (out[offering] = r))
						.catch(() => null)
				)
			)
			return out
		},
	})
	const terms = [...new Set((all.data?.data || []).map((o) => o.academic_term).filter(Boolean))].sort().reverse()
	const status = (o) => o.results_status || "Not Started"
	const count = (st) => offerings.filter((o) => status(o) === st).length
	const returned = offerings.filter((o) => status(o) === "Returned")
	const d = (o) => dist.data?.[o.name]
	// Average and pass rate only mean something once at least one student has a final result.
	const graded = (o) => (d(o)?.statuses?.Pass || 0) + (d(o)?.statuses?.Fail || 0)
	const passRate = (o) => {
		const g = d(o)
		return graded(o) ? ((g.statuses?.Pass || 0) / g.count) * 100 : null
	}

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Assessment"
				title="Gradebook"
				subtitle="One mark sheet per course offering. Enter marks, then submit them for approval."
				actions={
					<Select
						aria-label="Term"
						className="w-56"
						value={term}
						onChange={(e) => setTerm(e.target.value)}
						options={[
							{ value: "", label: "Current term" },
							{ value: "all", label: "All terms" },
							...terms.filter((t) => t !== all.data?.term).map((t) => ({ value: t, label: t })),
						]}
					/>
				}
			/>

			{returned.length ? (
				<Alert tone="error" title={`${returned.length} mark sheet${returned.length === 1 ? " was" : "s were"} returned`} icon={Undo2}>
					<span className="flex flex-wrap gap-x-3 gap-y-1">
						{returned.map((o) => (
							<Link key={o.name} to={`/lecturer/gradebook/${o.name}`} className="font-semibold underline">
								{o.course} · {o.course_title}
							</Link>
						))}
					</span>
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-5">
				<StatCard label="Draft" value={num(count("Draft") + count("Not Started"))} icon={FileEdit} loading={q.isLoading} />
				<StatCard label="Returned" value={num(count("Returned"))} tone={count("Returned") ? "red" : undefined} icon={Undo2} loading={q.isLoading} />
				<StatCard label="Submitted" hint="With the Dean" value={num(count("Submitted"))} tone="orange" icon={Inbox} loading={q.isLoading} />
				<StatCard label="Approved" value={num(count("Approved"))} tone="blue" icon={CheckCircle2} loading={q.isLoading} />
				<StatCard label="Published" value={num(count("Published"))} tone="green" icon={Send} loading={q.isLoading} />
			</div>

			<DataTable
				query={q}
				rows={q.isSuccess ? offerings : undefined}
				rowTo={(o) => `/lecturer/gradebook/${o.name}`}
				empty={term === "" ? "No courses this term" : "No courses found"}
				emptyIcon={BookOpen}
				initialSort={{ key: "results_status", dir: "asc" }}
				cols={[
					{
						key: "course_title",
						label: "Course",
						render: (o) => (
							<div className="min-w-0">
								<div className="font-semibold text-ink">{o.course_title}</div>
								<div className="text-xs text-ink-soft">
									{o.course} · {o.academic_term}
								</div>
							</div>
						),
						sortValue: (o) => o.course,
						exportValue: offeringLabel,
					},
					{ key: "enrolled_count", label: "Students", align: "right" },
					{
						key: "average",
						label: "Average",
						align: "right",
						render: (o) => (graded(o) ? score(d(o).average, 1) : <span className="text-ink-soft">—</span>),
						sortValue: (o) => (graded(o) ? d(o).average : -1),
						exportValue: (o) => (graded(o) ? d(o).average : ""),
					},
					{
						key: "pass",
						label: "Pass rate",
						align: "right",
						hideOnMobile: true,
						render: (o) => (passRate(o) == null ? <span className="text-ink-soft">—</span> : `${Math.round(passRate(o))}%`),
						sortValue: (o) => passRate(o) ?? -1,
						exportValue: (o) => (passRate(o) == null ? "" : Math.round(passRate(o))),
					},
					{
						key: "incomplete",
						label: "Incomplete",
						align: "right",
						hideOnMobile: true,
						render: (o) => {
							const n = d(o)?.statuses?.Incomplete || 0
							return n ? <span className="font-semibold text-orange-600 dark:text-orange-300">{n}</span> : <span className="text-ink-soft">0</span>
						},
						sortValue: (o) => d(o)?.statuses?.Incomplete || 0,
						exportValue: (o) => d(o)?.statuses?.Incomplete || 0,
					},
					{
						key: "results_status",
						label: "Mark sheet",
						render: (o) => <StatusBadge kind="sheet" status={status(o)} />,
						sortValue: (o) => ["Returned", "Draft", "Not Started", "Submitted", "Approved", "Published"].indexOf(status(o)),
						exportValue: status,
					},
				]}
			/>

			<Panel title="How results are approved">
				<ol className="grid gap-4 sm:grid-cols-3">
					{STEPS.map(([label, text, Icon], i) => (
						<li key={label} className="flex gap-3">
							<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
								<Icon size={16} />
							</span>
							<div>
								<div className="text-sm font-semibold text-ink">
									{i + 1}. {label}
								</div>
								<p className="mt-0.5 text-xs text-ink-soft">{text}</p>
							</div>
						</li>
					))}
				</ol>
			</Panel>
		</div>
	)
}
