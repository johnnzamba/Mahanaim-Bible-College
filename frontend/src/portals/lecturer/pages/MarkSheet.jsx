import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { AlertTriangle, BarChart3, CheckCircle2, Hourglass, Lock, Percent, RefreshCw, RotateCcw, Scale, Send, Sheet, Users, XCircle } from "lucide-react"
import { Alert, Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Loading, PageHeader, Panel, QueryState, SkeletonRows, StatCard } from "@/shared/components/ui"
import { ExportButton, Timeline, Toolbar, useDebounced } from "@/shared/components/kit"
import { BarsChart, DonutChart } from "@/shared/components/Charts"
import { useAction, useApi } from "@/shared/api/hooks"
import { dateTime, num } from "@/shared/utils/format"
import { SaveBar, ScoreInput, StatusBadge } from "../components/bits"
import { COMPONENTS, CONFLICT_RETRY, M, P, score } from "../components/lib"

const RESULT_TONE = { Pass: "green", Fail: "red", Incomplete: "orange", Absent: "gray" }
const RESULT_COLOR = { Pass: "#059669", Fail: "#dc2626", Incomplete: "#d97706", Absent: "#94a3b8" }
const INVALIDATE = [M.getMarkSheet, M.gradeDistribution, P.lec]

const orig = (e, f) => (e[f] == null ? "" : String(e[f]))

function WeightsEditor({ sheet, locked, blocked }) {
	const key = COMPONENTS.map(([, k]) => sheet[k] ?? 0).join("|")
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const initial = useMemo(() => Object.fromEntries(COMPONENTS.map(([, k]) => [k, String(sheet[k] ?? 0)])), [key])
	const [w, setW] = useState(initial)
	const [base, setBase] = useState(key)
	if (base !== key) {
		setBase(key)
		setW(initial)
	}
	const save = useAction(M.updateWeights, { invalidate: INVALIDATE, success: "Weights saved · marks recomputed" })
	const total = COMPONENTS.reduce((a, [, k]) => a + (Number(w[k]) || 0), 0)
	const bad = COMPONENTS.some(([, k]) => w[k] === "" || Number(w[k]) < 0 || Number(w[k]) > 100)
	const dirty = COMPONENTS.some(([, k]) => Number(w[k]) !== Number(initial[k]))
	const ok = Math.abs(total - 100) < 0.01 && !bad
	return (
		<Panel title="Weights" subtitle="Each component's share of the final mark" icon={Scale}>
			<div className="mb-4 flex h-3 overflow-hidden rounded-full bg-line/70" aria-hidden>
				{COMPONENTS.map(([k, wf], i) => (
					<div key={k} className={["bg-brand-700", "bg-gold-500", "bg-brand-400", "bg-gold-300"][i]} style={{ width: `${Math.min(100, Number(w[wf]) || 0)}%` }} />
				))}
			</div>
			<div className="grid grid-cols-2 gap-3">
				{COMPONENTS.map(([k, wf, , label], i) => (
					<label key={k} className="block">
						<span className="label flex items-center gap-1.5">
							<span className={`h-2 w-2 rounded-full ${["bg-brand-700", "bg-gold-500", "bg-brand-400", "bg-gold-300"][i]}`} />
							{label}
						</span>
						<div className="relative">
							<input
								type="number"
								inputMode="decimal"
								min={0}
								max={100}
								step="1"
								className="input pr-8 text-right tabular-nums"
								value={w[wf]}
								disabled={locked}
								onChange={(e) => setW((x) => ({ ...x, [wf]: e.target.value }))}
								onWheel={(e) => e.currentTarget.blur()}
								aria-label={`${label} weight`}
							/>
							<span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-ink-soft">%</span>
						</div>
					</label>
				))}
			</div>
			<div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
				<span className={`text-sm font-semibold tabular-nums ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`} role="status">
					Total {score(total)}%{ok ? "" : " · must be 100%"}
				</span>
				{!locked && dirty ? (
					<div className="ml-auto flex gap-2">
						<Button size="sm" variant="ghost" onClick={() => setW(initial)}>
							Reset
						</Button>
						<Button
							size="sm"
							disabled={!ok || blocked}
							loading={save.isPending}
							onClick={() => save.mutate({ name: sheet.name, weights: Object.fromEntries(COMPONENTS.map(([, k]) => [k, Number(w[k])])) })}
						>
							Save weights
						</Button>
					</div>
				) : null}
			</div>
			{!locked && dirty && blocked ? <p className="mt-2 text-xs text-ink-soft">Save or discard your mark changes first.</p> : null}
			{!locked ? <p className="mt-3 text-xs text-ink-soft">Changing weights rescales marks taken from assignments and exams. Marks you typed in yourself stay as entered and must fit the new weight.</p> : null}
		</Panel>
	)
}

function flow(s) {
	const by = (u) => (u ? ` · ${u}` : "")
	const steps = [{ label: "Draft prepared", date: dateTime(s.creation), note: "Lecturers enter and review marks", status: "done" }]
	const submitted = { label: "Submitted to the Dean", date: s.submitted_on ? dateTime(s.submitted_on) : undefined, note: s.submitted_by ? `By ${s.submitted_by}` : undefined }
	const approved = { label: "Approved by the Dean", date: s.approved_on ? dateTime(s.approved_on) : undefined, note: s.approved_by ? `By ${s.approved_by}` : "Dean of Studies reviews the marks" }
	const published = { label: "Published by the Registrar", date: s.published_on ? dateTime(s.published_on) : undefined, note: s.published_on ? `Students can see their results${by(s.published_by)}` : "Results become visible to students" }
	if (s.status === "Returned") {
		return [
			...steps,
			{ ...submitted, status: "done" },
			{ label: "Returned for changes", status: "failed", note: s.return_reason || "See remarks" },
			{ label: "Resubmit", status: "current", note: "Fix the marks and submit again" },
			{ ...approved, status: "pending" },
			{ ...published, status: "pending" },
		]
	}
	const order = ["Draft", "Submitted", "Approved", "Published"]
	const at = order.indexOf(s.status)
	const st = (i) => (i < at || (i === at && s.status === "Published") ? "done" : i === at ? "current" : "pending")
	steps[0].status = at === 0 ? "current" : "done"
	return [...steps, { ...submitted, status: st(1) }, { ...approved, status: st(2) }, { ...published, status: st(3) }]
}

function Grid({ sheet, edits, setEdits, locked }) {
	const [search, setSearch] = useState("")
	const [chip, setChip] = useState("all")
	const s = useDebounced(search).toLowerCase()
	const comps = COMPONENTS.filter(([, w]) => Number(sheet[w]) > 0)
	const entries = sheet.entries || []
	const counts = {
		all: entries.length,
		Incomplete: entries.filter((e) => e.result_status === "Incomplete").length,
		Fail: entries.filter((e) => e.result_status === "Fail").length,
		edited: entries.filter((e) => e.overridden_components?.length || edits[e.student]).length,
		Absent: entries.filter((e) => e.is_absent).length,
	}
	const rows = entries.filter((e) => {
		if (s && !`${e.student_name} ${e.student_number || ""} ${e.student}`.toLowerCase().includes(s)) return false
		if (chip === "edited") return e.overridden_components?.length || edits[e.student]
		if (chip === "Absent") return e.is_absent
		if (chip !== "all") return e.result_status === chip
		return true
	})

	const value = (e, f) => {
		const ch = edits[e.student]
		if (ch && f in ch) return ch[f] === null ? "" : ch[f]
		return orig(e, f)
	}
	const setCell = (e, f, v, overridden) => {
		setEdits((all) => {
			const ch = { ...(all[e.student] || {}) }
			if (f === "remarks") {
				if (v === (e.remarks || "")) delete ch[f]
				else ch[f] = v
			} else if (v === "") {
				if (overridden) ch[f] = null
				else delete ch[f]
			} else if (v === orig(e, f)) delete ch[f]
			else ch[f] = v
			const next = { ...all }
			if (Object.keys(ch).length) next[e.student] = ch
			else delete next[e.student]
			return next
		})
	}
	const nav = (ev) => {
		if (!["Enter", "ArrowDown", "ArrowUp"].includes(ev.key)) return
		const td = ev.target.closest("[data-cell]")
		if (!td || ev.target.tagName !== "INPUT") return
		const [c, r] = td.dataset.cell.split(":").map(Number)
		const target = ev.currentTarget.querySelector(`[data-cell="${c}:${r + (ev.key === "ArrowUp" ? -1 : 1)}"] input`)
		if (target) {
			ev.preventDefault()
			target.focus()
			target.select?.()
		}
	}
	const live = (e) => comps.reduce((a, [, , f]) => a + (Number(value(e, f)) || 0), 0)

	return (
		<Panel
			title="Marks"
			subtitle={locked ? "Read-only" : "Weighted points — e.g. a CAT weighted 20% is marked out of 20. Totals and grades are calculated when you save."}
			icon={Sheet}
			bodyClass="!p-0"
		>
			<div className="border-b border-line px-4 py-3 sm:px-5">
				<Toolbar
					search={search}
					onSearch={setSearch}
					placeholder="Find a student…"
					chips={[
						{ id: "all", label: "All", count: counts.all },
						{ id: "Incomplete", label: "Incomplete", count: counts.Incomplete },
						{ id: "Fail", label: "Failing", count: counts.Fail },
						{ id: "edited", label: "Edited", count: counts.edited },
						{ id: "Absent", label: "Absent", count: counts.Absent },
					].filter((c) => c.id === "all" || c.count)}
					active={chip}
					onChip={setChip}
					className="!mb-0"
				/>
			</div>
			{rows.length ? (
				<div className="scroll-thin overflow-x-auto">
					<table className="w-full min-w-[640px] text-sm" onKeyDown={nav}>
						<thead>
							<tr className="border-b border-line bg-cream/60 text-left text-[11px] font-bold uppercase tracking-wide text-ink-soft">
								<th className="sticky left-0 z-10 bg-cream px-4 py-2.5 sm:px-5">Student</th>
								{comps.map(([k, w, , label]) => (
									<th key={k} className="px-2 py-2.5 text-right">
										{label} <span className="font-normal normal-case">/{score(sheet[w])}</span>
									</th>
								))}
								<th className="px-3 py-2.5 text-right">Total</th>
								<th className="px-3 py-2.5">Result</th>
								<th className="min-w-[180px] px-3 py-2.5">Remarks</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-line">
							{rows.map((e, ri) => {
								const dirty = Boolean(edits[e.student])
								return (
									<tr key={e.student} className={dirty ? "bg-gold-50/60" : ""}>
										<td className={`sticky left-0 z-10 max-w-[180px] px-4 py-2 sm:px-5 ${dirty ? "bg-gold-50" : "bg-surface"}`}>
											<div className="truncate font-semibold text-ink">{e.student_name}</div>
											<div className="truncate text-[11px] text-ink-soft">{e.student_number || e.student}</div>
										</td>
										{comps.map(([k, w, f, label], ci) => {
											const over = e.overridden_components?.includes(k)
											const pending = e.pending_components?.includes(k)
											const v = value(e, f)
											const reset = edits[e.student]?.[f] === null
											return (
												<td key={k} className="px-2 py-2 text-right align-top" data-cell={`${ci}:${ri}`}>
													{locked ? (
														<span className="tabular-nums text-ink">{score(e[f])}</span>
													) : (
														<div className="inline-flex items-center gap-1">
															{over && !reset ? (
																<button
																	type="button"
																	className="rounded p-0.5 text-gold-700 hover:bg-gold-100"
																	title="Typed in by hand. Click to use the system mark again."
																	aria-label={`Use system ${label} mark for ${e.student_name}`}
																	onClick={() => setCell(e, f, "", true)}
																>
																	<RotateCcw size={12} />
																</button>
															) : null}
															<ScoreInput value={v} onChange={(x) => setCell(e, f, x, over)} max={Number(sheet[w])} step="0.01" label={`${label} for ${e.student_name}`} className={over && !reset ? "!border-gold-400" : ""} />
														</div>
													)}
													<div className="mt-0.5 h-3.5 text-[10px] leading-none">
														{reset ? <span className="text-ink-soft">system mark on save</span> : pending && !(f in (edits[e.student] || {})) ? <span className="text-orange-600 dark:text-orange-300">pending</span> : over ? <span className="text-gold-700">edited</span> : null}
													</div>
												</td>
											)
										})}
										<td className="px-3 py-2 text-right align-top">
											<div className="font-bold tabular-nums text-ink">{score(e.total, 1)}</div>
											{dirty ? <div className="text-[10px] tabular-nums text-gold-700" title="Unsaved estimate">≈ {score(live(e), 1)}</div> : null}
										</td>
										<td className="px-3 py-2 align-top">
											<div className="flex items-center gap-1.5">
												<span className="w-7 font-display text-base font-bold text-ink">{e.grade || "—"}</span>
												<Badge tone={RESULT_TONE[e.result_status] || "gray"} size="xs">
													{e.result_status || "—"}
												</Badge>
											</div>
										</td>
										<td className="px-3 py-2 align-top">
											{locked ? (
												<span className="text-ink-muted">{e.remarks || ""}</span>
											) : (
												<input
													className="input !py-1.5 text-sm"
													maxLength={140}
													value={value(e, "remarks")}
													onChange={(ev) => setCell(e, "remarks", ev.target.value)}
													placeholder="Optional"
													aria-label={`Remarks for ${e.student_name}`}
												/>
											)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			) : (
				<Empty compact icon={Users} title={entries.length ? "No students match" : "No students on this mark sheet"} subtitle={entries.length ? undefined : "Students appear here once they're enrolled in the offering."} />
			)}
		</Panel>
	)
}

export default function MarkSheet() {
	const { offering } = useParams()
	const q = useApi(M.getMarkSheet, { offering }, CONFLICT_RETRY)
	const dist = useApi(M.gradeDistribution, { offering })
	const [edits, setEdits] = useState({})
	const [confirm, setConfirm] = useState(false)
	const recompute = useAction(M.recomputeMarkSheet, { invalidate: INVALIDATE, success: "Marks recomputed from assignments and exams" })
	const save = useAction(M.saveEntries, { invalidate: INVALIDATE, success: "Marks saved", onSuccess: () => setEdits({}) })
	const submit = useAction(M.submitMarkSheet, { invalidate: INVALIDATE, success: "Submitted to the Dean for approval", onSuccess: () => setConfirm(false) })

	if (q.isError) {
		return (
			<div className="space-y-6">
				<PageHeader title="Mark sheet" back={{ to: "/lecturer/gradebook", label: "Gradebook" }} />
				<Card>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Card>
			</div>
		)
	}
	if (!q.data) return <Loading className="min-h-[50vh]" />
	const s = q.data
	const locked = !s.actions?.can_edit
	const dirtyCount = Object.keys(edits).length
	const weights = Object.fromEntries(COMPONENTS.map(([, w, f]) => [f, Number(s[w]) || 0]))
	const invalid = Object.values(edits).reduce(
		(a, ch) => a + Object.entries(ch).filter(([f, v]) => f !== "remarks" && v !== null && (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > weights[f] + 1e-6)).length,
		0
	)
	const incomplete = s.entries.filter((e) => e.result_status === "Incomplete").length
	const absent = s.entries.filter((e) => e.is_absent).length
	const failing = s.entries.filter((e) => e.result_status === "Fail").length
	const rows = Object.entries(edits).map(([student, ch]) => ({
		student,
		...Object.fromEntries(Object.entries(ch).map(([f, v]) => [f, f === "remarks" || v === null ? v : Number(v)])),
	}))
	const exportCols = [
		{ key: "student_number", label: "Student number" },
		{ key: "student_name", label: "Student" },
		...COMPONENTS.filter(([, w]) => Number(s[w]) > 0).map(([, w, f, label]) => ({ key: f, label: `${label} (/${score(s[w])})` })),
		{ key: "total", label: "Total" },
		{ key: "grade", label: "Grade" },
		{ key: "result_status", label: "Result" },
		{ key: "remarks", label: "Remarks" },
	]
	const statusData = Object.entries(dist.data?.statuses || {}).map(([label, value]) => ({ label, value, color: RESULT_COLOR[label] }))

	return (
		<div className="space-y-6">
			<PageHeader
				back={{ to: `/lecturer/courses/${offering}?tab=gradebook`, label: s.course_title }}
				eyebrow="Mark sheet"
				title={s.course_title}
				subtitle={
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<StatusBadge kind="sheet" status={s.status} />
						<span>
							{s.name} · {s.academic_term} · pass mark {score(s.pass_mark)}%
						</span>
					</span>
				}
				actions={
					<>
						<ExportButton filename={`${s.name}-marks`} cols={exportCols} rows={s.entries} />
						{!locked ? (
							<Button size="sm" variant="secondary" icon={RefreshCw} disabled={dirtyCount > 0} loading={recompute.isPending} onClick={() => recompute.mutate({ name: s.name })}>
								Recompute
							</Button>
						) : null}
						{s.actions?.can_submit ? (
							<Button size="sm" icon={Send} disabled={dirtyCount > 0} onClick={() => setConfirm(true)} title={dirtyCount ? "Save your changes first" : undefined}>
								Submit for approval
							</Button>
						) : null}
					</>
				}
			/>

			{s.status === "Returned" ? (
				<Alert tone="error" title="Returned for changes" icon={AlertTriangle}>
					{s.return_reason || "The mark sheet was sent back. Review the marks and submit again."}
				</Alert>
			) : null}
			{locked ? (
				<Alert tone="info" title={`Marks are locked · ${s.status}`} icon={Lock}>
					{s.status === "Submitted"
						? `Submitted ${dateTime(s.submitted_on)}. The Dean will approve it or send it back with remarks.`
						: s.status === "Approved"
							? "Approved by the Dean. The Registrar publishes results to students."
							: "Results are published to students."}
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 max-sm:[&_.card>span:first-child]:hidden lg:grid-cols-5">
				<StatCard label="Students" value={num(s.student_count)} icon={Users} />
				<StatCard label="Passing" value={num(s.pass_count)} tone="green" icon={CheckCircle2} hint={s.student_count ? `${Math.round((s.pass_count / s.student_count) * 100)}% of class` : undefined} />
				<StatCard
					label="Average"
					icon={Percent}
					value={s.pass_count + failing ? score(s.average_score, 1) : "—"}
					tone="gold"
					hint={s.pass_count + failing ? `Highest ${score(s.highest_score, 1)}` : "No final results yet"}
				/>
				<StatCard label="Failing" value={num(failing)} tone={failing ? "red" : undefined} icon={XCircle} />
				<StatCard label="Incomplete" value={num(incomplete)} tone={incomplete ? "orange" : undefined} icon={Hourglass} hint={incomplete ? "Work still to mark or release" : "All components in"} />
			</div>

			<Grid sheet={s} edits={edits} setEdits={setEdits} locked={locked} />

			<div className="grid gap-6 lg:grid-cols-3">
				<WeightsEditor sheet={s} locked={locked} blocked={dirtyCount > 0} />
				<Panel title="Approval" subtitle="Lecturer → Dean → Registrar">
					<Timeline steps={flow(s)} />
				</Panel>
				<Panel title="Results" icon={BarChart3}>
					<QueryState query={dist} skeleton={<SkeletonRows rows={4} />}>
						{(g) =>
							g?.count ? (
								<div className="space-y-4">
									<BarsChart data={g.grades} xKey="grade" series={[{ key: "count", label: "Students" }]} height={180} />
									{statusData.length ? <DonutChart data={statusData} height={160} center={num(g.count)} centerLabel="students" /> : null}
								</div>
							) : (
								<p className="text-sm text-ink-soft">No grades yet.</p>
							)
						}
					</QueryState>
				</Panel>
			</div>

			<Panel title="Counted assessments" subtitle="Published assignments and exams feed the components automatically">
				{s.assessments?.length ? (
					<ul className="divide-y divide-line">
						{s.assessments.map((a) => (
							<li key={a.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
								<Link to={a.kind === "exam" ? `/lecturer/exams/${a.name}` : `/lecturer/assignments/${a.name}`} className="min-w-0 flex-1 truncate font-semibold text-ink hover:underline">
									{a.title}
								</Link>
								<Badge tone="gray" size="xs">
									{(COMPONENTS.find(([k]) => k === a.bucket) || [])[3] || a.bucket}
								</Badge>
								<StatusBadge kind={a.kind === "exam" ? "exam" : "assignment"} status={a.status} size="xs" />
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-ink-soft">No published assignments or exams yet. You can type component marks in directly.</p>
				)}
			</Panel>

			{!locked && dirtyCount ? (
				<SaveBar note={invalid ? `${invalid} mark${invalid === 1 ? " is" : "s are"} out of range` : `${dirtyCount} student${dirtyCount === 1 ? "" : "s"} changed`}>
					<Button size="sm" variant="ghost" onClick={() => setEdits({})} disabled={save.isPending}>
						Discard
					</Button>
					<Button size="sm" disabled={invalid > 0} loading={save.isPending} onClick={() => save.mutate({ name: s.name, rows })}>
						Save marks
					</Button>
				</SaveBar>
			) : null}

			<ConfirmDialog
				open={confirm}
				onClose={() => setConfirm(false)}
				title="Submit for approval?"
				message="The Dean reviews the mark sheet and approves it or returns it with remarks. Marks are locked until then."
				confirmLabel="Submit"
				loading={submit.isPending}
				onConfirm={() => submit.mutate({ name: s.name })}
			>
				{incomplete || absent ? (
					<ul className="mt-3 space-y-1 rounded-xl bg-orange-50 p-3 text-sm text-orange-800 dark:bg-orange-500/10 dark:text-orange-200">
						{incomplete ? <li>{incomplete} student{incomplete === 1 ? " is" : "s are"} Incomplete (work not yet marked or released).</li> : null}
						{absent ? <li>{absent} student{absent === 1 ? " was" : "s were"} absent from the exam.</li> : null}
					</ul>
				) : null}
			</ConfirmDialog>
		</div>
	)
}
