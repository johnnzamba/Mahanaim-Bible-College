import { useState } from "react"
import { BookPlus } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction } from "@/shared/api/hooks"
import { Alert, Button, Input, Modal, Textarea } from "@/shared/components/ui"
import { API, INVALIDATE } from "./common"
import { SearchPick, addDays, today } from "./kit"

const searchBorrowers = (q) => frappe.call(`${API}borrower_lookup`, { q }).then((rows) => (rows || []).map((r) => ({ ...r, type: r.borrower_type })))

const searchItems = (q) =>
	frappe.call(`${API}list_items`, { search: q, is_active: 1, page_length: 10 }).then((r) =>
		(r?.data || []).map((it) => ({
			value: it.name,
			label: it.title,
			description: `${it.item_type}${it.authors ? ` · ${it.authors}` : ""} · ${it.available_copies ?? 0} of ${it.total_copies ?? 0} available`,
			available: Number(it.available_copies) || 0,
		}))
	)

/** "Issue a loan" at the desk: borrower + item + due date. `item` may be preset (from the catalogue). */
export function IssueLoanModal({ open, onClose, loanDays = 14, item: presetItem, onIssued }) {
	const [f, setF] = useState(() => blank(loanDays, presetItem))
	const [seenOpen, setSeenOpen] = useState(open)
	if (open !== seenOpen) {
		setSeenOpen(open)
		if (open) setF(blank(loanDays, presetItem))
	}
	const issue = useAction(`${API}issue_loan`, {
		invalidate: INVALIDATE,
		success: (d) => `${d.item_title} issued to ${d.borrower_name}`,
		onSuccess: (d) => {
			onClose()
			onIssued?.(d)
		},
	})
	const ready = f.item && f.borrower && f.due_date
	const submit = (e) => {
		e.preventDefault()
		if (!ready) return
		issue.mutate({
			item: f.item,
			student: f.borrower.type === "Student" ? f.borrower.value : undefined,
			staff_member: f.borrower.type === "Staff" ? f.borrower.value : undefined,
			due_date: f.due_date,
			remarks: f.remarks || undefined,
		})
	}
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Issue a loan"
			subtitle="Lend a copy over the desk. Requests from the portal are issued from the Requests tab."
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={issue.isPending}>
						Cancel
					</Button>
					<Button type="submit" form="issue-loan" icon={BookPlus} loading={issue.isPending} disabled={!ready}>
						Issue loan
					</Button>
				</>
			}
		>
			<form id="issue-loan" className="space-y-4" onSubmit={submit}>
				<SearchPick
					id="lib-borrower"
					label="Borrower"
					required
					placeholder="Student name, number or staff name…"
					value={f.borrower?.value}
					display={f.borrower ? `${f.borrower.label} (${f.borrower.borrower_type})` : ""}
					onChange={(v, row) => setF((x) => ({ ...x, borrower: v ? row : null }))}
					search={searchBorrowers}
				/>
				<SearchPick
					id="lib-item"
					label="Item"
					required
					placeholder="Title, author, ISBN or call number…"
					value={f.item}
					display={f.itemLabel}
					onChange={(v, row) => setF((x) => ({ ...x, item: v, itemLabel: row?.label || "", available: row?.available }))}
					search={searchItems}
				/>
				{f.item && f.available === 0 ? (
					<Alert tone="warning" title="No copies available">
						All copies of this item are out. Issuing will fail unless one has just been returned.
					</Alert>
				) : null}
				<Input type="date" label="Due back" required min={today()} value={f.due_date} onChange={(e) => setF((x) => ({ ...x, due_date: e.target.value }))} hint={`Standard loan is ${loanDays} days.`} />
				<Textarea label="Note (optional)" rows={2} value={f.remarks} onChange={(e) => setF((x) => ({ ...x, remarks: e.target.value }))} />
			</form>
		</Modal>
	)
}

function blank(loanDays, item) {
	return {
		borrower: null,
		item: item?.name || null,
		itemLabel: item?.title || "",
		available: item ? Number(item.available_copies) || 0 : undefined,
		due_date: addDays(today(), loanDays),
		remarks: "",
	}
}
