import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Archive, ArchiveRestore, CalendarClock, Eye, Paperclip, Save, Send, Trash2, Users } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, FileDrop, Html, Input, Modal, PageHeader, Panel, QueryState, Select, SkeletonRows, Spinner, Switch, Tabs, Textarea } from "@/shared/components/ui"
import { useDebounced } from "@/shared/components/kit"
import { dateTime, num } from "@/shared/utils/format"
import { API, AUDIENCE_HINT, AUDIENCES, INVALIDATE, searchOfferings, toneOf, useCommsRoles } from "../components/common"
import { SearchPick, useLookups } from "../components/kit"
import { htmlToText, textToHtml } from "../components/text"
import { safeUrl } from "@/shared/utils/sanitize"

const BLANK = {
	title: "",
	audience: "All Students",
	programme: "",
	campus: "",
	course_offering: "",
	publish_on: "",
	expires_on: "",
	is_pinned: 0,
	show_in_portal: 1,
	send_email: 1,
	send_sms: 0,
	body: "",
	attachment: "",
}

const toLocal = (v) => (v ? String(v).slice(0, 16).replace(" ", "T") : "")
const fromLocal = (v) => (v ? `${v.replace("T", " ")}:00` : null)
const nowLocal = () => {
	const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
	return d.toISOString().slice(0, 16)
}

export default function AnnouncementEditor() {
	const { name } = useParams()
	const isNew = name === "new"
	const { canAnnounce } = useCommsRoles()
	const [queued, setQueued] = useState("")
	const q = useApi(`${API}get_announcement`, { name }, { enabled: !isNew && canAnnounce, refetchInterval: (qq) => (queued === name && qq.state.data?.status === "Draft" ? 4000 : false) })
	if (!canAnnounce) {
		return (
			<>
				<PageHeader back={{ to: "/admin/communication", label: "Announcements" }} title="Announcement" />
				<Alert tone="warning" title="Not available for your role">
					Announcements are posted by the communications office, registry, deans, finance, the chaplaincy and lecturers.
				</Alert>
			</>
		)
	}
	return (
		<>
			{isNew ? (
				<Composer doc={null} onQueued={setQueued} />
			) : (
				<QueryState query={q} skeleton={<SkeletonRows rows={10} />}>
					{(doc) => <Composer doc={doc} queued={queued === doc.name && doc.status === "Draft"} onQueued={setQueued} />}
				</QueryState>
			)}
		</>
	)
}

function Composer({ doc, queued = false, onQueued }) {
	const nav = useNavigate()
	const qc = useQueryClient()
	const lookups = useLookups()
	const [form, setForm] = useState(BLANK)
	const [rawHtml, setRawHtml] = useState(false)
	const [offeringLabel, setOfferingLabel] = useState("")
	const [errors, setErrors] = useState({})
	const [dirty, setDirty] = useState(false)
	const [tab, setTab] = useState("write")
	const [uploading, setUploading] = useState(false)
	const [scheduling, setScheduling] = useState(false)
	const [confirm, setConfirm] = useState(null)
	const [busy, setBusy] = useState("")
	const [seen, setSeen] = useState(undefined)
	if (doc !== seen) {
		setSeen(doc)
		const f = { ...BLANK }
		for (const k of Object.keys(BLANK)) if (doc?.[k] != null) f[k] = doc[k]
		const t = htmlToText(doc?.body)
		f.body = t.text
		f.publish_on = toLocal(doc?.publish_on)
		setForm(f)
		setRawHtml(t.html)
		setOfferingLabel(doc?.course_offering || "")
		setErrors({})
		setDirty(false)
	}
	const status = doc?.status || "Draft"
	const locked = status === "Sent" || status === "Archived"
	const set = (k) => (e) => {
		const v = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e
		setForm((f) => ({ ...f, [k]: v }))
		setDirty(true)
	}
	const flag = (k) => (v) => {
		setForm((f) => ({ ...f, [k]: v ? 1 : 0 }))
		setDirty(true)
	}

	const audienceArgs = { audience: form.audience, programme: form.audience === "Programme" ? form.programme : undefined, campus: form.audience === "Campus" ? form.campus : undefined, course_offering: form.audience === "Course Offering" ? form.course_offering : undefined }
	const dArgs = useDebounced(JSON.stringify(audienceArgs), 300)
	const needsTarget = { Programme: "programme", Campus: "campus", "Course Offering": "course_offering" }[form.audience]
	const preview = useApi(`${API}preview_audience`, JSON.parse(dArgs), { enabled: !needsTarget || Boolean(form[needsTarget]), staleTime: 30000 })

	const validate = () => {
		const errs = {}
		if (!form.title.trim()) errs.title = "Give the announcement a title"
		if (!form.body.trim()) errs.body = "Write the announcement"
		if (needsTarget && !form[needsTarget]) errs[needsTarget] = `Choose the ${needsTarget.replace("_", " ")}`
		if (!form.show_in_portal && !form.send_email && !form.send_sms) errs.channels = "Choose at least one way to deliver it"
		if (form.expires_on && form.expires_on <= (form.publish_on || nowLocal()).slice(0, 10)) errs.expires_on = "Must be after the publish date"
		setErrors(errs)
		if (Object.keys(errs).length) toast.error(Object.values(errs)[0])
		return !Object.keys(errs).length
	}
	const payload = () => ({
		...(doc?.name ? { name: doc.name } : {}),
		title: form.title.trim(),
		audience: form.audience,
		programme: form.audience === "Programme" ? form.programme : null,
		campus: form.audience === "Campus" ? form.campus : null,
		course_offering: form.audience === "Course Offering" ? form.course_offering : null,
		publish_on: fromLocal(form.publish_on),
		expires_on: form.expires_on || null,
		is_pinned: form.is_pinned ? 1 : 0,
		show_in_portal: form.show_in_portal ? 1 : 0,
		send_email: form.send_email ? 1 : 0,
		send_sms: form.send_sms ? 1 : 0,
		body: rawHtml ? form.body : textToHtml(form.body),
		attachment: form.attachment || null,
	})
	const refresh = () => qc.invalidateQueries({ predicate: (qq) => typeof qq.queryKey[0] === "string" && qq.queryKey[0].startsWith(API) })
	/** Save if needed; resolves to the saved name. */
	const persist = async () => {
		if (doc?.name && !dirty) return doc.name
		const saved = await frappe.call(`${API}save_announcement`, { data: payload() })
		setDirty(false)
		return saved.name
	}
	const run = async (label, fn) => {
		if (!validate()) return
		setBusy(label)
		try {
			await fn()
		} catch (e) {
			toast.error(e?.message || "Something went wrong")
		} finally {
			setBusy("")
			refresh()
		}
	}
	const saveDraft = () =>
		run("save", async () => {
			const n = await persist()
			toast.success("Saved")
			if (!doc?.name) nav(`/admin/communication/announcements/${encodeURIComponent(n)}`, { replace: true })
		})
	const sendNow = () =>
		run("send", async () => {
			const n = await persist()
			await frappe.call(`${API}send_announcement_now`, { name: n })
			setConfirm(null)
			onQueued?.(n)
			toast.success(`Sending to ${num(preview.data?.count)} ${preview.data?.count === 1 ? "person" : "people"}. It shows as Sent once delivery finishes.`)
			if (!doc?.name) nav(`/admin/communication/announcements/${encodeURIComponent(n)}`, { replace: true })
		})
	const schedule = (when) =>
		run("schedule", async () => {
			const n = await persist()
			await frappe.call(`${API}schedule_announcement`, { name: n, publish_on: fromLocal(when) })
			setScheduling(false)
			toast.success(`Scheduled for ${dateTime(fromLocal(when))}`)
			if (!doc?.name) nav(`/admin/communication/announcements/${encodeURIComponent(n)}`, { replace: true })
		})
	const archive = useAction(`${API}archive_announcement`, { invalidate: INVALIDATE, success: (r) => (r.status === "Archived" ? "Archived" : `Restored as ${r.status}`) })
	const remove = useAction(`${API}delete_announcement`, {
		invalidate: INVALIDATE,
		success: "Announcement deleted",
		onSuccess: () => nav("/admin/communication", { replace: true }),
	})
	const upload = async (file) => {
		setUploading(true)
		try {
			const r = await frappe.uploadFile(file, false, doc?.name ? { doctype: "Announcement", docname: doc.name, fieldname: "attachment" } : {})
			setForm((f) => ({ ...f, attachment: r.file_url }))
			setDirty(true)
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const programmes = (lookups.data?.programmes || []).map((p) => ({ value: p.name, label: p.programme_name ? `${p.programme_name}${p.code ? ` (${p.code})` : ""}` : p.name }))
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))
	const p = preview.data
	const counting = preview.isFetching || dArgs !== JSON.stringify(audienceArgs)

	return (
		<>
			<PageHeader
				back={{ to: "/admin/communication", label: "Announcements" }}
				title={doc ? doc.title : "New announcement"}
				subtitle={
					doc
						? status === "Sent"
							? `Sent ${dateTime(doc.sent_on)} to ${num(doc.recipients_count)} ${doc.recipients_count === 1 ? "person" : "people"}${doc.posted_by_name ? ` · by ${doc.posted_by_name}` : ""}`
							: status === "Scheduled"
								? `Goes out ${dateTime(doc.publish_on)}`
								: `Draft · last edited ${dateTime(doc.modified)}`
						: "Write it once; it reaches the portal, inboxes and phones."
				}
				actions={
					<>
						{doc && status !== "Sent" && !queued ? (
							<Button variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setConfirm("delete")}>
								Delete
							</Button>
						) : null}
						{doc ? (
							<Button variant="secondary" icon={status === "Archived" ? ArchiveRestore : Archive} loading={archive.isPending} onClick={() => archive.mutate({ name: doc.name, undo: status === "Archived" ? 1 : 0 })}>
								{status === "Archived" ? "Restore" : "Archive"}
							</Button>
						) : null}
						<Button variant="secondary" icon={Save} loading={busy === "save"} disabled={Boolean(doc) && !dirty} onClick={saveDraft}>
							{locked ? "Save changes" : "Save draft"}
						</Button>
						{!locked && !queued ? (
							<>
								<Button variant="secondary" icon={CalendarClock} onClick={() => validate() && setScheduling(true)}>
									{status === "Scheduled" ? "Reschedule" : "Schedule"}
								</Button>
								<Button icon={Send} onClick={() => validate() && setConfirm("send")}>
									Send now
								</Button>
							</>
						) : null}
					</>
				}
			>
				{doc ? (
					<div className="mt-2 flex flex-wrap gap-2">
						{queued ? <Badge tone="blue" dot>Sending…</Badge> : <Badge status={status} tone={toneOf(status)} />}
						{dirty ? <Badge tone="orange">Unsaved changes</Badge> : null}
					</div>
				) : null}
			</PageHeader>
			{queued ? (
				<Alert tone="info" className="mb-4" title="Queued for delivery">
					It is going out in the background. This page switches to Sent when delivery finishes.
				</Alert>
			) : null}
			{locked ? (
				<Alert tone="info" className="mb-4" title={status === "Sent" ? "Already sent" : "Archived"}>
					{status === "Sent"
						? "You can correct the wording shown in the portal, but the audience is fixed and emails and SMS already delivered can't be recalled."
						: "Archived announcements no longer show in the portal. Restore it to make changes visible again."}
				</Alert>
			) : null}
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<Card className="min-w-0 p-5">
					<div className="space-y-4">
						<Input label="Title" required value={form.title} onChange={set("title")} error={errors.title} maxLength={140} placeholder="e.g. Chapel moves to the main hall this Friday" />
						<Tabs
							size="sm"
							active={tab}
							onChange={setTab}
							tabs={[
								{ id: "write", label: "Write" },
								{ id: "preview", label: "Preview" },
							]}
						/>
						{tab === "write" ? (
							<Textarea
								label="Message"
								required
								rows={12}
								value={form.body}
								onChange={set("body")}
								error={errors.body}
								hint={
									rawHtml
										? "This message has rich formatting, so it is shown as HTML. Edit carefully."
										: `Plain text: leave a blank line between paragraphs; links become clickable.${form.send_sms ? ` SMS carries the first 459 characters (${num(form.body.length)} now).` : ""}`
								}
							/>
						) : (
							<div className="min-h-[16rem] rounded-xl border border-line p-4">
								<h2 className="mb-2 font-serif text-xl text-ink">{form.title || "Untitled"}</h2>
								{form.body ? <Html html={rawHtml ? form.body : textToHtml(form.body)} /> : <p className="text-sm text-ink-soft">Nothing written yet.</p>}
							</div>
						)}
						<FileDrop label="Attachment (optional)" hint="A PDF or image people can download from the portal and email." onFile={upload} busy={uploading} value={form.attachment} />
						{form.attachment ? (
							<div className="flex items-center gap-3 text-sm">
								<a href={safeUrl(form.attachment)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
									<Paperclip size={14} /> Open attachment
								</a>
								<button type="button" className="text-red-600 hover:underline" onClick={() => set("attachment")("")}>
									Remove
								</button>
							</div>
						) : null}
					</div>
				</Card>
				<div className="space-y-4">
					<Panel title="Audience" icon={Users}>
						<div className="space-y-3">
							<Select
								label="Who should receive it?"
								options={AUDIENCES}
								value={form.audience}
								disabled={locked}
								onChange={(e) => {
									set("audience")(e)
									setOfferingLabel("")
								}}
								hint={AUDIENCE_HINT[form.audience]}
							/>
							{form.audience === "Programme" ? <Select label="Programme" required placeholder="Choose…" options={programmes} value={form.programme} disabled={locked} onChange={set("programme")} error={errors.programme} /> : null}
							{form.audience === "Campus" ? <Select label="Campus" required placeholder="Choose…" options={campuses} value={form.campus} disabled={locked} onChange={set("campus")} error={errors.campus} /> : null}
							{form.audience === "Course Offering" ? (
								<SearchPick
									id="ann-offering"
									label="Class (course offering)"
									required
									value={form.course_offering}
									display={offeringLabel}
									search={searchOfferings}
									disabled={locked}
									error={errors.course_offering}
									onChange={(v, r) => {
										setForm((f) => ({ ...f, course_offering: v || "" }))
										setOfferingLabel(r?.label || "")
										setDirty(true)
									}}
								/>
							) : null}
							<div className="rounded-xl bg-cream/70 p-3" aria-live="polite" data-audience-count={p && !counting ? p.count : ""}>
								{needsTarget && !form[needsTarget] ? (
									<p className="text-sm text-ink-soft">Choose the {needsTarget.replace("_", " ")} to see who it reaches.</p>
								) : preview.isError ? (
									<p className="text-sm text-red-600">{preview.error?.message || "Couldn't count the audience"}</p>
								) : (
									<>
										<div className="flex items-baseline gap-2">
											<span className="font-serif text-3xl text-ink">{p ? num(p.count) : "—"}</span>
											<span className="text-sm text-ink-muted">{p?.count === 1 ? "person" : "people"}</span>
											{counting ? <Spinner size={14} className="ml-auto" /> : null}
										</div>
										{p ? (
											<div className="mt-2 grid grid-cols-3 gap-2 text-xs">
												<Reach label="Portal" n={p.reachable.in_app} on={form.show_in_portal} />
												<Reach label="Email" n={p.reachable.email} on={form.send_email} />
												<Reach label="SMS" n={p.reachable.sms} on={form.send_sms} />
											</div>
										) : null}
										{p?.sample?.length ? (
											<details className="mt-2 text-xs">
												<summary className="cursor-pointer font-semibold text-brand-700">
													<Eye size={12} className="mr-1 inline" />
													See some of them
												</summary>
												<ul className="mt-1.5 space-y-1 text-ink-muted">
													{p.sample.map((r, i) => (
														<li key={`${r.email || r.phone || i}`} className="truncate">
															{r.name || r.email || r.phone}
															{r.email && r.name ? <span className="text-ink-soft"> · {r.email}</span> : null}
														</li>
													))}
												</ul>
											</details>
										) : null}
									</>
								)}
							</div>
						</div>
					</Panel>
					<Panel title="Delivery">
						<div className="space-y-3">
							<Switch checked={Boolean(form.show_in_portal)} onChange={flag("show_in_portal")} label="Show in the portal" description="On dashboards and the notification bell." />
							<Switch checked={Boolean(form.send_email)} onChange={flag("send_email")} label="Email" disabled={locked} />
							<Switch checked={Boolean(form.send_sms)} onChange={flag("send_sms")} label="SMS" description="Costs per message; keep it short." disabled={locked} />
							{errors.channels ? <p className="text-xs font-medium text-red-600">{errors.channels}</p> : null}
							<Checkbox checked={Boolean(form.is_pinned)} onChange={flag("is_pinned")} label="Pin to the top" description="Stays first in the portal until it expires." />
							<Input label="Stop showing after" type="date" value={form.expires_on || ""} onChange={set("expires_on")} error={errors.expires_on} hint="Optional. The portal hides it after this date." />
						</div>
					</Panel>
				</div>
			</div>
			<ScheduleDialog open={scheduling} initial={form.publish_on} busy={busy === "schedule"} onClose={() => setScheduling(false)} onConfirm={schedule} />
			<ConfirmDialog
				open={confirm === "send"}
				title="Send this announcement now?"
				message={`It goes to ${p ? `${num(p.count)} ${p.count === 1 ? "person" : "people"}` : "the selected people"}${[form.send_email && "by email", form.send_sms && "by SMS", form.show_in_portal && "in the portal"].filter(Boolean).length ? ` ${[form.show_in_portal && "in the portal", form.send_email && "by email", form.send_sms && "by SMS"].filter(Boolean).join(", ")}` : ""}. Emails and SMS can't be recalled.`}
				confirmLabel="Send now"
				loading={busy === "send"}
				onConfirm={sendNow}
				onClose={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm === "delete"}
				tone="danger"
				title="Delete this announcement?"
				message="It is removed for good. Archive it instead if you may need it again."
				confirmLabel="Delete"
				loading={remove.isPending}
				onConfirm={() => remove.mutate({ name: doc.name })}
				onClose={() => setConfirm(null)}
			/>
		</>
	)
}

function Reach({ label, n, on }) {
	return (
		<div className={on ? "rounded-lg bg-surface px-2 py-1.5" : "rounded-lg px-2 py-1.5 opacity-50"}>
			<div className="text-ink-soft">{label}</div>
			<div className="font-semibold text-ink">{num(n)}</div>
		</div>
	)
}

function ScheduleDialog({ open, initial, busy, onClose, onConfirm }) {
	const [when, setWhen] = useState("")
	const [error, setError] = useState("")
	useEffect(() => {
		if (open) {
			setWhen(initial && initial > nowLocal() ? initial : "")
			setError("")
		}
	}, [open, initial])
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="sm"
			title="Schedule for later"
			subtitle="It goes out automatically within five minutes of this time."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						loading={busy}
						onClick={() => {
							if (!when || when <= nowLocal()) return setError("Pick a time in the future")
							onConfirm(when)
						}}
					>
						Schedule
					</Button>
				</>
			}
		>
			<Input label="Send on" type="datetime-local" required min={nowLocal()} value={when} onChange={(e) => setWhen(e.target.value)} error={error} />
		</Modal>
	)
}
