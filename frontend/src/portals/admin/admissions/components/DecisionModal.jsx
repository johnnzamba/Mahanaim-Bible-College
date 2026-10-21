import { useEffect, useState } from "react"
import { CheckCircle2, Hourglass, XCircle } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Alert, Button, Input, Modal, RadioCards, Textarea } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { API } from "../lib"

const OPTIONS = [
	{ value: "Admitted", label: "Admit", description: "Send an offer of admission.", icon: CheckCircle2 },
	{ value: "Waitlisted", label: "Waitlist", description: "Hold until a place opens.", icon: Hourglass },
	{ value: "Rejected", label: "Reject", description: "Decline with a reason.", icon: XCircle },
]

const todayIso = () => new Date().toISOString().slice(0, 10)

/**
 * Record an admission decision for one application (`decide`) or many (`bulk_decide`).
 * `allowed` limits the choices to what the application's current status permits.
 */
export default function DecisionModal({ open, onClose, names = [], label, allowed, initial, onDone }) {
	const bulk = names.length > 1
	const options = OPTIONS.filter((o) => !allowed || allowed.includes(o.value))
	const [decision, setDecision] = useState("")
	const [notes, setNotes] = useState("")
	const [reason, setReason] = useState("")
	const [expiry, setExpiry] = useState("")
	const [failed, setFailed] = useState([])
	const [error, setError] = useState("")
	const optionKey = options.map((o) => o.value).join("|")

	useEffect(() => {
		if (!open) return
		const values = optionKey.split("|").filter(Boolean)
		setDecision(initial && values.includes(initial) ? initial : values[0] || "")
		setNotes("")
		setReason("")
		setExpiry("")
		setFailed([])
		setError("")
	}, [open, initial, optionKey])

	const one = useAction(`${API}decide`, {
		invalidate: [API],
		success: (d) => `${d.full_name} is now ${String(d.status).toLowerCase()}.`,
		onSuccess: () => {
			onDone?.()
			onClose()
		},
	})
	const many = useAction(`${API}bulk_decide`, {
		invalidate: [API],
		onSuccess: (res) => {
			const n = res?.updated?.length || 0
			if (n) toast.success(`${n} application${n === 1 ? "" : "s"} updated.`)
			onDone?.(res)
			if (res?.failed?.length) setFailed(res.failed)
			else onClose()
		},
	})
	const busy = one.isPending || many.isPending

	const submit = () => {
		if (!decision) return
		if (decision === "Rejected" && !reason.trim()) {
			setError("Give the applicant a reason for the decision.")
			return
		}
		if (expiry && expiry < todayIso()) {
			setError("The offer expiry date must be today or later.")
			return
		}
		setError("")
		const payload = {
			decision,
			notes: notes.trim() || undefined,
			rejection_reason: decision === "Rejected" ? reason.trim() : undefined,
		}
		if (bulk) many.mutate({ names, ...payload })
		else one.mutate({ name: names[0], ...payload, offer_expiry: decision === "Admitted" && expiry ? expiry : undefined })
	}

	return (
		<Modal
			open={open}
			onClose={busy ? undefined : onClose}
			title={bulk ? `Decide ${names.length} applications` : "Record decision"}
			subtitle={bulk ? "Only applications under review, at interview or waitlisted can be decided; others are skipped." : label}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={busy}>
						{failed.length ? "Close" : "Cancel"}
					</Button>
					{failed.length || !options.length ? null : (
						<Button variant={decision === "Rejected" ? "danger" : "primary"} onClick={submit} loading={busy} disabled={!decision}>
							{decision === "Admitted" ? "Admit" : decision === "Waitlisted" ? "Waitlist" : "Reject"}
							{bulk ? ` ${names.length}` : ""}
						</Button>
					)}
				</>
			}
		>
			{failed.length ? (
				<div className="space-y-3">
					<Alert tone="warning" title={`${failed.length} could not be updated`}>
						The others were saved. Open these applications to resolve them one by one.
					</Alert>
					<ul className="divide-y divide-line rounded-xl border border-line text-sm">
						{failed.map((f) => (
							<li key={f.name} className="px-3 py-2">
								<div className="font-semibold text-ink">{f.name}</div>
								<div className="text-xs text-ink-muted">{f.error}</div>
							</li>
						))}
					</ul>
				</div>
			) : !options.length ? (
				<Alert tone="info">This application is not at a stage where a decision can be recorded.</Alert>
			) : (
				<div className="space-y-4">
					<RadioCards options={options} value={decision} onChange={setDecision} cols={options.length === 3 ? 3 : 2} />
					{decision === "Rejected" ? (
						<Textarea
							label="Reason shared with the applicant"
							required
							rows={3}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="e.g. The entry requirements for this programme are not yet met."
						/>
					) : null}
					{decision === "Admitted" && !bulk ? (
						<Input
							type="date"
							label="Offer expires on"
							hint="Leave blank to use the standard offer window from settings."
							min={todayIso()}
							value={expiry}
							onChange={(e) => setExpiry(e.target.value)}
						/>
					) : null}
					<Textarea label="Internal notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Seen by admissions staff only." />
					{error ? <Alert tone="error">{error}</Alert> : null}
				</div>
			)}
		</Modal>
	)
}
