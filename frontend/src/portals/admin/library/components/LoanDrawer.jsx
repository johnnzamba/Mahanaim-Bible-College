import { useState } from "react"
import { Link } from "react-router-dom"
import { BookCheck, BookX, CalendarPlus, CircleDollarSign, HandCoins, RotateCcw, SearchX, ShieldAlert, X } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Checkbox, Drawer, Empty, Input, SkeletonRows, Textarea } from "@/shared/components/ui"
import { date, money } from "@/shared/utils/format"
import { API, INVALIDATE, dueText, isOpen, toneOf, useLibRoles } from "./common"
import { Stat, addDays, today } from "./kit"

const ACTIONS = {
	issue: { label: "Issue to borrower", method: "issue_loan", success: "Loan issued" },
	reject: { label: "Decline request", method: "reject_loan_request", success: "Request declined", danger: true },
	return: { label: "Record return", method: "return_loan", success: "Return recorded" },
	renew: { label: "Renew loan", method: "renew_loan", success: "Loan renewed" },
	lost: { label: "Mark as lost", method: "mark_lost", success: "Marked as lost", danger: true },
	fine: { label: "Record fine payment", method: "record_fine_payment", success: "Fine marked as paid" },
}

/**
 * One loan with the desk actions. `name` comes from `?loan=`; there is no get_loan endpoint,
 * so the loan is found with list_loans(search=name). `initial` (the clicked row) shows instantly.
 */
export function LoanDrawer({ name, initial, onClose, loanDays = 14 }) {
	const q = useApi(`${API}list_loans`, { search: name, page_length: 10 }, { enabled: Boolean(name) })
	const found = q.data?.data?.find((r) => r.name === name)
	const loan = found || (initial?.name === name ? initial : null)
	return (
		<Drawer
			open={Boolean(name)}
			onClose={onClose}
			title={loan ? loan.item_title : name}
			subtitle={loan ? `${name} · ${loan.borrower_name || ""}` : "Loan"}
		>
			{loan ? (
				<LoanBody key={`${loan.name}:${loan.status}:${loan.due_date}:${loan.fine_paid}`} loan={loan} loanDays={loanDays} onClose={onClose} />
			) : q.isLoading ? (
				<SkeletonRows rows={6} />
			) : q.isError ? (
				<Alert tone="error" title="Couldn't load this loan">
					{q.error?.message}
				</Alert>
			) : (
				<Empty icon={SearchX} title="Loan not found" subtitle={`There is no loan called ${name}, or you can't see it.`} />
			)}
		</Drawer>
	)
}

function LoanBody({ loan, loanDays, onClose }) {
	const { canManage } = useLibRoles()
	const [mode, setMode] = useState(null)
	const due = dueText(loan)
	const open = isOpen(loan)
	const fine = Number(loan.fine_amount) || 0
	const remarks = (loan.remarks || "").trim()
	return (
		<div className="space-y-5" data-loan={loan.name}>
			<div className="flex flex-wrap items-center gap-2">
				<Badge status={loan.status} tone={toneOf(loan.status)} />
				{due ? <span className={`text-sm font-medium ${loan.status === "Overdue" || due.includes("overdue") ? "text-red-600" : "text-ink-muted"}`}>{due}</span> : null}
				{fine > 0 ? <Badge tone={loan.fine_paid ? "green" : "red"} size="xs">{loan.fine_paid ? "Fine paid" : "Fine due"}</Badge> : null}
			</div>

			<div className="grid grid-cols-2 gap-2.5">
				<Stat label={loan.status === "Requested" ? "Requested" : "Issued"} value={date(loan.issue_date)} />
				<Stat label="Due" value={loan.due_date ? date(loan.due_date) : "—"} tone={loan.status === "Overdue" ? "text-red-600" : undefined} />
				<Stat label="Returned" value={loan.return_date ? date(loan.return_date) : "—"} />
				<Stat label="Fine" value={fine > 0 ? money(fine) : "None"} sub={fine > 0 ? (loan.fine_paid ? "Paid" : "Outstanding") : null} tone={fine > 0 && !loan.fine_paid ? "text-red-600" : undefined} />
			</div>

			<dl className="grid gap-3 rounded-xl border border-line p-4 text-sm sm:grid-cols-2">
				<div>
					<dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Item</dt>
					<dd className="mt-0.5">
						<Link to={`/admin/library/catalogue/${encodeURIComponent(loan.library_item)}`} className="font-medium text-brand-700 hover:underline">
							{loan.item_title}
						</Link>
						<span className="block text-xs text-ink-soft">{loan.library_item}</span>
					</dd>
				</div>
				<div>
					<dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Borrower</dt>
					<dd className="mt-0.5">
						<span className="font-medium text-ink">{loan.borrower_name || "—"}</span>
						<span className="block text-xs text-ink-soft">
							{loan.borrower_type} · {loan.student || loan.staff_member}
						</span>
					</dd>
				</div>
				{remarks ? (
					<div className="sm:col-span-2">
						<dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Notes</dt>
						<dd className="mt-0.5 whitespace-pre-line text-ink-muted">{remarks}</dd>
					</div>
				) : null}
			</dl>

			{canManage ? (
				mode ? (
					<ActionForm mode={mode} loan={loan} loanDays={loanDays} onCancel={() => setMode(null)} onDone={(m) => (m === "reject" ? onClose() : setMode(null))} />
				) : (
					<div className="space-y-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Desk actions</h3>
						<div className="grid gap-2 sm:grid-cols-2">
							{loan.status === "Requested" ? (
								<>
									<ActionButton icon={BookCheck} label="Issue now" sub="Hand the copy to the borrower" onClick={() => setMode("issue")} data-action="issue" />
									<ActionButton icon={X} label="Decline" sub="Cancel the request with a reason" onClick={() => setMode("reject")} data-action="reject" />
								</>
							) : null}
							{open || loan.status === "Lost" ? <ActionButton icon={RotateCcw} label={loan.status === "Lost" ? "Found & returned" : "Return"} sub="Check the copy back in" onClick={() => setMode("return")} data-action="return" /> : null}
							{open ? (
								<>
									<ActionButton icon={CalendarPlus} label="Renew" sub="Set a new due date" onClick={() => setMode("renew")} data-action="renew" />
									<ActionButton icon={BookX} label="Mark lost" sub="Add a replacement fee" onClick={() => setMode("lost")} data-action="lost" />
								</>
							) : null}
							{fine > 0 && !loan.fine_paid && loan.status !== "Cancelled" ? <ActionButton icon={HandCoins} label="Record fine payment" sub={`${money(fine)} received`} onClick={() => setMode("fine")} data-action="fine" /> : null}
						</div>
						{!open && loan.status !== "Requested" && loan.status !== "Lost" && !(fine > 0 && !loan.fine_paid) ? <p className="text-sm text-ink-soft">This loan is closed. Nothing more to do.</p> : null}
					</div>
				)
			) : (
				<Alert tone="info" icon={ShieldAlert}>
					Only the Library Officer can issue, renew or check in loans.
				</Alert>
			)}
		</div>
	)
}

function ActionButton({ icon: Icon, label, sub, onClick, ...rest }) {
	return (
		<button type="button" onClick={onClick} className="flex items-start gap-3 rounded-xl border border-line p-3 text-left transition hover:border-brand-300 hover:bg-cream" {...rest}>
			<span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
				<Icon size={17} />
			</span>
			<span className="min-w-0">
				<span className="block text-sm font-semibold text-ink">{label}</span>
				<span className="block text-xs text-ink-soft">{sub}</span>
			</span>
		</button>
	)
}

function ActionForm({ mode, loan, loanDays, onCancel, onDone }) {
	const cfg = ACTIONS[mode]
	const fine = Number(loan.fine_amount) || 0
	const base = loan.due_date && loan.due_date > today() ? loan.due_date : today()
	// The browser's date can trail the server's; never default to a return date before the issue date.
	const returnDefault = loan.issue_date && loan.issue_date > today() ? loan.issue_date : today()
	const [f, setF] = useState(() => ({
		due_date: mode === "renew" ? addDays(base, loanDays) : mode === "issue" ? addDays(today(), loanDays) : "",
		return_date: returnDefault,
		condition_notes: "",
		fine_paid: false,
		reason: "",
		notes: "",
		replacement_fee: "",
		remarks: "",
	}))
	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }))
	const act = useAction(`${API}${cfg.method}`, { invalidate: INVALIDATE, success: cfg.success, onSuccess: () => onDone(mode) })
	const submit = (e) => {
		e.preventDefault()
		const args = { loan: loan.name }
		if (mode === "issue") Object.assign(args, { due_date: f.due_date || undefined, remarks: f.remarks || undefined })
		if (mode === "reject") args.reason = f.reason || undefined
		// The server defaults the return date to its own today; only send a date the librarian changed.
		if (mode === "return") Object.assign(args, { return_date: f.return_date !== returnDefault ? f.return_date || undefined : undefined, condition_notes: f.condition_notes || undefined, fine_paid: f.fine_paid ? 1 : 0 })
		if (mode === "renew") args.due_date = f.due_date
		if (mode === "lost") Object.assign(args, { notes: f.notes || undefined, replacement_fee: f.replacement_fee || undefined })
		act.mutate(args)
	}
	return (
		<form onSubmit={submit} className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4" data-form={mode}>
			<h3 className="font-semibold text-ink">{cfg.label}</h3>
			{mode === "issue" ? (
				<>
					<Input type="date" label="Due back" min={today()} value={f.due_date} onChange={set("due_date")} hint={`Default loan period is ${loanDays} days.`} />
					<Textarea label="Note (optional)" rows={2} value={f.remarks} onChange={set("remarks")} />
				</>
			) : null}
			{mode === "reject" ? <Textarea label="Reason" rows={3} value={f.reason} onChange={set("reason")} hint="The borrower sees this in their notification." /> : null}
			{mode === "return" ? (
				<>
					<Input type="date" label="Returned on" min={loan.issue_date || undefined} max={returnDefault} value={f.return_date} onChange={set("return_date")} />
					<Textarea label="Condition notes" rows={2} placeholder="e.g. Good condition, cover slightly worn" value={f.condition_notes} onChange={set("condition_notes")} />
					{fine > 0 && !loan.fine_paid ? <Checkbox label={`Fine of ${money(fine)} paid now`} description="The fine is recalculated on the return date; tick if the borrower settled it at the desk." checked={f.fine_paid} onChange={set("fine_paid")} /> : null}
				</>
			) : null}
			{mode === "renew" ? <Input type="date" label="New due date" required min={addDays(today(), 1)} value={f.due_date} onChange={set("due_date")} hint={loan.due_date ? `Currently due ${date(loan.due_date)}.` : null} /> : null}
			{mode === "lost" ? (
				<>
					<Input type="number" min="0" step="1" label="Replacement fee" icon={CircleDollarSign} value={f.replacement_fee} onChange={set("replacement_fee")} hint="Added to any late fine already on the loan." />
					<Textarea label="Notes" rows={2} value={f.notes} onChange={set("notes")} />
				</>
			) : null}
			{mode === "fine" ? <p className="text-sm text-ink-muted">Confirm that {loan.borrower_name} has paid {money(fine)}. Fines on open loans are brought up to date first.</p> : null}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="secondary" onClick={onCancel} disabled={act.isPending}>
					Cancel
				</Button>
				<Button type="submit" variant={cfg.danger ? "danger" : "primary"} loading={act.isPending}>
					{cfg.label}
				</Button>
			</div>
		</form>
	)
}
