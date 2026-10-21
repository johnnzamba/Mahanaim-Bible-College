import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { ArrowDownWideNarrow, GraduationCap, Plus, Ruler, Save, Star, Trash2 } from "lucide-react"
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Empty, ErrorState, IconButton, Input, PageHeader, Panel, SkeletonRows, Switch, Textarea } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { PALETTE } from "@/shared/components/Charts"
import { bandErrors, fmtScore, gradeFor, useAcademicRoles } from "../lib"
import { SubNav } from "../components/common"

const LIST = "frappe.client.get_list"
const DOC = "Grading Scale"
const TEMPLATE_BANDS = [
	{
		grade: "A",
		min_score: 70,
		max_score: 100,
		grade_points: 4,
		description: "Excellent",
		is_pass: 1,
	},
	{
		grade: "B",
		min_score: 60,
		max_score: 69.99,
		grade_points: 3,
		description: "Good",
		is_pass: 1,
	},
	{
		grade: "C",
		min_score: 50,
		max_score: 59.99,
		grade_points: 2,
		description: "Satisfactory",
		is_pass: 1,
	},
	{
		grade: "D",
		min_score: 40,
		max_score: 49.99,
		grade_points: 1,
		description: "Pass",
		is_pass: 1,
	},
	{
		grade: "E",
		min_score: 0,
		max_score: 39.99,
		grade_points: 0,
		description: "Fail",
		is_pass: 0,
	},
]
const BAND_KEYS = ["name", "grade", "min_score", "max_score", "grade_points", "description", "is_pass"]
const CLASS_KEYS = ["name", "classification", "min_cgpa", "max_cgpa"]
const pick = (r, keys) => Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]))
const n = (v) => Number(v || 0)

/** Mirrors grading_scale.classification_errors. */
function classErrors(rows) {
	const errors = []
	const seen = new Set()
	for (const r of rows) {
		const key = String(r.classification || "")
			.trim()
			.toLowerCase()
		if (!key) errors.push("Every classification needs a name.")
		else if (seen.has(key)) errors.push(`Classification ${r.classification} is listed twice.`)
		seen.add(key)
		if (n(r.min_cgpa) < 0 || n(r.min_cgpa) > n(r.max_cgpa)) errors.push(`Classification ${r.classification || "?"}: min CGPA must be between 0 and max CGPA.`)
	}
	const ordered = [...rows].sort((a, b) => n(a.min_cgpa) - n(b.min_cgpa))
	for (let i = 1; i < ordered.length; i++)
		if (n(ordered[i].min_cgpa) < n(ordered[i - 1].max_cgpa) - 1e-9) errors.push(`Classifications ${ordered[i - 1].classification} and ${ordered[i].classification} overlap.`)
	return [...new Set(errors)]
}

function fromDoc(d) {
	return {
		scale_name: d.scale_name || d.name,
		pass_mark: d.pass_mark ?? 40,
		is_default: d.is_default ? 1 : 0,
		description: d.description || "",
		bands: (d.bands || []).map((b) => pick(b, BAND_KEYS)),
		classifications: (d.classifications || []).map((c) => pick(c, CLASS_KEYS)),
	}
}

/** 0–100 strip with one segment per band and the pass mark marked; doubles as the live preview. */
export function ScaleStrip({ bands, passMark, score, compact }) {
	const asc = [...bands].filter((b) => b.grade).sort((a, b) => n(a.min_score) - n(b.min_score))
	const hit = score !== "" && score != null ? gradeFor(score, bands) : null
	return (
		<div className={compact ? "" : "pt-5"}>
			<div className={clsx("relative flex overflow-hidden rounded-lg bg-line/50", compact ? "h-2.5" : "h-10")}>
				{asc.map((b, i) => {
					const w = Math.max(0, Math.min(100, n(b.max_score)) - Math.max(0, n(b.min_score)))
					return (
						<div
							key={`${b.grade}-${i}`}
							className={clsx("flex h-full items-center justify-center border-r border-white/60 text-xs font-bold text-white last:border-r-0", hit && hit !== b && !compact && "opacity-40")}
							style={{
								width: `${w}%`,
								background: PALETTE[(asc.length - 1 - i) % PALETTE.length],
							}}
							title={`${b.grade}: ${fmtScore(b.min_score, 2)}–${fmtScore(b.max_score, 2)}`}
						>
							{!compact && w >= 5 ? b.grade : null}
						</div>
					)
				})}
			</div>
			{!compact ? (
				<div className="relative mt-1 h-4 text-[10px] text-ink-soft">
					{[0, 25, 50, 75, 100].map((t) => (
						<span key={t} className={clsx("absolute", t === 0 ? "" : t === 100 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${t}%` }}>
							{t}
						</span>
					))}
				</div>
			) : null}
			{!compact && passMark != null ? (
				<div className="pointer-events-none relative -mt-[3.75rem] h-14">
					<div className="absolute top-0 h-14 w-0.5 bg-red-600" style={{ left: `${Math.min(100, n(passMark))}%` }} />
					<span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-1.5 text-[10px] font-semibold text-white" style={{ left: `${Math.min(100, n(passMark))}%` }}>
						pass {fmtScore(passMark)}
					</span>
					{hit ? <div className="absolute top-1 h-8 w-1 -translate-x-1/2 rounded bg-ink shadow" style={{ left: `${Math.min(100, Math.max(0, n(score)))}%` }} /> : null}
				</div>
			) : null}
		</div>
	)
}

function ScaleList({ scales, bands, active, onPick, loading }) {
	if (loading) return <SkeletonRows rows={4} />
	if (!scales.length) return <Empty compact icon={Ruler} title="No grading scales" subtitle="Create one to start grading." />
	return (
		<ul className="space-y-2">
			{scales.map((s) => {
				const own = bands.filter((b) => b.parent === s.name)
				return (
					<li key={s.name}>
						<button
							type="button"
							onClick={() => onPick(s.name)}
							className={clsx("w-full rounded-xl border p-3 text-left transition", active === s.name ? "border-brand-500 bg-brand-50/60 dark:bg-brand-900/20" : "border-line hover:border-brand-300")}
						>
							<div className="flex items-center gap-2">
								<span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.name}</span>
								{s.is_default ? (
									<Badge tone="gold" size="xs">
										Default
									</Badge>
								) : null}
							</div>
							<div className="mt-0.5 text-xs text-ink-soft">
								Pass mark {fmtScore(s.pass_mark)} · {own.length} grade
								{own.length === 1 ? "" : "s"}
								{own.length
									? ` · ${[...own]
											.sort((a, b) => n(b.min_score) - n(a.min_score))
											.map((b) => b.grade)
											.join(" ")}`
									: ""}
							</div>
							{own.length ? (
								<div className="mt-2">
									<ScaleStrip bands={own} compact />
								</div>
							) : null}
						</button>
					</li>
				)
			})}
		</ul>
	)
}

function numberInput(value, onChange, props = {}) {
	return (
		<input
			type="number"
			step="any"
			value={value ?? ""}
			onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
			className="input h-9 w-full min-w-0 px-2 text-right tabular-nums"
			{...props}
		/>
	)
}

function Editor({ name, isNew, canEdit, onSaved, onDeleted, defaultName }) {
	const q = useApi("frappe.client.get", { doctype: DOC, name }, { enabled: !isNew && Boolean(name) })
	const usage = useApi("frappe.client.get_count", { doctype: "Course Offering", filters: { grading_scale: name } }, { enabled: !isNew && Boolean(name) })
	const [v, setV] = useState(null)
	const [base, setBase] = useState("")
	const [score, setScore] = useState(65)
	const [touched, setTouched] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)
	useEffect(() => {
		if (isNew) {
			const fresh = {
				scale_name: "",
				pass_mark: 40,
				is_default: 0,
				description: "",
				bands: TEMPLATE_BANDS.map((b) => ({ ...b })),
				classifications: [],
			}
			setV(fresh)
			setBase(JSON.stringify(fresh))
			setTouched(false)
		} else if (q.data) {
			const d = fromDoc(q.data)
			setV(d)
			setBase(JSON.stringify(d))
			setTouched(false)
		}
	}, [isNew, q.data])
	const invalidate = [LIST, "frappe.client.get", "frappe.client.get_count"]
	const save = useAction(isNew ? "frappe.client.insert" : "frappe.client.save", {
		invalidate,
		success: isNew ? "Grading scale created" : "Grading scale saved",
		onSuccess: (doc) => onSaved(doc.name),
	})
	const remove = useAction("frappe.client.delete", {
		invalidate,
		success: "Grading scale deleted",
		onSuccess: () => {
			setConfirmDelete(false)
			onDeleted()
		},
	})
	const errors = useMemo(
		() =>
			v
				? [
						...(isNew && !v.scale_name.trim() ? ["Give the scale a name."] : []),
						...(n(v.pass_mark) < 0 || n(v.pass_mark) > 100 ? ["Pass mark must be between 0 and 100."] : []),
						...bandErrors(v.bands),
						...classErrors(v.classifications),
					]
				: [],
		[v, isNew]
	)
	if (!isNew && q.isLoading) return <SkeletonRows rows={10} />
	if (!isNew && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />
	if (!v) return null
	const dirty = JSON.stringify(v) !== base
	const ro = !canEdit
	const setBand = (i, patch) =>
		setV((cur) => ({
			...cur,
			bands: cur.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)),
		}))
	const setClass = (i, patch) =>
		setV((cur) => ({
			...cur,
			classifications: cur.classifications.map((c, j) => (j === i ? { ...c, ...patch } : c)),
		}))
	const hit = score !== "" ? gradeFor(score, v.bands) : null
	const passes = hit ? n(score) + 1e-9 >= n(v.pass_mark) : null
	const conflictDefault = v.is_default && defaultName && defaultName !== name
	const submit = () => {
		setTouched(true)
		if (errors.length) return
		const doc = isNew
			? { doctype: DOC, scale_name: v.scale_name.trim() }
			: // creation/owner are set-once in Frappe v16, so frappe.client.save rejects a doc without them
				{
					...pick(q.data, ["doctype", "name", "modified", "creation", "owner", "scale_name"]),
				}
		Object.assign(doc, {
			pass_mark: n(v.pass_mark),
			is_default: v.is_default ? 1 : 0,
			description: v.description || null,
			bands: v.bands.map((b) => ({
				...b,
				doctype: "Grading Scale Band",
				is_pass: b.is_pass ? 1 : 0,
			})),
			classifications: v.classifications.map((c) => ({
				...c,
				doctype: "Award Classification Band",
			})),
		})
		save.mutate({ doc })
	}
	const usedBy = usage.data || 0
	return (
		<div className="space-y-5">
			<Panel
				title={isNew ? "New grading scale" : v.scale_name}
				subtitle={
					isNew
						? "Start from the standard A–E bands and adjust"
						: usedBy
							? `Used by ${usedBy} course offering${usedBy === 1 ? "" : "s"}`
							: "Not linked to any offering (the default applies where none is set)"
				}
				icon={GraduationCap}
				actions={
					!isNew && canEdit && !v.is_default ? (
						<Button size="sm" variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setConfirmDelete(true)}>
							Delete
						</Button>
					) : null
				}
			>
				<div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
					<Input
						label="Scale name"
						required
						value={v.scale_name}
						onChange={(e) => setV((cur) => ({ ...cur, scale_name: e.target.value }))}
						disabled={!isNew || ro}
						hint={isNew ? "Can't be changed later" : undefined}
					/>
					<Input
						label="Pass mark"
						type="number"
						min="0"
						max="100"
						step="any"
						value={v.pass_mark}
						onChange={(e) => setV((cur) => ({ ...cur, pass_mark: e.target.value }))}
						disabled={ro}
						hint="Total out of 100"
					/>
				</div>
				<Textarea className="mt-4" label="Description" rows={2} value={v.description} onChange={(e) => setV((cur) => ({ ...cur, description: e.target.value }))} disabled={ro} />
				<Switch
					className="mt-4"
					label="Default scale"
					description="Used by offerings that don't name a scale. A default set in Mahanaim Settings takes precedence."
					checked={Boolean(v.is_default)}
					onChange={(c) => setV((cur) => ({ ...cur, is_default: c ? 1 : 0 }))}
					disabled={ro}
				/>
				{conflictDefault ? (
					<Alert tone="warning" className="mt-3">
						{defaultName} is the default now. Untick it there first, or this save will be refused.
					</Alert>
				) : null}
				{!isNew && usedBy ? (
					<Alert className="mt-4" title="Changes apply going forward">
						Draft and returned mark sheets regrade on their next recompute. Published results keep the grade they were published with.
					</Alert>
				) : null}
			</Panel>

			<Panel
				title="Grade bands"
				subtitle="Scores are totals out of 100. Bands must cover 0–100 without overlaps."
				actions={
					canEdit ? (
						<div className="flex gap-2">
							<Button
								size="sm"
								variant="ghost"
								icon={ArrowDownWideNarrow}
								onClick={() =>
									setV((cur) => ({
										...cur,
										bands: [...cur.bands].sort((a, b) => n(b.min_score) - n(a.min_score)),
									}))
								}
							>
								Sort
							</Button>
							<Button
								size="sm"
								variant="secondary"
								icon={Plus}
								onClick={() =>
									setV((cur) => ({
										...cur,
										bands: [
											...cur.bands,
											{
												grade: "",
												min_score: "",
												max_score: "",
												grade_points: 0,
												description: "",
												is_pass: 1,
											},
										],
									}))
								}
							>
								Band
							</Button>
						</div>
					) : null
				}
			>
				<div className="scroll-thin -mx-1 overflow-x-auto px-1">
					<table className="w-full min-w-[40rem] text-sm">
						<thead>
							<tr className="text-left text-xs uppercase tracking-wide text-ink-soft">
								<th className="w-20 pb-2 font-semibold">Grade</th>
								<th className="w-24 pb-2 text-right font-semibold">Min</th>
								<th className="w-24 pb-2 text-right font-semibold">Max</th>
								<th className="w-24 pb-2 text-right font-semibold">Points</th>
								<th className="pb-2 pl-2 font-semibold">Remarks</th>
								<th className="w-14 pb-2 text-center font-semibold">Pass</th>
								<th className="w-10 pb-2" />
							</tr>
						</thead>
						<tbody>
							{v.bands.map((b, i) => (
								<tr key={b.name || `new-${i}`} className={clsx("border-t border-line", hit === b && "bg-gold-50/70 dark:bg-gold-900/20")}>
									<td className="py-1.5 pr-2">
										<input aria-label="Grade" value={b.grade} onChange={(e) => setBand(i, { grade: e.target.value })} disabled={ro} className="input h-9 w-full px-2 font-bold" />
									</td>
									<td className="py-1.5 pr-2">{numberInput(b.min_score, (x) => setBand(i, { min_score: x }), { "aria-label": `Min score ${b.grade}`, disabled: ro })}</td>
									<td className="py-1.5 pr-2">{numberInput(b.max_score, (x) => setBand(i, { max_score: x }), { "aria-label": `Max score ${b.grade}`, disabled: ro })}</td>
									<td className="py-1.5 pr-2">{numberInput(b.grade_points, (x) => setBand(i, { grade_points: x }), { "aria-label": `Grade points ${b.grade}`, disabled: ro })}</td>
									<td className="py-1.5 pl-2 pr-2">
										<input
											aria-label="Remarks"
											value={b.description || ""}
											onChange={(e) => setBand(i, { description: e.target.value })}
											disabled={ro}
											className="input h-9 w-full px-2"
											placeholder="e.g. Distinction"
										/>
									</td>
									<td className="py-1.5 text-center">
										<Checkbox aria-label={`${b.grade} is a pass`} checked={Boolean(b.is_pass)} onChange={(c) => setBand(i, { is_pass: c ? 1 : 0 })} disabled={ro} className="inline-flex" />
									</td>
									<td className="py-1.5 text-right">
										{canEdit ? (
											<IconButton
												icon={Trash2}
												tone="danger"
												label={`Remove band ${b.grade}`}
												onClick={() =>
													setV((cur) => ({
														...cur,
														bands: cur.bands.filter((_, j) => j !== i),
													}))
												}
											/>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Panel>

			<Panel title="Live preview" subtitle="How totals map to grades with these bands">
				<ScaleStrip bands={v.bands} passMark={v.pass_mark} score={score} />
				<div className="mt-4 flex flex-wrap items-end gap-4">
					<Input label="Try a total" type="number" min="0" max="100" step="any" value={score} onChange={(e) => setScore(e.target.value === "" ? "" : Number(e.target.value))} className="w-32" />
					{hit ? (
						<div className="flex items-center gap-3 rounded-xl bg-cream/70 px-4 py-2 dark:bg-white/5">
							<span className="font-serif text-3xl font-bold text-ink">{hit.grade}</span>
							<div className="text-sm">
								<div className="font-semibold text-ink">
									{fmtScore(hit.grade_points, 2)} grade points
									{hit.description ? ` · ${hit.description}` : ""}
								</div>
								<div className={passes ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
									{passes ? "Pass" : "Fail"} (pass mark {fmtScore(v.pass_mark)})
								</div>
							</div>
						</div>
					) : null}
					{hit && Boolean(hit.is_pass) !== passes ? (
						<p className="max-w-sm text-xs text-orange-700 dark:text-orange-300">
							Band {hit.grade} is marked {hit.is_pass ? "pass" : "fail"} but the pass mark says {passes ? "pass" : "fail"}. Results use the pass mark.
						</p>
					) : null}
				</div>
			</Panel>

			<Panel
				title="Award classifications"
				subtitle="Final award by CGPA (e.g. First Class, Distinction)"
				icon={Star}
				actions={
					canEdit ? (
						<Button
							size="sm"
							variant="secondary"
							icon={Plus}
							onClick={() =>
								setV((cur) => ({
									...cur,
									classifications: [...cur.classifications, { classification: "", min_cgpa: "", max_cgpa: "" }],
								}))
							}
						>
							Classification
						</Button>
					) : null
				}
			>
				{v.classifications.length ? (
					<div className="space-y-2">
						{v.classifications.map((c, i) => (
							<div key={c.name || `new-${i}`} className="grid grid-cols-[1fr_6rem_6rem_auto] items-center gap-2">
								<input
									aria-label="Classification"
									value={c.classification}
									onChange={(e) => setClass(i, { classification: e.target.value })}
									disabled={ro}
									className="input h-9 px-2"
									placeholder="Classification"
								/>
								{numberInput(c.min_cgpa, (x) => setClass(i, { min_cgpa: x }), {
									"aria-label": "Min CGPA",
									placeholder: "min",
									disabled: ro,
								})}
								{numberInput(c.max_cgpa, (x) => setClass(i, { max_cgpa: x }), {
									"aria-label": "Max CGPA",
									placeholder: "max",
									disabled: ro,
								})}
								{canEdit ? (
									<IconButton
										icon={Trash2}
										tone="danger"
										label="Remove classification"
										onClick={() =>
											setV((cur) => ({
												...cur,
												classifications: cur.classifications.filter((_, j) => j !== i),
											}))
										}
									/>
								) : (
									<span />
								)}
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-ink-soft">None. Transcripts show no award classification for this scale.</p>
				)}
			</Panel>

			{errors.length && (touched || dirty) ? (
				<Alert tone={touched ? "error" : "warning"} title="Fix these before saving">
					<ul className="list-disc pl-4">
						{errors.map((e) => (
							<li key={e}>{e}</li>
						))}
					</ul>
				</Alert>
			) : null}

			{canEdit && (dirty || isNew) ? (
				<div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur">
					<span className="text-sm text-ink-muted">{isNew ? "New scale" : "Unsaved changes"}</span>
					<div className="flex gap-2">
						{!isNew ? (
							<Button variant="secondary" onClick={() => setV(JSON.parse(base))}>
								Discard
							</Button>
						) : null}
						<Button icon={Save} loading={save.isPending} onClick={submit}>
							{isNew ? "Create scale" : "Save scale"}
						</Button>
					</div>
				</div>
			) : null}

			<ConfirmDialog
				open={confirmDelete}
				title={`Delete ${name}?`}
				message={usedBy ? `${usedBy} offerings use this scale, so the delete will be refused. Point them at another scale first.` : "This scale is removed permanently."}
				confirmLabel="Delete"
				tone="danger"
				loading={remove.isPending}
				onConfirm={() => remove.mutate({ doctype: DOC, name })}
				onClose={() => setConfirmDelete(false)}
			/>
		</div>
	)
}

export default function Grading() {
	const roles = useAcademicRoles()
	const [params, setParams] = useSearchParams()
	const list = useApi(LIST, {
		doctype: DOC,
		fields: ["name", "scale_name", "is_default", "pass_mark", "modified"],
		order_by: "is_default desc, name asc",
		limit_page_length: 100,
	})
	const bands = useApi(LIST, {
		doctype: "Grading Scale Band",
		parent: DOC,
		fields: ["parent", "grade", "min_score", "max_score"],
		limit_page_length: 1000,
	})
	const scales = list.data || []
	const sel = params.get("scale") || ""
	const isNew = sel === "new"
	const active = isNew ? "new" : sel || scales.find((s) => s.is_default)?.name || scales[0]?.name || ""
	const go = (s) => setParams(s ? { scale: s } : {}, { replace: false })
	const defaultName = scales.find((s) => s.is_default)?.name

	return (
		<div>
			<PageHeader
				eyebrow="Academics"
				title="Grading scales"
				subtitle="Grade bands, grade points and award classifications used to grade mark sheets."
				actions={
					roles.grading ? (
						<Button icon={Plus} onClick={() => go("new")}>
							New scale
						</Button>
					) : null
				}
			/>
			<SubNav group="results" />
			{list.isError ? (
				<ErrorState error={list.error} onRetry={list.refetch} />
			) : (
				<div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
					<div>
						<ScaleList scales={scales} bands={bands.data || []} active={active} onPick={go} loading={list.isLoading} />
					</div>
					<div className="min-w-0">
						{active ? (
							<Editor key={active} name={isNew ? null : active} isNew={isNew} canEdit={roles.grading} defaultName={defaultName} onSaved={(nm) => go(nm)} onDeleted={() => go("")} />
						) : list.isLoading ? (
							<SkeletonRows rows={8} />
						) : (
							<Empty
								icon={Ruler}
								title="No grading scale yet"
								subtitle="Mark sheets can't be graded until there is one."
								action={roles.grading ? <Button onClick={() => go("new")}>Create a scale</Button> : null}
							/>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
