import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { CalendarClock, Pencil, Plus, Trash2, UsersRound } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Badge, Button, Card, Drawer, Empty, Input, KeyValueGrid, Modal, PageHeader, QueryState, Select, SkeletonRows, Switch, Textarea } from "@/shared/components/ui"
import { Toolbar, useDebounced } from "@/shared/components/kit"
import { date, num, time } from "@/shared/utils/format"
import { API, ChurchTabs, GROUP_TYPES, INVALIDATE, MEMBER_ROLES, RoleGate, searchStaff, searchStudents, useChurchRoles, WEEKDAYS } from "../components/common"
import { nullify, SearchPick, today, useLookups, usePaged } from "../components/kit"

const CHIPS = [
	{ id: "1", label: "Active" },
	{ id: "0", label: "Inactive" },
	{ id: "", label: "All" },
]

export default function MinistryGroups() {
	return (
		<RoleGate need="chapel" title="Ministry groups">
			<MinistryGroupsPage />
		</RoleGate>
	)
}

function MinistryGroupsPage() {
	const { isChaplain } = useChurchRoles()
	const lookups = useLookups()
	const [params, setParams] = useSearchParams()
	const [search, setSearch] = useState("")
	const [active, setActive] = useState("1")
	const [type, setType] = useState("")
	const [campus, setCampus] = useState("")
	const [editing, setEditing] = useState(null)
	const ds = useDebounced(search)
	const { query, rows, total, pager } = usePaged(`${API}list_ministry_groups`, { search: ds, is_active: active, group_type: type, campus }, 24)
	const open = params.get("group")
	const setOpen = (name) => {
		const next = new URLSearchParams(params)
		if (name) next.set("group", name)
		else next.delete("group")
		setParams(next, { replace: true })
	}
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))
	return (
		<>
			<ChurchTabs />
			<PageHeader
				title="Ministry groups"
				subtitle="Fellowships, choirs, prayer and mission teams where students serve, with their leaders and patrons."
				actions={
					isChaplain ? (
						<Button icon={Plus} onClick={() => setEditing({})}>
							New group
						</Button>
					) : null
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search groups…"
				chips={CHIPS}
				active={active}
				onChip={setActive}
				right={
					<div className="flex flex-wrap items-center gap-2">
						<Select aria-label="Group type" className="w-40" placeholder="All types" options={GROUP_TYPES} value={type} onChange={(e) => setType(e.target.value)} />
						<Select aria-label="Campus" className="w-44" placeholder="All campuses" options={campuses} value={campus} onChange={(e) => setCampus(e.target.value)} />
					</div>
				}
			/>
			<QueryState
				query={query}
				skeleton={<SkeletonRows rows={6} />}
				isEmpty={() => !rows.length}
				empty={
					<Card>
						<Empty
							icon={UsersRound}
							title={ds || type || campus ? "No groups match these filters" : "No ministry groups yet"}
							subtitle={isChaplain ? "Create the fellowships and teams students join." : null}
						/>
					</Card>
				}
			>
				{() => (
					<>
						<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{rows.map((g) => (
								<Card key={g.name} interactive as="button" type="button" className="p-4 text-left" onClick={() => setOpen(g.name)}>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<div className="truncate font-semibold text-ink">{g.group_name}</div>
											<div className="truncate text-xs text-ink-soft">{[g.group_type, g.campus].filter(Boolean).join(" · ")}</div>
										</div>
										{g.is_active ? <Badge tone="green" size="xs">Active</Badge> : <Badge tone="gray" size="xs">Inactive</Badge>}
									</div>
									<div className="mt-3 grid grid-cols-3 gap-2 text-xs">
										<div>
											<div className="text-ink-soft">Members</div>
											<div className="text-base font-bold text-ink">{num(g.members)}</div>
										</div>
										<div className="col-span-2 min-w-0">
											<div className="text-ink-soft">Leader</div>
											<div className="truncate font-medium text-ink">{g.leader_name || "—"}</div>
										</div>
									</div>
									<div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2.5 text-xs text-ink-soft">
										<CalendarClock size={13} />
										{g.meeting_day ? `${g.meeting_day}s${g.meeting_time ? ` at ${time(g.meeting_time)}` : ""}` : "No regular meeting"}
										{g.patron_name ? <span className="ml-auto truncate">Patron: {g.patron_name}</span> : null}
									</div>
								</Card>
							))}
						</div>
						<div className="mt-3 flex items-center justify-between text-xs text-ink-soft">
							<span>{num(total)} groups</span>
							{pager}
						</div>
					</>
				)}
			</QueryState>
			<GroupDrawer name={open} onClose={() => setOpen(null)} onEdit={isChaplain ? setEditing : null} />
			<GroupForm initial={editing} onClose={() => setEditing(null)} onSaved={(doc) => setOpen(doc.name)} />
		</>
	)
}

function GroupDrawer({ name, onClose, onEdit }) {
	const q = useApi(`${API}get_ministry_group`, { name }, { enabled: Boolean(name) })
	const g = q.data
	return (
		<Drawer
			open={Boolean(name)}
			onClose={onClose}
			title={g?.group_name || "Ministry group"}
			subtitle={g ? [g.group_type, g.campus].filter(Boolean).join(" · ") : name}
			footer={
				onEdit && g ? (
					<Button icon={Pencil} onClick={() => onEdit(g)}>
						Edit group
					</Button>
				) : null
			}
		>
			<QueryState query={q}>
				{(d) => (
					<div className="space-y-5">
						<KeyValueGrid
							items={[
								{ label: "Status", value: d.is_active ? <Badge tone="green" size="xs">Active</Badge> : <Badge tone="gray" size="xs">Inactive</Badge> },
								{ label: "Meets", value: d.meeting_day ? `${d.meeting_day}s${d.meeting_time ? `, ${time(d.meeting_time)}` : ""}` : "—" },
								{ label: "Patron", value: d.patron || "—" },
								{
									label: "Leader",
									value: d.leader ? (
										<Link className="text-brand-700 hover:underline" to={`/admin/students/${encodeURIComponent(d.leader)}`}>
											{(d.members || []).find((m) => m.student === d.leader)?.student_name || d.leader}
										</Link>
									) : (
										"—"
									),
								},
								{ label: "About", value: d.description || "—", wide: true },
							]}
						/>
						<div>
							<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Members ({num(d.members?.length)})</h3>
							{d.members?.length ? (
								<ul className="divide-y divide-line rounded-xl border border-line">
									{d.members.map((m) => (
										<li key={m.name || m.student} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
											<span className="min-w-0">
												<Link to={`/admin/students/${encodeURIComponent(m.student)}`} className="block truncate font-medium text-ink hover:text-brand-700">
													{m.student_name || m.student}
												</Link>
												<span className="block text-xs text-ink-soft">{m.joined_on ? `Joined ${date(m.joined_on)}` : m.student}</span>
											</span>
											<Badge tone={m.role === "Member" ? "gray" : "purple"} size="xs">
												{m.role || "Member"}
											</Badge>
										</li>
									))}
								</ul>
							) : (
								<Empty compact icon={UsersRound} title="No members yet" />
							)}
						</div>
					</div>
				)}
			</QueryState>
		</Drawer>
	)
}

const BLANK = { group_name: "", group_type: "Fellowship", campus: "", is_active: 1, patron: "", leader: "", meeting_day: "", meeting_time: "", description: "" }

function GroupForm({ initial, onClose, onSaved }) {
	const lookups = useLookups()
	const [form, setForm] = useState(BLANK)
	const [members, setMembers] = useState([])
	const [patronLabel, setPatronLabel] = useState("")
	const [error, setError] = useState("")
	const [seen, setSeen] = useState(null)
	if (initial !== seen) {
		setSeen(initial)
		const f = { ...BLANK }
		for (const k of Object.keys(BLANK)) if (initial?.[k] != null) f[k] = initial[k]
		f.meeting_time = (f.meeting_time || "").slice(0, 5)
		setForm(f)
		setMembers((initial?.members || []).map((m) => ({ student: m.student, student_name: m.student_name, role: m.role || "Member", joined_on: m.joined_on || "" })))
		setPatronLabel(initial?.patron || "")
		setError("")
	}
	const isNew = !initial?.name
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = useAction(`${API}save_ministry_group`, {
		invalidate: INVALIDATE,
		success: "Ministry group saved",
		onSuccess: (doc) => {
			onClose()
			onSaved?.(doc)
		},
	})
	const setMember = (student, patch) => setMembers((ms) => ms.map((m) => (m.student === student ? { ...m, ...patch } : m)))
	const submit = () => {
		if (!form.group_name.trim()) return setError("Enter the group's name")
		const leader = members.find((m) => m.role === "Leader")?.student || (members.some((m) => m.student === form.leader) ? form.leader : "")
		save.mutate({
			data: {
				...nullify({ ...form, leader, meeting_time: form.meeting_time ? `${form.meeting_time}:00` : "", ...(isNew ? {} : { name: initial.name }) }),
				is_active: form.is_active ? 1 : 0,
				members: members.map((m) => ({ student: m.student, role: m.role, joined_on: m.joined_on || null })),
			},
		})
	}
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))
	return (
		<Modal
			open={Boolean(initial)}
			onClose={onClose}
			size="lg"
			title={isNew ? "New ministry group" : `Edit ${initial.group_name}`}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={save.isPending} onClick={submit}>
						Save group
					</Button>
				</>
			}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Group name" required value={form.group_name} onChange={set("group_name")} error={error} disabled={!isNew} hint={isNew ? null : "The name can't be changed."} />
				<Select label="Type" options={GROUP_TYPES} value={form.group_type} onChange={set("group_type")} />
				<Select label="Campus" placeholder="All campuses" options={campuses} value={form.campus} onChange={set("campus")} />
				<SearchPick
					id="group-patron"
					label="Staff patron"
					value={form.patron}
					display={patronLabel}
					search={searchStaff}
					onChange={(v, r) => {
						setForm((f) => ({ ...f, patron: v || "" }))
						setPatronLabel(r?.label || "")
					}}
				/>
				<Select label="Meets on" placeholder="No regular day" options={WEEKDAYS} value={form.meeting_day} onChange={set("meeting_day")} />
				<Input label="Time" type="time" value={form.meeting_time} onChange={set("meeting_time")} />
				<Textarea label="About the group" rows={2} value={form.description} onChange={set("description")} className="sm:col-span-2" />
				<Switch className="sm:col-span-2" checked={Boolean(form.is_active)} onChange={(v) => setForm((f) => ({ ...f, is_active: v ? 1 : 0 }))} label="Active" description="Inactive groups are kept for history." />
			</div>
			<div className="mt-6">
				<div className="mb-2 flex items-end justify-between gap-3">
					<h3 className="text-sm font-semibold text-ink">Members ({num(members.length)})</h3>
					<span className="text-xs text-ink-soft">Give one member the Leader role to make them the group leader.</span>
				</div>
				<SearchPick
					id="group-add-member"
					label="Add a member"
					value=""
					search={searchStudents}
					placeholder="Name or student number…"
					onChange={(v, r) => {
						if (!v || members.some((m) => m.student === v)) return
						setMembers((ms) => [...ms, { student: v, student_name: r?.label, role: "Member", joined_on: today() }])
					}}
				/>
				{members.length ? (
					<ul className="mt-3 divide-y divide-line rounded-xl border border-line">
						{members.map((m) => (
							<li key={m.student} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_10rem_9.5rem_auto]">
								<span className="min-w-0">
									<span className="block truncate text-sm font-medium text-ink">{m.student_name || m.student}</span>
									<span className="block text-xs text-ink-soft">{m.student}</span>
								</span>
								<button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-cream hover:text-red-600 sm:order-last" aria-label={`Remove ${m.student_name || m.student}`} onClick={() => setMembers((ms) => ms.filter((x) => x.student !== m.student))}>
									<Trash2 size={15} />
								</button>
								<Select aria-label="Role" options={MEMBER_ROLES} value={m.role} onChange={(e) => setMember(m.student, { role: e.target.value })} />
								<Input aria-label="Joined on" type="date" value={m.joined_on} onChange={(e) => setMember(m.student, { joined_on: e.target.value })} />
							</li>
						))}
					</ul>
				) : (
					<p className="mt-3 text-sm text-ink-soft">No members yet.</p>
				)}
			</div>
		</Modal>
	)
}
