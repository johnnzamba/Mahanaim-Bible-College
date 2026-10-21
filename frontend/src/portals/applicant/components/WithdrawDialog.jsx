import { useEffect, useState } from "react"
import { useAction } from "@/shared/api/hooks"
import { ConfirmDialog, Textarea } from "@/shared/components/ui"
import { INVALIDATE, M } from "../lib"

export function WithdrawDialog({ app, open, onClose, onDone }) {
	const [reason, setReason] = useState("")
	const act = useAction(M.withdraw, {
		invalidate: INVALIDATE,
		success: "Your application has been withdrawn",
		onSuccess: (d) => {
			onClose?.()
			onDone?.(d)
		},
	})
	useEffect(() => {
		if (open) setReason("")
	}, [open])
	return (
		<ConfirmDialog
			open={open}
			title="Withdraw this application?"
			message={app ? `${app.name} for ${app.programme_name} will be closed and the admissions team notified. You can apply again later.` : ""}
			confirmLabel="Withdraw application"
			tone="danger"
			loading={act.isPending}
			onConfirm={() => act.mutate({ name: app.name, reason: reason.trim() || undefined })}
			onClose={onClose}
		>
			<Textarea className="mt-3" label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let us know why you're withdrawing" />
		</ConfirmDialog>
	)
}
