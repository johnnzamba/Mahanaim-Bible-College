import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import clsx from "clsx"
import { CheckCircle2, Loader2, RefreshCw, Smartphone, XCircle } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { Button } from "@/shared/components/ui"
import { money } from "@/shared/utils/format"

const PENDING = new Set(["Initiated", "Pending", "", undefined, null])

/**
 * Poll an M-Pesa status endpoint every few seconds until `done` (or ~3 minutes pass).
 * Returns { status, data, timedOut, query }.
 */
export function usePaymentPoll(method, args, { enabled = true, guest = true, interval = 3000, maxMs = 180_000 } = {}) {
	const [started] = useState(() => Date.now())
	const [timedOut, setTimedOut] = useState(false)
	const query = useQuery({
		queryKey: [method, args, "poll"],
		queryFn: () => (guest ? frappe.get(method, args) : frappe.call(method, args)),
		enabled: Boolean(method) && enabled && !timedOut,
		refetchInterval: (q) => (q.state.data?.done || timedOut ? false : interval),
		refetchIntervalInBackground: true,
		retry: 2,
		staleTime: 0,
		gcTime: 0,
	})
	useEffect(() => {
		if (!enabled || query.data?.done) return undefined
		const left = Math.max(0, maxMs - (Date.now() - started))
		const t = setTimeout(() => setTimedOut(true), left)
		return () => clearTimeout(t)
	}, [enabled, query.data?.done, maxMs, started])
	return { status: query.data?.status, data: query.data, timedOut, query }
}

const PHONE_STEPS = ["Unlock your phone and look for the M-Pesa prompt", "Check the amount and enter your M-Pesa PIN", "Wait here; we confirm the payment automatically"]

/**
 * "Check your phone" panel for an STK push.
 * status: undefined (not polling) | Initiated | Pending | Completed | Failed | Cancelled | Timeout
 */
export function MpesaWait({ phone, amount, currency, message, status, receipt, timedOut, polling = true, onRetry, retrying, successTitle, successText, children, className }) {
	const done = status === "Completed"
	const failed = status && !PENDING.has(status) && !done
	return (
		<div className={clsx("rounded-2xl border p-5 sm:p-6", done ? "border-emerald-200 bg-emerald-50/60" : failed ? "border-red-200 bg-red-50/60" : "border-gold-200 bg-cream/70", className)} aria-live="polite">
			<div className="flex items-start gap-4">
				<span
					className={clsx(
						"relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl",
						done ? "bg-emerald-600 text-white" : failed ? "bg-red-600 text-white" : "bg-brand-800 text-gold-300"
					)}
				>
					{!done && !failed ? <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-brand-700/30" /> : null}
					{done ? <CheckCircle2 size={28} /> : failed ? <XCircle size={28} /> : <Smartphone size={28} className="relative" />}
				</span>
				<div className="min-w-0 flex-1">
					<h3 className="font-serif text-xl text-ink">
						{done ? successTitle || "Payment received. Thank you!" : failed ? "Payment not completed" : "Check your phone"}
					</h3>
					<p className="mt-1 text-sm leading-relaxed text-ink-muted">
						{done
							? successText || "Your M-Pesa payment has been confirmed."
							: failed
								? message || "The M-Pesa payment did not go through. You can try again."
								: message ||
									`We have sent an M-Pesa prompt${phone ? ` to ${phone}` : ""}${amount ? ` for ${money(amount, { currency })}` : ""}. Enter your PIN to complete the payment.`}
					</p>
					{done && receipt ? (
						<div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-emerald-200">
							<span className="text-ink-soft">M-Pesa receipt</span>
							<span className="font-mono font-semibold text-ink">{receipt}</span>
						</div>
					) : null}
				</div>
			</div>

			{!done && !failed ? (
				<>
					<ol className="mt-5 grid gap-2 sm:grid-cols-3">
						{PHONE_STEPS.map((s, i) => (
							<li key={s} className="flex gap-2.5 rounded-xl bg-surface p-3 text-xs leading-relaxed text-ink-muted ring-1 ring-line">
								<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold-500 text-[10.5px] font-bold text-brand-900">{i + 1}</span>
								{s}
							</li>
						))}
					</ol>
					{polling ? (
						<div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
							{timedOut ? (
								<span className="text-ink-muted">Still waiting for M-Pesa. If you completed the payment you'll get an SMS confirmation shortly.</span>
							) : (
								<span className="inline-flex items-center gap-2 font-medium text-ink-muted">
									<Loader2 size={16} className="animate-spin text-brand-700" /> Waiting for confirmation…
								</span>
							)}
							{onRetry && timedOut ? (
								<Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} loading={retrying}>
									Send a new prompt
								</Button>
							) : null}
						</div>
					) : null}
				</>
			) : null}

			{failed && onRetry ? (
				<div className="mt-4">
					<Button icon={RefreshCw} onClick={onRetry} loading={retrying}>
						Try again
					</Button>
				</div>
			) : null}
			{children ? <div className="mt-5">{children}</div> : null}
		</div>
	)
}
