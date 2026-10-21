import { useState } from "react"
import { Archive, ArchiveRestore, Bell, Mail, Megaphone, MessageSquare, Paperclip, Pin, Send, Smartphone, Trash2 } from "lucide-react"
import { Badge, Button, Card, ConfirmDialog, Empty, Html, IconButton, PageHeader, QueryState, SkeletonRows, Tabs } from "@/shared/components/ui"
import { DataTable, Toolbar } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { dateTime } from "@/shared/utils/format"
import { MessageClassModal } from "../components/MessageClassModal"
import { StatusBadge } from "../components/bits"
import { safeUrl } from "@/shared/utils/sanitize"
import { M, P, fileName, since, useMyOfferings } from "../components/lib"

const AUDIENCE = { Everyone: "Everyone", "All Staff": "All staff", Lecturers: "Lecturers", Campus: "Campus", Programme: "Programme", "All Students": "All students" }

function Feed() {
	const [limit, setLimit] = useState(20)
	const q = useApi(M.myAnnouncements, { limit }, { placeholderData: (p) => p })
	const [open, setOpen] = useState(null)
	return (
		<QueryState
			query={q}
			skeleton={
				<Card className="p-5">
					<SkeletonRows rows={4} />
				</Card>
			}
			isEmpty={(d) => !d?.data?.length}
			empty={
				<Card>
					<Empty icon={Bell} title="No announcements" subtitle="College and campus announcements addressed to staff appear here." />
				</Card>
			}
		>
			{(d) => (
				<div className="space-y-3">
					{d.data.map((a) => {
						const expanded = open === a.name
						return (
							<article key={a.name} className={`card p-4 sm:p-5 ${a.is_pinned ? "border-gold-300" : ""}`}>
								<div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
									{a.is_pinned ? (
										<Badge tone="gold" size="xs">
											<Pin size={11} /> Pinned
										</Badge>
									) : null}
									<span>{a.course_title || AUDIENCE[a.audience] || a.audience}</span>
									<span>·</span>
									<span title={dateTime(a.sent_on)}>{since(a.sent_on)}</span>
									{a.posted_by_name ? <span>· {a.posted_by_name}</span> : null}
								</div>
								<h3 className="mt-1.5 font-display text-lg font-semibold text-ink">{a.title}</h3>
								{expanded ? <Html html={a.body} className="mt-2 text-sm" /> : <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{a.summary}</p>}
								<div className="mt-3 flex flex-wrap items-center gap-3">
									{(a.summary || "").length >= 120 || a.body?.length > 300 ? (
										<button type="button" className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => setOpen(expanded ? null : a.name)} aria-expanded={expanded}>
											{expanded ? "Show less" : "Read more"}
										</button>
									) : null}
									{a.attachment ? (
										safeUrl(a.attachment) ? (
											<a href={safeUrl(a.attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
												<Paperclip size={14} /> {fileName(a.attachment)}
											</a>
										) : (
											<span className="inline-flex items-center gap-1 text-sm text-ink-soft">
												<Paperclip size={14} /> {fileName(a.attachment)}
											</span>
										)
									) : null}
								</div>
							</article>
						)
					})}
					{d.data.length >= limit ? (
						<div className="flex justify-center">
							<Button variant="secondary" size="sm" loading={q.isFetching} onClick={() => setLimit((l) => l + 20)}>
								Load more
							</Button>
						</div>
					) : null}
				</div>
			)}
		</QueryState>
	)
}

function Posted({ onCompose }) {
	const [status, setStatus] = useState("")
	const [search, setSearch] = useState("")
	const q = useApi(M.listAnnouncements, { status, search: search.trim() || undefined, page_length: 50 }, { placeholderData: (p) => p })
	const offerings = useMyOfferings("all")
	const titles = Object.fromEntries((offerings.data?.data || []).map((o) => [o.name, o.course_title]))
	const [confirm, setConfirm] = useState(null)
	const opts = { invalidate: [P.comm] }
	const send = useAction(M.sendAnnouncementNow, { ...opts, success: "Queued for delivery" })
	const archive = useAction(M.archiveAnnouncement, { ...opts, success: (r) => (r.status === "Archived" ? "Archived" : "Restored") })
	const remove = useAction(M.deleteAnnouncement, { ...opts, success: "Deleted", onSuccess: () => setConfirm(null) })
	const counts = q.data?.counts || {}
	const total = Object.values(counts).reduce((a, b) => a + b, 0)

	return (
		<div className="space-y-4">
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search your announcements…"
				chips={[
					{ id: "", label: "All", count: total },
					...["Sent", "Draft", "Scheduled", "Archived"].filter((s) => counts[s]).map((s) => ({ id: s, label: s, count: counts[s] })),
				]}
				active={status}
				onChip={setStatus}
			/>
			<DataTable
				query={q}
				rows={q.data?.data}
				empty={
					<Empty
						compact
						icon={Megaphone}
						title="Nothing posted yet"
						subtitle="Messages you send to a class are kept here."
						action={
							<Button size="sm" icon={Send} onClick={onCompose}>
								Message a class
							</Button>
						}
					/>
				}
				cols={[
					{
						key: "title",
						label: "Announcement",
						render: (a) => (
							<div className="min-w-0">
								<div className="flex items-center gap-1.5 font-semibold text-ink">
									{a.is_pinned ? <Pin size={12} className="shrink-0 text-gold-700" aria-label="Pinned" /> : null}
									<span className="truncate">{a.title}</span>
								</div>
								<div className="truncate text-xs text-ink-soft">{a.course_offering ? titles[a.course_offering] || a.course_offering : AUDIENCE[a.audience] || a.audience}</div>
							</div>
						),
					},
					{
						key: "channels",
						label: "Via",
						hideOnMobile: true,
						sortable: false,
						exportValue: (a) => [a.show_in_portal && "Portal", a.send_email && "Email", a.send_sms && "SMS"].filter(Boolean).join(" "),
						render: (a) => (
							<span className="inline-flex gap-1.5 text-ink-soft">
								{a.show_in_portal ? <MessageSquare size={14} aria-label="Portal" /> : null}
								{a.send_email ? <Mail size={14} aria-label="Email" /> : null}
								{a.send_sms ? <Smartphone size={14} aria-label="SMS" /> : null}
							</span>
						),
					},
					{ key: "recipients_count", label: "Reached", align: "right", hideOnMobile: true, render: (a) => (a.recipients_count ? a.recipients_count : "—") },
					{
						key: "sent_on",
						label: "When",
						sortValue: (a) => a.sent_on || a.modified,
						render: (a) => <span title={dateTime(a.sent_on || a.modified)}>{since(a.sent_on || a.modified)}</span>,
					},
					{ key: "status", label: "Status", render: (a) => <StatusBadge kind="announcement" status={a.status} /> },
					{
						key: "act",
						label: "",
						sortable: false,
						export: false,
						render: (a) => (
							<div className="flex justify-end gap-1">
								{["Draft", "Scheduled"].includes(a.status) ? (
									<Button size="sm" variant="secondary" icon={Send} loading={send.isPending && send.variables?.name === a.name} onClick={() => send.mutate({ name: a.name })}>
										Send
									</Button>
								) : null}
								{a.status === "Sent" ? <IconButton icon={Archive} label="Archive" onClick={() => archive.mutate({ name: a.name })} /> : null}
								{a.status === "Archived" ? <IconButton icon={ArchiveRestore} label="Restore" onClick={() => archive.mutate({ name: a.name, undo: 1 })} /> : null}
								{a.status !== "Sent" ? <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => setConfirm(a)} /> : null}
							</div>
						),
					},
				]}
			/>
			<p className="text-xs text-ink-soft">Sending is queued; the status changes to Sent once delivery starts.</p>
			<ConfirmDialog
				open={Boolean(confirm)}
				onClose={() => setConfirm(null)}
				title="Delete this announcement?"
				message={confirm ? `"${confirm.title}" will be removed.` : ""}
				confirmLabel="Delete"
				tone="danger"
				loading={remove.isPending}
				onConfirm={() => remove.mutate({ name: confirm.name })}
			/>
		</div>
	)
}

export default function Announcements() {
	const [tab, setTab] = useState("inbox")
	const [compose, setCompose] = useState(false)
	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Communication"
				title="Announcements"
				subtitle="News from the college, and messages you've sent to your classes."
				actions={
					<Button size="sm" icon={Send} onClick={() => setCompose(true)}>
						Message a class
					</Button>
				}
			/>
			<Tabs
				className="overflow-y-hidden pb-px"
				tabs={[
					{ id: "inbox", label: "For me" },
					{ id: "posted", label: "Sent by me" },
				]}
				active={tab}
				onChange={setTab}
			/>
			{tab === "inbox" ? <Feed /> : <Posted onCompose={() => setCompose(true)} />}
			<MessageClassModal open={compose} onClose={() => setCompose(false)} />
		</div>
	)
}
