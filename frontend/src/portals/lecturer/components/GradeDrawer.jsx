import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Clock, Download, ExternalLink, FileText, Paperclip, X } from "lucide-react"
import { Alert, Badge, Button, Checkbox, Drawer, FileDrop, Html, IconButton, Textarea } from "@/shared/components/ui"
import { frappe } from "@/shared/api/frappe"
import { useAction } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { dateTime } from "@/shared/utils/format"
import { ScoreInput, StatusBadge } from "./bits"
import { safeUrl } from "@/shared/utils/sanitize"
import { M, P, fileName, fromHtml, score, toHtml } from "./lib"

const INLINE_IMG = /\.(png|jpe?g|gif|webp)$/i

/** Late-penalty preview mirroring services/assessments.penalty_for. */
function penaltyOf(raw, daysLate, a) {
	const r = Number(raw) || 0
	if (!daysLate || r <= 0) return { percent: 0, penalty: 0, final: r }
	const percent = Math.min(daysLate * (Number(a.late_penalty_percent_per_day) || 0), Number(a.max_late_penalty_percent) || 0)
	const penalty = Math.round(r * Math.max(percent, 0)) / 100
	return { percent, penalty, final: Math.max(r - penalty, 0) }
}

/**
 * Grade one submission at a time with prev/next. `rows` is the (filtered) submissions list,
 * including "Not Submitted" rows which are graded as paper hand-ins via bulk_grade.
 */
export function GradeDrawer({ open, onClose, assignment: a, rows, index, onIndex }) {
	const r = rows[index]
	const [raw, setRaw] = useState("")
	const [feedback, setFeedback] = useState("")
	const [file, setFile] = useState(null)
	const [uploading, setUploading] = useState(false)
	const [release, setRelease] = useState(false)
	const [preview, setPreview] = useState(false)
	const key = r ? r.student : ""

	useEffect(() => {
		if (!r) return
		setRaw(r.status === "Graded" || r.status === "Returned" ? String(r.raw_score ?? "") : "")
		setFeedback(fromHtml(r.feedback))
		setFile(r.feedback_attachment || null)
		setRelease(Boolean(r.released))
		setPreview(false)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key])

	const inval = [P.asg, P.lec, P.res]
	const grade = useAction(M.gradeSubmission, { invalidate: inval })
	const offline = useAction(M.bulkGrade, { invalidate: inval })
	const busy = grade.isPending || offline.isPending || uploading

	if (!r) return null
	const max = Number(a.max_score) || 0
	const n = raw === "" ? null : Number(raw)
	const invalid = n === null || Number.isNaN(n) || n < 0 || n > max
	const pen = penaltyOf(raw, r.days_late, a)
	const missing = r.status === "Not Submitted"
	const hasPrev = index > 0
	const hasNext = index < rows.length - 1

	const save = async (next) => {
		if (invalid) {
			toast.error(`Enter a score between 0 and ${score(max)}.`)
			return
		}
		const fb = feedback.trim() ? toHtml(feedback) : ""
		try {
			if (missing) {
				await offline.mutateAsync({ assignment: a.name, rows: [{ student: r.student, raw_score: n, feedback: fb }], release: release ? 1 : 0 })
			} else {
				await grade.mutateAsync({
					name: r.name,
					raw_score: n,
					feedback: fb,
					feedback_attachment: file || "",
					release: release ? 1 : 0,
				})
			}
		} catch {
			return
		}
		toast.success(`${r.student_name}: ${score(n)}/${score(max)} saved${release ? " and released" : ""}`)
		if (next && hasNext) onIndex(index + 1)
		else if (next) onClose()
	}

	const onFile = async (f) => {
		if (!f) return
		setUploading(true)
		try {
			const res = await frappe.uploadFile(f, true)
			setFile(res.file_url)
		} catch (e) {
			toast.error(e.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const attachment = r.attachment
	const attachUrl = safeUrl(attachment)
	// Inline previews only for files served by this site (/files, /private/files).
	const local = Boolean(attachUrl && /^\/(private\/)?files\//.test(attachUrl))
	const isPdf = local && /\.pdf$/i.test(attachUrl)
	const isImg = local && INLINE_IMG.test(attachUrl)

	return (
		<Drawer
			open={open}
			onClose={onClose}
			width="max-w-2xl"
			title={r.student_name || r.student}
			subtitle={`${r.student_number || r.student} · ${index + 1} of ${rows.length}`}
			footer={
				<div className="flex w-full flex-wrap items-center gap-2">
					<IconButton icon={ChevronLeft} label="Previous student" disabled={!hasPrev || busy} onClick={() => onIndex(index - 1)} />
					<IconButton icon={ChevronRight} label="Next student" disabled={!hasNext || busy} onClick={() => onIndex(index + 1)} />
					<span className="hidden text-xs text-ink-soft sm:inline">Ctrl + Enter saves &amp; moves on</span>
					<div className="ml-auto flex gap-2">
						<Button variant="secondary" onClick={() => save(false)} disabled={busy}>
							Save
						</Button>
						<Button onClick={() => save(true)} loading={busy} iconRight={hasNext ? ChevronRight : undefined}>
							{hasNext ? "Save & next" : "Save & close"}
						</Button>
					</div>
				</div>
			}
		>
			<div
				className="space-y-5"
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault()
						save(true)
					}
				}}
			>
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<StatusBadge kind="submission" status={r.status} />
					{r.submitted_on ? (
						<span className="inline-flex items-center gap-1 text-ink-soft">
							<Clock size={12} /> Submitted {dateTime(r.submitted_on)}
						</span>
					) : null}
					{r.is_late ? <Badge tone="red">{r.days_late} day{r.days_late === 1 ? "" : "s"} late</Badge> : null}
					{r.released ? <Badge tone="green">Released to student</Badge> : null}
				</div>

				{missing ? (
					<Alert tone="warning" title="Nothing submitted online">
						If the student handed in on paper you can still record a mark; a submission record is created for them.
					</Alert>
				) : (
					<section aria-label="Student's work" className="space-y-3">
						{r.answer_text ? (
							<div>
								<div className="label">Written answer</div>
								<div className="scroll-thin max-h-[40vh] overflow-y-auto rounded-xl border border-line bg-canvas/60 p-4">
									<Html html={r.answer_text} className="text-sm" />
								</div>
							</div>
						) : null}
						{attachment ? (
							<div>
								<div className="label">Attached file</div>
								<div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2.5">
									<FileText size={16} className="shrink-0 text-brand-700" />
									<span className="min-w-0 flex-1 truncate text-sm text-ink">{fileName(attachment)}</span>
									{isPdf || isImg ? (
										<Button size="sm" variant="ghost" onClick={() => setPreview((x) => !x)}>
											{preview ? "Hide preview" : "Preview"}
										</Button>
									) : null}
									{attachUrl ? (
										<a href={attachUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
											<ExternalLink size={14} /> Open
										</a>
									) : null}
								</div>
								{preview && isPdf ? <iframe title="Submission preview" src={attachUrl} className="mt-2 h-[60vh] w-full rounded-xl border border-line bg-white" /> : null}
								{preview && isImg ? <img src={attachUrl} alt="Submitted file" className="mt-2 max-h-[60vh] rounded-xl border border-line object-contain" /> : null}
							</div>
						) : null}
						{!r.answer_text && !attachment ? <p className="text-sm text-ink-soft">The submission is empty.</p> : null}
					</section>
				)}

				<section aria-label="Grade" className="rounded-2xl border border-line bg-surface p-4 shadow-card">
					<div className="flex flex-wrap items-end gap-4">
						<div>
							<label className="label" htmlFor={`score-${key}`}>
								Score
							</label>
							<div className="flex items-center gap-2">
								<input
									id={`score-${key}`}
									type="number"
									inputMode="decimal"
									min={0}
									max={max}
									step="0.5"
									autoFocus
									value={raw}
									onChange={(e) => setRaw(e.target.value)}
									onWheel={(e) => e.currentTarget.blur()}
									aria-invalid={(raw !== "" && invalid) || undefined}
									className={`input !w-28 text-right text-lg font-semibold tabular-nums ${raw !== "" && invalid ? "!border-red-400" : ""}`}
								/>
								<span className="text-sm text-ink-soft">/ {score(max)}</span>
							</div>
						</div>
						<div className="flex flex-wrap gap-1.5 pb-1">
							{[1, 0.8, 0.6, 0.4].map((f) => (
								<button key={f} type="button" className="chip" onClick={() => setRaw(String(Math.round(max * f * 2) / 2))}>
									{Math.round(f * 100)}%
								</button>
							))}
						</div>
					</div>
					{r.days_late && n !== null && !invalid ? (
						<p className="mt-2 text-xs text-orange-700 dark:text-orange-300">
							Late penalty {score(pen.percent)}% (−{score(pen.penalty)}) → final {score(pen.final)}/{score(max)}
						</p>
					) : null}
					{raw !== "" && invalid ? <p className="mt-2 text-xs font-medium text-red-600">Score must be between 0 and {score(max)}.</p> : null}

					<Textarea
						className="mt-4"
						label="Feedback to the student"
						rows={5}
						value={feedback}
						onChange={(e) => setFeedback(e.target.value)}
						placeholder="What went well, what to improve…"
					/>

					{!missing ? (
						<div className="mt-4">
							{file ? (
								<div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
									<Paperclip size={14} className="text-ink-soft" />
									<span className="min-w-0 flex-1 truncate">{fileName(file)}</span>
									{file === r.feedback_attachment ? (
										<a
											className="btn btn-ghost btn-sm"
											href={frappe.downloadUrl(M.downloadAssignmentFile, { name: r.name, kind: "feedback" })}
											target="_blank"
											rel="noreferrer"
										>
											<Download size={14} /> Open
										</a>
									) : null}
									<IconButton icon={X} label="Remove feedback file" onClick={() => setFile(null)} />
								</div>
							) : (
								<FileDrop label="Marked script or feedback file (optional)" hint="PDF, Word or image" busy={uploading} onFile={onFile} />
							)}
						</div>
					) : null}

					<Checkbox
						className="mt-4"
						checked={release}
						onChange={setRelease}
						label="Release to the student now"
						description="Unreleased grades stay hidden until you release them."
					/>
				</section>
			</div>
		</Drawer>
	)
}
