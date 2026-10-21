import { useState } from "react"
import { useAction } from "@/shared/api/hooks"
import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from "@/shared/components/ui"
import { API, INVALIDATE, PREFERRED_COMMS, SPONSOR_STATUSES, SPONSOR_TYPES, searchChurches } from "./common"
import { nullify, SearchPick } from "./kit"

const BLANK = {
	sponsor_name: "",
	sponsor_type: "Individual",
	partner_church: "",
	status: "Active",
	email: "",
	phone: "",
	preferred_communication: "Email",
	contact_person: "",
	country: "Kenya",
	address: "",
	notes: "",
}

function fromDoc(doc) {
	const out = { ...BLANK }
	for (const k of Object.keys(BLANK)) if (doc?.[k] != null) out[k] = doc[k]
	return out
}

/** Create or edit a sponsor. `initial` = {} for new, the sponsor doc to edit; null closes. */
export function SponsorForm({ initial, onClose, onSaved }) {
	const [form, setForm] = useState(BLANK)
	const [churchLabel, setChurchLabel] = useState("")
	const [portal, setPortal] = useState(true)
	const [errors, setErrors] = useState({})
	const [seen, setSeen] = useState(null)
	if (initial !== seen) {
		setSeen(initial)
		setForm(fromDoc(initial))
		setChurchLabel(initial?.partner_church || "")
		setPortal(!initial?.user)
		setErrors({})
	}
	const isNew = !initial?.name
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = useAction(`${API}save_sponsor`, {
		invalidate: INVALIDATE,
		success: (doc) => (doc.user && !initial?.user ? "Sponsor saved, portal access created" : "Sponsor saved"),
		onSuccess: (doc) => {
			onClose()
			onSaved?.(doc)
		},
	})
	const submit = () => {
		const errs = {}
		if (!form.sponsor_name.trim()) errs.sponsor_name = "Enter the sponsor's name"
		if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = "Enter a valid email"
		if (portal && !initial?.user && !form.email) errs.email = "An email is needed for portal access"
		setErrors(errs)
		if (Object.keys(errs).length) return
		save.mutate({ data: nullify({ ...form, ...(isNew ? {} : { name: initial.name }) }), create_user: portal && !initial?.user ? 1 : 0 })
	}
	return (
		<Modal
			open={Boolean(initial)}
			onClose={onClose}
			size="lg"
			title={isNew ? "New sponsor" : `Edit ${initial.sponsor_name}`}
			subtitle={isNew ? "Individuals, churches and organisations who support students." : initial.name}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={submit}>
						Save sponsor
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Sponsor name" required value={form.sponsor_name} onChange={set("sponsor_name")} error={errors.sponsor_name} className="sm:col-span-2" />
				<Select label="Type" options={SPONSOR_TYPES} value={form.sponsor_type} onChange={set("sponsor_type")} />
				<Select label="Status" options={SPONSOR_STATUSES} value={form.status} onChange={set("status")} />
				<SearchPick
					id="sponsor-church"
					label="Partner church"
					value={form.partner_church}
					display={churchLabel}
					search={searchChurches}
					onChange={(v, r) => {
						setForm((f) => ({ ...f, partner_church: v || "" }))
						setChurchLabel(r?.label || "")
					}}
				/>
				<Input label="Contact person" value={form.contact_person} onChange={set("contact_person")} />
				<Input label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} />
				<Input label="Phone" type="tel" value={form.phone} onChange={set("phone")} placeholder="07XX XXX XXX" />
				<Select label="Preferred contact" options={PREFERRED_COMMS} value={form.preferred_communication} onChange={set("preferred_communication")} />
				<Input label="Country" value={form.country} onChange={set("country")} />
				<Textarea label="Address" rows={2} value={form.address} onChange={set("address")} className="sm:col-span-2" />
				<Textarea label="Notes" rows={3} value={form.notes} onChange={set("notes")} className="sm:col-span-2" />
				{initial?.user ? (
					<Alert tone="success" className="sm:col-span-2" title="Has portal access">
						Signs in as {initial.user}.
					</Alert>
				) : (
					<Checkbox
						className="sm:col-span-2"
						checked={portal}
						onChange={setPortal}
						label="Give portal access"
						description="Creates a sponsor login for this email so they can follow their students' progress and statements."
					/>
				)}
			</div>
		</Modal>
	)
}
