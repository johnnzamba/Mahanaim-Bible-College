import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Smartphone, XCircle } from "lucide-react"
import { frappe } from "../api/frappe"
import { useSession } from "../session"
import { money } from "../utils/format"
import { Alert, Button, Input, Modal, Spinner } from "./ui"

const POLL_MS = 3000
const GIVE_UP_MS = 120000
const STATUS_METHOD = "mahanaim.api.finance.payment_request_status"

/**
 * M-Pesa STK push dialog: phone + amount → "check your phone" → receipt or failure.
 *
 *   <MpesaPay open={open} onClose={…} title="Pay application fee" amount={1000} fixedAmount
 *     start={({ phone, amount }) => frappe.call("mahanaim.api.admissions.pay_application_fee", { name, phone })}
 *     onDone={() => invalidate("mahanaim.api.admissions.")} />
 *
 * `start` must resolve to the STK response `{ request, checkout_request_id, customer_message, simulation }`.
 * Status is polled with `statusMethod` (default finance.payment_request_status; guests pass
 * church.giving_status + `statusArgs(resp)`). Simulated requests (sandbox without Daraja) show
 * "Simulate" buttons for signed-in users so the flow can be demonstrated end to end.
 */
export function MpesaPay({
	open,
	onClose,
	title = "Pay with M-Pesa",
	subtitle,
	amount: initialAmount,
	fixedAmount = false,
	minAmount = 1,
	maxAmount,
	start,
	statusMethod = STATUS_METHOD,
	statusArgs = (resp) => ({ request: resp.request }),
	onDone,
	children,
}) {
	const session = useSession()
	const [phone, setPhone] = useState("")
	const [amount, setAmount] = useState("")
	const [stage, setStage] = useState("form") // form | waiting | done | failed | timeout
	const [resp, setResp] = useState(null)
	const [result, setResult] = useState(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const startedAt = useRef(0)

	useEffect(() => {
		if (!open) return
		setPhone(session.phone || "")
		setAmount(initialAmount != null ? String(Math.ceil(Number(initialAmount) || 0) || "") : "")
		setStage("form")
		setResp(null)
		setResult(null)
		setError("")
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (stage !== "waiting" || !resp) return undefined
		let cancelled = false
		let timer
		const tick = async () => {
			try {
				const s = await frappe.call(statusMethod, statusArgs(resp))
				if (cancelled) return
				if (s?.done) {
					const ok = s.status === "Completed"
					setResult({ ...s, receipt: s.receipt || s.mpesa_receipt_number, message: s.message || s.result_desc })
					setStage(ok ? "done" : "failed")
					if (ok) onDone?.(s)
					return
				}
			} catch {
				/* transient; keep polling */
			}
			if (cancelled) return
			if (Date.now() - startedAt.current > GIVE_UP_MS) setStage("timeout")
			else timer = setTimeout(tick, POLL_MS)
		}
		timer = setTimeout(tick, POLL_MS)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [stage, resp]) // eslint-disable-line react-hooks/exhaustive-deps

	const submit = async (e) => {
		e.preventDefault()
		const n = Number(amount)
		if (!fixedAmount && (!n || n < minAmount)) return setError(`Enter at least ${money(minAmount)}.`)
		if (!fixedAmount && maxAmount && n > maxAmount) return setError(`The most you can pay here is ${money(maxAmount)}.`)
		setBusy(true)
		setError("")
		try {
			const r = await start({ phone: phone.trim(), amount: fixedAmount ? Number(initialAmount) : n })
			if (!r?.request) throw new Error(r?.message || "M-Pesa did not accept the request. Please try again.")
			setResp(r)
			startedAt.current = Date.now()
			setStage("waiting")
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}

	const simulate = async (success) => {
		setBusy(true)
		try {
			await frappe.call("mahanaim.api.mpesa.simulate_callback", { request: resp.request, success: success ? 1 : 0 })
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}

	const shownAmount = fixedAmount ? Number(initialAmount) : Number(amount)
	const footer =
		stage === "form" ? (
			<>
				<Button variant="ghost" onClick={onClose}>
					Cancel
				</Button>
				<Button type="submit" form="mpesa-pay" loading={busy} icon={Smartphone}>
					{shownAmount ? `Pay ${money(shownAmount)}` : "Pay"}
				</Button>
			</>
		) : stage === "waiting" ? (
			<Button variant="ghost" onClick={onClose}>
				Close (keep waiting in background)
			</Button>
		) : (
			<>
				{stage !== "done" ? (
					<Button variant="ghost" onClick={() => setStage("form")}>
						Try again
					</Button>
				) : null}
				<Button onClick={onClose}>{stage === "done" ? "Done" : "Close"}</Button>
			</>
		)

	return (
		<Modal open={open} onClose={onClose} title={title} subtitle={subtitle} footer={footer} size="sm">
			{stage === "form" ? (
				<form id="mpesa-pay" onSubmit={submit} className="space-y-4">
					{children}
					{error ? <Alert tone="error">{error}</Alert> : null}
					{fixedAmount ? (
						<div className="flex items-center justify-between rounded-xl bg-cream/70 px-4 py-3">
							<span className="text-sm text-ink-muted">Amount</span>
							<span className="text-xl font-semibold tabular-nums text-ink">{money(initialAmount)}</span>
						</div>
					) : (
						<Input
							label="Amount"
							type="number"
							inputMode="numeric"
							min={minAmount}
							max={maxAmount}
							step="1"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							required
						/>
					)}
					<Input
						label="M-Pesa phone number"
						type="tel"
						inputMode="tel"
						icon={Smartphone}
						placeholder="07XX XXX XXX"
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						hint="You'll get a prompt on this phone to enter your M-Pesa PIN."
						required
					/>
				</form>
			) : stage === "waiting" ? (
				<div className="py-4 text-center">
					<span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
						<Spinner size={26} />
					</span>
					<h3 className="font-serif text-xl text-ink">Check your phone</h3>
					<p className="mx-auto mt-2 max-w-xs text-sm text-ink-muted">
						{resp?.customer_message && !resp.simulation ? resp.customer_message : `Enter your M-Pesa PIN on ${phone} to pay ${money(shownAmount)}.`}
					</p>
					{resp?.simulation && !session.isGuest ? (
						<div className="mt-5 rounded-xl border border-dashed border-gold-500 bg-gold-50/40 p-3 text-left text-xs text-ink-muted">
							<div className="mb-2 font-semibold text-ink">Sandbox: no real prompt was sent</div>
							<div className="flex gap-2">
								<Button size="sm" onClick={() => simulate(true)} loading={busy}>
									Simulate success
								</Button>
								<Button size="sm" variant="secondary" onClick={() => simulate(false)} disabled={busy}>
									Simulate failure
								</Button>
							</div>
						</div>
					) : null}
					{error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}
				</div>
			) : stage === "done" ? (
				<div className="py-4 text-center">
					<CheckCircle2 size={48} className="mx-auto text-emerald-600" />
					<h3 className="mt-3 font-serif text-xl text-ink">Payment received</h3>
					<p className="mt-2 text-sm text-ink-muted">
						{money(result?.amount || shownAmount)} paid{result?.receipt ? ` · M-Pesa ref ${result.receipt}` : ""}. A receipt has been sent to you.
					</p>
				</div>
			) : stage === "failed" ? (
				<div className="py-4 text-center">
					<XCircle size={48} className="mx-auto text-red-600" />
					<h3 className="mt-3 font-serif text-xl text-ink">Payment not completed</h3>
					<p className="mt-2 text-sm text-ink-muted">{result?.message || "The payment was cancelled or did not go through."}</p>
				</div>
			) : (
				<div className="py-4 text-center">
					<Smartphone size={44} className="mx-auto text-gold-700" />
					<h3 className="mt-3 font-serif text-xl text-ink">Still waiting for M-Pesa</h3>
					<p className="mt-2 text-sm text-ink-muted">
						We haven't heard back yet. If you completed the payment, it will show on your account shortly and you'll get a notification.
					</p>
				</div>
			)}
		</Modal>
	)
}
