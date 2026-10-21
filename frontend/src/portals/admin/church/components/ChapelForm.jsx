import { useState } from "react"
import { useAction } from "@/shared/api/hooks"
import { Button, Input, Modal, Select, Textarea } from "@/shared/components/ui"
import { API, CHAPEL_STATUSES, INVALIDATE, searchStaff, SERVICE_TYPES } from "./common"
import { nullify, SearchPick, today, useLookups } from "./kit"

const BLANK = {
	service_date: "",
	service_type: "Chapel",
	campus: "",
	status: "Scheduled",
	theme: "",
	scripture: "",
	preacher: "",
	preacher_staff: "",
	offering_total: "",
	sermon_media_url: "",
	notes: "",
}

/** Schedule or edit a chapel service (details only; the roll is captured on the service page). */
export function ChapelForm({ initial, onClose, onSaved }) {
	const lookups = useLookups()
	const [form, setForm] = useState(BLANK)
	const [staffLabel, setStaffLabel] = useState("")
	const [errors, setErrors] = useState({})
	const [seen, setSeen] = useState(null)
	if (initial !== seen) {
		setSeen(initial)
		const f = { ...BLANK, service_date: today() }
		for (const k of Object.keys(BLANK)) if (initial?.[k] != null) f[k] = initial[k]
		setForm(f)
		setStaffLabel(initial?.preacher_staff ? initial.preacher || initial.preacher_staff : "")
		setErrors({})
	}
	const isNew = !initial?.name
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = useAction(`${API}save_chapel_service`, {
		invalidate: INVALIDATE,
		success: isNew ? "Service scheduled" : "Service updated",
		onSuccess: (doc) => {
			onClose()
			onSaved?.(doc)
		},
	})
	const future = form.service_date > today()
	const submit = () => {
		const errs = {}
		if (!form.service_date) errs.service_date = "Choose the date"
		if (form.status === "Held" && future) errs.status = "A future service can't be marked as held"
		if (Number(form.offering_total) < 0) errs.offering_total = "Can't be negative"
		setErrors(errs)
		if (Object.keys(errs).length) return
		save.mutate({
			data: nullify({ ...form, offering_total: Number(form.offering_total) || 0, ...(isNew ? {} : { name: initial.name }) }),
		})
	}
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))
	return (
		<Modal
			open={Boolean(initial)}
			onClose={onClose}
			size="lg"
			title={isNew ? "Schedule a chapel service" : "Edit service details"}
			subtitle={isNew ? "Attendance is taken on the service page on the day." : initial.name}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={submit}>
						{isNew ? "Schedule service" : "Save changes"}
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Date" type="date" required value={form.service_date} onChange={set("service_date")} error={errors.service_date} />
				<Select label="Service" required options={SERVICE_TYPES} value={form.service_type} onChange={set("service_type")} />
				<Select label="Campus" placeholder="All campuses" options={campuses} value={form.campus} onChange={set("campus")} />
				<Select label="Status" options={CHAPEL_STATUSES} value={form.status} onChange={set("status")} error={errors.status} />
				<Input label="Theme" value={form.theme} onChange={set("theme")} placeholder="e.g. Called to serve" className="sm:col-span-2" />
				<Input label="Scripture" value={form.scripture} onChange={set("scripture")} placeholder="e.g. Isaiah 6:1-8" />
				<SearchPick
					id="chapel-preacher"
					label="Preacher (staff)"
					value={form.preacher_staff}
					display={staffLabel}
					search={searchStaff}
					hint="Or type a guest preacher below."
					onChange={(v, r) => {
						setForm((f) => ({ ...f, preacher_staff: v || "", preacher: r?.label || (v ? f.preacher : "") }))
						setStaffLabel(r?.label || "")
					}}
				/>
				<Input label="Preacher's name" value={form.preacher} onChange={set("preacher")} disabled={Boolean(form.preacher_staff)} placeholder="Guest preacher" />
				<Input label="Offering total (KES)" type="number" min="0" value={form.offering_total} onChange={set("offering_total")} error={errors.offering_total} />
				<Input label="Sermon media link" type="url" value={form.sermon_media_url} onChange={set("sermon_media_url")} placeholder="https://youtube.com/…" className="sm:col-span-2" />
				<Textarea label="Notes" rows={3} value={form.notes} onChange={set("notes")} className="sm:col-span-2" />
			</div>
		</Modal>
	)
}
