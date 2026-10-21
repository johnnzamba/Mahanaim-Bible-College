import { useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, ChevronRight, ExternalLink, FileCheck2, PenLine, Users } from "lucide-react"
import { Badge, Card, Empty, PageHeader, QueryState, Select, SkeletonRows } from "@/shared/components/ui"
import { DataTable, SearchInput, useDebounced } from "@/shared/components/kit"
import { StatusBadge } from "../components/bits"
import { safeUrl } from "@/shared/utils/sanitize"
import { offeringLabel, useMyOfferings } from "../components/lib"

function CourseCard({ o }) {
	const toGrade = (o.to_grade?.submissions || 0) + (o.to_grade?.essay_answers || 0)
	return (
		<Link to={`/lecturer/courses/${o.name}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift">
			<div className="flex items-start justify-between gap-3">
				<div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
					<BookOpen size={20} />
				</div>
				<div className="flex flex-wrap justify-end gap-1.5">
					{o.my_role && o.my_role !== "Lead" ? <Badge tone="purple">{o.my_role}</Badge> : null}
					<StatusBadge kind="sheet" status={o.results_status || "Not Started"} size="xs">
						Marks: {o.results_status || "Not started"}
					</StatusBadge>
				</div>
			</div>
			<div className="mt-3 text-xs font-bold uppercase tracking-wide text-gold-700">{o.course}</div>
			<h3 className="mt-0.5 line-clamp-2 font-display text-lg font-semibold text-ink">{o.course_title}</h3>
			<p className="mt-1 text-xs text-ink-soft">
				{o.academic_term} · {o.campus}
				{o.study_mode ? ` · ${o.study_mode}` : ""}
				{o.section && o.section !== "A" ? ` · Section ${o.section}` : ""}
			</p>
			<div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
				<div>
					<div className="flex items-center justify-center gap-1 text-base font-bold tabular-nums text-ink">
						<Users size={14} className="text-ink-soft" /> {o.enrolled_count ?? 0}
					</div>
					<div className="text-[11px] text-ink-soft">students</div>
				</div>
				<div>
					<div className={`flex items-center justify-center gap-1 text-base font-bold tabular-nums ${o.to_grade?.submissions ? "text-gold-700" : "text-ink"}`}>
						<FileCheck2 size={14} className="text-ink-soft" /> {o.to_grade?.submissions || 0}
					</div>
					<div className="text-[11px] text-ink-soft">to grade</div>
				</div>
				<div>
					<div className={`flex items-center justify-center gap-1 text-base font-bold tabular-nums ${o.to_grade?.essay_answers ? "text-orange-600" : "text-ink"}`}>
						<PenLine size={14} className="text-ink-soft" /> {o.to_grade?.essay_answers || 0}
					</div>
					<div className="text-[11px] text-ink-soft">exam answers</div>
				</div>
			</div>
			<div className="mt-4 flex items-center justify-between text-sm font-semibold text-brand-700">
				<span>Open workspace</span>
				<ChevronRight size={16} className="transition group-hover:translate-x-0.5" />
			</div>
		</Link>
	)
}

export default function Courses() {
	const [term, setTerm] = useState("")
	const [view, setView] = useState("cards")
	const [search, setSearch] = useState("")
	const q = useMyOfferings(term)
	const all = useMyOfferings("all")
	const s = useDebounced(search).toLowerCase()
	const rows = (q.data?.data || []).filter((o) => !s || `${o.course} ${o.course_title} ${o.academic_term}`.toLowerCase().includes(s))
	const terms = [...new Set((all.data?.data || []).map((o) => o.academic_term).filter(Boolean))].sort().reverse()

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Teaching"
				title="My courses"
				subtitle={q.data?.term ? `Course offerings you teach in ${q.data.term}.` : "Course offerings you teach."}
			/>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
				<SearchInput value={search} onChange={setSearch} placeholder="Search courses…" className="w-full sm:max-w-xs" />
				<Select
					label="Term"
					className="w-full sm:w-64"
					value={term}
					onChange={(e) => setTerm(e.target.value)}
					options={[
						{ value: "", label: "Current term" },
						{ value: "all", label: "All terms" },
						...terms.filter((t) => t !== all.data?.term).map((t) => ({ value: t, label: t })),
					]}
				/>
				<div className="flex gap-1 sm:ml-auto" role="group" aria-label="View">
					<button type="button" className={`chip ${view === "cards" ? "chip-active" : ""}`} onClick={() => setView("cards")}>
						Cards
					</button>
					<button type="button" className={`chip ${view === "table" ? "chip-active" : ""}`} onClick={() => setView("table")}>
						Table
					</button>
				</div>
			</div>

			{view === "cards" ? (
				<QueryState
					query={q}
					skeleton={
						<Card className="p-5">
							<SkeletonRows rows={4} />
						</Card>
					}
				>
					{() =>
						rows.length ? (
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{rows.map((o) => (
									<CourseCard key={o.name} o={o} />
								))}
							</div>
						) : (
							<Card>
								<Empty
									icon={BookOpen}
									title={search ? "No course matches your search" : term === "" ? "No courses this term" : "No courses found"}
									subtitle={term === "" ? "Switch to All terms to see courses you taught before." : "The registry assigns lecturers to course offerings."}
								/>
							</Card>
						)
					}
				</QueryState>
			) : (
				<DataTable
					query={q}
					rows={q.isSuccess ? rows : undefined}
					rowTo={(o) => `/lecturer/courses/${o.name}`}
					empty="No courses found"
					emptyIcon={BookOpen}
					cols={[
						{ key: "course_title", label: "Course", render: (o) => <span className="font-semibold text-ink">{offeringLabel(o)}</span>, sortValue: (o) => o.course, exportValue: offeringLabel },
						{ key: "academic_term", label: "Term", hideOnMobile: true },
						{ key: "campus", label: "Campus", hideOnMobile: true },
						{ key: "enrolled_count", label: "Students", align: "right" },
						{ key: "submissions", label: "To grade", align: "right", sortValue: (o) => o.to_grade?.submissions || 0, render: (o) => o.to_grade?.submissions || 0 },
						{ key: "results_status", label: "Mark sheet", render: (o) => <StatusBadge kind="sheet" status={o.results_status || "Not Started"} /> },
						{
							key: "lms",
							label: "LMS",
							hideOnMobile: true,
							render: (o) =>
								safeUrl(o.lms_url) ? (
									<a href={safeUrl(o.lms_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700" onClick={(e) => e.stopPropagation()}>
										Open <ExternalLink size={12} />
									</a>
								) : (
									<span className="text-ink-soft">—</span>
								),
						},
					]}
				/>
			)}
		</div>
	)
}
