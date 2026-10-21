import { siteWallClock } from "@/shared/utils/format"
import { useEffect, useState } from "react"
import { Button, Checkbox, Drawer, FileDrop, Input, Loading, Select, Switch, Textarea } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { ASSIGNMENT_COMPONENTS, M, P, SUBMISSION_TYPES, fileName, fromHtml, fromLocalInput, toHtml, toLocalInput } from "./lib"

const BUCKET = { CAT: "CAT", Assignment: "Assignment" }

function defaultDue() {
	const d = siteWallClock()
	d.setDate(d.getDate() + 7)
	d.setHours(23, 59, 0, 0)
	const p = (n) => String(n).padStart(2, "0")
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T23:59`
}

const blank = () => ({
	title: "",
	assessment_component: "Assignment",
	instructions: "",
	attachment: "",
	open_date: "",
	due_date: defaultDue(),
	max_score: 100,
	submission_type: "File Upload",
	allowed_file_types: "pdf,doc,docx,odt,jpg,png",
	allow_late: 1,
	late_penalty_percent_per_day: 5,
	late_cutoff: "",
	max_late_penalty_percent: 50,
})

export function AssignmentDrawer({ open, onClose, offering, assignment: given, onSaved }) {
	const [f, setF] = useState(blank)
	// list rows lack instructions and late-policy fields, so edit from the full document
	const full = useApi(M.getAssignment, { name: given?.name }, { enabled: open && Boolean(given?.name) && given.instructions === undefined })
	const assignment = given?.name ? (given.instructions !== undefined ? given : full.data) : null
	const loading = Boolean(given?.name) && !assignment
	const [publish, setPublish] = useState(false)
	const [uploading, setUploading] = useState(false)
	const publishNow = useAction(M.publishAssignment, { invalidate: [P.asg, P.lec] })
	const save = useAction(M.saveAssignment, {
		invalidate: [P.asg, P.lec, P.res],
		onSuccess: async (doc) => {
			if (publish && doc?.status === "Draft") {
				try {
					await publishNow.mutateAsync({ name: doc.name })
					toast.success("Assignment published. Students have been notified.")
				} catch {
					toast.info("Saved as a draft. Publish it from the list when ready.")
				}
			} else toast.success(assignment ? "Assignment updated" : "Assignment saved as a draft")
			onSaved?.(doc)
			onClose()
		},
	})

	useEffect(() => {
		if (!open) return
		setPublish(false)
		if (assignment)
			setF({
				...blank(),
				...assignment,
				instructions: fromHtml(assignment.instructions),
				open_date: toLocalInput(assignment.open_date),
				due_date: toLocalInput(assignment.due_date),
				late_cutoff: toLocalInput(assignment.late_cutoff),
				attachment: assignment.attachment || "",
			})
		else if (!given?.name) setF(blank())
	}, [open, assignment, given?.name])

	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
	const fileTypes = f.submission_type !== "Text"

	const upload = async (file) => {
		setUploading(true)
		try {
			const r = await frappe.uploadFile(file, true)
			setF((x) => ({ ...x, attachment: r.file_url }))
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const problem = !f.title.trim()
		? "Give the assignment a title."
		: !f.due_date
			? "Set a due date."
			: !(Number(f.max_score) > 0)
				? "Maximum score must be greater than zero."
				: f.open_date && f.open_date >= f.due_date
					? "The open date must be before the due date."
					: f.allow_late && f.late_cutoff && f.late_cutoff < f.due_date
						? "The late cut-off can't be before the due date."
						: null

	const submit = (e) => {
		e?.preventDefault()
		if (problem) return toast.error(problem)
		save.mutate({
			data: {
				name: assignment?.name,
				course_offering: offering,
				title: f.title.trim(),
				assessment_component: f.assessment_component,
				instructions: toHtml(f.instructions),
				attachment: f.attachment || null,
				open_date: fromLocalInput(f.open_date),
				due_date: fromLocalInput(f.due_date),
				max_score: Number(f.max_score),
				submission_type: f.submission_type,
				allowed_file_types: fileTypes ? f.allowed_file_types : null,
				allow_late: f.allow_late ? 1 : 0,
				late_penalty_percent_per_day: f.allow_late ? Number(f.late_penalty_percent_per_day) || 0 : 0,
				late_cutoff: f.allow_late ? fromLocalInput(f.late_cutoff) : null,
				max_late_penalty_percent: f.allow_late ? Number(f.max_late_penalty_percent) || 0 : 0,
			},
		})
	}

	const isDraft = !assignment || assignment.status === "Draft"

	return (
		<Drawer
			open={open}
			onClose={onClose}
			width="max-w-2xl"
			title={given?.name ? "Edit assignment" : "New assignment"}
			subtitle={given?.name ? `${given.name} · ${given.status}` : "Saved as a draft until you publish it."}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={submit} loading={save.isPending || publishNow.isPending} disabled={uploading || loading}>
						{publish ? "Save & publish" : assignment ? "Save changes" : "Save draft"}
					</Button>
				</>
			}
		>
			{loading ? <Loading /> : (
			<form onSubmit={submit} className="space-y-5">
				<Input label="Title" required value={f.title} onChange={set("title")} placeholder="e.g. Exegesis paper: Philippians 2:5–11" />
				<div className="grid gap-4 sm:grid-cols-2">
					<Select
						label="Counts as"
						required
						value={f.assessment_component}
						onChange={set("assessment_component")}
						options={ASSIGNMENT_COMPONENTS}
						hint={`Mark sheet column: ${BUCKET[f.assessment_component] || "Other"}. Weights are set in the Gradebook.`}
					/>
					<Input label="Maximum score" required type="number" min={1} step="0.5" value={f.max_score} onChange={set("max_score")} />
				</div>
				<Textarea label="Instructions" rows={7} value={f.instructions} onChange={set("instructions")} placeholder="What students must do, length, referencing style, how it will be marked…" />
				<FileDrop label="Brief or rubric (optional)" onFile={upload} busy={uploading} value={f.attachment} hint="Students can download this file." />
				{f.attachment ? (
					<p className="-mt-3 flex items-center gap-2 text-xs text-ink-soft">
						<span className="truncate">{fileName(f.attachment)}</span>
						<button type="button" className="link" onClick={() => setF((x) => ({ ...x, attachment: "" }))}>
							Remove
						</button>
					</p>
				) : null}

				<fieldset className="space-y-4 rounded-xl border border-line p-4">
					<legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Dates</legend>
					<div className="grid gap-4 sm:grid-cols-2">
						<Input label="Opens" type="datetime-local" value={f.open_date} onChange={set("open_date")} hint="Blank = when published" />
						<Input label="Due" required type="datetime-local" value={f.due_date} onChange={set("due_date")} />
					</div>
				</fieldset>

				<fieldset className="space-y-4 rounded-xl border border-line p-4">
					<legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Submission</legend>
					<Select label="Students submit" value={f.submission_type} onChange={set("submission_type")} options={SUBMISSION_TYPES} />
					{fileTypes ? (
						<Input label="Allowed file types" value={f.allowed_file_types || ""} onChange={set("allowed_file_types")} hint="Comma-separated extensions, e.g. pdf,docx" />
					) : null}
				</fieldset>

				<fieldset className="space-y-4 rounded-xl border border-line p-4">
					<legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-muted">Late work</legend>
					<Switch
						checked={Boolean(f.allow_late)}
						onChange={(v) => setF((x) => ({ ...x, allow_late: v ? 1 : 0 }))}
						label="Accept late submissions"
						description="A penalty is deducted per day late, up to the maximum."
					/>
					{f.allow_late ? (
						<div className="grid gap-4 sm:grid-cols-3">
							<Input label="Penalty / day (%)" type="number" min={0} max={100} value={f.late_penalty_percent_per_day} onChange={set("late_penalty_percent_per_day")} />
							<Input label="Max penalty (%)" type="number" min={0} max={100} value={f.max_late_penalty_percent} onChange={set("max_late_penalty_percent")} />
							<Input label="Cut-off" type="datetime-local" value={f.late_cutoff} onChange={set("late_cutoff")} hint="Blank = no cut-off" />
						</div>
					) : null}
				</fieldset>

				{isDraft ? (
					<Checkbox checked={publish} onChange={setPublish} label="Publish now" description="Students are notified and can start submitting from the open date." />
				) : null}
			</form>
			)}
		</Drawer>
	)
}
