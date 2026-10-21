import { useEffect, useMemo, useState } from "react"
import { Save, Undo2 } from "lucide-react"
import { Button, Checkbox, ConfirmDialog, Empty } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { useAction } from "@/shared/api/hooks"
import { ScoreInput, StatusBadge } from "./bits"
import { M, P, fromHtml, score, toHtml } from "./lib"

const GRADED = ["Graded", "Returned"]
const initial = (r) => ({ raw: GRADED.includes(r.status) ? String(r.raw_score ?? "") : "", feedback: fromHtml(r.feedback) })

/** Spreadsheet-style grading for the whole class → bulk_grade (all-or-nothing on the server). */
export function BulkGradeTable({ assignment: a, rows }) {
	const max = Number(a.max_score) || 0
	const base = useMemo(() => Object.fromEntries(rows.map((r) => [r.student, initial(r)])), [rows])
	const [edits, setEdits] = useState({})
	const [release, setRelease] = useState(false)
	const [search, setSearch] = useState("")
	const [confirm, setConfirm] = useState(false)

	useEffect(() => setEdits({}), [a.name])

	const val = (s) => edits[s] || base[s] || { raw: "", feedback: "" }
	const set = (s, patch) => setEdits((e) => ({ ...e, [s]: { ...val(s), ...patch } }))
	const dirty = rows.filter((r) => {
		const e = edits[r.student]
		if (!e) return false
		const b = base[r.student]
		return e.raw !== b.raw || e.feedback !== b.feedback
	})
	const bad = (v) => v !== "" && (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > max)
	const invalid = dirty.filter((r) => bad(val(r.student).raw))
	const cleared = dirty.filter((r) => val(r.student).raw === "" && base[r.student].raw !== "")
	const toSend = dirty.filter((r) => val(r.student).raw !== "" && !bad(val(r.student).raw))
	const offline = toSend.filter((r) => !r.name)

	const save = useAction(M.bulkGrade, {
		invalidate: [P.asg, P.lec, P.res],
		success: (d) => `${d.graded} grade${d.graded === 1 ? "" : "s"} saved${release ? " and released" : ""}`,
		onSuccess: () => {
			setEdits({})
			setConfirm(false)
		},
	})

	const submit = () =>
		save.mutate({
			assignment: a.name,
			release: release ? 1 : 0,
			rows: toSend.map((r) => {
				const v = val(r.student)
				const row = { student: r.student, raw_score: Number(v.raw) }
				if (r.name) row.submission = r.name
				if (v.feedback !== base[r.student].feedback) row.feedback = v.feedback.trim() ? toHtml(v.feedback) : ""
				return row
			}),
		})

	const q = search.trim().toLowerCase()
	const shown = q ? rows.filter((r) => `${r.student_name} ${r.student_number}`.toLowerCase().includes(q)) : rows
	const blanks = rows.filter((r) => r.status === "Not Submitted" && val(r.student).raw === "")

	return (
		<div className="card overflow-hidden">
			<div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
				<SearchInput value={search} onChange={setSearch} placeholder="Find a student…" className="sm:max-w-xs" />
				<div className="flex flex-wrap items-center gap-2 sm:ml-auto">
					{blanks.length ? (
						<Button size="sm" variant="ghost" onClick={() => blanks.forEach((r) => set(r.student, { raw: "0" }))}>
							Give 0 to {blanks.length} non-submitter{blanks.length === 1 ? "" : "s"}
						</Button>
					) : null}
					{dirty.length ? (
						<Button size="sm" variant="ghost" icon={Undo2} onClick={() => setEdits({})}>
							Discard
						</Button>
					) : null}
				</div>
			</div>
			{shown.length ? (
				<div className="scroll-thin overflow-x-auto">
					<table className="table-base min-w-[640px]">
						<thead>
							<tr>
								<th className="sticky left-0 z-[1] bg-surface">Student</th>
								<th>Status</th>
								<th className="text-right">Score / {score(max)}</th>
								<th>Feedback</th>
								<th className="text-right">Final</th>
							</tr>
						</thead>
						<tbody>
							{shown.map((r) => {
								const v = val(r.student)
								const changed = dirty.includes(r)
								return (
									<tr key={r.student} className={changed ? "bg-gold-50/70" : undefined}>
										<td className={`sticky left-0 z-[1] !py-2 ${changed ? "bg-gold-50" : "bg-surface"}`}>
											<div className="max-w-[11rem] truncate font-medium text-ink">{r.student_name}</div>
											<div className="text-xs text-ink-soft">{r.student_number}</div>
										</td>
										<td className="!py-2">
											<StatusBadge kind="submission" status={r.status} size="xs" />
											{r.is_late ? <div className="mt-0.5 text-[11px] text-red-600">{r.days_late}d late</div> : null}
										</td>
										<td className="!py-2 text-right">
											<ScoreInput value={v.raw} max={max} label={`Score for ${r.student_name}`} onChange={(x) => set(r.student, { raw: x })} />
										</td>
										<td className="!py-2">
											<input
												className="input !py-1.5 text-sm"
												aria-label={`Feedback for ${r.student_name}`}
												value={v.feedback}
												placeholder="Optional"
												onChange={(e) => set(r.student, { feedback: e.target.value })}
											/>
										</td>
										<td className="!py-2 text-right tabular-nums text-ink-muted">
											{GRADED.includes(r.status) ? score(r.final_score) : "—"}
											{r.penalty ? <div className="text-[11px] text-red-600">−{score(r.penalty)}</div> : null}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			) : (
				<Empty title="No students match" compact />
			)}
			<div className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center">
				<div className="text-sm text-ink-muted">
					{dirty.length ? (
						<>
							<b className="text-ink">{toSend.length}</b> to save
							{offline.length ? ` (${offline.length} paper hand-in${offline.length === 1 ? "" : "s"})` : ""}
							{invalid.length ? <span className="text-red-600"> · {invalid.length} out of range</span> : null}
							{cleared.length ? <span className="text-orange-600"> · {cleared.length} blank (existing grade kept)</span> : null}
						</>
					) : (
						"Type scores, then save them all at once."
					)}
				</div>
				<div className="flex items-center gap-3 sm:ml-auto">
					<Checkbox checked={release} onChange={setRelease} label="Release now" />
					<Button icon={Save} disabled={!toSend.length || invalid.length > 0} loading={save.isPending} onClick={() => (release ? setConfirm(true) : submit())}>
						Save grades
					</Button>
				</div>
			</div>
			<ConfirmDialog
				open={confirm}
				onClose={() => setConfirm(false)}
				title="Save and release?"
				message={`${toSend.length} student${toSend.length === 1 ? "" : "s"} will see their grade and feedback immediately.`}
				confirmLabel="Save & release"
				loading={save.isPending}
				onConfirm={submit}
			/>
		</div>
	)
}
