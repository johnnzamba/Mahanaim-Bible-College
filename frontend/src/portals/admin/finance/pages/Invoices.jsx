import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { CheckCircle2, FileStack, FileText, Layers, Plus, Trash2, Wand2 } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Input, KeyValueGrid, Modal, PageHeader, RadioCards, Select, Textarea } from "@/shared/components/ui"
import { DataTable, Stepper, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { DateRange, F, FilterSelect, INVOICE_STATUSES, Pager, REFRESH, StudentLink, StudentPicker, today, useFinanceRole, useOptions, usePaged } from "../lib"

export default function Invoices() {
	const { canWrite } = useFinanceRole()
	const [params, setParams] = useSearchParams()
	const opts = useOptions()
	const [search, setSearch] = useState(params.get("search") || "")
	const [status, setStatus] = useState(params.get("status") || "")
	const [term, setTerm] = useState(params.get("term") || "")
	const [programme, setProgramme] = useState("")
	const [campus, setCampus] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const q = useDebounced(search, 300)
	const list = usePaged(`${F}list_invoices`, { search: q, status, academic_term: term, programme, campus, from_date: from, to_date: to, student: params.get("student") })
	const creating = params.get("new") === "1"
	const bulk = params.get("bulk") === "1"
	const setFlag = (k, on) => {
		const next = new URLSearchParams(params)
		if (on) next.set(k, "1")
		else next.delete(k)
		setParams(next, { replace: true })
	}
	const filtered = Boolean(term || programme || campus || from || to)

	return (
		<div>
			<PageHeader
				eyebrow="Finance"
				title="Invoices"
				subtitle="Fee invoices raised to students: create, submit, cancel and follow up balances."
				back={{ to: "/admin/finance", label: "Finance overview" }}
				actions={
					canWrite ? (
						<>
							<Button variant="secondary" size="sm" icon={Wand2} onClick={() => setFlag("bulk", true)}>
								Bulk invoice a term
							</Button>
							<Button size="sm" icon={Plus} onClick={() => setFlag("new", true)}>
								New invoice
							</Button>
						</>
					) : null
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search invoice, student or name…"
				chips={[{ id: "", label: "Open & paid" }, ...INVOICE_STATUSES.map((s) => ({ id: s, label: s }))]}
				active={status}
				onChip={setStatus}
			/>
			<div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
				<FilterSelect value={term} onChange={setTerm} options={opts.terms} placeholder="All terms" />
				<FilterSelect value={programme} onChange={setProgramme} options={opts.programmes} placeholder="All programmes" />
				<FilterSelect value={campus} onChange={setCampus} options={opts.campuses} placeholder="All campuses" />
				<DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
				{filtered ? (
					<button
						type="button"
						className="text-xs font-semibold text-brand-700 hover:underline"
						onClick={() => {
							setTerm("")
							setProgramme("")
							setCampus("")
							setFrom("")
							setTo("")
						}}
					>
						Clear filters
					</button>
				) : null}
				{params.get("student") ? (
					<Badge tone="blue" className="lg:ml-auto">
						Student {params.get("student")}
					</Badge>
				) : null}
				<span className="text-xs text-ink-soft lg:ml-auto">{num(list.total)} invoices</span>
			</div>
			<DataTable
				query={list.query}
				rowTo={(r) => `/admin/finance/invoices/${encodeURIComponent(r.name)}`}
				empty="No invoices match these filters"
				emptyIcon={FileText}
				cols={[
					{ key: "name", label: "Invoice", render: (r) => (
						<span>
							<span className="block whitespace-nowrap font-semibold text-ink">{r.name}</span>
							<span className="block text-xs text-ink-soft">{r.academic_term || "No term"}</span>
						</span>
					) },
					{ key: "student_name", label: "Student", render: (r) => <StudentLink id={r.student} name={r.student_name} inRow /> },
					{ key: "programme", label: "Programme", hideOnMobile: true },
					{ key: "due_date", label: "Due", render: (r) => <span className="whitespace-nowrap">{date(r.due_date)}</span>, sortValue: (r) => r.due_date },
					{ key: "status", label: "Status", render: (r) => <Badge status={r.status} /> },
					{ key: "total_amount", label: "Total", align: "right", render: (r) => <span className="whitespace-nowrap">{money(r.total_amount)}</span>, sortValue: (r) => r.total_amount, hideOnMobile: true },
					{ key: "outstanding_amount", label: "Balance", align: "right", render: (r) => <span className={r.outstanding_amount > 0 ? "whitespace-nowrap font-semibold text-ink" : "whitespace-nowrap text-ink-soft"}>{money(r.outstanding_amount)}</span>, sortValue: (r) => r.outstanding_amount },
				]}
			/>
			<Pager list={list} />
			{canWrite ? <CreateInvoice open={creating} onClose={() => setFlag("new", false)} /> : null}
			{canWrite ? <BulkInvoice open={bulk} onClose={() => setFlag("bulk", false)} /> : null}
		</div>
	)
}

const blankLine = () => ({ key: Math.random().toString(36).slice(2), fee_component: "", description: "", amount: "" })

export function CreateInvoice({ open, onClose, student: initialStudent }) {
	const nav = useNavigate()
	const opts = useOptions()
	const [student, setStudent] = useState(initialStudent || null)
	const [mode, setMode] = useState("structure")
	const [structure, setStructure] = useState("")
	const [term, setTerm] = useState("")
	const [posting, setPosting] = useState(today())
	const [due, setDue] = useState("")
	const [remarks, setRemarks] = useState("")
	const [lines, setLines] = useState([blankLine()])
	const [errors, setErrors] = useState({})
	const components = useApi(`${F}list_fee_components`, {}, { enabled: open, staleTime: 60_000 })
	const structures = useApi(`${F}list_fee_structures`, { is_active: 1, programme: student?.programme || undefined, page_length: 100 }, { enabled: open && mode === "structure" })
	const detail = useApi(`${F}get_fee_structure`, { name: structure }, { enabled: open && Boolean(structure) })
	const create = useAction(`${F}create_invoice`, { invalidate: REFRESH })

	useEffect(() => {
		if (open) {
			setStudent(initialStudent || null)
			setMode("structure")
			setStructure("")
			setTerm(opts.currentTerm || "")
			setPosting(today())
			setDue("")
			setRemarks("")
			setLines([blankLine()])
			setErrors({})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])
	useEffect(() => {
		if (!term && opts.currentTerm) setTerm(opts.currentTerm)
	}, [opts.currentTerm, term])
	useEffect(() => {
		const s = detail.data
		if (!s || mode !== "structure") return
		setLines((s.items || []).map((i) => ({ key: i.name || Math.random().toString(36).slice(2), fee_component: i.fee_component, description: i.description || "", amount: i.amount })))
		if (s.academic_term) setTerm(s.academic_term)
	}, [detail.data, mode])

	const comps = components.data?.data || []
	const compOptions = comps.map((c) => ({ value: c.name, label: c.component_name || c.name }))
	const total = lines.reduce((a, l) => a + Number(l.amount || 0), 0)
	const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

	const submit = (andSubmit) => {
		const e = {}
		if (!student) e.student = "Choose the student to invoice"
		if (mode === "structure" && !structure) e.structure = "Choose a fee structure"
		const good = lines.filter((l) => l.fee_component && Number(l.amount) > 0)
		if (!good.length) e.lines = "Add at least one fee line with an amount"
		if (lines.some((l) => (l.fee_component || l.amount) && !(l.fee_component && Number(l.amount) > 0))) e.lines = "Each line needs a fee component and an amount above zero"
		if (due && posting && due < posting) e.due = "The due date can't be before the invoice date"
		setErrors(e)
		if (Object.keys(e).length) return
		create.mutate(
			{
				data: {
					student: student.name,
					fee_structure: mode === "structure" ? structure : undefined,
					academic_term: term || undefined,
					posting_date: posting || undefined,
					due_date: due || undefined,
					remarks: remarks || undefined,
					items: good.map((l) => ({ fee_component: l.fee_component, description: l.description, amount: Number(l.amount) })),
					submit: andSubmit ? 1 : 0,
				},
			},
			{
				onSuccess: (inv) => {
					onClose()
					nav(`/admin/finance/invoices/${encodeURIComponent(inv.name)}`)
				},
			}
		)
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="New invoice"
			subtitle="Bill a student from a fee structure or itemise the fee lines yourself."
			footer={
				<>
					<span className="mr-auto self-center text-sm text-ink-soft">
						Total <span className="font-bold text-ink">{money(total)}</span>
					</span>
					<Button variant="secondary" onClick={() => submit(false)} loading={create.isPending && !create.variables?.data?.submit}>
						Save as draft
					</Button>
					<Button icon={CheckCircle2} onClick={() => submit(true)} loading={create.isPending && Boolean(create.variables?.data?.submit)}>
						Create & submit
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<StudentPicker value={student} onChange={setStudent} required error={errors.student} autoFocus />
				<RadioCards
					value={mode}
					onChange={(v) => {
						setMode(v)
						setStructure("")
						setLines([blankLine()])
					}}
					options={[
						{ value: "structure", label: "From a fee structure", description: "Lines and instalments follow the structure", icon: Layers },
						{ value: "items", label: "Itemised", description: "Pick fee components one by one", icon: FileStack },
					]}
				/>
				{mode === "structure" ? (
					<Select
						label="Fee structure"
						required
						value={structure}
						onChange={(e) => setStructure(e.target.value)}
						placeholder={structures.isLoading ? "Loading…" : (structures.data?.data || []).length ? "Choose a structure" : "No active structures for this programme"}
						options={(structures.data?.data || []).map((s) => ({ value: s.name, label: `${s.structure_name || s.name} · ${money(s.total_amount)}${s.academic_term ? ` · ${s.academic_term}` : ""}` }))}
						error={errors.structure}
						hint={student?.programme ? `Showing structures for ${student.programme}` : "Pick a student to narrow the list to their programme"}
					/>
				) : null}
				<div>
					<div className="mb-1.5 flex items-center justify-between">
						<span className="label !mb-0">Fee lines</span>
						<Button variant="ghost" size="sm" icon={Plus} onClick={() => setLines((ls) => [...ls, blankLine()])}>
							Add line
						</Button>
					</div>
					<div className="space-y-2">
						{lines.map((l) => (
							<div key={l.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] gap-2 rounded-xl border border-line p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
								<select
									className="input"
									aria-label="Fee component"
									value={l.fee_component}
									onChange={(e) => {
										const c = comps.find((x) => x.name === e.target.value)
										setLine(l.key, { fee_component: e.target.value, amount: l.amount || c?.default_amount || "" })
									}}
								>
									<option value="">Fee component…</option>
									{compOptions.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
								</select>
								<input className="input col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto" placeholder="Description (optional)" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
								<input className="input text-right" type="number" min="0" step="0.01" placeholder="Amount" aria-label="Amount" value={l.amount} onChange={(e) => setLine(l.key, { amount: e.target.value })} />
								<button type="button" className="grid h-10 w-9 place-items-center rounded-lg text-ink-soft hover:bg-red-50 hover:text-red-600 disabled:opacity-40" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
									<Trash2 size={15} />
								</button>
							</div>
						))}
					</div>
					{errors.lines ? <p className="mt-1 text-xs font-medium text-red-600">{errors.lines}</p> : null}
				</div>
				<div className="grid gap-3 sm:grid-cols-3">
					<Select label="Academic term" value={term} onChange={(e) => setTerm(e.target.value)} options={opts.terms} placeholder="No term" />
					<Input label="Invoice date" type="date" value={posting} onChange={(e) => setPosting(e.target.value)} />
					<Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} error={errors.due} hint="Defaults to the college payment terms" />
				</div>
				<Textarea label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Shown on the invoice (optional)" />
			</div>
		</Modal>
	)
}

function BulkInvoice({ open, onClose }) {
	const opts = useOptions()
	const [step, setStep] = useState(0)
	const [form, setForm] = useState({ term: "", programme: "", campus: "", study_mode: "" })
	const [result, setResult] = useState(null)
	const run = useAction(`${F}bulk_invoice`, {
		invalidate: REFRESH,
		onSuccess: (r) => {
			setResult(r)
			setStep(2)
		},
	})
	const structures = useApi(`${F}list_fee_structures`, { is_active: 1, academic_term: form.term || undefined, programme: form.programme || undefined, page_length: 100 }, { enabled: open && step === 1 })
	useEffect(() => {
		if (open) {
			setStep(0)
			setResult(null)
			setForm({ term: opts.currentTerm || "", programme: "", campus: "", study_mode: "" })
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
	const label = (list, v) => list.find((o) => o.value === v)?.label || v
	const structs = (structures.data?.data || []).filter((s) => (!form.campus || !s.campus || s.campus === form.campus) && (!form.study_mode || !s.study_mode || s.study_mode === form.study_mode))

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Bulk invoice a term"
			subtitle="Raise term invoices for every approved registration that doesn't have one yet."
			footer={
				step === 0 ? (
					<>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button disabled={!form.term} onClick={() => setStep(1)}>
							Review
						</Button>
					</>
				) : step === 1 ? (
					<>
						<Button variant="secondary" onClick={() => setStep(0)} disabled={run.isPending}>
							Back
						</Button>
						<Button icon={Wand2} loading={run.isPending} onClick={() => run.mutate({ term: form.term, programme: form.programme || undefined, campus: form.campus || undefined, study_mode: form.study_mode || undefined })}>
							Generate invoices
						</Button>
					</>
				) : (
					<Button onClick={onClose}>Done</Button>
				)
			}
		>
			<Stepper steps={["Choose cohort", "Review", "Results"]} current={step} onStep={step < 2 ? setStep : undefined} className="mb-5" />
			{step === 0 ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<Select label="Academic term" required value={form.term} onChange={set("term")} options={opts.terms} placeholder="Choose a term" />
					<Select label="Programme" value={form.programme} onChange={set("programme")} options={opts.programmes} placeholder="All programmes" />
					<Select label="Campus" value={form.campus} onChange={set("campus")} options={opts.campuses} placeholder="All campuses" />
					<Select label="Study mode" value={form.study_mode} onChange={set("study_mode")} options={opts.studyModes} placeholder="All study modes" />
					<Alert tone="info" className="sm:col-span-2">
						Students who already have an invoice from a fee structure for this term are skipped, so it's safe to run again after late registrations.
					</Alert>
				</div>
			) : step === 1 ? (
				<div className="space-y-4">
					<KeyValueGrid
						cols={4}
						items={[
							{ label: "Term", value: label(opts.terms, form.term) },
							{ label: "Programme", value: form.programme ? label(opts.programmes, form.programme) : "All" },
							{ label: "Campus", value: form.campus ? label(opts.campuses, form.campus) : "All" },
							{ label: "Study mode", value: form.study_mode || "All" },
						]}
					/>
					<div>
						<div className="label">Matching active fee structures</div>
						{structures.isLoading ? (
							<p className="text-sm text-ink-soft">Checking fee structures…</p>
						) : structs.length ? (
							<ul className="divide-y divide-line rounded-xl border border-line">
								{structs.map((s) => (
									<li key={s.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
										<span className="min-w-0">
											<span className="block truncate font-medium text-ink">{s.structure_name || s.name}</span>
											<span className="block truncate text-xs text-ink-soft">{[s.programme, s.campus, s.study_mode, s.year_of_study ? `Year ${s.year_of_study}` : null].filter(Boolean).join(" · ")}</span>
										</span>
										<span className="shrink-0 font-semibold">{money(s.total_amount)}</span>
									</li>
								))}
							</ul>
						) : (
							<Alert tone="warning">No active fee structure names this term{form.programme ? " and programme" : ""}. Structures without a term still apply; students with no matching structure are listed after the run.</Alert>
						)}
					</div>
				</div>
			) : result ? (
				<BulkResult r={result} />
			) : null}
		</Modal>
	)
}

function BulkResult({ r }) {
	if (r.queued) {
		return (
			<Alert tone="success" title="Running in the background">
				{num(r.count)} registrations are being invoiced. You'll find the invoices in the list in a few minutes.
			</Alert>
		)
	}
	const created = r.created || []
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-3 gap-3 text-center">
				<Stat label="Created" value={created.length} tone="text-emerald-700" />
				<Stat label="Already invoiced" value={r.skipped_existing || 0} />
				<Stat label="Problems" value={(r.no_structure || []).length + (r.errors || []).length} tone={(r.no_structure || []).length + (r.errors || []).length ? "text-red-600" : undefined} />
			</div>
			{created.length ? (
				<div>
					<div className="label">New invoices</div>
					<div className="flex flex-wrap gap-1.5">
						{created.slice(0, 30).map((n) => (
							<Link key={n} to={`/admin/finance/invoices/${encodeURIComponent(n)}`} className="chip">
								{n}
							</Link>
						))}
						{created.length > 30 ? <span className="chip">+{created.length - 30} more</span> : null}
					</div>
				</div>
			) : null}
			{(r.no_structure || []).length ? (
				<Alert tone="warning" title="No fee structure found for">
					{r.no_structure.slice(0, 20).join(", ")}
					{r.no_structure.length > 20 ? ` and ${r.no_structure.length - 20} more` : ""}
				</Alert>
			) : null}
			{(r.errors || []).length ? (
				<Alert tone="error" title="Could not invoice">
					<ul className="list-disc pl-4">
						{r.errors.slice(0, 10).map((e) => (
							<li key={e.student}>
								{e.student}: {e.error}
							</li>
						))}
					</ul>
				</Alert>
			) : null}
			{!created.length && !(r.no_structure || []).length && !(r.errors || []).length ? <Alert tone="info">Everyone in this cohort is already invoiced for the term.</Alert> : null}
		</div>
	)
}

function Stat({ label, value, tone }) {
	return (
		<div className="rounded-xl border border-line px-3 py-3">
			<div className={`text-2xl font-bold ${tone || "text-ink"}`}>{num(value)}</div>
			<div className="text-xs text-ink-soft">{label}</div>
		</div>
	)
}
