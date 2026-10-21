import { useMemo, useState } from "react"
import clsx from "clsx"
import { GraduationCap, LayoutGrid, List, Smartphone } from "lucide-react"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { AvatarCell, Badge, Button, Empty, PageHeader } from "@/shared/components/ui"
import { money, num } from "@/shared/utils/format"
import { coverageLabel, isNoProfile, standingTone } from "../lib"
import { useProgresses, useStudents } from "../hooks"
import { NoSponsorProfile } from "../components/NoSponsorProfile"
import { PayForStudentDialog } from "../components/PayForStudentDialog"
import { StudentCard, StudentCardSkeleton } from "../components/StudentCard"

const FILTERS = [
	{ id: "all", label: "All" },
	{ id: "due", label: "Fees due" },
	{ id: "paid", label: "Paid up" },
	{ id: "attention", label: "Needs attention" },
]
const attention = (s) => /probation|warning|suspend/i.test(s.academic_standing || "") || (s.attendance_pct != null && s.attendance_pct < 75)

export default function Students() {
	const q = useStudents()
	const [search, setSearch] = useState("")
	const [filter, setFilter] = useState("all")
	const [view, setView] = useState("cards")
	const [payFor, setPayFor] = useState(null)
	const term = useDebounced(search, 200).trim().toLowerCase()
	const all = useMemo(() => q.data?.data || [], [q.data])
	const progresses = useProgresses(view === "cards" ? all.map((s) => s.student) : [])
	const progressOf = Object.fromEntries(all.map((s, i) => [s.student, progresses[i]]))

	const rows = useMemo(
		() =>
			all.filter((s) => {
				if (filter === "due" && !(s.fee_balance > 0)) return false
				if (filter === "paid" && s.fee_balance > 0) return false
				if (filter === "attention" && !attention(s)) return false
				if (!term) return true
				return [s.full_name, s.student_number, s.programme_name, s.campus_name].some((v) => String(v || "").toLowerCase().includes(term))
			}),
		[all, filter, term]
	)

	if (q.isError && isNoProfile(q.error)) return <NoSponsorProfile />

	const counts = { all: all.length, due: all.filter((s) => s.fee_balance > 0).length, paid: all.filter((s) => !(s.fee_balance > 0)).length, attention: all.filter(attention).length }
	const cols = [
		{
			key: "full_name",
			label: "Student",
			render: (s) => <AvatarCell name={s.full_name} image={s.photo} sub={`${s.student_number || s.student}${s.year_of_study ? ` · Year ${s.year_of_study}` : ""}`} />,
			sortValue: (s) => s.full_name,
		},
		{ key: "programme_name", label: "Programme", render: (s) => <span className="text-sm">{s.programme_name}</span>, sortValue: (s) => s.programme_name, hideOnMobile: true },
		{ key: "cgpa", label: "CGPA", align: "right", render: (s) => (s.cgpa ? num(s.cgpa, 2) : "—"), sortValue: (s) => s.cgpa },
		{
			key: "academic_standing",
			label: "Standing",
			render: (s) =>
				s.academic_standing ? (
					<Badge tone={standingTone(s.academic_standing)} size="xs">
						{s.academic_standing}
					</Badge>
				) : (
					"—"
				),
		},
		{ key: "attendance_pct", label: "Attendance", align: "right", render: (s) => (s.attendance_pct != null ? `${Math.round(s.attendance_pct)}%` : "—"), sortValue: (s) => s.attendance_pct },
		{ key: "coverage", label: "Sponsorship", render: (s) => coverageLabel(s.sponsorship), sortValue: (s) => s.sponsorship?.coverage, hideOnMobile: true },
		{
			key: "fee_balance",
			label: "Balance",
			align: "right",
			render: (s) => <span className={clsx("font-semibold", s.fee_balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>{s.fee_balance > 0 ? money(s.fee_balance) : "Paid up"}</span>,
			sortValue: (s) => s.fee_balance,
		},
		{
			key: "pay",
			label: "",
			align: "right",
			sortable: false,
			render: (s) => (
				<Button
					size="sm"
					variant={s.fee_balance > 0 ? "gold" : "secondary"}
					icon={Smartphone}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						setPayFor(s)
					}}
				>
					Pay
				</Button>
			),
		},
	]

	return (
		<>
			<PageHeader
				eyebrow="Partnership"
				title="My students"
				subtitle={q.data ? `${all.length} student${all.length === 1 ? "" : "s"} you sponsor — tap a student to see results, attendance and fees.` : "The students you sponsor."}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, number or programme"
				chips={FILTERS.map((f) => ({ ...f, count: q.data ? counts[f.id] : undefined }))}
				active={filter}
				onChip={setFilter}
				right={
					<div className="inline-flex rounded-xl border border-line p-0.5" role="group" aria-label="View">
						{[
							{ id: "cards", icon: LayoutGrid, label: "Cards" },
							{ id: "table", icon: List, label: "Table" },
						].map((v) => (
							<button
								key={v.id}
								type="button"
								aria-pressed={view === v.id}
								aria-label={`${v.label} view`}
								onClick={() => setView(v.id)}
								className={clsx("grid h-8 w-9 place-items-center rounded-lg transition", view === v.id ? "bg-brand-800 text-white" : "text-ink-soft hover:text-ink")}
							>
								<v.icon size={16} />
							</button>
						))}
					</div>
				}
			/>
			{view === "table" ? (
				<DataTable
					cols={cols}
					rows={q.data ? rows : undefined}
					query={q}
					rowKey="student"
					rowTo={(s) => `/sponsor/students/${s.student}`}
					empty={all.length ? "No students match your search" : "You aren't sponsoring any students yet"}
					emptyIcon={GraduationCap}
				/>
			) : q.isLoading ? (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<StudentCardSkeleton key={i} />
					))}
				</div>
			) : q.isError ? (
				<DataTable cols={cols} query={q} />
			) : !rows.length ? (
				<div className="card">
					<Empty
						icon={GraduationCap}
						title={all.length ? "No students match" : "No sponsored students yet"}
						subtitle={all.length ? "Try a different search or filter." : "When the college links a student to your sponsorship, they'll appear here."}
						action={
							all.length ? (
								<Button
									variant="secondary"
									onClick={() => {
										setSearch("")
										setFilter("all")
									}}
								>
									Clear filters
								</Button>
							) : null
						}
					/>
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{rows.map((s) => (
						<StudentCard key={s.student} s={s} progress={progressOf[s.student]} onPay={setPayFor} />
					))}
				</div>
			)}
			<PayForStudentDialog student={payFor} open={Boolean(payFor)} onClose={() => setPayFor(null)} />
		</>
	)
}
