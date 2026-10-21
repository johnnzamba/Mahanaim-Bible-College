import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowRight, Building2, CalendarRange, Laptop, Layers, MapPin, Pencil, Plus } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { DataTable, SearchInput } from "@/shared/components/kit"
import { Alert, Badge, Button, Input, Loading, Modal, Select, Tabs, Textarea } from "@/shared/components/ui"
import { S, ImageField, ToggleRow, errText } from "../lib"

const KINDS = {
	campuses: {
		doctype: "Campus",
		label: "Campuses",
		singular: "campus",
		icon: Building2,
		nameField: "campus_name",
		lookupKey: "campuses",
		fields: [
			{ key: "campus_name", label: "Campus name", required: true, createOnly: true },
			{ key: "code", label: "Code", required: true, hint: "Short code used in student numbers, e.g. NRB.", upper: true },
			{ key: "town", label: "Town" },
			{ key: "county", label: "County" },
			{ key: "phone", label: "Phone", inputType: "tel" },
			{ key: "email", label: "Email", inputType: "email" },
			{ key: "head_of_campus", label: "Head of campus", type: "staff" },
			{ key: "map_url", label: "Map link", inputType: "url", placeholder: "https://maps.google.com/…" },
			{ key: "address", label: "Address", type: "text", wide: true },
			{ key: "image", label: "Photo", type: "image", wide: true },
			{ key: "is_main_campus", label: "Main campus", type: "check", hint: "The headquarters campus." },
			{ key: "is_active", label: "Active", type: "check", hint: "Inactive campuses are hidden from new applications and registrations." },
		],
		columns: [
			{ key: "campus_name", label: "Campus", render: (r) => <NameCell name={r.campus_name || r.name} sub={r.town} /> , sortValue: (r) => r.campus_name },
			{ key: "code", label: "Code", render: (r) => <span className="font-mono text-xs">{r.code || "—"}</span>, sortValue: (r) => r.code },
			{ key: "is_main_campus", label: "Type", render: (r) => (Number(r.is_main_campus) ? <Badge tone="gold">Main campus</Badge> : <span className="text-ink-soft">Branch</span>), sortValue: (r) => -Number(r.is_main_campus) },
		],
	},
	departments: {
		doctype: "Department",
		label: "Departments",
		singular: "department",
		icon: Layers,
		nameField: "department_name",
		lookupKey: "departments",
		fields: [
			{ key: "department_name", label: "Department name", required: true, createOnly: true },
			{ key: "code", label: "Code", upper: true },
			{ key: "head_of_department", label: "Head of department", type: "staff", wide: true },
			{ key: "description", label: "Description", type: "text", wide: true },
			{ key: "is_active", label: "Active", type: "check" },
		],
		columns: [
			{ key: "department_name", label: "Department", render: (r) => <NameCell name={r.department_name || r.name} />, sortValue: (r) => r.department_name },
			{ key: "code", label: "Code", render: (r) => <span className="font-mono text-xs">{r.code || "—"}</span>, sortValue: (r) => r.code },
		],
	},
	study_modes: {
		doctype: "Study Mode",
		label: "Study modes",
		singular: "study mode",
		icon: Laptop,
		nameField: "study_mode_name",
		lookupKey: "study_modes",
		fields: [
			{ key: "study_mode_name", label: "Study mode name", required: true, createOnly: true },
			{ key: "code", label: "Code", required: true, upper: true },
			{ key: "description", label: "Description", type: "text", wide: true },
			{ key: "is_online", label: "Delivered online", type: "check", hint: "Online modes get LMS access and remote exams." },
			{ key: "is_active", label: "Active", type: "check" },
		],
		columns: [
			{ key: "study_mode_name", label: "Study mode", render: (r) => <NameCell name={r.study_mode_name || r.name} />, sortValue: (r) => r.study_mode_name },
			{ key: "code", label: "Code", render: (r) => <span className="font-mono text-xs">{r.code || "—"}</span>, sortValue: (r) => r.code },
			{ key: "is_online", label: "Delivery", render: (r) => (Number(r.is_online) ? <Badge tone="blue">Online</Badge> : <span className="text-ink-soft">On campus</span>), sortValue: (r) => Number(r.is_online) },
		],
	},
}

function NameCell({ name, sub }) {
	return (
		<span className="block min-w-0">
			<span className="block truncate font-medium text-ink">{name}</span>
			{sub ? (
				<span className="flex items-center gap-1 text-xs text-ink-soft">
					<MapPin size={11} /> {sub}
				</span>
			) : null}
		</span>
	)
}

const statusColumn = { key: "is_active", label: "Status", render: (r) => (Number(r.is_active) ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>), sortValue: (r) => -Number(r.is_active) }

function useStaffOptions(enabled) {
	const q = useApi("frappe.client.get_list", { doctype: "Staff Member", fields: ["name", "full_name"], filters: { status: ["!=", "Inactive"] }, order_by: "full_name asc", limit_page_length: 500 }, { enabled, staleTime: 10 * 60_000, retry: false })
	return useMemo(() => (q.data || []).map((s) => ({ value: s.name, label: s.full_name || s.name })), [q.data])
}

function MasterEditor({ kind, name, onClose }) {
	const def = KINDS[kind]
	const editing = Boolean(name)
	const doc = useApi("frappe.client.get", { doctype: def.doctype, name }, { enabled: editing, staleTime: 0 })
	const staff = useStaffOptions(def.fields.some((f) => f.type === "staff"))
	const [draft, setDraft] = useState({})
	const [error, setError] = useState("")
	const base = editing ? doc.data || {} : { is_active: 1 }
	const values = { ...base, ...draft }
	const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
	const save = useAction(`${S}save_master`, {
		invalidate: [`${S}lookups`, "frappe.client.get"],
		success: editing ? `${values[def.nameField] || name} updated` : `${def.singular[0].toUpperCase()}${def.singular.slice(1)} added`,
		error: false,
		onSuccess: onClose,
		onError: (e) => setError(errText(e)),
	})
	const missing = def.fields.filter((f) => f.required && !(editing && f.createOnly) && !String(values[f.key] ?? "").trim())
	const submit = (e) => {
		e?.preventDefault()
		setError("")
		if (missing.length) return setError(`${missing.map((f) => f.label).join(", ")} ${missing.length === 1 ? "is" : "are"} required.`)
		const keys = editing ? Object.keys(draft) : def.fields.map((f) => f.key)
		const data = Object.fromEntries(keys.filter((k) => !(editing && def.fields.find((f) => f.key === k)?.createOnly)).map((k) => [k, values[k] ?? ""]))
		if (editing && !Object.keys(data).length) return onClose()
		save.mutate({ doctype: def.doctype, data, name: editing ? name : undefined })
	}
	return (
		<Modal
			open
			onClose={onClose}
			size="lg"
			title={editing ? `Edit ${values[def.nameField] || name}` : `New ${def.singular}`}
			subtitle={editing ? def.doctype : `Add a ${def.singular} to the master list.`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={save.isPending}>
						Cancel
					</Button>
					<Button onClick={submit} loading={save.isPending} disabled={editing && doc.isLoading}>
						{editing ? "Save changes" : `Add ${def.singular}`}
					</Button>
				</>
			}
		>
			{editing && doc.isLoading ? (
				<Loading />
			) : editing && doc.isError ? (
				<Alert tone="error">{errText(doc.error)}</Alert>
			) : (
				<form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
					{error ? (
						<Alert tone="error" className="sm:col-span-2">
							{error}
						</Alert>
					) : null}
					{def.fields.map((f) => {
						const span = f.wide ? "sm:col-span-2" : undefined
						const v = values[f.key]
						if (f.type === "check") return <ToggleRow key={f.key} label={f.label} description={f.hint} checked={v} onChange={(x) => set(f.key, x)} className="sm:col-span-1" />
						if (f.type === "staff") {
							const opts = v && !staff.some((o) => o.value === v) ? [{ value: v, label: v }, ...staff] : staff
							return <Select key={f.key} label={f.label} className={span} value={v || ""} onChange={(e) => set(f.key, e.target.value)} options={opts} placeholder="Not assigned" />
						}
						if (f.type === "text") return <Textarea key={f.key} label={f.label} rows={2} className={span} value={v || ""} onChange={(e) => set(f.key, e.target.value)} />
						if (f.type === "image") return <ImageField key={f.key} label={f.label} className={span} value={v} onChange={(x) => set(f.key, x)} />
						return (
							<Input
								key={f.key}
								label={f.label}
								hint={editing && f.createOnly ? "The name can't be changed once created." : f.hint}
								required={f.required && !(editing && f.createOnly)}
								className={span}
								type={f.inputType || "text"}
								placeholder={f.placeholder}
								value={v || ""}
								disabled={editing && f.createOnly}
								onChange={(e) => set(f.key, f.upper ? e.target.value.toUpperCase() : e.target.value)}
							/>
						)
					})}
					<button type="submit" className="hidden" />
				</form>
			)}
		</Modal>
	)
}

/** Campuses, departments and study modes via setup.lookups + setup.save_master. */
export default function MasterData() {
	const [params, setParams] = useSearchParams()
	const kind = KINDS[params.get("tab")] ? params.get("tab") : "campuses"
	const setKind = (k) => setParams(k === "campuses" ? {} : { tab: k }, { replace: true })
	const [search, setSearch] = useState("")
	const [editing, setEditing] = useState(null)
	const lookups = useApi(`${S}lookups`, {}, { staleTime: 60_000 })
	const def = KINDS[kind]
	const all = lookups.data?.[def.lookupKey] || []
	const rows = useMemo(() => {
		const q = search.trim().toLowerCase()
		return q ? all.filter((r) => [r.name, r[def.nameField], r.code, r.town].some((x) => String(x || "").toLowerCase().includes(q))) : all
	}, [all, search, def.nameField])
	const columns = [
		...def.columns,
		statusColumn,
		{
			key: "actions",
			label: "",
			align: "right",
			render: (r) => (
				<Button size="sm" variant="ghost" icon={Pencil} onClick={(e) => (e.stopPropagation(), setEditing(r.name))}>
					Edit
				</Button>
			),
		},
	]
	const tabs = Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label, count: lookups.data?.[k.lookupKey]?.length }))
	return (
		<div className="space-y-5">
			<section className="card overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
					<div>
						<h3 className="text-[15px] font-semibold text-ink">Master data</h3>
						<p className="text-xs text-ink-soft">Lists used in applications, registration, fees and reports.</p>
					</div>
					<Button size="sm" icon={Plus} onClick={() => setEditing("__new__")}>
						Add {def.singular}
					</Button>
				</div>
				<Tabs
					className="mt-3 overflow-y-hidden px-3"
					tabs={tabs}
					active={kind}
					onChange={(k) => {
						setKind(k)
						setSearch("")
					}}
				/>
				<div className="border-t border-line px-4 py-3">
					<SearchInput value={search} onChange={setSearch} placeholder={`Search ${def.label.toLowerCase()}…`} className="sm:max-w-xs" />
				</div>
				<DataTable
					className="rounded-none border-0 shadow-none"
					cols={columns}
					rows={lookups.isLoading || lookups.isError ? undefined : rows}
					query={lookups}
					onRow={(r) => setEditing(r.name)}
					empty={search ? "No matches for that search" : `No ${def.label.toLowerCase()} yet`}
					emptyIcon={def.icon}
				/>
			</section>
			<section className="card flex flex-wrap items-center justify-between gap-3 p-5">
				<div className="flex items-start gap-3">
					<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-50 text-gold-700">
						<CalendarRange size={17} />
					</span>
					<div>
						<h3 className="text-[15px] font-semibold text-ink">Academic years, terms and intakes</h3>
						<p className="text-xs text-ink-soft">Maintained with the academic calendar so dates and registration windows stay in one place.</p>
					</div>
				</div>
				<Link to="/admin/academics/calendar" className="btn btn-secondary btn-sm">
					Open calendar <ArrowRight size={14} />
				</Link>
			</section>
			{editing ? <MasterEditor key={`${kind}:${editing}`} kind={kind} name={editing === "__new__" ? null : editing} onClose={() => setEditing(null)} /> : null}
		</div>
	)
}
