import { useEffect, useState } from "react"
import { Ban, BadgeCheck, ShieldAlert } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Alert, Button, Modal, Switch, Textarea } from "@/shared/components/ui"
import { API, CAN } from "../lib"

const INVALIDATE = [API, "mahanaim.api.students.get_request", "mahanaim.api.students.list_requests", "mahanaim.api.students.student_360"]

/** revoke_document (Registrar): Issued → Revoked with a required reason. Verification then reports "revoked". */
export function RevokeDialog({ open, onClose, doctype, name, label, onDone }) {
	const [reason, setReason] = useState("")
	const [touched, setTouched] = useState(false)
	useEffect(() => {
		if (open) {
			setReason("")
			setTouched(false)
		}
	}, [open])
	const revoke = useAction(`${API}revoke_document`, {
		invalidate: INVALIDATE,
		success: `${doctype} revoked`,
		onSuccess: (r) => {
			onClose()
			onDone?.(r)
		},
	})
	const short = reason.trim().length < 5
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="sm"
			title={`Revoke ${label || name}?`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={revoke.isPending}>
						Cancel
					</Button>
					<Button
						variant="danger"
						icon={Ban}
						loading={revoke.isPending}
						onClick={() => {
							setTouched(true)
							if (!short) revoke.mutate({ doctype, name, reason: reason.trim() })
						}}
					>
						Revoke
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<Alert tone="warning" icon={ShieldAlert}>
					Anyone who checks this {doctype.toLowerCase()}'s verification code will be told it has been revoked. Issued documents cannot be edited or reinstated.
				</Alert>
				<Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: issued with incorrect results; replaced by a corrected transcript" error={touched && short ? "Give a reason of at least a few words." : undefined} />
			</div>
		</Modal>
	)
}

/** issue_transcript (Registrar): Draft → Issued. The fee check runs unless the Registrar overrides it. */
export function IssueTranscriptDialog({ open, onClose, transcript, onDone }) {
	const { hasRole } = useSession()
	const canOverride = hasRole(...CAN.override)
	const [override, setOverride] = useState(false)
	const [feeError, setFeeError] = useState("")
	useEffect(() => {
		if (open) {
			setOverride(false)
			setFeeError("")
		}
	}, [open])
	const issue = useAction(`${API}issue_transcript`, {
		invalidate: INVALIDATE,
		error: false,
		success: (r) => (r.request ? `Transcript ${r.name} issued and request ${r.request} completed` : `Transcript ${r.name} issued`),
		onSuccess: (r) => {
			onClose()
			onDone?.(r)
		},
		onError: (e) => setFeeError(e?.message || "The transcript could not be issued."),
	})
	const t = transcript || {}
	const feeBlocked = /fee|clearance|balance|paid/i.test(feeError)
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="sm"
			title={`Issue ${t.transcript_type ? `${t.transcript_type.toLowerCase()} ` : ""}transcript?`}
			subtitle={t.student_name}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={issue.isPending}>
						Cancel
					</Button>
					<Button icon={BadgeCheck} loading={issue.isPending} onClick={() => issue.mutate({ name: t.name, override_fee_check: override ? 1 : 0 })}>
						{override ? "Issue with override" : "Issue transcript"}
					</Button>
				</>
			}
		>
			<div className="space-y-3 text-sm text-ink-muted">
				<p>
					Issuing takes a final snapshot of published results, gives the transcript a verification code and notifies the student
					{t.request ? `, and completes request ${t.request}` : ""}. It cannot be edited afterwards; it can only be revoked.
				</p>
				{feeError ? (
					<Alert tone="error" title={feeBlocked ? "Fee clearance required" : "Could not issue"}>
						{feeError}
					</Alert>
				) : null}
				{canOverride ? (
					<div className="rounded-xl border border-line px-3 py-2.5">
						<Switch checked={override} onChange={setOverride} label="Override the fee clearance check" />
						<p className="mt-1 text-xs text-ink-soft">Only use this with authorisation. The override and your name are recorded on the transcript.</p>
					</div>
				) : null}
			</div>
		</Modal>
	)
}
