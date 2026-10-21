import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Award, Layers, Plus, Puzzle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Checkbox, Input, Modal, PageHeader, ProgressBar, Select, Tabs, Textarea } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { COMPONENT_TYPES, F, FilterSelect, Pager, SCHOLARSHIP_TYPES, useFinanceRole, useOptions, usePaged } from "../lib"

export default function FeeSetup() {
	const [params, setParams] = useSearchParams()
	const tab = params.get("tab") || "structures"
	const { canWrite } = useFinanceRole()
	const nav = useNavigate()
	return (
		<div>
			<PageHeader
				eyebrow="Finance"
				title="Fee setup"
				subtitle="Fee structures decide what each cohort is billed. Components are the line items; scholarships fund awards and bursaries."
				back={{ to: "/admin/finance", label: "Finance overview" }}
				actions={canWrite && tab === "structures" ? <Button size="sm" icon={Plus} onClick={() => nav("/admin/finance/setup/structures/new")}>New fee structure</Button> : null}
			/>
			<Tabs
				className="mb-4 overflow-y-hidden"
				active={tab}
				onChange={(id) => setParams(id === "structures" ? {} : { tab: id }, { replace: true })}
				tabs={[
					{ id: "structures", label: "Fee structures" },
					{ id: "components", label: "Fee components" },
					{ id: "scholarships", label: "Scholarships" },
				]}
			/>
			{tab === "components" ? <Components /> : tab === "scholarships" ? <Scholarships /> : <Structures />}
		</div>
	)
}

function Structures() {
	const opts = useOptions()
	const [search, setSearch] = useState("")
	const [programme, setProgramme] = useState("")
	const [term, setTerm] = useState("")
	const [active, setActive] = useState("1")
	const q = useDebounced(search, 300)
	const list = usePaged(`${F}list_fee_structures`, { search: q, programme, academic_term: term, is_active: active }, 20)
	return (
		<>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search structures…"
				chips={[
					{ id: "1", label: "Active" },
					{ id: "0", label: "Inactive" },
					{ id: "", label: "All" },
				]}
				active={active}
				onChip={setActive}
			>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:ml-auto lg:flex lg:shrink-0">
					<FilterSelect value={programme} onChange={setProgramme} options={opts.programmes} placeholder="All programmes" className="lg:w-48" />
					<FilterSelect value={term} onChange={setTerm} options={opts.terms} placeholder="Any term" className="lg:w-40" />
				</div>
			</Toolbar>
			<DataTable
				query={list.query}
				rowTo={(r) => `/admin/finance/setup/structures/${encodeURIComponent(r.name)}`}
				empty="No fee structures yet. Create one per programme and term so invoices can be generated."
				emptyIcon={Layers}
				cols={[
					{ key: "structure_name", label: "Structure", render: (r) => (
						<span>
							<span className="block font-semibold text-ink">{r.structure_name}</span>
							<span className="block text-xs text-ink-soft">{r.name} · updated {date(r.modified)}</span>
						</span>
					) },
					{ key: "programme", label: "Applies to", render: (r) => (
						<span className="text-xs">
							<span className="block font-medium text-ink">{r.programme}</span>
							<span className="block text-ink-soft">{[r.campus || "All campuses", r.study_mode, r.year_of_study ? `Year ${r.year_of_study}` : null].filter(Boolean).join(" · ")}</span>
						</span>
					) },
					{ key: "academic_term", label: "Term / year", hideOnMobile: true, render: (r) => <span className="text-sm">{r.academic_term || r.academic_year || "Any"}</span> },
					{ key: "fee_category", label: "Category", hideOnMobile: true },
					{ key: "allow_installments", label: "Plan", hideOnMobile: true, render: (r) => (r.allow_installments ? <Badge tone="blue">Instalments</Badge> : <span className="whitespace-nowrap text-xs text-ink-soft">Lump sum</span>) },
					{ key: "is_active", label: "Status", render: (r) => <Badge tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
					{ key: "total_amount", label: "Total", align: "right", render: (r) => <b className="whitespace-nowrap">{money(r.total_amount)}</b> },
				]}
			/>
			<Pager list={list} />
		</>
	)
}

function Components() {
	const { canWrite } = useFinanceRole()
	const [showInactive, setShowInactive] = useState(false)
	const q = useApi(`${F}list_fee_components`, { include_inactive: showInactive ? 1 : 0 })
	const [edit, setEdit] = useState(null)
	return (
		<>
			<Toolbar
				right={
					<>
						<Checkbox label="Show inactive" checked={showInactive} onChange={(v) => setShowInactive(Boolean(v))} />
						{canWrite ? <Button size="sm" icon={Plus} onClick={() => setEdit({})}>New component</Button> : null}
					</>
				}
			/>
			<DataTable
				query={q}
				onRow={canWrite ? (r) => setEdit(r) : undefined}
				empty="No fee components yet"
				emptyIcon={Puzzle}
				cols={[
					{ key: "component_name", label: "Component", render: (r) => (
						<span>
							<span className="block font-semibold text-ink">{r.component_name}</span>
							{r.code ? <span className="block font-mono text-[11px] text-ink-soft">{r.code}</span> : null}
						</span>
					) },
					{ key: "component_type", label: "Type" },
					{ key: "is_refundable", label: "Refundable", hideOnMobile: true, render: (r) => (r.is_refundable ? "Yes" : "No") },
					{ key: "income_account", label: "Income account", hideOnMobile: true, render: (r) => r.income_account || <span className="text-ink-soft">—</span> },
					{ key: "is_active", label: "Status", render: (r) => <Badge tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
					{ key: "default_amount", label: "Default amount", align: "right", render: (r) => (r.default_amount ? money(r.default_amount) : <span className="text-ink-soft">—</span>) },
				]}
			/>
			{canWrite ? <ComponentModal value={edit} onClose={() => setEdit(null)} /> : null}
		</>
	)
}

function ComponentModal({ value, onClose }) {
	const open = Boolean(value)
	const [form, setForm] = useState({})
	const [error, setError] = useState("")
	const save = useAction(`${F}save_fee_component`, { invalidate: [F], success: (d) => `${d.component_name} saved` })
	useEffect(() => {
		if (open) {
			setForm({ component_type: "Other", is_active: 1, is_refundable: 0, ...value, default_amount: value.default_amount ? String(value.default_amount) : "" })
			setError("")
		}
	}, [value, open])
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const go = () => {
		if (!String(form.component_name || "").trim()) return setError("Name the component")
		save.mutate({ data: { ...form, default_amount: form.default_amount ? Number(form.default_amount) : 0 } }, { onSuccess: onClose })
	}
	return (
		<Modal
			open={open}
			onClose={onClose}
			title={value?.name ? `Edit ${value.component_name}` : "New fee component"}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
					<Button onClick={go} loading={save.isPending}>Save</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-2">
					<Input label="Name" required value={form.component_name || ""} onChange={set("component_name")} error={error} disabled={Boolean(value?.name)} hint={value?.name ? "The name can't be changed once used" : undefined} />
					<Input label="Code" value={form.code || ""} onChange={set("code")} placeholder="e.g. TUI" />
					<Select label="Type" value={form.component_type || "Other"} onChange={set("component_type")} options={COMPONENT_TYPES} />
					<Input label="Default amount" type="number" min="0" value={form.default_amount} onChange={set("default_amount")} />
				</div>
				<Input label="Income account" value={form.income_account || ""} onChange={set("income_account")} placeholder="Optional GL account for accounting exports" />
				<Textarea label="Description" rows={2} value={form.description || ""} onChange={set("description")} />
				<div className="flex flex-wrap gap-6">
					<Checkbox label="Active" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v ? 1 : 0 }))} />
					<Checkbox label="Refundable" description="Can be refunded if a student withdraws" checked={form.is_refundable} onChange={(v) => setForm((f) => ({ ...f, is_refundable: v ? 1 : 0 }))} />
				</div>
				{save.isError ? <Alert tone="error">{save.error?.message}</Alert> : null}
			</div>
		</Modal>
	)
}

function Scholarships() {
	const { canWrite } = useFinanceRole()
	const [active, setActive] = useState("1")
	const list = usePaged(`${F}list_scholarships`, { is_active: active }, 20)
	const [edit, setEdit] = useState(null)
	return (
		<>
			<Toolbar
				chips={[
					{ id: "1", label: "Active" },
					{ id: "0", label: "Inactive" },
					{ id: "", label: "All" },
				]}
				active={active}
				onChip={setActive}
				right={
					<>
						<Link className="btn btn-ghost btn-sm" to="/admin/finance/adjustments">Awards & waivers</Link>
						{canWrite ? <Button size="sm" icon={Plus} onClick={() => setEdit({})}>New scholarship</Button> : null}
					</>
				}
			/>
			<DataTable
				query={list.query}
				onRow={canWrite ? (r) => setEdit(r) : undefined}
				empty="No scholarships set up"
				emptyIcon={Award}
				cols={[
					{ key: "scholarship_name", label: "Scholarship", render: (r) => (
						<span>
							<span className="block font-semibold text-ink">{r.scholarship_name}</span>
							<span className="block text-xs text-ink-soft">{[r.scholarship_type, r.sponsor, r.academic_year].filter(Boolean).join(" · ")}</span>
						</span>
					) },
					{ key: "amount", label: "Award", render: (r) => (r.amount_type === "Percentage" ? `${num(r.percentage)}%${r.applies_to_component ? ` of ${r.applies_to_component}` : ""}` : money(r.amount)) },
					{ key: "total_budget", label: "Budget used", render: (r) => (r.total_budget ? (
						<div className="min-w-[9rem]">
							<ProgressBar value={(100 * (r.utilised_amount || 0)) / r.total_budget} tone={(r.utilised_amount || 0) / r.total_budget > 0.9 ? "red" : "brand"} size="sm" />
							<div className="mt-1 text-[11px] text-ink-soft">{money(r.utilised_amount)} of {money(r.total_budget)}</div>
						</div>
					) : (
						<span className="text-xs text-ink-soft">{money(r.utilised_amount)} used · no cap</span>
					)) },
					{ key: "is_active", label: "Status", render: (r) => <Badge tone={r.is_active ? "green" : "gray"}>{r.is_active ? "Active" : "Inactive"}</Badge> },
				]}
			/>
			<Pager list={list} />
			{canWrite ? <ScholarshipModal value={edit} onClose={() => setEdit(null)} /> : null}
		</>
	)
}

function ScholarshipModal({ value, onClose }) {
	const open = Boolean(value)
	const opts = useOptions()
	const components = useApi(`${F}list_fee_components`, {}, { enabled: open })
	const [form, setForm] = useState({})
	const [errors, setErrors] = useState({})
	const save = useAction(`${F}save_scholarship`, { invalidate: [F], success: (d) => `${d.scholarship_name} saved` })
	useEffect(() => {
		if (open) {
			setForm({ scholarship_type: "Partial", amount_type: "Fixed Amount", is_active: 1, ...value })
			setErrors({})
		}
	}, [value, open])
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const pctMode = form.amount_type === "Percentage"
	const go = () => {
		const e = {}
		if (!String(form.scholarship_name || "").trim()) e.scholarship_name = "Name the scholarship"
		if (pctMode && !(Number(form.percentage) > 0 && Number(form.percentage) <= 100)) e.percentage = "Between 1 and 100"
		if (!pctMode && !(Number(form.amount) > 0)) e.amount = "Enter the award amount"
		setErrors(e)
		if (Object.keys(e).length) return
		const { utilised_amount, modified, ...rest } = form
		save.mutate(
			{
				data: {
					...rest,
					amount: pctMode ? 0 : Number(form.amount),
					percentage: pctMode ? Number(form.percentage) : 0,
					total_budget: form.total_budget ? Number(form.total_budget) : 0,
					sponsor: form.sponsor || undefined,
					academic_year: form.academic_year || undefined,
					applies_to_component: form.applies_to_component || undefined,
				},
			},
			{ onSuccess: onClose }
		)
	}
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title={value?.name ? `Edit ${value.scholarship_name}` : "New scholarship"}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
					<Button onClick={go} loading={save.isPending}>Save</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-2">
					<Input label="Name" required value={form.scholarship_name || ""} onChange={set("scholarship_name")} error={errors.scholarship_name} disabled={Boolean(value?.name)} />
					<Select label="Type" value={form.scholarship_type} onChange={set("scholarship_type")} options={SCHOLARSHIP_TYPES} />
					<Select label="Award as" value={form.amount_type} onChange={set("amount_type")} options={["Fixed Amount", "Percentage"]} />
					{pctMode ? (
						<Input label="Percentage" type="number" min="0" max="100" required value={form.percentage ?? ""} onChange={set("percentage")} error={errors.percentage} />
					) : (
						<Input label="Amount" type="number" min="0" required value={form.amount ?? ""} onChange={set("amount")} error={errors.amount} />
					)}
					<Select label="Applies to component" value={form.applies_to_component || ""} onChange={set("applies_to_component")} placeholder="Whole invoice" options={(components.data?.data || []).map((c) => c.name)} />
					<Select label="Academic year" value={form.academic_year || ""} onChange={set("academic_year")} placeholder="Any year" options={opts.years} />
					<Input label="Total budget" type="number" min="0" value={form.total_budget ?? ""} onChange={set("total_budget")} hint={value?.utilised_amount ? `${money(value.utilised_amount)} already awarded` : "Leave blank for no cap"} />
					<Input label="Sponsor ID" value={form.sponsor || ""} onChange={set("sponsor")} placeholder="Optional" />
				</div>
				<Textarea label="Description" rows={2} value={form.description || ""} onChange={set("description")} />
				<Textarea label="Eligibility" rows={2} value={form.eligibility || ""} onChange={set("eligibility")} placeholder="Who qualifies?" />
				<Checkbox label="Active" description="Inactive scholarships can't be awarded" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v ? 1 : 0 }))} />
				{save.isError ? <Alert tone="error">{save.error?.message}</Alert> : null}
			</div>
		</Modal>
	)
}
