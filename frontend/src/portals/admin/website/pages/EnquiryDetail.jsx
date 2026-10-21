import { useState } from "react"
import { useParams } from "react-router-dom"
import { CheckCircle2, Mail, MessageCircle, Phone, Send, StickyNote, UserCheck, UserMinus } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { Alert, Avatar, Badge, Button, Card, Html, KeyValueGrid, PageHeader, Panel, QueryState, Select, SkeletonRows, Textarea } from "@/shared/components/ui"
import { ago, dateTime } from "@/shared/utils/format"
import { API, INVALIDATE, WebTabs, toneOf, useWebRoles } from "../components/common"
import { SearchPick } from "../components/kit"

/** Mirrors TRANSITIONS in contact_enquiry.py (Responded is reached by sending a response). */
const NEXT = {
	New: ["In Progress", "Closed"],
	"In Progress": ["Closed", "New"],
	Responded: ["Closed", "In Progress"],
	Closed: ["In Progress"],
}

const searchStaffUsers = (q) =>
	frappe
		.call("frappe.client.get_list", {
			doctype: "Staff Member",
			fields: ["name", "full_name", "user", "designation"],
			filters: [["user", "is", "set"], ["status", "=", "Active"]],
			or_filters: [["full_name", "like", `%${q}%`], ["email", "like", `%${q}%`]],
			limit_page_length: 8,
		})
		.then((rows) => rows.map((s) => ({ value: s.user, label: s.full_name, description: [s.designation, s.user].filter(Boolean).join(" · ") })))

const whatsapp = (phone) => {
	const d = String(phone || "").replace(/\D/g, "")
	return d ? `https://wa.me/${d.startsWith("0") ? `254${d.slice(1)}` : d}` : null
}

export default function EnquiryDetail() {
	const { name } = useParams()
	const { canEnquiries } = useWebRoles()
	const q = useApi(`${API}get_enquiry`, { name }, { enabled: canEnquiries })
	if (!canEnquiries) {
		return (
			<>
				<WebTabs />
				<PageHeader back={{ to: "/admin/website/enquiries", label: "Enquiries" }} title="Enquiry" />
				<Alert tone="warning" title="Enquiries are handled by the communications and admissions offices" />
			</>
		)
	}
	return (
		<>
			<WebTabs />
			<QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
				{(e) => <Enquiry e={e} />}
			</QueryState>
		</>
	)
}

function Enquiry({ e }) {
	const { user } = useSession()
	const [response, setResponse] = useState("")
	const [note, setNote] = useState("")
	const [assignee, setAssignee] = useState("")
	const [seen, setSeen] = useState(undefined)
	if (e.name !== seen) {
		setSeen(e.name)
		setResponse("")
		setNote("")
		setAssignee("")
	}
	const update = useAction(`${API}update_enquiry`, { invalidate: INVALIDATE })
	const responded = e.status === "Responded" || Boolean(e.response)
	const send = () => {
		if (!response.trim()) return toast.error("Write your reply first")
		update.mutate({ name: e.name, response: response.trim(), status: "Responded", assign_to: e.assigned_to ? undefined : "me" }, {
			onSuccess: () => {
				setResponse("")
				toast.success(`Reply emailed to ${e.email}`)
			},
		})
	}
	const addNote = () => {
		if (!note.trim()) return
		update.mutate({ name: e.name, notes: note.trim() }, { onSuccess: () => {
			setNote("")
			toast.success("Note added")
		} })
	}
	const assign = (to, label) => update.mutate({ name: e.name, assign_to: to }, { onSuccess: () => toast.success(label) })
	const setStatus = (s) => update.mutate({ name: e.name, status: s }, { onSuccess: () => toast.success(`Marked ${s.toLowerCase()}`) })
	const wa = whatsapp(e.phone)

	return (
		<>
			<PageHeader
				back={{ to: "/admin/website/enquiries", label: "Enquiries" }}
				title={e.full_name}
				subtitle={`${e.subject} enquiry · ${e.name} · received ${dateTime(e.creation)}`}
				actions={
					<>
						{e.assigned_to === user ? (
							<Button variant="secondary" icon={UserMinus} loading={update.isPending && update.variables?.assign_to === ""} onClick={() => assign("", "Released")}>
								Release
							</Button>
						) : (
							<Button variant="secondary" icon={UserCheck} loading={update.isPending && update.variables?.assign_to === "me"} onClick={() => assign("me", "Assigned to you")}>
								Assign to me
							</Button>
						)}
						{e.status !== "Closed" ? (
							<Button variant="secondary" icon={CheckCircle2} onClick={() => setStatus("Closed")}>
								Close
							</Button>
						) : null}
					</>
				}
			>
				<div className="mt-2 flex flex-wrap gap-2">
					<Badge status={e.status} tone={toneOf(e.status)} />
					<Badge tone="gray">{e.assigned_to ? (e.assigned_to === user ? "With you" : `With ${e.assigned_to}`) : "Unassigned"}</Badge>
				</div>
			</PageHeader>
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="min-w-0 space-y-4">
					<Card className="p-5">
						<div className="mb-3 flex items-center gap-3">
							<Avatar name={e.full_name} size={40} />
							<div className="min-w-0">
								<div className="font-semibold text-ink">{e.full_name}</div>
								<div className="text-xs text-ink-soft">{ago(e.creation)}</div>
							</div>
						</div>
						<p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{e.message}</p>
					</Card>
					{e.response ? (
						<Card className="border-emerald-200 bg-emerald-50/40 p-5 dark:bg-emerald-950/20">
							<div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
								<Mail size={15} /> Reply sent to {e.email}
							</div>
							<p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{e.response}</p>
						</Card>
					) : null}
					{e.status !== "Responded" ? (
						<Panel title={responded ? "Send a follow-up" : "Reply"} icon={Send} subtitle={`Emailed to ${e.email}`}>
							{e.status === "Closed" ? (
								<Alert tone="info">This enquiry is closed. Re-open it (In progress) to reply again.</Alert>
							) : (
								<>
									<Textarea label="Your reply" rows={7} value={response} onChange={(ev) => setResponse(ev.target.value)} placeholder={`Dear ${e.full_name.split(" ")[0]},\n\nThank you for contacting us…`} />
									<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
										<span className="text-xs text-ink-soft">Sending marks the enquiry as responded{e.assigned_to ? "" : " and assigns it to you"}.</span>
										<Button icon={Send} loading={update.isPending && update.variables?.status === "Responded"} onClick={send}>
											Send reply
										</Button>
									</div>
								</>
							)}
						</Panel>
					) : (
						<Alert tone="success" title="Answered">
							To reply again, move it back to In progress.
						</Alert>
					)}
					<Panel title="Internal notes" icon={StickyNote} subtitle="Only staff see these.">
						{e.notes?.length ? (
							<ul className="mb-4 space-y-3">
								{e.notes.map((n) => (
									<li key={n.name} className="rounded-xl bg-cream/70 p-3">
										<Html html={n.content} className="text-sm" />
										<div className="mt-1 text-xs text-ink-soft">
											{n.comment_email} · {ago(n.creation)}
										</div>
									</li>
								))}
							</ul>
						) : (
							<p className="mb-3 text-sm text-ink-soft">No notes yet.</p>
						)}
						<Textarea label="Add a note" rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
						<div className="mt-2 flex justify-end">
							<Button variant="secondary" size="sm" icon={StickyNote} disabled={!note.trim()} loading={update.isPending && Boolean(update.variables?.notes)} onClick={addNote}>
								Add note
							</Button>
						</div>
					</Panel>
				</div>
				<div className="space-y-4">
					<Panel title="Contact">
						<KeyValueGrid
							cols={1}
							items={[
								{ label: "Email", value: <a className="break-all text-brand-700 hover:underline" href={`mailto:${e.email}`}>{e.email}</a> },
								{ label: "Phone", value: e.phone ? <a className="text-brand-700 hover:underline" href={`tel:${e.phone}`}>{e.phone}</a> : "—" },
							]}
						/>
						<div className="mt-3 flex flex-wrap gap-2">
							<a className="btn btn-sm btn-secondary" href={`mailto:${e.email}?subject=${encodeURIComponent(`Re: your ${e.subject.toLowerCase()} enquiry`)}`}>
								<Mail size={14} /> Email
							</a>
							{e.phone ? (
								<a className="btn btn-sm btn-secondary" href={`tel:${e.phone}`}>
									<Phone size={14} /> Call
								</a>
							) : null}
							{wa ? (
								<a className="btn btn-sm btn-secondary" href={wa} target="_blank" rel="noreferrer">
									<MessageCircle size={14} /> WhatsApp
								</a>
							) : null}
						</div>
					</Panel>
					<Panel title="Handling">
						<div className="space-y-3">
							<Select
								label="Status"
								value=""
								placeholder={`${e.status} (change…)`}
								options={NEXT[e.status] || []}
								onChange={(ev) => ev.target.value && setStatus(ev.target.value)}
							/>
							<SearchPick
								id="enq-assign"
								label="Assign to a colleague"
								value={assignee}
								display=""
								search={searchStaffUsers}
								onChange={(v, r) => {
									if (!v) return setAssignee("")
									setAssignee(v)
									assign(v, `Assigned to ${r?.label || v}`)
								}}
								hint="They get a portal notification."
							/>
							{e.assigned_to ? (
								<button type="button" className="text-xs font-semibold text-red-600 hover:underline" onClick={() => assign("", "Unassigned")}>
									Unassign
								</button>
							) : null}
						</div>
					</Panel>
				</div>
			</div>
		</>
	)
}
