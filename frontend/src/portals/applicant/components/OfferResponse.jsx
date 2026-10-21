import { useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, GraduationCap, PartyPopper, XCircle } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { Alert, Button, ConfirmDialog, Modal, Textarea } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { useSession } from "@/shared/session"
import { date, daysUntil } from "@/shared/utils/format"
import { INVALIDATE, M } from "../lib"

/** Accept / decline an offer. After accepting, the session is reloaded so the student portal appears. */
export function OfferResponse({ app, onAccepted }) {
	const session = useSession()
	const invalidate = useInvalidate()
	const [mode, setMode] = useState(null) // accept | decline
	const [reason, setReason] = useState("")
	const [busy, setBusy] = useState(false)
	const expiresIn = app.offer_expiry ? daysUntil(app.offer_expiry) : null
	const expired = expiresIn != null && expiresIn < 0

	const accept = async () => {
		setBusy(true)
		try {
			const updated = await frappe.call(M.accept, { name: app.name })
			const s = await session.reload().catch(() => null)
			invalidate(...INVALIDATE)
			setMode(null)
			onAccepted?.({ app: updated, student: (s?.portals || session.portals).includes("student") })
		} catch (err) {
			toast.error(err.message)
		} finally {
			setBusy(false)
		}
	}

	const decline = async () => {
		setBusy(true)
		try {
			await frappe.call(M.decline, { name: app.name, reason: reason.trim() || undefined })
			invalidate(...INVALIDATE)
			toast.info("You have declined the offer")
			setMode(null)
		} catch (err) {
			toast.error(err.message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div id="offer" className="scroll-mt-24 overflow-hidden rounded-2xl border border-line">
			<div className="hero-wash relative px-5 py-5 text-white">
				<div className="flex items-start gap-3">
					<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15">
						<PartyPopper size={22} aria-hidden />
					</span>
					<div className="min-w-0">
						<div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Offer of admission</div>
						<h2 className="mt-0.5 font-serif text-xl leading-snug text-white">Congratulations, {app.first_name}!</h2>
						<p className="mt-1 text-sm text-white/80">
							You have been offered a place in the <strong className="text-white">{app.programme_name}</strong> programme
							{app.intake ? ` for the ${app.intake}` : ""}.
						</p>
					</div>
				</div>
			</div>
			<div className="space-y-4 bg-surface p-5">
				{app.offer_expiry ? (
					<Alert tone={expired ? "error" : expiresIn <= 7 ? "warning" : "info"} title={expired ? "This offer has expired" : `Please respond by ${date(app.offer_expiry)}`}>
						{expired
							? "Contact the admissions office if you still wish to take up your place."
							: `That's ${expiresIn === 0 ? "today" : `${expiresIn} day${expiresIn === 1 ? "" : "s"} from now`}. Accepting creates your student record and student number.`}
					</Alert>
				) : null}
				<div className="flex flex-col gap-2 sm:flex-row">
					<Button size="lg" icon={CheckCircle2} onClick={() => setMode("accept")} disabled={expired} className="sm:flex-1">
						Accept offer
					</Button>
					<Button size="lg" variant="secondary" icon={XCircle} onClick={() => setMode("decline")} className="sm:flex-1">
						Decline
					</Button>
				</div>
			</div>

			<ConfirmDialog
				open={mode === "accept"}
				title="Accept your offer?"
				message={`You're accepting a place in ${app.programme_name}${app.intake ? ` (${app.intake})` : ""} at ${app.campus}. Your student record and number will be created straight away.`}
				confirmLabel="Yes, accept my place"
				loading={busy}
				onConfirm={accept}
				onClose={() => setMode(null)}
			/>
			<ConfirmDialog
				open={mode === "decline"}
				title="Decline this offer?"
				message="Declining releases your place to another applicant. This cannot be undone."
				confirmLabel="Decline offer"
				tone="danger"
				loading={busy}
				onConfirm={decline}
				onClose={() => setMode(null)}
			>
				<Textarea
					className="mt-3"
					label="Reason (optional)"
					rows={3}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder="e.g. I've chosen a different programme"
				/>
			</ConfirmDialog>
		</div>
	)
}

/** Shown after accepting: the student number and a way into the student portal. */
export function WelcomeModal({ welcome, onClose }) {
	const app = welcome?.app
	return (
		<Modal
			open={Boolean(welcome)}
			onClose={onClose}
			title="Welcome to Mahanaim!"
			size="sm"
			footer={
				welcome?.student ? (
					<Link to="/student" className="btn btn-primary">
						<GraduationCap size={16} /> Go to student portal
					</Link>
				) : (
					<Button onClick={onClose}>Done</Button>
				)
			}
		>
			<div className="py-2 text-center">
				<span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
					<GraduationCap size={26} aria-hidden />
				</span>
				<p className="text-sm text-ink-muted">You've accepted your place in {app?.programme_name}.</p>
				{app?.student_number ? (
					<p className="mt-3 text-sm">
						Your student number is <span className="font-mono text-base font-semibold text-ink">{app.student_number}</span>
					</p>
				) : (
					<p className="mt-3 text-sm text-ink-muted">Your student number will be sent to you as soon as your record is ready.</p>
				)}
				{welcome?.student ? (
					<p className="mt-3 text-xs text-ink-soft">Your student portal is ready — register for units, see your fees and timetable.</p>
				) : null}
			</div>
		</Modal>
	)
}
