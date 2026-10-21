import { frappe } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { MpesaPay } from "@/shared/components/MpesaPay"
import { money } from "@/shared/utils/format"
import { INVALIDATE, M } from "../lib"

/** M-Pesa STK push for an application's fee. `app` needs name, programme_name, application_fee. */
export function PayFeeDialog({ app, open, onClose, onPaid }) {
	const invalidate = useInvalidate()
	const close = () => {
		invalidate(...INVALIDATE)
		onClose?.()
	}
	return (
		<MpesaPay
			open={open && Boolean(app)}
			onClose={close}
			title="Pay application fee"
			subtitle={app ? `${app.name} · ${app.programme_name || app.programme}` : undefined}
			amount={app?.application_fee}
			fixedAmount
			start={({ phone }) => frappe.call(M.pay, { name: app.name, phone })}
			onDone={() => {
				invalidate(...INVALIDATE)
				onPaid?.()
			}}
		>
			<div className="rounded-xl border border-line bg-cream/50 p-3 text-xs text-ink-muted">
				The non-refundable application fee of <span className="font-semibold text-ink">{money(app?.application_fee)}</span> lets the
				admissions team start reviewing your application. Your M-Pesa receipt is saved to your Payments page.
			</div>
		</MpesaPay>
	)
}
