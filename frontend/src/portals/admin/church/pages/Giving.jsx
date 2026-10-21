import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Ban, CheckCircle2, HandCoins, Pencil, Plus, Smartphone } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { Badge, Button, Card, Checkbox, ConfirmDialog, Input, Modal, PageHeader, Panel, Select, Switch, Tabs, Textarea } from "@/shared/components/ui"
import { BarRow, DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { MpesaPay } from "@/shared/components/MpesaPay"
import { date, money, num } from "@/shared/utils/format"
import { API, ChurchTabs, GIVER_TYPES, INVALIDATE, PAYMENT_MODES, RoleGate, searchChurches, searchSponsors, searchStudents, useChurchRoles } from "../components/common"
import { nullify, SearchPick, today, usePaged } from "../components/kit"

const GIVER_CHIPS = [{ id: "", label: "All givers" }, ...GIVER_TYPES.map((g) => ({ id: g, label: g }))]
const STATE = { 0: ["Draft", "gray"], 1: ["Recorded", "green"], 2: ["Cancelled", "red"] }

export default function Giving() {
	return (
		<RoleGate title="Giving">
			<GivingPage />
		</RoleGate>
	)
}

function GivingPage() {
	const { canManage } = useChurchRoles()
	const [params, setParams] = useSearchParams()
	const [tab, setTab] = useState("records")
	const [stk, setStk] = useState(false)
	const recording = params.get("record") === "1"
	const prefill = recording ? { sponsor: params.get("sponsor") || "", chapel_service: params.get("chapel_service") || "" } : null
	const closeRecord = () => {
		const next = new URLSearchParams(params)
		for (const k of ["record", "sponsor", "chapel_service"]) next.delete(k)
		setParams(next, { replace: true })
	}
	const openRecord = () => {
		const next = new URLSearchParams(params)
		next.set("record", "1")
		setParams(next, { replace: true })
	}
	return (
		<>
			<ChurchTabs />
			<PageHeader
				title="Giving"
				subtitle="Offerings, tithes, pledges and donations to the college, each with a receipt to the giver."
				actions={
					canManage ? (
						<>
							<Button variant="secondary" icon={Smartphone} onClick={() => setStk(true)}>
								M-Pesa prompt
							</Button>
							<Button icon={Plus} onClick={openRecord}>
								Record a gift
							</Button>
						</>
					) : null
				}
			/>
			<Tabs
				className="mb-4"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "records", label: "Gifts" },
					{ id: "types", label: "Giving types" },
				]}
			/>
			{tab === "records" ? <Records canManage={canManage} /> : <GivingTypes canManage={canManage} />}
			<GiftForm open={recording && canManage} prefill={prefill} onClose={closeRecord} />
			{canManage ? <StkGift open={stk} onClose={() => setStk(false)} /> : null}
		</>
	)
}

function Records({ canManage }) {
	const { canChapel } = useChurchRoles()
	const [search, setSearch] = useState("")
	const [giverType, setGiverType] = useState("")
	const [givingType, setGivingType] = useState("")
	const [mode, setMode] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [withCancelled, setWithCancelled] = useState(false)
	const [cancelling, setCancelling] = useState(null)
	const ds = useDebounced(search)
	const types = useApi(`${API}list_giving_types`, { include_inactive: 1 })
	const { query, rows, total, pager } = usePaged(`${API}list_giving`, {
		search: ds,
		giver_type: giverType,
		giving_type: givingType,
		from_date: from,
		to_date: to,
		include_cancelled: withCancelled ? 1 : 0,
	})
	const shown = mode ? rows.filter((r) => r.mode_of_payment === mode) : rows
	const totals = query.data?.totals
	const maxType = Math.max(1, ...(totals?.by_type || []).map((t) => t.total))
	const cols = [
		{ key: "posting_date", label: "Date", render: (r) => date(r.posting_date), sortValue: (r) => r.posting_date },
		{
			key: "giver_name",
			label: "Giver",
			render: (r) => (
				<span className="block min-w-0">
					<span className="block truncate font-semibold text-ink">
						{r.sponsor ? (
							<Link to={`/admin/church/sponsors/${encodeURIComponent(r.sponsor)}`} className="hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
								{r.giver_name || r.sponsor}
							</Link>
						) : (
							r.giver_name || "Anonymous"
						)}
					</span>
					<span className="block truncate text-xs text-ink-soft">{[r.giver_type, r.name].join(" · ")}</span>
				</span>
			),
			exportValue: (r) => r.giver_name,
		},
		{ key: "giving_type", label: "Type" },
		{
			key: "mode_of_payment",
			label: "Paid by",
			hideOnMobile: true,
			render: (r) => (
				<span className="block">
					<span className="block">{r.mode_of_payment}</span>
					{r.reference_no ? <span className="block font-mono text-xs text-ink-soft">{r.reference_no}</span> : null}
				</span>
			),
		},
		{
			key: "chapel_service",
			label: "Service",
			hideOnMobile: true,
			render: (r) =>
				r.chapel_service && !canChapel ? (
					r.chapel_service
				) : r.chapel_service ? (
					<Link to={`/admin/church/chapel/${encodeURIComponent(r.chapel_service)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
						{r.chapel_service}
					</Link>
				) : (
					"—"
				),
		},
		{ key: "amount", label: "Amount", align: "right", render: (r) => <span className={r.docstatus === 2 ? "text-ink-soft line-through" : "font-semibold"}>{money(r.amount)}</span>, sortValue: (r) => r.amount },
		{
			key: "docstatus",
			label: "Status",
			render: (r) => (
				<span className="flex items-center gap-1.5">
					<Badge tone={STATE[r.docstatus]?.[1]} size="xs">
						{STATE[r.docstatus]?.[0]}
					</Badge>
					{r.receipt_sent ? <CheckCircle2 size={14} className="text-emerald-600" aria-label="Receipt sent" /> : null}
				</span>
			),
			exportValue: (r) => STATE[r.docstatus]?.[0],
		},
		...(canManage
			? [
					{
						key: "actions",
						label: "",
						export: false,
						align: "right",
						render: (r) =>
							r.docstatus === 1 ? (
								<button type="button" className="btn btn-ghost btn-sm text-red-600" aria-label={`Cancel ${r.name}`} onClick={() => setCancelling(r)}>
									<Ban size={14} /> <span className="hidden xl:inline">Cancel</span>
								</button>
							) : null,
					},
				]
			: []),
	]
	return (
		<>
			<div className="mb-4 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
				<Card className="flex flex-col justify-center p-5">
					<div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Total received</div>
					<div className="mt-1 font-serif text-3xl text-ink">{money(totals?.amount)}</div>
					<div className="mt-1 text-sm text-ink-muted">
						{num(totals?.count)} gifts{from || to ? ` · ${from ? date(from) : "start"} – ${to ? date(to) : "today"}` : " · all time"}
					</div>
				</Card>
				<Panel title="By giving type" subtitle="Recorded gifts matching the filters">
					{totals?.by_type?.length ? (
						<div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
							{totals.by_type.map((t) => (
								<BarRow key={t.giving_type} label={`${t.giving_type} (${num(t.count)})`} value={t.total} max={maxType} caption={money(t.total, { compact: true })} tone="bg-gold-500" />
							))}
						</div>
					) : (
						<p className="text-sm text-ink-soft">No recorded gifts match these filters.</p>
					)}
				</Panel>
			</div>
			<Toolbar search={search} onSearch={setSearch} placeholder="Search giver, reference, purpose…" chips={GIVER_CHIPS} active={giverType} onChip={setGiverType} />
			<div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 xl:items-end">
				<Select
					label="Giving type"
					placeholder="All types"
					options={(types.data || []).map((t) => t.name)}
					value={givingType}
					onChange={(e) => setGivingType(e.target.value)}
				/>
				<Select label="Paid by (this page)" placeholder="Any mode" options={PAYMENT_MODES} value={mode} onChange={(e) => setMode(e.target.value)} />
				<Input label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
				<Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
				<Checkbox className="pb-2" checked={withCancelled} onChange={setWithCancelled} label="Show cancelled" />
				<div className="flex justify-end pb-0.5">
					<ExportButton filename="giving.csv" cols={cols} rows={shown} />
				</div>
			</div>
			<DataTable
				cols={cols}
				query={query}
				rows={query.data ? shown : undefined}
				empty="No gifts match these filters"
				emptyIcon={HandCoins}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">{num(total)} records</span>
						{pager}
					</div>
				}
			/>
			<CancelGift row={cancelling} onClose={() => setCancelling(null)} />
		</>
	)
}

function CancelGift({ row, onClose }) {
	const [reason, setReason] = useState("")
	const [error, setError] = useState("")
	const [seen, setSeen] = useState(null)
	if (row !== seen) {
		setSeen(row)
		setReason("")
		setError("")
	}
	const act = useAction(`${API}cancel_giving`, { invalidate: INVALIDATE, success: "Gift cancelled and the journal reversed", onSuccess: onClose })
	return (
		<ConfirmDialog
			open={Boolean(row)}
			onClose={onClose}
			tone="danger"
			title="Cancel this gift?"
			message={row ? `${money(row.amount)} ${row.giving_type} from ${row.giver_name || "an anonymous giver"} on ${date(row.posting_date)}. The accounting entry is reversed; this can't be undone.` : null}
			confirmLabel="Cancel gift"
			loading={act.isPending}
			onConfirm={() => {
				if (!reason.trim()) return setError("Say why the gift is being cancelled")
				act.mutate({ name: row.name, reason: reason.trim() })
			}}
		>
			<Textarea className="mt-4" label="Reason" required rows={3} value={reason} error={error} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate entry, bounced cheque…" />
		</ConfirmDialog>
	)
}

const BLANK_GIFT = {
	giving_type: "",
	giver_type: "Other",
	sponsor: "",
	partner_church: "",
	student: "",
	giver_name: "",
	posting_date: "",
	amount: "",
	mode_of_payment: "Cash",
	reference_no: "",
	msisdn: "",
	chapel_service: "",
	purpose: "",
}

const LINK_FOR = { Sponsor: "sponsor", "Partner Church": "partner_church", Student: "student" }
const SEARCH_FOR = { sponsor: searchSponsors, partner_church: searchChurches, student: searchStudents }

/** Record a manual gift (submitted straight away, which posts it and sends the receipt). */
function GiftForm({ open, prefill, onClose }) {
	const qc = useQueryClient()
	const [form, setForm] = useState(BLANK_GIFT)
	const [label, setLabel] = useState("")
	const [errors, setErrors] = useState({})
	const [wasOpen, setWasOpen] = useState(false)
	const types = useApi(`${API}list_giving_types`, {}, { enabled: open })
	const services = useApi(`${API}list_chapel_services`, { page_length: 30, to_date: today() }, { enabled: open, retry: false })
	if (open !== wasOpen) {
		setWasOpen(open)
		if (open) {
			setForm({
				...BLANK_GIFT,
				posting_date: today(),
				...(prefill?.sponsor ? { giver_type: "Sponsor", sponsor: prefill.sponsor } : {}),
				...(prefill?.chapel_service ? { chapel_service: prefill.chapel_service, giving_type: "" } : {}),
			})
			setLabel(prefill?.sponsor || "")
			setErrors({})
		}
	}
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const link = LINK_FOR[form.giver_type]
	const needsRef = ["M-Pesa", "Bank", "Cheque"].includes(form.mode_of_payment)
	const save = useAction(`${API}record_giving`, {
		invalidate: INVALIDATE,
		success: (doc) => `Gift ${doc.name} recorded${doc.receipt_sent ? " and receipt sent" : ""}`,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["pick"] })
			onClose()
		},
	})
	const submit = () => {
		const errs = {}
		if (!form.giving_type) errs.giving_type = "Choose what the gift is for"
		if (!(Number(form.amount) > 0)) errs.amount = "Enter an amount greater than zero"
		if (!form.posting_date) errs.posting_date = "Enter the date"
		else if (form.posting_date > today()) errs.posting_date = "The date can't be in the future"
		if (link && !form[link]) errs[link] = `Choose the ${form.giver_type.toLowerCase()}`
		if (["Staff", "Other"].includes(form.giver_type) && !form.giver_name.trim()) errs.giver_name = "Enter the giver's name"
		if (needsRef && !form.reference_no.trim()) errs.reference_no = `Enter the ${form.mode_of_payment} reference`
		setErrors(errs)
		if (Object.keys(errs).length) return
		const data = { ...form, amount: Number(form.amount) }
		for (const k of Object.values(LINK_FOR)) if (k !== link) delete data[k]
		if (form.mode_of_payment !== "M-Pesa") delete data.msisdn
		save.mutate({ data: nullify(data), submit: 1 })
	}
	const serviceOpts = (services.data?.data || []).map((s) => ({ value: s.name, label: `${date(s.service_date)} · ${s.service_type}${s.theme ? ` — ${s.theme}` : ""}` }))
	if (form.chapel_service && !serviceOpts.some((o) => o.value === form.chapel_service)) serviceOpts.unshift({ value: form.chapel_service, label: form.chapel_service })
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Record a gift"
			subtitle="For cash, cheque, bank or M-Pesa gifts received outside the online giving page."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={submit}>
						Record gift
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Select label="Giving type" required placeholder="Choose…" options={(types.data || []).map((t) => t.name)} value={form.giving_type} onChange={set("giving_type")} error={errors.giving_type} />
				<Input label="Amount (KES)" required type="number" min="1" value={form.amount} onChange={set("amount")} error={errors.amount} />
				<Select
					label="Who gave"
					options={GIVER_TYPES}
					value={form.giver_type}
					onChange={(e) => {
						setForm((f) => ({ ...f, giver_type: e.target.value, sponsor: "", partner_church: "", student: "" }))
						setLabel("")
					}}
				/>
				{link ? (
					<SearchPick
						id={`gift-${link}`}
						label={form.giver_type}
						required
						value={form[link]}
						display={label}
						search={SEARCH_FOR[link]}
						error={errors[link]}
						onChange={(v, r) => {
							setForm((f) => ({ ...f, [link]: v || "" }))
							setLabel(r?.label || "")
						}}
					/>
				) : (
					<Input
						label="Giver's name"
						required={form.giver_type !== "Anonymous"}
						disabled={form.giver_type === "Anonymous"}
						value={form.giver_type === "Anonymous" ? "" : form.giver_name}
						placeholder={form.giver_type === "Anonymous" ? "Recorded as anonymous" : ""}
						onChange={set("giver_name")}
						error={errors.giver_name}
					/>
				)}
				<Select label="Paid by" options={PAYMENT_MODES} value={form.mode_of_payment} onChange={set("mode_of_payment")} />
				<Input
					label={needsRef ? `${form.mode_of_payment} reference` : "Reference (optional)"}
					required={needsRef}
					value={form.reference_no}
					onChange={set("reference_no")}
					error={errors.reference_no}
					placeholder={form.mode_of_payment === "M-Pesa" ? "e.g. SGH7K2L9QX" : ""}
				/>
				{form.mode_of_payment === "M-Pesa" ? <Input label="M-Pesa phone (optional)" type="tel" value={form.msisdn} onChange={set("msisdn")} placeholder="07XX XXX XXX" /> : null}
				<Input label="Date received" required type="date" max={today()} value={form.posting_date} onChange={set("posting_date")} error={errors.posting_date} />
				{services.isError && !form.chapel_service ? null : (
					<Select label="Chapel service (offerings)" placeholder="Not linked to a service" options={serviceOpts} value={form.chapel_service} onChange={set("chapel_service")} />
				)}
				<Textarea label="Purpose or note" rows={2} value={form.purpose} onChange={set("purpose")} className="sm:col-span-2" placeholder="e.g. Building fund pledge, harvest Sunday…" />
			</div>
		</Modal>
	)
}

/** Staff-initiated STK push, e.g. at the chapel door: the gift is recorded when the giver confirms on their phone. */
function StkGift({ open, onClose }) {
	const [type, setType] = useState("")
	const [name, setName] = useState("")
	const types = useApi(`${API}list_giving_types`, {}, { enabled: open })
	const online = (types.data || []).filter((t) => t.allow_online)
	const chosen = type || online[0]?.name || ""
	return (
		<MpesaPay
			open={open}
			onClose={onClose}
			title="M-Pesa giving prompt"
			subtitle="Sends a PIN prompt to the giver's phone; the gift and receipt are recorded once they confirm."
			start={({ phone, amount }) => {
				if (!chosen) throw new Error("No giving type is open for online giving. Turn on “Online” for one under Giving types.")
				return frappe.call(`${API}give`, { giving_type: chosen, amount, phone, full_name: name || undefined, anonymous: name ? 0 : 1 })
			}}
			statusMethod={`${API}giving_status`}
			statusArgs={(resp) => ({ request: resp.request, checkout_request_id: resp.checkout_request_id })}
			onDone={() => {}}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Select
					label="Giving type"
					options={online.map((t) => t.name)}
					value={chosen}
					onChange={(e) => setType(e.target.value)}
					hint={online.length ? null : "No giving type allows online giving yet."}
				/>
				<Input label="Giver's name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank for anonymous" />
			</div>
		</MpesaPay>
	)
}

const BLANK_TYPE = { giving_type_name: "", is_active: 1, allow_online: 0, suggested_amounts: "", income_account: "", description: "" }

function GivingTypes({ canManage }) {
	const q = useApi(`${API}list_giving_types`, { include_inactive: 1 })
	const [editing, setEditing] = useState(null)
	const toggle = useAction(`${API}save_giving_type`, { invalidate: INVALIDATE, success: "Giving type updated" })
	const flip = (r, field) => toggle.mutate({ data: { name: r.name, [field]: r[field] ? 0 : 1 } })
	const cols = [
		{
			key: "giving_type_name",
			label: "Giving type",
			render: (r) => (
				<span className="block min-w-0">
					<span className="block truncate font-semibold text-ink">{r.giving_type_name}</span>
					{r.description ? <span className="block truncate text-xs text-ink-soft">{r.description}</span> : null}
				</span>
			),
		},
		{ key: "suggested_amounts", label: "Quick amounts", hideOnMobile: true, render: (r) => r.suggested_amounts || "—" },
		{ key: "income_account", label: "Income account", hideOnMobile: true, render: (r) => r.income_account || "Default" },
		{
			key: "allow_online",
			label: "Online",
			render: (r) => (canManage ? <Switch checked={Boolean(r.allow_online)} disabled={toggle.isPending} onChange={() => flip(r, "allow_online")} label={<span className="sr-only">Online giving for {r.name}</span>} /> : r.allow_online ? "Yes" : "No"),
		},
		{
			key: "is_active",
			label: "Active",
			render: (r) => (canManage ? <Switch checked={Boolean(r.is_active)} disabled={toggle.isPending} onChange={() => flip(r, "is_active")} label={<span className="sr-only">{r.name} active</span>} /> : r.is_active ? "Yes" : "No"),
		},
		...(canManage
			? [
					{
						key: "edit",
						label: "",
						align: "right",
						render: (r) => (
							<button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
								<Pencil size={14} />
							</button>
						),
					},
				]
			: []),
	]
	return (
		<>
			<div className="mb-3 flex items-center justify-between gap-3">
				<p className="text-sm text-ink-muted">Types switched to “Online” appear on the public giving page with their quick amounts.</p>
				{canManage ? (
					<Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing(BLANK_TYPE)}>
						New type
					</Button>
				) : null}
			</div>
			<DataTable cols={cols} query={q} empty="No giving types yet" emptyIcon={HandCoins} />
			<GivingTypeForm initial={editing} onClose={() => setEditing(null)} />
		</>
	)
}

function GivingTypeForm({ initial, onClose }) {
	const [form, setForm] = useState(BLANK_TYPE)
	const [error, setError] = useState("")
	const [seen, setSeen] = useState(null)
	if (initial !== seen) {
		setSeen(initial)
		setForm({ ...BLANK_TYPE, ...(initial || {}) })
		setError("")
	}
	const isNew = !initial?.name
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = useAction(`${API}save_giving_type`, { invalidate: INVALIDATE, success: "Giving type saved", onSuccess: onClose })
	const submit = () => {
		if (!form.giving_type_name.trim()) return setError("Enter a name")
		const amounts = form.suggested_amounts
			.split(/[,\s]+/)
			.map((a) => a.trim())
			.filter(Boolean)
		if (amounts.some((a) => !(Number(a) > 0))) return setError("")
		save.mutate({
			data: nullify({
				...(isNew ? {} : { name: initial.name }),
				giving_type_name: form.giving_type_name.trim(),
				is_active: form.is_active ? 1 : 0,
				allow_online: form.allow_online ? 1 : 0,
				suggested_amounts: amounts.join(", "),
				income_account: form.income_account,
				description: form.description,
			}),
		})
	}
	const badAmounts = form.suggested_amounts
		.split(/[,\s]+/)
		.filter(Boolean)
		.some((a) => !(Number(a) > 0))
	return (
		<Modal
			open={Boolean(initial)}
			onClose={onClose}
			title={isNew ? "New giving type" : `Edit ${initial.name}`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} disabled={badAmounts} onClick={submit}>
						Save
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Input label="Name" required disabled={!isNew} value={form.giving_type_name} onChange={set("giving_type_name")} error={error} hint={isNew ? null : "The name can't be changed once gifts use it."} />
				<Input
					label="Quick amounts"
					value={form.suggested_amounts}
					onChange={set("suggested_amounts")}
					placeholder="500, 1000, 2500, 5000"
					error={badAmounts ? "Use numbers separated by commas" : null}
					hint="Buttons offered on the online giving page."
				/>
				<Input label="Income account" value={form.income_account} onChange={set("income_account")} hint="Optional accounting income account; leave blank for the default." />
				<Textarea label="Description" rows={2} value={form.description} onChange={set("description")} />
				<Switch checked={Boolean(form.is_active)} onChange={(v) => setForm((f) => ({ ...f, is_active: v ? 1 : 0 }))} label="Active" description="Inactive types can't receive new gifts." />
				<Switch checked={Boolean(form.allow_online)} onChange={(v) => setForm((f) => ({ ...f, allow_online: v ? 1 : 0 }))} label="Online giving" description="Show on the public /give page (M-Pesa)." />
			</div>
		</Modal>
	)
}
