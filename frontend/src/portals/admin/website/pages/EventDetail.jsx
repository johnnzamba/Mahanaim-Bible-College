import { useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { CalendarDays, CheckCircle2, Download, ExternalLink, Save, Undo2, Users } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, Card, Checkbox, Drawer, Input, KeyValueGrid, PageHeader, Panel, ProgressBar, QueryState, Select, SkeletonRows, StatCard, Tabs, Textarea } from "@/shared/components/ui"
import { DataTable, Toolbar, useDebounced } from "@/shared/components/kit"
import { dateTime, money, num, time } from "@/shared/utils/format"
import { API, EVENT_STATUSES, EVENT_TYPES, ImageField, INVALIDATE, REG_STATUSES, WebTabs, fromLocal, toLocal, toneOf, useWebRoles } from "../components/common"
import { SearchPick, downloadText, useLookups } from "../components/kit"
import { htmlToText, textToHtml } from "../components/text"

const BLANK = {
	title: "",
	route: "",
	event_type: "Conference",
	status: "Upcoming",
	start_datetime: "",
	end_datetime: "",
	venue: "",
	campus: "",
	is_public: 1,
	partner_church: "",
	organiser: "",
	cover_image: "",
	livestream_url: "",
	summary: "",
	description: "",
	notices: "",
	registration_required: 0,
	capacity: "",
	registration_deadline: "",
	fee: "",
}
const DATETIME = ["start_datetime", "end_datetime", "registration_deadline"]

/** Mirrors TRANSITIONS in event_registration.py. */
const NEXT = {
	Registered: ["Confirmed", "Attended", "Cancelled", "Waitlisted"],
	Confirmed: ["Attended", "Cancelled", "Registered"],
	Waitlisted: ["Registered", "Confirmed", "Cancelled"],
	Attended: ["Confirmed"],
	Cancelled: ["Registered"],
}

const searchChurches = (q) =>
	frappe
		.call("frappe.client.get_list", { doctype: "Partner Church", fields: ["name", "church_name", "town"], or_filters: [["church_name", "like", `%${q}%`], ["town", "like", `%${q}%`]], limit_page_length: 10 })
		.then((rows) => rows.map((c) => ({ value: c.name, label: c.church_name, description: c.town })))

export default function EventDetail() {
	const { name } = useParams()
	const isNew = name === "new"
	const { canEvents } = useWebRoles()
	const q = useApi(`${API}get_event`, { name }, { enabled: !isNew && canEvents })
	if (!canEvents) {
		return (
			<>
				<WebTabs />
				<PageHeader back={{ to: "/admin/website/events", label: "Events" }} title="Event" />
				<Alert tone="warning" title="Events are managed by the communications office and the chaplaincy" />
			</>
		)
	}
	return isNew ? <EventPage doc={null} /> : <QueryState query={q} skeleton={<SkeletonRows rows={10} />}>{(doc) => <EventPage doc={doc} />}</QueryState>
}

function EventPage({ doc }) {
	const [params, setParams] = useSearchParams()
	const tab = doc ? params.get("tab") || "details" : "details"
	const setTab = (t) => setParams((p) => {
		const n = new URLSearchParams(p)
		if (t === "details") n.delete("tab")
		else n.set("tab", t)
		return n
	}, { replace: true })
	return (
		<>
			<WebTabs />
			<PageHeader
				back={{ to: "/admin/website/events", label: "Events" }}
				title={doc ? doc.title : "New event"}
				subtitle={doc ? `${doc.event_type} · ${dateTime(doc.start_datetime)}${doc.venue ? ` · ${doc.venue}` : ""}` : "Publish an event on the website and take registrations."}
				actions={
					doc?.route && doc.is_public && doc.status !== "Draft" ? (
						<a href={`/events/${doc.route}`} target="_blank" rel="noreferrer" className="btn btn-secondary">
							<ExternalLink size={16} /> View on site
						</a>
					) : null
				}
			>
				{doc ? (
					<div className="mt-2 flex flex-wrap gap-2">
						<Badge status={doc.status} tone={toneOf(doc.status)} />
						{doc.is_public ? null : <Badge tone="gray">Staff only</Badge>}
						{doc.registration?.required ? <Badge tone={doc.registration.open ? "green" : "gray"}>{doc.registration.open ? (doc.registration.waitlist ? "Waiting list open" : "Registration open") : "Registration closed"}</Badge> : null}
					</div>
				) : null}
			</PageHeader>
			{doc ? (
				<Tabs
					className="mb-5"
					active={tab}
					onChange={setTab}
					tabs={[
						{ id: "details", label: "Details" },
						{ id: "registrations", label: "Registrations", count: doc.registration_required ? doc.registered_count : undefined },
					]}
				/>
			) : null}
			{tab === "registrations" ? <Registrations event={doc} /> : <EventForm doc={doc} />}
		</>
	)
}

function EventForm({ doc }) {
	const nav = useNavigate()
	const qc = useQueryClient()
	const lookups = useLookups()
	const [form, setForm] = useState(BLANK)
	const [raw, setRaw] = useState(false)
	const [churchLabel, setChurchLabel] = useState("")
	const [errors, setErrors] = useState({})
	const [dirty, setDirty] = useState(false)
	const [saving, setSaving] = useState(false)
	const [seen, setSeen] = useState(undefined)
	if (doc !== seen) {
		setSeen(doc)
		const f = { ...BLANK }
		for (const k of Object.keys(BLANK)) if (doc?.[k] != null) f[k] = doc[k]
		for (const k of DATETIME) f[k] = toLocal(doc?.[k])
		const t = htmlToText(doc?.description)
		f.description = t.text
		setRaw(t.html)
		setForm(f)
		setChurchLabel(doc?.partner_church || "")
		setErrors({})
		setDirty(false)
	}
	const set = (k) => (e) => {
		const v = e?.target ? e.target.value : e
		setForm((f) => ({ ...f, [k]: v }))
		setDirty(true)
	}
	const flag = (k) => (v) => set(k)(v ? 1 : 0)
	const save = async () => {
		const errs = {}
		if (!form.title.trim()) errs.title = "Give the event a title"
		if (!form.start_datetime) errs.start_datetime = "When does it start?"
		if (form.end_datetime && form.start_datetime && form.end_datetime <= form.start_datetime) errs.end_datetime = "Must be after the start"
		if (form.registration_deadline && form.end_datetime && form.registration_deadline > form.end_datetime) errs.registration_deadline = "Can't be after the event ends"
		if (Number(form.capacity) < 0) errs.capacity = "Can't be negative"
		if (Number(form.fee) < 0) errs.fee = "Can't be negative"
		if (doc && Number(form.capacity) && Number(form.capacity) < Number(doc.registered_count || 0)) errs.capacity = `${doc.registered_count} seats are already taken`
		setErrors(errs)
		if (Object.keys(errs).length) return toast.error(Object.values(errs)[0])
		setSaving(true)
		try {
			const data = { ...(doc ? { name: doc.name } : {}) }
			for (const [k, v] of Object.entries(form)) data[k] = v === "" ? null : v
			for (const k of DATETIME) data[k] = fromLocal(form[k])
			data.description = form.description ? (raw ? form.description : textToHtml(form.description)) : null
			data.capacity = form.registration_required ? Number(form.capacity) || 0 : Number(form.capacity) || 0
			data.fee = Number(form.fee) || 0
			if (!doc) delete data.route
			const saved = await frappe.call(`${API}save_event`, { data })
			setDirty(false)
			qc.invalidateQueries({ predicate: (qq) => typeof qq.queryKey[0] === "string" && qq.queryKey[0].startsWith(API) })
			toast.success(doc ? "Event saved" : "Event created")
			if (!doc) nav(`/admin/website/events/${encodeURIComponent(saved.name)}`, { replace: true })
		} catch (e) {
			toast.error(e?.message || "Couldn't save")
		} finally {
			setSaving(false)
		}
	}
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))
	return (
		<>
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<div className="min-w-0 space-y-4">
					<Card className="p-5">
						<div className="grid gap-4 sm:grid-cols-2">
							<Input label="Title" required className="sm:col-span-2" value={form.title} onChange={set("title")} error={errors.title} maxLength={140} />
							<Select label="Type" options={EVENT_TYPES} value={form.event_type} onChange={set("event_type")} />
							<Select label="Status" options={EVENT_STATUSES} value={form.status} onChange={set("status")} hint={form.status === "Cancelled" && doc?.status !== "Cancelled" ? "Everyone registered is told the event is off." : "Upcoming, Ongoing and Completed follow the dates."} />
							<Input label="Starts" type="datetime-local" required value={form.start_datetime} onChange={set("start_datetime")} error={errors.start_datetime} />
							<Input label="Ends" type="datetime-local" value={form.end_datetime} onChange={set("end_datetime")} error={errors.end_datetime} hint="Blank = a few hours after the start." />
							<Input label="Venue" value={form.venue || ""} onChange={set("venue")} />
							<Select label="Campus" placeholder="Not on a campus" options={campuses} value={form.campus || ""} onChange={set("campus")} />
							<Input label="Organiser" value={form.organiser || ""} onChange={set("organiser")} />
							<SearchPick
								id="event-church"
								label="Partner church"
								value={form.partner_church}
								display={churchLabel}
								search={searchChurches}
								onChange={(v, r) => {
									set("partner_church")(v || "")
									setChurchLabel(r?.label || "")
								}}
								hint="If hosted with a partner church."
							/>
						</div>
					</Card>
					<Card className="space-y-4 p-5">
						<Textarea label="Summary" rows={2} maxLength={300} value={form.summary || ""} onChange={set("summary")} hint="One or two lines for event cards." />
						<Textarea label="Description" rows={10} value={form.description || ""} onChange={set("description")} hint={raw ? "Shown as HTML because it has rich formatting." : "Leave a blank line between paragraphs."} />
						<Textarea label="Notices" rows={3} value={form.notices || ""} onChange={set("notices")} hint="What to bring, dress code, parking…" />
						<Input label="Livestream link" type="url" value={form.livestream_url || ""} onChange={set("livestream_url")} placeholder="https://youtube.com/…" />
					</Card>
				</div>
				<div className="space-y-4">
					<Panel title="Registration" icon={Users}>
						<div className="space-y-3">
							<Checkbox checked={Boolean(form.is_public)} onChange={flag("is_public")} label="Show on the public website" />
							<Checkbox checked={Boolean(form.registration_required)} onChange={flag("registration_required")} label="People must register" description="Collects names and contacts, and fees if any." />
							{form.registration_required ? (
								<>
									<Input label="Capacity" type="number" min={0} value={form.capacity ?? ""} onChange={set("capacity")} error={errors.capacity} hint="0 or blank = unlimited. Extra people join a waiting list." />
									<Input label="Registration closes" type="datetime-local" value={form.registration_deadline || ""} onChange={set("registration_deadline")} error={errors.registration_deadline} />
									<Input label="Fee (KES)" type="number" min={0} step="1" value={form.fee ?? ""} onChange={set("fee")} error={errors.fee} hint="Paid by M-Pesa when registering. 0 = free." />
								</>
							) : null}
							{doc?.registration_required ? (
								<div className="rounded-xl bg-cream/70 p-3 text-sm">
									<div className="flex justify-between">
										<span>Registered</span>
										<b>
											{num(doc.registered_count)}
											{doc.capacity ? ` / ${num(doc.capacity)}` : ""}
										</b>
									</div>
									{doc.capacity ? <ProgressBar className="mt-1.5" size="sm" value={(doc.registered_count / doc.capacity) * 100} /> : null}
									<div className="mt-1.5 flex justify-between text-ink-soft">
										<span>Checked in</span>
										<span>{num(doc.attended_count)}</span>
									</div>
								</div>
							) : null}
						</div>
					</Panel>
					<Panel title="Cover image">
						<ImageField value={form.cover_image} onChange={set("cover_image")} meta={doc ? { doctype: "Campus Event", docname: doc.name, fieldname: "cover_image" } : null} />
					</Panel>
				</div>
			</div>
			<div className="sticky bottom-4 z-20 mt-5 flex justify-end">
				<div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lift">
					{dirty ? <span className="text-sm text-amber-700">Unsaved changes</span> : <span className="text-sm text-ink-soft">{doc ? "All changes saved" : "Not saved yet"}</span>}
					<Button icon={Save} loading={saving} disabled={Boolean(doc) && !dirty} onClick={save}>
						{doc ? "Save event" : "Create event"}
					</Button>
				</div>
			</div>
		</>
	)
}

function Registrations({ event }) {
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [open, setOpen] = useState(null)
	const ds = useDebounced(search)
	const q = useApi(`${API}event_registrations`, { event: event.name, search: ds || undefined })
	const rows = useMemo(() => (q.data?.data || []).filter((r) => !status || r.status === status), [q.data, status])
	const summary = q.data?.summary || {}
	const checkIn = useAction(`${API}check_in`, { invalidate: INVALIDATE, success: (r) => (r.status === "Attended" ? `${r.full_name} checked in` : `Check-in undone for ${r.full_name}`) })
	const setStatusAction = useAction(`${API}set_registration_status`, { invalidate: INVALIDATE, success: (r) => `${r.full_name} is now ${r.status}`, onSuccess: () => setOpen(null) })
	const exportCsv = async () => {
		try {
			const r = await frappe.call(`${API}export_registrations`, { event: event.name })
			downloadText(r.filename, r.content, r.mimetype)
			toast.success(`Exported ${num(r.rows)} registrations`)
		} catch (e) {
			toast.error(e?.message || "Export failed")
		}
	}
	const people = (s) => summary[s]?.people || 0
	const seated = people("Registered") + people("Confirmed") + people("Attended")
	const attended = people("Attended")
	const cols = [
		{
			key: "full_name",
			label: "Guest",
			render: (r) => (
				<span className="block min-w-0">
					<span className="block truncate font-semibold text-ink">{r.full_name}</span>
					<span className="block truncate text-xs text-ink-soft">{[r.email, r.phone].filter(Boolean).join(" · ")}</span>
				</span>
			),
		},
		{ key: "attendees", label: "People", align: "right", render: (r) => num(r.attendees) },
		{ key: "church", label: "Church", hideOnMobile: true, render: (r) => r.church || "—" },
		{
			key: "payment_status",
			label: "Payment",
			hideOnMobile: true,
			render: (r) => (r.payment_status && r.payment_status !== "Not Required" ? <Badge status={r.payment_status} tone={toneOf(r.payment_status)} size="xs">{`${r.payment_status}${Number(r.amount) ? ` · ${money(r.amount)}` : ""}`}</Badge> : <span className="text-ink-soft">—</span>),
		},
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" /> },
		{
			key: "action",
			label: "",
			align: "right",
			export: false,
			render: (r) =>
				r.status === "Attended" ? (
					<span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
						<span className="hidden text-xs text-emerald-700 sm:inline">{time(r.checked_in_on)}</span>
						<Button size="sm" variant="ghost" icon={Undo2} data-undo={r.name} loading={checkIn.isPending && checkIn.variables?.registration === r.name} onClick={() => checkIn.mutate({ registration: r.name, undo: 1 })}>
							Undo
						</Button>
					</span>
				) : r.status === "Registered" || r.status === "Confirmed" ? (
					<span onClick={(e) => e.stopPropagation()}>
						<Button size="sm" icon={CheckCircle2} data-checkin={r.name} loading={checkIn.isPending && checkIn.variables?.registration === r.name} onClick={() => checkIn.mutate({ registration: r.name })}>
							Check in
						</Button>
					</span>
				) : null,
		},
	]
	return (
		<>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Holding a seat" value={num(seated)} icon={Users} tone="brand" hint={event.capacity ? `of ${num(event.capacity)} seats` : "No limit"} />
				<StatCard label="Checked in" value={num(attended)} icon={CheckCircle2} tone="green" hint={seated ? `${Math.round((attended / seated) * 100)}% of expected` : null} />
				<StatCard label="Waiting list" value={num(people("Waitlisted"))} icon={CalendarDays} tone="orange" hint={`${num(summary.Waitlisted?.registrations || 0)} registrations`} />
				<StatCard label="Cancelled" value={num(summary.Cancelled?.registrations || 0)} icon={Undo2} tone="gray" />
			</div>
			{!event.registration_required ? (
				<Alert tone="info" className="mb-4">
					This event doesn't take registrations. Turn on "People must register" in Details to open it.
				</Alert>
			) : null}
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name, email, phone or reference…"
				chips={[{ id: "", label: "All", count: q.data?.total }, ...REG_STATUSES.map((s) => ({ id: s, label: s, count: summary[s]?.registrations || 0 }))]}
				active={status}
				onChip={setStatus}
				right={
					<Button variant="secondary" icon={Download} onClick={exportCsv}>
						Export CSV
					</Button>
				}
			/>
			<DataTable
				cols={cols}
				rows={q.data ? rows : undefined}
				query={q}
				onRow={setOpen}
				empty={ds || status ? "No registrations match" : "No one has registered yet"}
				emptyIcon={Users}
				pageSize={50}
			/>
			<Drawer
				open={Boolean(open)}
				onClose={() => setOpen(null)}
				title={open?.full_name}
				subtitle={open ? `${open.name} · registered ${dateTime(open.creation)}` : ""}
				footer={
					open ? (
						<div className="flex flex-wrap gap-2">
							{(NEXT[open.status] || []).map((s) => (
								<Button key={s} size="sm" variant={s === "Cancelled" ? "danger" : s === "Attended" ? "primary" : "secondary"} loading={setStatusAction.isPending && setStatusAction.variables?.status === s} onClick={() => setStatusAction.mutate({ registration: open.name, status: s })}>
									{s === "Attended" ? "Check in" : `Mark ${s.toLowerCase()}`}
								</Button>
							))}
						</div>
					) : null
				}
			>
				{open ? (
					<div className="space-y-5">
						<KeyValueGrid
							cols={2}
							items={[
								{ label: "Status", value: <Badge status={open.status} tone={toneOf(open.status)} size="xs" /> },
								{ label: "People", value: num(open.attendees) },
								{ label: "Email", value: open.email || "—" },
								{ label: "Phone", value: open.phone || "—" },
								{ label: "Church", value: open.church || "—" },
								{ label: "Student", value: open.student || "—" },
								{ label: "Payment", value: open.payment_status ? `${open.payment_status}${Number(open.amount) ? ` · ${money(open.amount)}` : ""}` : "—" },
								{ label: "M-Pesa ref", value: open.payment_reference || "—" },
								{ label: "Checked in", value: open.checked_in_on ? dateTime(open.checked_in_on) : "—" },
							]}
						/>
						<Answers raw={open.answers} />
					</div>
				) : null}
			</Drawer>
		</>
	)
}

function Answers({ raw }) {
	if (!raw) return null
	let parsed = null
	try {
		parsed = JSON.parse(raw)
	} catch {
		parsed = null
	}
	return (
		<div>
			<div className="label mb-1.5">Answers</div>
			{parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (
				<KeyValueGrid className="sm:!grid-cols-1" items={Object.entries(parsed).map(([k, v]) => ({ label: k, value: String(v ?? "—") }))} />
			) : Array.isArray(parsed) ? (
				<KeyValueGrid className="sm:!grid-cols-1" items={parsed.map((a, i) => ({ label: a.question || a.label || `Answer ${i + 1}`, value: String(a.answer ?? a.value ?? "—") }))} />
			) : (
				<p className="whitespace-pre-wrap rounded-xl bg-cream p-3 text-sm text-ink">{String(raw)}</p>
			)}
		</div>
	)
}
