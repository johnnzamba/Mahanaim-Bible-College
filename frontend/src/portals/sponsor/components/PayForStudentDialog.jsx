import { frappe } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { MpesaPay } from "@/shared/components/MpesaPay"
import { money } from "@/shared/utils/format"
import { INVALIDATE, M } from "../lib"

/** STK push towards a sponsored student's fees. `student` is a my_students row (or student_progress.student). */
export function PayForStudentDialog({ student, open, onClose, onPaid }) {
	const invalidate = useInvalidate()
	const id = student?.student || student?.name
	const balance = Math.max(Number(student?.fee_balance || 0), 0)
	return (
		<MpesaPay
			open={open && Boolean(student)}
			onClose={() => {
				invalidate(...INVALIDATE)
				onClose?.()
			}}
			title="Pay student fees"
			subtitle={student ? `${student.full_name} · ${student.student_number || id}` : undefined}
			amount={balance || undefined}
			minAmount={10}
			start={({ phone, amount }) => frappe.call(M.payForStudent, { student: id, amount, phone })}
			onDone={() => {
				invalidate(...INVALIDATE, "mahanaim.api.finance.")
				onPaid?.()
			}}
		>
			<div className="rounded-xl border border-line bg-cream/50 p-3 text-xs text-ink-muted">
				{balance > 0 ? (
					<>
						Current fee balance: <span className="font-semibold text-ink">{money(balance)}</span>. You can pay the full balance or any part of it.
					</>
				) : (
					<>This student has no outstanding balance — any payment is held as credit towards next term's fees.</>
				)}{" "}
				The payment is recorded against {student?.full_name?.split(" ")[0] || "the student"}'s account in your name, and a receipt appears under Giving.
			</div>
		</MpesaPay>
	)
}
