import { useEffect, useState } from "react"
import { Church, HeartHandshake, Phone, Save } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Button, Input, Modal, Textarea } from "@/shared/components/ui"
import { API, INV } from "./lib"

/** Self-editable profile field groups (keys must be in my_profile.editable_fields to be shown). */
export const PROFILE_SECTIONS = {
	contact: {
		title: "Contact details",
		icon: Phone,
		fields: [
			{ key: "phone", label: "Mobile phone", type: "tel", hint: "Used for M-Pesa prompts and SMS alerts.", autoComplete: "tel" },
			{ key: "postal_address", label: "Postal address", type: "textarea" },
			{ key: "county", label: "County" },
		],
	},
	nok: {
		title: "Next of kin",
		icon: HeartHandshake,
		fields: [
			{ key: "nok_name", label: "Full name" },
			{ key: "nok_relationship", label: "Relationship", placeholder: "e.g. Mother, Spouse" },
			{ key: "nok_phone", label: "Phone", type: "tel" },
		],
	},
	church: {
		title: "Church & ministry",
		icon: Church,
		fields: [
			{ key: "home_church", label: "Home church" },
			{ key: "pastor_name", label: "Pastor's name" },
			{ key: "pastor_phone", label: "Pastor's phone", type: "tel" },
			{ key: "ministry_role", label: "Ministry role", placeholder: "e.g. Youth leader, Worship team" },
		],
	},
}

/**
 * Edit a group of self-editable profile fields.
 * fields: [{ key, label, type?: "text"|"tel"|"textarea", hint?, placeholder? }] — only keys in `editable` are shown.
 */
export function ProfileEditModal({ open, onClose, title, fields, editable = [], profile }) {
	const session = useSession()
	const allowed = fields.filter((f) => editable.includes(f.key))
	const [v, setV] = useState({})
	useEffect(() => {
		if (open) setV(Object.fromEntries(allowed.map((f) => [f.key, profile?.[f.key] ?? ""])))
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps
	const act = useAction(API.updateProfile, {
		invalidate: [INV.students],
		success: "Profile updated",
		onSuccess: () => {
			session.reload?.()
			onClose()
		},
	})
	const changed = Object.fromEntries(allowed.filter((f) => (v[f.key] ?? "") !== (profile?.[f.key] ?? "")).map((f) => [f.key, typeof v[f.key] === "string" ? v[f.key].trim() : v[f.key]]))
	const phoneBad = allowed.some((f) => f.type === "tel" && v[f.key] && !/^\+?[\d\s-]{9,16}$/.test(v[f.key]))
	return (
		<Modal
			open={open}
			onClose={onClose}
			title={title}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button icon={Save} disabled={!Object.keys(changed).length || phoneBad} loading={act.isPending} onClick={() => act.mutate({ data: changed })}>
						Save changes
					</Button>
				</>
			}
		>
			<form
				className="space-y-4"
				onSubmit={(e) => {
					e.preventDefault()
					if (Object.keys(changed).length && !phoneBad) act.mutate({ data: changed })
				}}
			>
				{allowed.map((f) =>
					f.type === "textarea" ? (
						<Textarea key={f.key} label={f.label} hint={f.hint} rows={3} value={v[f.key] ?? ""} onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))} />
					) : (
						<Input
							key={f.key}
							label={f.label}
							hint={f.hint}
							type={f.type || "text"}
							inputMode={f.type === "tel" ? "tel" : undefined}
							autoComplete={f.autoComplete}
							placeholder={f.placeholder}
							value={v[f.key] ?? ""}
							error={f.type === "tel" && v[f.key] && !/^\+?[\d\s-]{9,16}$/.test(v[f.key]) ? "Enter a valid phone number" : null}
							onChange={(e) => setV((x) => ({ ...x, [f.key]: e.target.value }))}
						/>
					)
				)}
				<button type="submit" className="hidden" />
			</form>
		</Modal>
	)
}
