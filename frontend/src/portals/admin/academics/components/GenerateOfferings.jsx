import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, CircleSlash, Wand2 } from "lucide-react"
import { Alert, Badge, Button, Modal, Select, SkeletonRows } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { num } from "@/shared/utils/format"
import { ACAD, BASE, nameOptions, rowsOf, termOptions, useAcross } from "../lib"

/**
 * generate_offerings has no dry run, so the preview replays its rules client-side:
 * candidate programmes (explicit, or Active ones open to the campus / study mode), their curriculum rows for
 * the term's term number, minus courses already offered at that campus this term or inactive.
 */
function usePreview({ term, campus, programme, study_mode }, lookups, enabled) {
	const termNumber = Number((lookups?.terms || []).find((t) => t.name === term)?.term_number || 1)
	const candidates = useMemo(() => {
		if (programme) return [programme]
		return (lookups?.programmes || []).filter((p) => p.status === "Active").map((p) => p.name)
	}, [programme, lookups])
	const ready = enabled && Boolean(term && campus)
	const progs = useAcross(`${ACAD}get_programme`, candidates, (code) => ({ code }), { enabled: ready })
	const existing = useApi(`${ACAD}list_offerings`, { term, campus, page_length: 200 }, { enabled: ready })
	const inactive = useApi(`${ACAD}list_courses`, { is_active: 0, page_length: 200 }, { enabled: ready })

	const rows = useMemo(() => {
		if (!progs.data || !existing.data || !inactive.data) return null
		const off = rowsOf(existing.data).filter((o) => o.status !== "Cancelled")
		const dead = new Set(rowsOf(inactive.data).map((c) => c.name))
		const out = new Map()
		for (const { item, data } of progs.data) {
			if (!data) continue
			if (!programme) {
				if (data.campuses?.length && !data.campuses.includes(campus)) continue
				if (study_mode && data.study_modes?.length && !data.study_modes.includes(study_mode)) continue
			}
			const curriculum = [...(data.curriculum || [])].filter((r) => Number(r.term_number) === termNumber).sort((a, b) => a.year_of_study - b.year_of_study)
			for (const r of curriculum) {
				const prev = out.get(r.course)
				if (prev) {
					prev.programmes.push(item)
					continue
				}
				const already = off.find((o) => o.course === r.course && (!study_mode || !o.study_mode || o.study_mode === study_mode))
				out.set(r.course, {
					course: r.course,
					course_title: r.course_title,
					credits: r.credits,
					year: r.year_of_study,
					programmes: [item],
					reason: already ? "Already offered" : dead.has(r.course) ? "Course is inactive" : null,
					existing: already?.name,
				})
			}
		}
		return [...out.values()]
	}, [progs.data, existing.data, inactive.data, programme, campus, study_mode, termNumber])

	return { rows, termNumber, loading: ready && !rows && !(progs.isError || existing.isError || inactive.isError), error: progs.error || existing.error || inactive.error }
}

export function GenerateOfferings({ open, onClose, lookups, defaults = {} }) {
	const [v, setV] = useState({ term: "", campus: "", programme: "", study_mode: "" })
	const [result, setResult] = useState(null)
	useEffect(() => {
		if (open) {
			setResult(null)
			setV({
				term: defaults.term || lookups?.current_term || "",
				campus: defaults.campus || (lookups?.campuses?.length === 1 ? lookups.campuses[0].name : ""),
				programme: defaults.programme || "",
				study_mode: "",
			})
		}
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps

	const preview = usePreview(v, lookups, open && !result)
	const create = preview.rows ? preview.rows.filter((r) => !r.reason) : []
	const skip = preview.rows ? preview.rows.filter((r) => r.reason) : []

	const run = useAction(`${ACAD}generate_offerings`, {
		invalidate: [ACAD],
		success: (d) => `${d.created} offering${d.created === 1 ? "" : "s"} created`,
		onSuccess: (d) => setResult(d),
	})
	const set = (k) => (e) => setV((cur) => ({ ...cur, [k]: e.target.value }))
	const termLabel = (lookups?.terms || []).find((t) => t.name === v.term)?.term_label || v.term

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Generate offerings"
			subtitle="Creates a Planned section A offering for every curriculum course taught in this term."
			footer={
				result ? (
					<Button onClick={onClose}>Done</Button>
				) : (
					<>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button
							icon={Wand2}
							loading={run.isPending}
							disabled={!v.term || !v.campus || !preview.rows || !create.length}
							onClick={() => run.mutate({ term: v.term, campus: v.campus, programme: v.programme || undefined, study_mode: v.study_mode || undefined })}
						>
							{preview.rows ? `Create ${create.length} offering${create.length === 1 ? "" : "s"}` : "Create offerings"}
						</Button>
					</>
				)
			}
		>
			{result ? (
				<div className="space-y-4">
					<Alert tone={result.created ? "success" : "info"} title={`${result.created} created, ${result.skipped} skipped`}>
						Term number {result.term_number} of {termLabel}, from {result.programmes?.length || 0} programme{result.programmes?.length === 1 ? "" : "s"}. New offerings have no lecturer yet.
					</Alert>
					{result.offerings?.length ? (
						<ul className="divide-y divide-line rounded-xl border border-line">
							{result.offerings.map((o) => (
								<li key={o} className="flex items-center gap-2 px-3 py-2 text-sm">
									<CheckCircle2 size={15} className="text-green-600" />
									<Link to={`${BASE}/offerings/${encodeURIComponent(o)}`} className="font-semibold text-brand-700 hover:underline" onClick={onClose}>
										{o}
									</Link>
								</li>
							))}
						</ul>
					) : null}
					{result.skipped_courses?.length ? (
						<p className="text-xs text-ink-soft">
							Skipped: {result.skipped_courses.map((s) => `${s.course} (${s.reason.toLowerCase()})`).join(", ")}
						</p>
					) : null}
				</div>
			) : (
				<div className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<Select label="Term" required value={v.term} onChange={set("term")} placeholder="Choose…" options={termOptions(lookups)} />
						<Select label="Campus" required value={v.campus} onChange={set("campus")} placeholder="Choose…" options={nameOptions(lookups?.campuses, "campus_name")} />
						<Select label="Programme" value={v.programme} onChange={set("programme")} placeholder="All active programmes at this campus" options={(lookups?.programmes || []).filter((p) => p.status === "Active").map((p) => ({ value: p.name, label: `${p.programme_name} (${p.code || p.name})` }))} />
						<Select label="Study mode" value={v.study_mode} onChange={set("study_mode")} placeholder="Any / not set" options={nameOptions(lookups?.study_modes, "study_mode_name")} />
					</div>
					{!v.term || !v.campus ? (
						<p className="rounded-xl bg-cream/70 px-4 py-3 text-sm text-ink-muted">Choose a term and campus to preview what will be created.</p>
					) : preview.error ? (
						<Alert tone="error" title="Couldn't build the preview">
							{preview.error.message}
						</Alert>
					) : preview.loading || !preview.rows ? (
						<SkeletonRows rows={4} />
					) : !preview.rows.length ? (
						<Alert tone="warning" title="Nothing to generate">
							No curriculum course is scheduled in term {preview.termNumber} for the selected programmes. Check the programmes' curricula and campuses.
						</Alert>
					) : (
						<>
							<div className="flex flex-wrap gap-2 text-sm">
								<Badge tone="green">{num(create.length)} to create</Badge>
								{skip.length ? <Badge tone="gray">{num(skip.length)} skipped</Badge> : null}
								<Badge tone="brand">Curriculum term {preview.termNumber}</Badge>
							</div>
							<ul className="scroll-thin max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
								{[...create, ...skip].map((r) => (
									<li key={r.course} className="flex items-center gap-3 px-3 py-2 text-sm">
										{r.reason ? <CircleSlash size={15} className="shrink-0 text-ink-soft" /> : <CheckCircle2 size={15} className="shrink-0 text-green-600" />}
										<span className="min-w-0 flex-1">
											<span className={r.reason ? "block truncate text-ink-soft" : "block truncate font-semibold text-ink"}>
												{r.course} · {r.course_title}
											</span>
											<span className="block truncate text-xs text-ink-soft">
												Year {r.year} · {r.programmes.join(", ")}
											</span>
										</span>
										{r.reason ? (
											r.existing ? (
												<Link to={`${BASE}/offerings/${encodeURIComponent(r.existing)}`} className="text-xs font-semibold text-brand-700 hover:underline" onClick={onClose}>
													{r.reason}
												</Link>
											) : (
												<Badge size="xs" tone="orange">
													{r.reason}
												</Badge>
											)
										) : (
											<Badge size="xs" tone="green">
												New
											</Badge>
										)}
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			)}
		</Modal>
	)
}
