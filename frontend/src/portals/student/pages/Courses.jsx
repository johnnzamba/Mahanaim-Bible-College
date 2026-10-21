import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, GraduationCap } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Empty, PageHeader, QueryState, Skeleton, Tabs } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { API } from "../components/lib"
import { CourseCard } from "../components/bits"

export default function Courses() {
	const q = useApi(API.courses)
	const [tab, setTab] = useState("current")
	const [search, setSearch] = useState("")
	const all = q.data?.data || []
	const current = all.filter((c) => c.enrolment_status === "Enrolled")
	const past = all.filter((c) => c.enrolment_status !== "Enrolled")
	const list = useMemo(() => {
		const base = tab === "current" ? current : tab === "past" ? past : all
		const s = search.trim().toLowerCase()
		return s ? base.filter((c) => `${c.course} ${c.course_title}`.toLowerCase().includes(s)) : base
	}, [tab, current, past, all, search])

	const byTerm = useMemo(() => {
		const m = new Map()
		for (const c of list) {
			const k = c.academic_term || "Other"
			if (!m.has(k)) m.set(k, [])
			m.get(k).push(c)
		}
		return [...m.entries()]
	}, [list])

	return (
		<>
			<PageHeader
				eyebrow="Learning"
				title="My courses"
				subtitle="Course notes, recordings, readings and your progress for every course you're enrolled in."
				actions={
					<Link to="/student/registration" className="btn btn-secondary btn-sm">
						Registration
					</Link>
				}
			/>
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<Tabs className="pb-px"
					tabs={[
						{ id: "current", label: "This term", count: current.length },
						{ id: "past", label: "Completed", count: past.length },
						{ id: "all", label: "All", count: all.length },
					]}
					active={tab}
					onChange={setTab}
				/>
				<SearchInput value={search} onChange={setSearch} placeholder="Search courses…" className="sm:w-64" />
			</div>
			<QueryState
				query={q}
				skeleton={
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{[0, 1, 2, 3, 4, 5].map((i) => (
							<Skeleton key={i} className="h-40 rounded-2xl" />
						))}
					</div>
				}
			>
				{() =>
					list.length ? (
						<div className="space-y-6">
							{byTerm.map(([term, rows]) => (
								<section key={term}>
									{tab !== "current" ? (
										<h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
											<GraduationCap size={14} /> {term}
										</h2>
									) : null}
									<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
										{rows.map((c) => (
											<CourseCard key={c.name} course={c} />
										))}
									</div>
								</section>
							))}
						</div>
					) : (
						<div className="card">
							<Empty
								icon={BookOpen}
								title={search ? "No matching courses" : tab === "current" ? "No courses this term" : "Nothing here yet"}
								subtitle={tab === "current" ? "Courses appear once your registration is approved." : undefined}
							/>
						</div>
					)
				}
			</QueryState>
		</>
	)
}
