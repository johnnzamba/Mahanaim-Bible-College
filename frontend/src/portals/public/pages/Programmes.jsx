import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, GraduationCap, Mail, SlidersHorizontal, X } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Chip, Empty, ErrorState, Select } from "@/shared/components/ui"
import { SearchInput, useDebounced } from "@/shared/components/kit"
import { Band, CtaBand, PageHero } from "../components/Blocks"
import { CardGridSkeleton, ProgrammeCard } from "../components/Cards"
import { NamedIcon } from "../components/NamedIcon"
import { PATHWAYS } from "../content"
import { W, sortLevels, useParamState, usePageMeta, useUpdateParams } from "../lib"

export default function Programmes() {
	const [level, setLevel] = useParamState("level")
	const [mode, setMode] = useParamState("mode")
	const [campus, setCampus] = useParamState("campus")
	const [qParam, setQParam] = useParamState("q")
	const [search, setSearch] = useState(qParam)
	const debounced = useDebounced(search, 350)
	useEffect(() => {
		if (debounced !== qParam) setQParam(debounced.trim())
	}, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

	usePageMeta(level ? `${level} programmes` : "Programmes", "Certificate, diploma and degree programmes in Bible, theology and ministry: full-time, evening, weekend and online.")
	const q = useApi(
		`${W}programmes`,
		{ level: level || undefined, search: qParam || undefined, study_mode: mode || undefined, campus: campus || undefined },
		{ guest: true, placeholderData: (prev) => prev }
	)
	const d = q.data || {}
	const facets = d.facets || {}
	const levels = sortLevels(facets.levels || [])
	const rows = d.data || []
	const filtered = Boolean(level || mode || campus || qParam)
	const update = useUpdateParams()
	const clear = () => {
		setSearch("")
		update({ level: "", mode: "", campus: "", q: "" })
	}
	const catalogueEmpty = q.isSuccess && !filtered && rows.length === 0

	return (
		<>
			<PageHero
				eyebrow="Programmes"
				title="Train for the work of the ministry"
				subtitle="Certificate, diploma and degree programmes in Bible, theology and Christian ministry, taught by practising ministers, on campus and online."
				crumbs={[{ label: "Academics", to: "/academics" }, { label: "Programmes" }]}
			>
				<div className="mt-8 max-w-xl">
					<SearchInput value={search} onChange={setSearch} placeholder="Search programmes, e.g. theology, diploma, missions" className="[&_input]:h-12 [&_input]:text-[15px]" />
				</div>
			</PageHero>

			<Band className="!pt-10">
				{!catalogueEmpty ? (
					<div className="mb-8 space-y-4">
						<div className="flex flex-wrap items-center gap-2">
							<span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-soft">
								<SlidersHorizontal size={14} /> Level
							</span>
							<Chip active={!level} onClick={() => setLevel("")}>
								All levels
							</Chip>
							{levels.map((l) => (
								<Chip key={l} active={level === l} onClick={() => setLevel(level === l ? "" : l)}>
									{l}
								</Chip>
							))}
						</div>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
							{facets.study_modes?.length ? (
								<Select
									label="Study mode"
									className="sm:w-56"
									value={mode}
									onChange={(e) => setMode(e.target.value)}
									placeholder="Any study mode"
									options={facets.study_modes}
								/>
							) : null}
							{facets.campuses?.length > 1 ? (
								<Select label="Campus" className="sm:w-56" value={campus} onChange={(e) => setCampus(e.target.value)} placeholder="Any campus" options={facets.campuses} />
							) : null}
							<div className="flex flex-1 items-center justify-between gap-3 sm:justify-end">
								<span className="text-sm text-ink-soft" aria-live="polite">
									{q.isSuccess ? `${d.total ?? rows.length} programme${(d.total ?? rows.length) === 1 ? "" : "s"}` : ""}
								</span>
								{filtered ? (
									<button type="button" onClick={clear} className="btn btn-ghost btn-sm">
										<X size={14} /> Clear filters
									</button>
								) : null}
							</div>
						</div>
					</div>
				) : null}

				{q.isLoading ? (
					<CardGridSkeleton count={6} />
				) : q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : rows.length ? (
					<div className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 ${q.isFetching ? "opacity-70 transition" : ""}`}>
						{rows.map((p) => (
							<ProgrammeCard key={p.code} p={p} />
						))}
					</div>
				) : filtered ? (
					<div className="card">
						<Empty
							icon={GraduationCap}
							title="No programmes match your filters"
							subtitle="Try a different level or study mode, or clear the filters to see everything we offer."
							action={
								<button type="button" className="btn btn-secondary" onClick={clear}>
									Clear filters
								</button>
							}
						/>
					</div>
				) : (
					<div className="space-y-8">
						<div className="card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
							<div>
								<h2 className="font-serif text-2xl text-ink">Programme details are being published</h2>
								<p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-muted">
									Our full catalogue will be listed here shortly. In the meantime, here are the pathways we offer. The admissions office will gladly
									help you choose.
								</p>
							</div>
							<Link to="/contact?type=Admissions" className="btn btn-primary shrink-0">
								<Mail size={16} /> Ask admissions
							</Link>
						</div>
						<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
							{PATHWAYS.map((p) => (
								<div key={p.level} className="card p-6">
									<span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-800 text-gold-300">
										<NamedIcon name={p.icon} size={22} />
									</span>
									<h3 className="mt-4 font-serif text-xl text-ink">{p.title}</h3>
									<div className="text-xs font-semibold uppercase tracking-wider text-gold-700">{p.duration}</div>
									<p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.text}</p>
								</div>
							))}
						</div>
					</div>
				)}

				<div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl bg-cream p-6 ring-1 ring-gold-200 sm:flex-row sm:items-center">
					<div>
						<div className="font-semibold text-ink">Not sure which programme is right for you?</div>
						<p className="text-sm text-ink-muted">Compare entry requirements, study modes and fees, or speak to an admissions officer.</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Link to="/admissions" className="btn btn-secondary">
							Entry requirements
						</Link>
						<Link to="/fees" className="btn btn-ghost">
							Fees <ArrowRight size={14} />
						</Link>
					</div>
				</div>
			</Band>
			<CtaBand />
		</>
	)
}
