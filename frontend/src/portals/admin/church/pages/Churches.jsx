import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { ChevronDown, ChevronRight, Church, GitBranch, List, Pencil, Plus } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"
import { Badge, Button, Checkbox, Drawer, Empty, Input, KeyValueGrid, Modal, PageHeader, QueryState, Select, SkeletonRows, Tabs, Textarea, Card } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { date, money, num } from "@/shared/utils/format"
import { API, CHURCH_TYPES, ChurchTabs, INVALIDATE, PARTNERSHIP_STATUSES, RoleGate, searchChurches, searchSponsors, toneOf, useChurchRoles } from "../components/common"
import { nullify, SearchPick, usePaged } from "../components/kit"
import { safeUrl } from "@/shared/utils/sanitize"

const STATUS_CHIPS = [{ id: "", label: "All" }, ...PARTNERSHIP_STATUSES.map((s) => ({ id: s, label: s }))]

export default function Churches() {
	return (
		<RoleGate need="church" title="Partner churches">
			<ChurchesPage />
		</RoleGate>
	)
}

function ChurchesPage() {
	const { canEditChurch } = useChurchRoles()
	const [params, setParams] = useSearchParams()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [view, setView] = useState("tree")
	const [editing, setEditing] = useState(null)
	const ds = useDebounced(search)
	const open = params.get("church")
	const setOpen = (name) => {
		const next = new URLSearchParams(params)
		if (name) next.set("church", name)
		else next.delete("church")
		setParams(next, { replace: true })
	}
	const treeMode = view === "tree" && !ds

	return (
		<>
			<ChurchTabs />
			<PageHeader
				title="Partner churches"
				subtitle="The churches and ministries that send students, sponsor them and pray with the college."
				actions={canEditChurch ? <Button icon={Plus} onClick={() => setEditing({})}>New church</Button> : null}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, code, town, pastor…"
				chips={STATUS_CHIPS}
				active={status}
				onChip={setStatus}
				right={
					<div className="flex rounded-xl border border-line p-0.5">
						<button type="button" className={clsx("btn btn-sm", view === "tree" ? "btn-primary" : "btn-ghost")} onClick={() => setView("tree")}>
							<GitBranch size={14} /> Tree
						</button>
						<button type="button" className={clsx("btn btn-sm", view === "list" ? "btn-primary" : "btn-ghost")} onClick={() => setView("list")}>
							<List size={14} /> List
						</button>
					</div>
				}
			/>
			{treeMode ? <TreeView status={status} onOpen={setOpen} /> : <ListView search={ds} status={status} onOpen={setOpen} />}
			<ChurchDrawer name={open} onClose={() => setOpen(null)} onEdit={(doc) => setEditing(doc)} onBranch={(parent) => setEditing({ parent_partner_church: parent.name, _parent_label: parent.church_name, church_type: "Local Church" })} />
			<ChurchForm initial={editing} onClose={() => setEditing(null)} onSaved={(doc) => setOpen(doc.name)} />
		</>
	)
}

function TreeView({ status, onOpen }) {
	const q = useApi(`${API}list_churches`, { tree: 1, ...(status ? { status } : {}) })
	return (
		<Card className="overflow-hidden">
			<QueryState
				query={q}
				skeleton={<SkeletonRows className="p-5" />}
				isEmpty={(d) => !d?.data?.length}
				empty={<Empty title="No partner churches yet" subtitle="Add the denominations, regions and local churches the college partners with." icon={Church} />}
			>
				{(d) => (
					<>
						<div className="hidden grid-cols-[minmax(0,1fr)_9rem_8rem_6rem] gap-3 border-b border-line bg-cream/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft md:grid">
							<span>Church</span>
							<span>Town</span>
							<span>Status</span>
							<span className="text-right">Students</span>
						</div>
						<ul className="divide-y divide-line">
							{d.data.map((node) => (
								<TreeNode key={node.name} node={node} depth={0} onOpen={onOpen} />
							))}
						</ul>
						<div className="border-t border-line px-4 py-2.5 text-xs text-ink-soft">{num(d.total)} churches in the network</div>
					</>
				)}
			</QueryState>
		</Card>
	)
}

function TreeNode({ node, depth, onOpen }) {
	const [open, setOpen] = useState(depth < 1)
	const kids = node.children || []
	return (
		<li>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-cream/60 md:grid-cols-[minmax(0,1fr)_9rem_8rem_6rem]">
				<div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
					{kids.length ? (
						<button type="button" className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-soft hover:bg-line/60" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
							{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
						</button>
					) : (
						<span className="w-6 shrink-0" />
					)}
					<button type="button" className="min-w-0 text-left" onClick={() => onOpen(node.name)}>
						<span className="block truncate text-sm font-semibold text-ink hover:text-brand-700">{node.church_name}</span>
						<span className="block truncate text-xs text-ink-soft">
							{[node.church_type, node.denomination, kids.length ? `${kids.length} branch${kids.length === 1 ? "" : "es"}` : null].filter(Boolean).join(" · ")}
						</span>
					</button>
				</div>
				<span className="hidden truncate text-sm text-ink-muted md:block">{node.town || "—"}</span>
				<span className="hidden md:block">
					<Badge status={node.partnership_status} tone={toneOf(node.partnership_status)} size="xs" />
				</span>
				<span className="text-right text-sm font-semibold tabular-nums text-ink" title="Students including branches">
					{num(node.students_total)}
				</span>
			</div>
			{open && kids.length ? (
				<ul className="divide-y divide-line border-t border-line bg-cream/20">
					{kids.map((k) => (
						<TreeNode key={k.name} node={k} depth={depth + 1} onOpen={onOpen} />
					))}
				</ul>
			) : null}
		</li>
	)
}

const LIST_COLS = [
	{ key: "church_name", label: "Church", render: (r) => (
		<span className="block min-w-0">
			<span className="block truncate font-semibold text-ink">{r.church_name}</span>
			<span className="block truncate text-xs text-ink-soft">{[r.church_code, r.denomination].filter(Boolean).join(" · ")}</span>
		</span>
	), sortValue: (r) => r.church_name, exportValue: (r) => r.church_name },
	{ key: "church_type", label: "Type", hideOnMobile: true },
	{ key: "town", label: "Town", render: (r) => [r.town, r.county].filter(Boolean).join(", ") || "—", sortValue: (r) => r.town },
	{ key: "senior_pastor", label: "Senior pastor", hideOnMobile: true },
	{ key: "partnership_status", label: "Status", render: (r) => <Badge status={r.partnership_status} tone={toneOf(r.partnership_status)} size="xs" />, sortValue: (r) => r.partnership_status },
	{ key: "students", label: "Students", align: "right" },
]

function ListView({ search, status, onOpen }) {
	const { query, rows, total, pager } = usePaged(`${API}list_churches`, { tree: 0, search, status })
	return (
		<>
			<div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
				<span>{num(total)} churches</span>
				<ExportButton filename="partner-churches.csv" cols={LIST_COLS} rows={rows} />
			</div>
			<DataTable cols={LIST_COLS} query={query} onRow={(r) => onOpen(r.name)} empty="No churches match" footer={pager} />
		</>
	)
}

function ChurchDrawer({ name, onClose, onEdit, onBranch }) {
	const { canEditChurch, canRead } = useChurchRoles()
	const [tab, setTab] = useState("profile")
	const q = useApi(`${API}get_church`, { name }, { enabled: Boolean(name) })
	const d = q.data
	return (
		<Drawer
			open={Boolean(name)}
			onClose={onClose}
			title={d?.church_name || "Partner church"}
			subtitle={d ? [d.church_type, d.denomination, d.town].filter(Boolean).join(" · ") : name}
			width="max-w-2xl"
			footer={
				canEditChurch && d ? (
					<>
						<Button variant="secondary" icon={GitBranch} onClick={() => onBranch(d)}>
							Add branch
						</Button>
						<Button icon={Pencil} onClick={() => onEdit(d)}>
							Edit church
						</Button>
					</>
				) : null
			}
		>
			<QueryState query={q}>
				{(c) => (
					<div className="space-y-4">
						<div className="flex flex-wrap items-center gap-2">
							<Badge status={c.partnership_status} tone={toneOf(c.partnership_status)} />
							{c.is_group ? <Badge tone="purple">Has branches</Badge> : null}
							{c.partnership_since ? <span className="text-xs text-ink-soft">Partner since {date(c.partnership_since)}</span> : null}
						</div>
						<div className="grid grid-cols-3 gap-2">
							<MiniStat label="Students" value={num(c.students?.length)} />
							<MiniStat label="Sponsors" value={num(c.sponsors?.length)} />
							<MiniStat label="Giving" value={money(c.giving_total, { compact: true })} />
						</div>
						<Tabs
							size="sm"
							active={tab}
							onChange={setTab}
							tabs={[
								{ id: "profile", label: "Profile" },
								{ id: "students", label: "Students", count: c.students?.length || 0 },
								{ id: "branches", label: "Branches", count: c.branches?.length || 0 },
								{ id: "sponsors", label: "Sponsors", count: c.sponsors?.length || 0 },
							]}
						/>
						{tab === "profile" ? (
							<KeyValueGrid
								items={[
									{ label: "Church code", value: c.church_code },
									{ label: "Part of", value: c.parent_partner_church },
									{ label: "Senior pastor", value: c.senior_pastor },
									{ label: "Contact person", value: c.contact_person },
									{ label: "Phone", value: c.phone ? <a className="text-brand-700" href={`tel:${c.phone}`}>{c.phone}</a> : null },
									{ label: "Email", value: c.email ? <a className="text-brand-700" href={`mailto:${c.email}`}>{c.email}</a> : null },
									{ label: "Website", value: c.website ? safeUrl(c.website) ? <a className="text-brand-700" href={safeUrl(c.website)} target="_blank" rel="noreferrer">{c.website}</a> : c.website : null },
									{ label: "County", value: c.county },
									{ label: "Address", value: c.address, wide: true },
								]}
							/>
						) : null}
						{tab === "students" ? (
							c.students?.length ? (
								<ul className="divide-y divide-line rounded-xl border border-line">
									{c.students.map((s) => (
										<li key={s.name}>
											<Link to={`/admin/students/${encodeURIComponent(s.name)}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-cream/60">
												<span className="min-w-0">
													<span className="block truncate text-sm font-semibold text-ink">{s.full_name}</span>
													<span className="block truncate text-xs text-ink-soft">{[s.student_number, s.programme, s.year_of_study ? `Year ${s.year_of_study}` : null].filter(Boolean).join(" · ")}</span>
												</span>
												<Badge status={s.status} size="xs" />
											</Link>
										</li>
									))}
								</ul>
							) : (
								<Empty compact title="No students from this church yet" />
							)
						) : null}
						{tab === "branches" ? (
							c.branches?.length ? (
								<ul className="divide-y divide-line rounded-xl border border-line">
									{c.branches.map((b) => (
										<li key={b.name}>
											<Link to={`/admin/church/churches?church=${encodeURIComponent(b.name)}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-cream/60">
												<span className="min-w-0">
													<span className="block truncate text-sm font-semibold text-ink">{b.church_name}</span>
													<span className="block truncate text-xs text-ink-soft">{b.town || "—"}</span>
												</span>
												<Badge status={b.partnership_status} tone={toneOf(b.partnership_status)} size="xs" />
											</Link>
										</li>
									))}
								</ul>
							) : (
								<Empty compact title="No branches" subtitle={canEditChurch ? "Use “Add branch” to place a congregation under this church." : undefined} />
							)
						) : null}
						{tab === "sponsors" ? (
							c.sponsors?.length ? (
								<ul className="divide-y divide-line rounded-xl border border-line">
									{c.sponsors.map((s) => {
										const row = (
											<>
												<span className="min-w-0">
													<span className="block truncate text-sm font-semibold text-ink">{s.sponsor_name}</span>
													<span className="block truncate text-xs text-ink-soft">
														{money(s.total_disbursed)} of {money(s.total_committed)} disbursed
													</span>
												</span>
												<Badge status={s.status} size="xs" />
											</>
										)
										return (
											<li key={s.name}>
												{canRead ? (
													<Link to={`/admin/church/sponsors/${encodeURIComponent(s.name)}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-cream/60">
														{row}
													</Link>
												) : (
													<div className="flex items-center justify-between gap-3 px-3 py-2.5">{row}</div>
												)}
											</li>
										)
									})}
								</ul>
							) : (
								<Empty compact title="No sponsors linked" />
							)
						) : null}
					</div>
				)}
			</QueryState>
		</Drawer>
	)
}

function MiniStat({ label, value }) {
	return (
		<div className="rounded-xl bg-cream/70 px-3 py-2 text-center">
			<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
			<div className="truncate text-base font-bold text-ink">{value}</div>
		</div>
	)
}

const BLANK = {
	church_name: "",
	church_code: "",
	denomination: "",
	church_type: "Local Church",
	partnership_status: "Prospect",
	partnership_since: "",
	sponsor: "",
	senior_pastor: "",
	contact_person: "",
	phone: "",
	email: "",
	website: "",
	county: "",
	town: "",
	address: "",
	is_group: 0,
	parent_partner_church: "",
}

function ChurchForm({ initial, onClose, onSaved }) {
	const { hasRole } = useSession()
	const canSeeSponsors = hasRole(ROLES.CHAPLAIN, ROLES.FINANCE, ROLES.AUDITOR, ROLES.REGISTRAR, ROLES.ADMISSIONS)
	const open = Boolean(initial)
	const start = useMemo(() => {
		if (!initial) return BLANK
		const out = { ...BLANK }
		for (const k of Object.keys(BLANK)) if (initial[k] != null) out[k] = initial[k]
		return out
	}, [initial])
	const [form, setForm] = useState(start)
	const [labels, setLabels] = useState({})
	const [errors, setErrors] = useState({})
	const [seen, setSeen] = useState(null)
	if (initial !== seen) {
		setSeen(initial)
		setForm(start)
		setErrors({})
		setLabels({ parent: initial?._parent_label || initial?.parent_partner_church, sponsor: initial?.sponsor })
	}
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = useAction(`${API}save_church`, {
		invalidate: INVALIDATE,
		success: "Church saved",
		onSuccess: (doc) => {
			onClose()
			onSaved?.(doc)
		},
	})
	const submit = () => {
		const errs = {}
		if (!form.church_name.trim()) errs.church_name = "Give the church a name"
		if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errs.email = "Enter a valid email"
		setErrors(errs)
		if (Object.keys(errs).length) return
		save.mutate({ data: nullify({ ...form, ...(initial?.name ? { name: initial.name } : {}) }) })
	}
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title={initial?.name ? `Edit ${initial.church_name}` : "New partner church"}
			subtitle={initial?.name ? initial.name : "Churches can be nested: denomination → region → local church."}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={submit}>
						Save church
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Church name" required value={form.church_name} onChange={set("church_name")} error={errors.church_name} className="sm:col-span-2" />
				<Input label="Church code" value={form.church_code} onChange={set("church_code")} />
				<Input label="Denomination" value={form.denomination} onChange={set("denomination")} />
				<Select label="Type" options={CHURCH_TYPES} value={form.church_type} onChange={set("church_type")} />
				<Select label="Partnership status" options={PARTNERSHIP_STATUSES} value={form.partnership_status} onChange={set("partnership_status")} />
				<Input label="Partner since" type="date" value={form.partnership_since || ""} onChange={set("partnership_since")} />
				<SearchPick
					id="church-parent"
					label="Part of (parent church)"
					value={form.parent_partner_church}
					display={labels.parent}
					search={searchChurches}
					onChange={(v, r) => {
						setForm((f) => ({ ...f, parent_partner_church: v || "" }))
						setLabels((l) => ({ ...l, parent: r?.label }))
					}}
				/>
				<Checkbox className="sm:col-span-2" label="This church has branches" description="Groups (denominations, regions) can hold other churches beneath them." checked={Boolean(form.is_group)} onChange={(v) => setForm((f) => ({ ...f, is_group: v ? 1 : 0 }))} />
				<Input label="Senior pastor" value={form.senior_pastor} onChange={set("senior_pastor")} />
				<Input label="Contact person" value={form.contact_person} onChange={set("contact_person")} />
				<Input label="Phone" type="tel" value={form.phone} onChange={set("phone")} />
				<Input label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} />
				<Input label="Website" value={form.website} onChange={set("website")} placeholder="https://" />
				{canSeeSponsors ? (
					<SearchPick
						id="church-sponsor"
						label="Linked sponsor record"
						value={form.sponsor}
						display={labels.sponsor}
						search={searchSponsors}
						onChange={(v, r) => {
							setForm((f) => ({ ...f, sponsor: v || "" }))
							setLabels((l) => ({ ...l, sponsor: r?.label }))
						}}
					/>
				) : null}
				<Input label="County" value={form.county} onChange={set("county")} />
				<Input label="Town" value={form.town} onChange={set("town")} />
				<Textarea label="Address" rows={2} value={form.address} onChange={set("address")} className="sm:col-span-2" />
			</div>
		</Modal>
	)
}
