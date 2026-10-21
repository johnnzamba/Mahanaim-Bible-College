import { useEffect, useMemo, useState } from "react"
import { Mail, MessageSquare, Send, Smartphone, Users } from "lucide-react"
import { Alert, Button, Checkbox, Input, Modal, Textarea } from "@/shared/components/ui"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { useSession } from "@/shared/session"
import { OfferingSelect } from "./bits"
import { M, P, toHtml } from "./lib"

const DIRECT_ROLES = ["Communications Officer", "Registrar", "Admissions Officer", "Finance Officer", "Academic Dean"]
const CHANNELS = [
	{ id: "In-App", label: "Portal notification", icon: MessageSquare },
	{ id: "Email", label: "Email", icon: Mail },
	{ id: "SMS", label: "SMS", icon: Smartphone },
]

/**
 * Message every student in an offering (or a chosen few).
 * Direct messages need a DIRECT_ROLES role on the server; lecturers without one post a class
 * announcement instead, which reaches the same students on the chosen channels.
 */
export function MessageClassModal({ open, onClose, offering: given, title, students }) {
	const session = useSession()
	const invalidate = useInvalidate()
	const canDirect = session.hasRole(...DIRECT_ROLES)
	const [subject, setSubject] = useState("")
	const [body, setBody] = useState("")
	const [channels, setChannels] = useState(["In-App", "Email"])
	const [busy, setBusy] = useState(false)
	const [chosen, setChosen] = useState({ name: "", label: "" })
	const offering = given || chosen.name
	const picked = students?.length ? students : null

	useEffect(() => {
		if (open) {
			setSubject("")
			setBody("")
			setChannels(["In-App", "Email"])
			if (!given) setChosen({ name: "", label: "" })
		}
	}, [open])

	const reach = useApi(M.previewAudience, { audience: "Course Offering", course_offering: offering }, { enabled: open && Boolean(offering) })
	const r = reach.data
	const toggle = (id) => (on) => setChannels((c) => (on ? [...new Set([...c, id])] : c.filter((x) => x !== id)))
	const valid = offering && subject.trim() && body.trim() && channels.length
	const viaAnnouncement = !canDirect

	const reachLine = useMemo(() => {
		if (picked) return `${picked.length} selected student${picked.length === 1 ? "" : "s"}`
		if (!offering) return "Choose a class"
		if (!r) return "Whole class"
		return `Whole class · ${r.count} student${r.count === 1 ? "" : "s"}`
	}, [picked, r, offering])

	const send = async () => {
		if (!valid) return
		setBusy(true)
		try {
			if (!viaAnnouncement) {
				const recipients = (picked || []).map((s) => ({ student: s.student }))
				if (!recipients.length) {
					const ov = await frappe.call(M.overview, { offering })
					for (const s of ov?.roster || []) recipients.push({ student: s.student })
				}
				const res = await frappe.call(M.sendDirect, { recipients, subject: subject.trim(), message: toHtml(body.trim()), channels })
				toast.success(res?.queued ? `Queued for ${res.recipients} students` : `Sent to ${res?.recipients ?? recipients.length} students`)
			} else {
				const doc = await frappe.call(M.saveAnnouncement, {
					data: {
						title: subject.trim(),
						audience: "Course Offering",
						course_offering: offering,
						body: toHtml(body.trim()),
						show_in_portal: channels.includes("In-App") ? 1 : 0,
						send_email: channels.includes("Email") ? 1 : 0,
						send_sms: channels.includes("SMS") ? 1 : 0,
					},
				})
				const res = await frappe.call(M.sendAnnouncementNow, { name: doc.name })
				toast.success(res?.queued ? "Queued for the class as an announcement" : "Sent to the class as an announcement")
			}
			invalidate(P.comm)
			onClose()
		} catch (e) {
			toast.error(e?.message || "Could not send the message")
		} finally {
			setBusy(false)
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Message the class"
			subtitle={title || chosen.label || undefined}
			footer={
				<>
					<Button variant="secondary" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
					<Button icon={Send} onClick={send} loading={busy} disabled={!valid}>
						Send
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{given ? null : (
					<OfferingSelect value={chosen.name} onChange={(name, o) => setChosen({ name, label: o ? `${o.course} · ${o.course_title}` : "" })} label="Class" />
				)}
				<div className="flex items-center gap-2 rounded-xl border border-line bg-cream/60 px-3 py-2 text-sm">
					<Users size={16} className="shrink-0 text-gold-700" />
					<span className="font-semibold text-ink">To:</span>
					<span className="min-w-0 truncate text-ink-muted">{reachLine}</span>
				</div>
				{viaAnnouncement && picked ? (
					<Alert tone="warning" title="This goes to the whole class">
						Messaging individual students isn't enabled for lecturers, so this is posted as a class announcement.
					</Alert>
				) : viaAnnouncement ? (
					<p className="text-xs text-ink-soft">Posted as a class announcement and delivered on the channels you pick.</p>
				) : null}
				<Input label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="e.g. Venue change for Thursday" />
				<Textarea label="Message" required rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />
				<fieldset>
					<legend className="label">Send via</legend>
					<div className="grid gap-2 sm:grid-cols-3">
						{CHANNELS.map((c) => (
							<div key={c.id} className="rounded-xl border border-line px-3 py-2.5">
								<Checkbox
									checked={channels.includes(c.id)}
									onChange={toggle(c.id)}
									label={
										<span className="inline-flex items-center gap-1.5">
											<c.icon size={14} className="text-ink-soft" /> {c.label}
										</span>
									}
									description={
										r && !picked
											? c.id === "Email"
												? `${r.reachable?.email ?? 0} reachable`
												: c.id === "SMS"
													? `${r.reachable?.sms ?? 0} reachable`
													: `${r.reachable?.in_app ?? 0} reachable`
											: undefined
									}
								/>
							</div>
						))}
					</div>
					{!channels.length ? <p className="mt-1 text-xs text-red-600">Pick at least one channel.</p> : null}
				</fieldset>
			</div>
		</Modal>
	)
}
