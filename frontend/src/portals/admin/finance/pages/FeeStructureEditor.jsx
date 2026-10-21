import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { CalendarClock, Layers, Plus, Save, Trash2 } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Button, ErrorState, Input, PageHeader, Panel, Select, SkeletonRows, Switch } from "@/shared/components/ui"
import { money } from "@/shared/utils/format"
import { FEE_CATEGORIES, F, REFRESH, SaveBar, useFinanceRole, useOptions } from "../lib"

const blankItem = () => ({ fee_component: "", description: "", amount: "", is_mandatory: 1 })
const blankInst = (label = "") => ({ label, percent: "", amount: "", due_date: "", due_days: "" })

export default function FeeStructureEditor() {
	const { name } = useParams()
	const isNew = !name || name === "new"
	const q = useApi(`${F}get_fee_structure`, { name }, { enabled: !isNew })
	if (!isNew && q.isLoading) {
		return (
			<div className="card p-5">
				<SkeletonRows rows={10} />
			</div>
		)
	}
	if (!isNew && q.isError) {
		return (
			<>
				<PageHeader title={name} back={{ to: "/admin/finance/setup", label: "Fee setup" }} />
				<div className="card">
					<ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't open this fee structure" />
				</div>
			</>
		)
	}
	return <Editor key={name || "new"} doc={isNew ? null : q.data} />
}

function Editor({ doc }) {
	const nav = useNavigate()
	const { canWrite } = useFinanceRole()
	const opts = useOptions()
	const components = useApi(`${F}list_fee_components`, {})
	const compList = components.data?.data || []
	const [form, setForm] = useState(() => ({
		structure_name: doc?.structure_name || "",
		programme: doc?.programme || "",
		campus: doc?.campus || "",
		study_mode: doc?.study_mode || "",
		academic_year: doc?.academic_year || "",
		academic_term: doc?.academic_term || "",
		year_of_study: doc?.year_of_study ? String(doc.year_of_study) : "",
		fee_category: doc?.fee_category || "Standard",
		is_active: doc ? doc.is_active : 1,
		allow_installments: doc ? doc.allow_installments : 0,
	}))
	const [items, setItems] = useState(() => (doc?.items?.length ? doc.items.map((i) => ({ fee_component: i.fee_component, description: i.description || "", amount: String(i.amount), is_mandatory: i.is_mandatory })) : [blankItem()]))
	const [installments, setInstallments] = useState(() => (doc?.installments?.length ? doc.installments.map((i) => ({ label: i.label, percent: i.percent ? String(Math.round(i.percent * 100) / 100) : "", amount: String(i.amount || ""), due_date: i.due_date || "", due_days: i.due_days ? String(i.due_days) : "" })) : [blankInst("First instalment"), blankInst("Second instalment")]))
	const [errors, setErrors] = useState({})
	const [dirty, setDirty] = useState(false)
	const save = useAction(`${F}save_fee_structure`, { invalidate: REFRESH, success: (d) => `${d.structure_name} saved` })

	useEffect(() => {
		if (!doc && opts.currentTerm && !form.academic_term) setForm((f) => ({ ...f, academic_term: opts.currentTerm }))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [opts.currentTerm])

	const total = useMemo(() => items.reduce((a, i) => a + Number(i.amount || 0), 0), [items])
	const instTotal = installments.reduce((a, i) => a + Number(i.amount || 0), 0)
	const touch = () => setDirty(true)
	const setF = (k) => (e) => {
		touch()
		setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	}
	const setItem = (idx, k, v) => {
		touch()
		setItems((rows) => rows.map((r, i) => {
			if (i !== idx) return r
			const next = { ...r, [k]: v }
			if (k === "fee_component") {
				const c = compList.find((x) => x.name === v)
				if (c && !r.amount && c.default_amount) next.amount = String(c.default_amount)
				if (c && !r.description) next.description = c.component_name
			}
			return next
		}))
	}
	const setInst = (idx, k, v) => {
		touch()
		setInstallments((rows) => rows.map((r, i) => {
			if (i !== idx) return r
			const next = { ...r, [k]: v }
			if (k === "percent" && total) next.amount = v === "" ? "" : String(Math.round((total * Number(v)) / 100 * 100) / 100)
			if (k === "amount" && total) next.percent = v === "" ? "" : String(Math.round((Number(v) * 10000) / total) / 100)
			return next
		}))
	}
	const splitEvenly = () => {
		touch()
		const n = installments.length
		if (!n || !total) return
		const each = Math.floor((total / n) * 100) / 100
		setInstallments((rows) => rows.map((r, i) => {
			const amount = i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each
			return { ...r, amount: String(amount), percent: String(Math.round((amount * 10000) / total) / 100) }
		}))
	}

	const go = () => {
		const e = {}
		if (!form.programme) e.programme = "Choose the programme"
		const used = items.filter((i) => i.fee_component)
		if (!used.length) e.items = "Add at least one fee component"
		else if (used.some((i) => !(Number(i.amount) > 0))) e.items = "Every component needs an amount above zero"
		else if (new Set(used.map((i) => i.fee_component)).size !== used.length) e.items = "Each component can only appear once"
		if (form.allow_installments) {
			if (!installments.length) e.installments = "Add the instalment plan or turn instalments off"
			else if (installments.some((i) => !i.label.trim())) e.installments = "Label every instalment"
			else if (Math.abs(instTotal - total) > 0.01) e.installments = `Instalments add up to ${money(instTotal)} but the structure total is ${money(total)}`
		}
		setErrors(e)
		if (Object.keys(e).length) return
		save.mutate(
			{
				data: {
					name: doc?.name,
					...form,
					year_of_study: form.year_of_study ? Number(form.year_of_study) : 0,
					campus: form.campus || null,
					study_mode: form.study_mode || null,
					academic_year: form.academic_year || null,
					academic_term: form.academic_term || null,
					items: used.map((i) => ({ ...i, amount: Number(i.amount) })),
					installments: form.allow_installments ? installments.map((i) => ({ label: i.label.trim(), amount: Number(i.amount || 0), percent: Number(i.percent || 0), due_date: i.due_date || null, due_days: Number(i.due_days || 0) })) : [],
				},
			},
			{
				onSuccess: (d) => {
					setDirty(false)
					if (!doc) nav(`/admin/finance/setup/structures/${encodeURIComponent(d.name)}`, { replace: true })
				},
			}
		)
	}

	const ro = !canWrite
	return (
		<div className="pb-20">
			<PageHeader
				eyebrow="Fee structure"
				title={doc ? doc.structure_name : "New fee structure"}
				subtitle={doc ? `${doc.name} · ${money(doc.total_amount)}` : "Choose who it applies to, list the fee components, then set an optional instalment plan."}
				back={{ to: "/admin/finance/setup", label: "Fee setup" }}
				actions={canWrite ? <Button icon={Save} onClick={go} loading={save.isPending}>{doc ? "Save changes" : "Create structure"}</Button> : null}
			/>
			{ro ? <Alert tone="info" className="mb-4">You have read-only access to fee structures.</Alert> : null}
			<div className="grid gap-5 lg:grid-cols-3">
				<Panel title="Applies to" icon={Layers} className="lg:col-span-1">
					<fieldset disabled={ro} className="space-y-3">
						<Input label="Name" value={form.structure_name} onChange={setF("structure_name")} placeholder="Generated from programme, term and campus" />
						<Select label="Programme" required value={form.programme} onChange={setF("programme")} placeholder="Choose…" options={opts.programmes} error={errors.programme} />
						<Select label="Campus" value={form.campus} onChange={setF("campus")} placeholder="All campuses" options={opts.campuses} />
						<Select label="Study mode" value={form.study_mode} onChange={setF("study_mode")} placeholder="All study modes" options={opts.studyModes} />
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
							<Select label="Academic year" value={form.academic_year} onChange={setF("academic_year")} placeholder="Any" options={opts.years} />
							<Select label="Term" value={form.academic_term} onChange={setF("academic_term")} placeholder="Any" options={opts.terms} />
						</div>
						<div className="grid grid-cols-2 gap-3">
							<Input label="Year of study" type="number" min="0" max="8" value={form.year_of_study} onChange={setF("year_of_study")} placeholder="Any" />
							<Select label="Category" value={form.fee_category} onChange={setF("fee_category")} options={FEE_CATEGORIES} />
						</div>
						<Switch label="Active" description="Inactive structures aren't used for new invoices" checked={Boolean(form.is_active)} onChange={(v) => { touch(); setForm((f) => ({ ...f, is_active: v ? 1 : 0 })) }} disabled={ro} />
					</fieldset>
				</Panel>
				<div className="space-y-5 lg:col-span-2">
					<Panel title="Fee components" subtitle={`Total ${money(total)}`} bodyClass="p-0">
						<fieldset disabled={ro}>
							<div className="divide-y divide-line">
								{items.map((it, idx) => (
									<div key={idx} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
										<Select label={idx === 0 ? "Component" : undefined} value={it.fee_component} onChange={(e) => setItem(idx, "fee_component", e.target.value)} placeholder="Choose…" options={compList.map((c) => ({ value: c.name, label: c.component_name }))} aria-label="Fee component" />
										<Input label={idx === 0 ? "Description" : undefined} className="hidden sm:block" value={it.description} onChange={(e) => setItem(idx, "description", e.target.value)} placeholder="Shown on the invoice" aria-label="Description" />
										<Input label={idx === 0 ? "Amount" : undefined} type="number" min="0" inputClassName="text-right" value={it.amount} onChange={(e) => setItem(idx, "amount", e.target.value)} aria-label="Amount" />
										<button type="button" className="mb-1 rounded-lg p-2 text-ink-soft hover:bg-red-50 hover:text-red-600 disabled:opacity-40" onClick={() => { touch(); setItems((rows) => rows.filter((_, i) => i !== idx)) }} disabled={items.length === 1} aria-label="Remove component">
											<Trash2 size={16} />
										</button>
									</div>
								))}
							</div>
							<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
								{canWrite ? <Button size="sm" variant="ghost" icon={Plus} onClick={() => { touch(); setItems((rows) => [...rows, blankItem()]) }}>Add component</Button> : <span />}
								<span className="text-sm">Total <b className="text-ink">{money(total)}</b></span>
							</div>
						</fieldset>
						{errors.items ? <div className="px-4 pb-3"><Alert tone="error">{errors.items}</Alert></div> : null}
					</Panel>
					<Panel
						title="Instalment plan"
						icon={CalendarClock}
						subtitle={form.allow_installments ? `${installments.length} instalments · ${money(instTotal)} of ${money(total)}` : "Students pay the full amount by the invoice due date"}
						actions={<Switch checked={Boolean(form.allow_installments)} onChange={(v) => { touch(); setForm((f) => ({ ...f, allow_installments: v ? 1 : 0 })) }} disabled={ro} label="Allow instalments" />}
						bodyClass={form.allow_installments ? "p-0" : undefined}
					>
						{form.allow_installments ? (
							<fieldset disabled={ro}>
								<div className="divide-y divide-line">
									{installments.map((r, idx) => (
										<div key={idx} className="grid grid-cols-2 items-end gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_5.5rem_7.5rem_9rem_5.5rem_auto]">
											<Input label={idx === 0 ? "Label" : undefined} className="col-span-2 sm:col-span-1" value={r.label} onChange={(e) => setInst(idx, "label", e.target.value)} placeholder={`Instalment ${idx + 1}`} aria-label="Instalment label" />
											<Input label={idx === 0 ? "%" : undefined} type="number" min="0" max="100" value={r.percent} onChange={(e) => setInst(idx, "percent", e.target.value)} aria-label="Percent" />
											<Input label={idx === 0 ? "Amount" : undefined} type="number" min="0" inputClassName="text-right" value={r.amount} onChange={(e) => setInst(idx, "amount", e.target.value)} aria-label="Instalment amount" />
											<Input label={idx === 0 ? "Due date" : undefined} type="date" value={r.due_date} onChange={(e) => setInst(idx, "due_date", e.target.value)} aria-label="Due date" />
											<Input label={idx === 0 ? "or days" : undefined} type="number" min="0" value={r.due_days} onChange={(e) => setInst(idx, "due_days", e.target.value)} aria-label="Due days after invoice" title="Days after the invoice date" />
											<button type="button" className="mb-1 justify-self-end rounded-lg p-2 text-ink-soft hover:bg-red-50 hover:text-red-600 disabled:opacity-40" onClick={() => { touch(); setInstallments((rows) => rows.filter((_, i) => i !== idx)) }} disabled={installments.length === 1} aria-label="Remove instalment">
												<Trash2 size={16} />
											</button>
										</div>
									))}
								</div>
								<div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
									{canWrite ? (
										<span className="flex gap-1">
											<Button size="sm" variant="ghost" icon={Plus} onClick={() => { touch(); setInstallments((rows) => [...rows, blankInst()]) }}>Add instalment</Button>
											<Button size="sm" variant="ghost" onClick={splitEvenly} disabled={!total}>Split evenly</Button>
										</span>
									) : <span />}
									<span className={`text-sm ${Math.abs(instTotal - total) > 0.01 ? "text-red-600" : "text-emerald-700"}`}>
										{Math.abs(instTotal - total) > 0.01 ? `${money(total - instTotal)} unassigned` : "Balanced"}
									</span>
								</div>
								{errors.installments ? <div className="px-4 pb-3"><Alert tone="error">{errors.installments}</Alert></div> : null}
								<p className="px-4 pb-3 text-xs text-ink-soft">Use a fixed due date, or a number of days after each invoice's posting date.</p>
							</fieldset>
						) : (
							<p className="text-sm text-ink-muted">Turn instalments on to split the total into dated parts, for example 50% at registration and 50% by mid-term. Invoices then carry a payment schedule.</p>
						)}
					</Panel>
				</div>
			</div>
			<SaveBar show={canWrite && dirty} message={`Unsaved changes · total ${money(total)}`} onSave={go} saving={save.isPending} label={doc ? "Save changes" : "Create structure"} />
		</div>
	)
}
