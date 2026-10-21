import { useEffect, useState } from "react"
import { Send } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Button, Input, Modal, RadioCards, Select, Textarea } from "@/shared/components/ui"
import { API, INV } from "./lib"

const TYPES = [
	{ value: "Provisional", label: "Provisional", description: "Unofficial record of results to date, for applications in progress." },
	{ value: "Official", label: "Official", description: "Signed and sealed transcript with a verification code." },
	{ value: "Final", label: "Final", description: "Complete record issued on completion of your programme." },
]

const DELIVERY = [
	{ value: "Collect", label: "Collect from the registry" },
	{ value: "Email", label: "Email (PDF with verification code)" },
	{ value: "Courier", label: "Courier (delivery charges may apply)" },
]

export function TranscriptRequestModal({ open, onClose, defaultType = "Official", onDone }) {
	const [form, setForm] = useState({ type: defaultType, copies: 1, delivery_method: "Collect", reason: "" })
	useEffect(() => {
		if (open) setForm({ type: defaultType, copies: 1, delivery_method: "Collect", reason: "" })
	}, [open, defaultType])
	const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))
	const act = useAction(API.requestTranscript, {
		invalidate: [INV.credentials, INV.students],
		success: (r) => `Transcript request ${r?.name || ""} submitted`,
		onSuccess: (r) => {
			onClose?.()
			onDone?.(r)
		},
	})
	const copies = Number(form.copies)
	const valid = copies >= 1 && copies <= 10
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Request a transcript"
			subtitle="The registry reviews requests within 3 working days. You'll be notified at each step."
			size="lg"
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button icon={Send} loading={act.isPending} disabled={!valid} onClick={() => act.mutate({ ...form, copies })}>
						Submit request
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div>
					<div className="label">Transcript type</div>
					<RadioCards cols={3} options={TYPES} value={form.type} onChange={set("type")} />
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<Input
						label="Copies"
						type="number"
						min={1}
						max={10}
						value={form.copies}
						onChange={set("copies")}
						error={valid ? null : "Between 1 and 10 copies"}
					/>
					<Select label="Delivery" options={DELIVERY} value={form.delivery_method} onChange={set("delivery_method")} />
				</div>
				<Textarea
					label="Purpose (optional)"
					rows={3}
					value={form.reason}
					onChange={set("reason")}
					placeholder="e.g. Application for further studies at …"
				/>
			</div>
		</Modal>
	)
}
