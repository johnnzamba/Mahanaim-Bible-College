import { useState } from "react"
import { useAction } from "@/shared/api/hooks"
import { Button, Input, Modal, Select, Textarea } from "@/shared/components/ui"
import { API, COVERAGES, INVALIDATE, REPORTING, SPONSORSHIP_STATUSES, searchSponsors, searchStudents } from "./common"
import { nullify, SearchPick, useLookups } from "./kit"

const BLANK = {
	sponsor: "",
	student: "",
	status: "Active",
	coverage: "Fixed Amount",
	amount: "",
	percentage: "",
	start_term: "",
	end_term: "",
	reporting_frequency: "Termly",
	notes: "",
}

const COVERAGE_HINT = {
	"Full Fees": "The sponsor carries the student's whole fee balance.",
	"Tuition Only": "Tuition lines only; the student pays accommodation and other fees.",
	"Fixed Amount": "A set amount the sponsor commits.",
	Percentage: "A share of each invoice.",
	Upkeep: "Living costs paid to the student, not against fees.",
}

/**
 * Create or edit a sponsorship. `initial` = {} (new), { sponsor, sponsor_name } (new for a sponsor) or the row to
 * edit; null closes the dialog.
 */
export function SponsorshipForm({ initial, onClose, onSaved }) {
	const lookups = useLookups()
	const [form, setForm] = useState(BLANK)
	const [labels, setLabels] = useState({})
	const [errors, setErrors] = useState({})
	const [seen, setSeen] = useState(null)
	if (initial !== seen) {
		setSeen(initial)
		const f = { ...BLANK }
		for (const k of Object.keys(BLANK)) if (initial?.[k] != null) f[k] = initial[k]
		setForm(f)
		setLabels({ sponsor: initial?.sponsor_name, student: initial?.student_name })
		setErrors({})
	}
	const isNew = !initial?.name
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = useAction(`${API}save_sponsorship`, {
		invalidate: INVALIDATE,
		success: "Sponsorship saved",
		onSuccess: (doc) => {
			onClose()
			onSaved?.(doc)
		},
	})
	const needsAmount = ["Fixed Amount", "Upkeep"].includes(form.coverage)
	const needsPct = form.coverage === "Percentage"
	const submit = () => {
		const errs = {}
		if (!form.sponsor) errs.sponsor = "Choose the sponsor"
		if (!form.student) errs.student = "Choose the student"
		if (needsAmount && !(Number(form.amount) > 0)) errs.amount = "Enter the amount pledged"
		if (needsPct && !(Number(form.percentage) > 0 && Number(form.percentage) <= 100)) errs.percentage = "Between 1 and 100"
		setErrors(errs)
		if (Object.keys(errs).length) return
		const data = nullify({ ...form, ...(isNew ? {} : { name: initial.name }) })
		data.amount = needsAmount || form.coverage === "Full Fees" || form.coverage === "Tuition Only" ? Number(form.amount) || 0 : 0
		data.percentage = needsPct ? Number(form.percentage) : 0
		save.mutate({ data })
	}
	const terms = (lookups.data?.terms || []).map((t) => ({ value: t.name, label: t.term_label || t.name }))
	return (
		<Modal
			open={Boolean(initial)}
			onClose={onClose}
			size="lg"
			title={isNew ? "New sponsorship" : "Edit sponsorship"}
			subtitle={isNew ? "Link a sponsor to a student and record what they have pledged." : initial.name}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={submit}>
						Save sponsorship
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<SearchPick
					id="sp-sponsor"
					label="Sponsor"
					required
					value={form.sponsor}
					display={labels.sponsor}
					search={searchSponsors}
					error={errors.sponsor}
					disabled={!isNew}
					onChange={(v, r) => {
						setForm((f) => ({ ...f, sponsor: v || "" }))
						setLabels((l) => ({ ...l, sponsor: r?.label }))
					}}
				/>
				<SearchPick
					id="sp-student"
					label="Student"
					required
					value={form.student}
					display={labels.student}
					search={searchStudents}
					error={errors.student}
					disabled={!isNew}
					placeholder="Name or student number…"
					onChange={(v, r) => {
						setForm((f) => ({ ...f, student: v || "" }))
						setLabels((l) => ({ ...l, student: r?.label }))
					}}
				/>
				<Select label="Coverage" required options={COVERAGES} value={form.coverage} onChange={set("coverage")} hint={COVERAGE_HINT[form.coverage]} />
				<Select label="Status" options={SPONSORSHIP_STATUSES} value={form.status} onChange={set("status")} />
				{needsPct ? (
					<Input label="Percentage of fees" type="number" min="1" max="100" value={form.percentage} onChange={set("percentage")} error={errors.percentage} />
				) : (
					<Input
						label={needsAmount ? "Amount committed" : "Amount cap (optional)"}
						type="number"
						min="0"
						value={form.amount}
						onChange={set("amount")}
						error={errors.amount}
						required={needsAmount}
					/>
				)}
				<Select label="Progress reports" options={REPORTING} value={form.reporting_frequency} onChange={set("reporting_frequency")} />
				<Select label="Starts" placeholder="Any term" options={terms} value={form.start_term} onChange={set("start_term")} />
				<Select label="Ends" placeholder="Open-ended" options={terms} value={form.end_term} onChange={set("end_term")} />
				<Textarea label="Notes" rows={3} value={form.notes} onChange={set("notes")} className="sm:col-span-2" />
			</div>
		</Modal>
	)
}

/** Allowed moves, mirroring the Sponsorship controller. */
const TRANSITIONS = {
	Proposed: ["Active", "Cancelled"],
	Active: ["Suspended", "Completed", "Cancelled"],
	Suspended: ["Active", "Completed", "Cancelled"],
	Completed: ["Active"],
	Cancelled: ["Proposed", "Active"],
}

/** Change a sponsorship's status with an optional note (appended to the record's notes). */
export function SponsorshipStatusDialog({ row, onClose }) {
	const [status, setStatus] = useState("")
	const [notes, setNotes] = useState("")
	const [seen, setSeen] = useState(null)
	if (row !== seen) {
		setSeen(row)
		setStatus((TRANSITIONS[row?.status] || [])[0] || "")
		setNotes("")
	}
	const act = useAction(`${API}set_sponsorship_status`, { invalidate: INVALIDATE, success: "Sponsorship updated", onSuccess: onClose })
	return (
		<Modal
			open={Boolean(row)}
			onClose={onClose}
			size="sm"
			title="Change sponsorship status"
			subtitle={row ? `${row.sponsor_name || row.sponsor} → ${row.student_name || row.student}` : null}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={act.isPending} disabled={!status || status === row?.status} onClick={() => act.mutate({ name: row.name, status, notes })}>
						Update status
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Select label="New status" options={TRANSITIONS[row?.status] || SPONSORSHIP_STATUSES} value={status} onChange={(e) => setStatus(e.target.value)} hint={`Currently ${row?.status || "—"}.`} />
				<Textarea label="Note for the record" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why the change? (kept on the sponsorship)" />
			</div>
		</Modal>
	)
}
