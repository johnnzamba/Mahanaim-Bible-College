import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Chip, Empty, ErrorState, Skeleton } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { Band, CtaBand, PageHero, Scripture } from "../components/Blocks"
import { PersonCard } from "../components/Cards"
import { PersonModal } from "../components/PersonModal"
import { VERSES } from "../content"
import { W, useParamState, usePageMeta } from "../lib"

export default function Faculty() {
	usePageMeta("Faculty and leadership", "Meet the lecturers and leaders who teach and shepherd students at the college.")
	const q = useApi(`${W}faculty`, {}, { guest: true })
	const [dept, setDept] = useParamState("department")
	const [search, setSearch] = useState("")
	const [person, setPerson] = useState(null)
	const all = q.data?.data || []
	const departments = q.data?.departments?.length ? q.data.departments : [...new Set(all.map((p) => p.department).filter(Boolean))].sort()
	const rows = useMemo(() => {
		const needle = search.trim().toLowerCase()
		return all.filter(
			(p) =>
				(!dept || p.department === dept) &&
				(!needle || [p.full_name, p.name, p.designation, p.department, p.specialisation].filter(Boolean).join(" ").toLowerCase().includes(needle))
		)
	}, [all, dept, search])
	const leaders = rows.filter((p) => !p.is_lecturer)
	const lecturers = rows.filter((p) => p.is_lecturer)
	const grouped = leaders.length && lecturers.length

	return (
		<>
			<PageHero
				eyebrow="Faculty and leadership"
				title="Scholars who shepherd"
				subtitle="Our lecturers are qualified theologians and practising ministers: pastors, missionaries and counsellors who bring the classroom and the church together."
				crumbs={[{ label: "About", to: "/about" }, { label: "Faculty" }]}
			/>

			<Band>
				{q.isLoading ? (
					<div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
						{Array.from({ length: 8 }).map((_, i) => (
							<Skeleton key={i} className="h-72 rounded-2xl" />
						))}
					</div>
				) : q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : !all.length ? (
					<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
						<div className="card">
							<Empty
								icon={Users}
								title="Faculty profiles are being updated"
								subtitle="Profiles of our lecturers and leaders will be published here soon."
								action={
									<Link to="/contact" className="btn btn-secondary">
										Contact the academic office
									</Link>
								}
							/>
						</div>
						<Scripture verse={VERSES.ministry} size="lg" />
					</div>
				) : (
					<>
						<div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
							<div className="flex flex-wrap gap-2">
								<Chip active={!dept} onClick={() => setDept("")}>
									Everyone
								</Chip>
								{departments.map((d) => (
									<Chip key={d} active={dept === d} onClick={() => setDept(dept === d ? "" : d)}>
										{d}
									</Chip>
								))}
							</div>
							<SearchInput value={search} onChange={setSearch} placeholder="Search by name or specialisation" className="lg:w-72" />
						</div>
						{!rows.length ? (
							<div className="card">
								<Empty icon={Users} title="No one matches your search" subtitle="Try another name or department." />
							</div>
						) : grouped ? (
							<div className="space-y-14">
								<div>
									<h2 className="mb-6 font-serif text-2xl text-ink">Leadership</h2>
									<div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
										{leaders.map((p) => (
											<PersonCard key={p.name} person={p} onClick={() => setPerson(p)} />
										))}
									</div>
								</div>
								<div>
									<h2 className="mb-6 font-serif text-2xl text-ink">Lecturers</h2>
									<div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
										{lecturers.map((p) => (
											<PersonCard key={p.name} person={p} onClick={() => setPerson(p)} />
										))}
									</div>
								</div>
							</div>
						) : (
							<div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4">
								{rows.map((p) => (
									<PersonCard key={p.name} person={p} onClick={() => setPerson(p)} />
								))}
							</div>
						)}
					</>
				)}
			</Band>

			<Band tone="cream">
				<div className="grid gap-10 lg:grid-cols-2 lg:items-center">
					<div>
						<div className="eyebrow">Teach with us</div>
						<h2 className="mt-2 font-serif text-3xl text-ink">Called to train the next generation?</h2>
						<p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
							We welcome enquiries from qualified ministers and theologians who share our statement of faith and would like to serve as full-time,
							part-time or visiting lecturers.
						</p>
						<Link to="/contact?type=General" className="btn btn-primary mt-6">
							Get in touch <ArrowRight size={16} />
						</Link>
					</div>
					<div className="card p-7">
						<Scripture verse={VERSES.faithfulMen} />
					</div>
				</div>
			</Band>
			<CtaBand />
			<PersonModal person={person} onClose={() => setPerson(null)} />
		</>
	)
}
