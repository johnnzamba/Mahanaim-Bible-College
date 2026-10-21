import { useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Braces, Eye, Save } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, Card, Html, Input, PageHeader, Panel, QueryState, Select, SkeletonRows, Spinner, Switch, Textarea } from "@/shared/components/ui"
import { dateTime } from "@/shared/utils/format"
import { API, CommsTabs, EVENT_EXTRAS, SAMPLE_DOCTYPE, SAMPLE_TITLE, useCommsRoles } from "../components/common"

const FIELDS = ["template_name", "event", "is_active", "send_email", "send_sms", "send_in_app", "subject", "email_body", "sms_body", "in_app_body", "description"]
const BLANK = { template_name: "", event: "", is_active: 1, send_email: 1, send_sms: 0, send_in_app: 1, subject: "", email_body: "", sms_body: "", in_app_body: "", description: "" }

const GENERAL = [
	["{{ doc.name }}", "The record the message is about"],
	["{{ recipient.name }}", "The person receiving it"],
	["{{ college }}", "College name"],
	["{{ settings.short_name }}", "Any public college setting, e.g. the short name for SMS"],
	["{{ site_url }}", "Portal address"],
	["{{ money(doc.amount) }}", "An amount as KES 1,234.00"],
	["{{ frappe.utils.fmt_money(doc.amount, currency='KES') }}", "An amount with the currency symbol"],
	["{{ frappe.utils.formatdate(doc.posting_date) }}", "A formatted date"],
	["{{ frappe.utils.format_datetime(doc.modified) }}", "A formatted date and time"],
	["{{ _('Dear') }}", "Translated text"],
	["{% if doc.x %}…{% endif %}", "Show text only when a value is set"],
]

const SKIP = /^(_|owner$|modified_by$|docstatus$|idx$|doctype$|parent|amended_from$|naming_series$)/

export default function TemplateEditor() {
	const { name } = useParams()
	const isNew = name === "new"
	const { isComms } = useCommsRoles()
	const q = useApi(`${API}get_template`, { name }, { enabled: !isNew && isComms })
	if (!isComms) {
		return (
			<>
				<CommsTabs />
				<PageHeader back={{ to: "/admin/communication/templates", label: "Templates" }} title="Template" />
				<Alert tone="warning" title="Only the communications office edits templates" />
			</>
		)
	}
	return isNew ? <Editor doc={null} /> : <QueryState query={q} skeleton={<SkeletonRows rows={10} />}>{(doc) => <Editor doc={doc} />}</QueryState>
}

function Editor({ doc }) {
	const nav = useNavigate()
	const qc = useQueryClient()
	const [params] = useSearchParams()
	const events = useApi(`${API}list_templates`, {}, { staleTime: 60000 })
	const [form, setForm] = useState(BLANK)
	const [dirty, setDirty] = useState(false)
	const [errors, setErrors] = useState({})
	const [saving, setSaving] = useState(false)
	const [seen, setSeen] = useState(undefined)
	const focused = useRef("email_body")
	const refs = { subject: useRef(null), email_body: useRef(null), sms_body: useRef(null), in_app_body: useRef(null) }
	if (doc !== seen) {
		setSeen(doc)
		const f = { ...BLANK, event: params.get("event") || "" }
		for (const k of FIELDS) if (doc?.[k] != null) f[k] = doc[k]
		setForm(f)
		setDirty(false)
		setErrors({})
	}
	const set = (k) => (e) => {
		const v = e?.target ? e.target.value : e
		setForm((f) => ({ ...f, [k]: v }))
		setDirty(true)
	}
	const flag = (k) => (v) => set(k)(v ? 1 : 0)
	const track = (k) => ({ ref: refs[k], onFocus: () => (focused.current = k) })

	const insert = (snippet) => {
		const k = focused.current
		const el = refs[k]?.current
		const val = form[k] || ""
		const at = el && typeof el.selectionStart === "number" ? el.selectionStart : val.length
		const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : at
		set(k)(val.slice(0, at) + snippet + val.slice(end))
		requestAnimationFrame(() => {
			if (!el) return
			el.focus()
			el.setSelectionRange(at + snippet.length, at + snippet.length)
		})
	}

	const save = async () => {
		const errs = {}
		if (!doc && !form.template_name.trim()) errs.template_name = "Name the template"
		if (!form.event) errs.event = "Choose the event"
		if (form.send_email && !form.subject.trim()) errs.subject = "Email needs a subject"
		if (form.send_email && !form.email_body.trim()) errs.email_body = "Write the email"
		if (form.send_sms && !form.sms_body.trim()) errs.sms_body = "Write the SMS"
		setErrors(errs)
		if (Object.keys(errs).length) {
			toast.error(Object.values(errs)[0])
			return null
		}
		setSaving(true)
		try {
			const data = { ...form, template_name: form.template_name.trim(), ...(doc ? { name: doc.name } : {}) }
			const saved = await frappe.call(`${API}save_template`, { data })
			setDirty(false)
			qc.invalidateQueries({ predicate: (qq) => typeof qq.queryKey[0] === "string" && qq.queryKey[0].startsWith(`${API}`) })
			toast.success("Template saved")
			if (!doc) nav(`/admin/communication/templates/${encodeURIComponent(saved.name)}`, { replace: true })
			return saved.name
		} catch (e) {
			toast.error(e?.message || "Couldn't save")
			return null
		} finally {
			setSaving(false)
		}
	}

	const smsLen = (form.sms_body || "").length
	return (
		<>
			<CommsTabs />
			<PageHeader
				back={{ to: "/admin/communication/templates", label: "Templates" }}
				title={doc ? doc.template_name || doc.name : "New template"}
				subtitle={doc ? `${doc.event} · last edited ${dateTime(doc.modified)}` : "Choose the event it answers, then write each channel's wording."}
				actions={
					<Button icon={Save} loading={saving} disabled={Boolean(doc) && !dirty} onClick={save}>
						Save template
					</Button>
				}
			>
				<div className="mt-2 flex flex-wrap gap-2">
					{doc ? <Badge tone={doc.is_active ? "green" : "gray"}>{doc.is_active ? "Active" : "Inactive"}</Badge> : null}
					{dirty ? <Badge tone="orange">Unsaved changes</Badge> : null}
				</div>
			</PageHeader>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
				<div className="min-w-0 space-y-4">
					<Card className="p-5">
						<div className="grid gap-4 sm:grid-cols-2">
							{doc ? (
								<Input label="Template name" value={doc.template_name || doc.name} disabled hint="The name can't change once created." />
							) : (
								<Input label="Template name" required value={form.template_name} onChange={set("template_name")} error={errors.template_name} placeholder="e.g. Fee reminder (friendly)" />
							)}
							<Select label="Sent when" required placeholder="Choose an event…" options={events.data?.events || (form.event ? [form.event] : [])} value={form.event} onChange={set("event")} error={errors.event} />
							<Textarea label="Notes for staff" rows={2} className="sm:col-span-2" value={form.description || ""} onChange={set("description")} hint="Who receives it and when; not sent to anyone." />
						</div>
						<div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
							<Switch checked={Boolean(form.is_active)} onChange={flag("is_active")} label="Active" description="Off = built-in wording" />
							<Switch checked={Boolean(form.send_email)} onChange={flag("send_email")} label="Email" />
							<Switch checked={Boolean(form.send_sms)} onChange={flag("send_sms")} label="SMS" />
							<Switch checked={Boolean(form.send_in_app)} onChange={flag("send_in_app")} label="Portal notification" />
						</div>
					</Card>
					<Panel title="Email" subtitle={form.send_email ? null : "Email is switched off for this template."} className={form.send_email ? "" : "opacity-70"}>
						<div className="space-y-3">
							<Input label="Subject" value={form.subject || ""} onChange={set("subject")} error={errors.subject} {...track("subject")} />
							<Textarea label="Body (HTML)" rows={12} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }} value={form.email_body || ""} onChange={set("email_body")} error={errors.email_body} hint="Use <p>…</p> for paragraphs and <b>…</b> for bold." {...track("email_body")} />
						</div>
					</Panel>
					<div className="grid gap-4 md:grid-cols-2">
						<Panel title="SMS" className={form.send_sms ? "" : "opacity-70"}>
							<Textarea
								label="Text"
								rows={5}
								value={form.sms_body || ""}
								onChange={set("sms_body")}
								error={errors.sms_body}
								hint={<span className={smsLen > 160 ? "font-semibold text-amber-700" : ""}>{smsLen} characters before placeholders are filled{smsLen > 160 ? ` · about ${Math.ceil(smsLen / 153)} SMS each` : ""}</span>}
								{...track("sms_body")}
							/>
						</Panel>
						<Panel title="Portal notification" className={form.send_in_app ? "" : "opacity-70"}>
							<Textarea label="Text" rows={5} value={form.in_app_body || ""} onChange={set("in_app_body")} hint="Short line for the bell. Falls back to the subject." {...track("in_app_body")} />
						</Panel>
					</div>
				</div>
				<div className="space-y-4">
					<Placeholders event={form.event} onInsert={insert} />
					{doc ? <Preview doc={doc} event={form.event} dirty={dirty} onSave={save} /> : <Alert tone="info" title="Preview">Save the template to preview it against a real record.</Alert>}
				</div>
			</div>
		</>
	)
}

function Placeholders({ event, onInsert }) {
	const doctype = SAMPLE_DOCTYPE[event]
	const extras = (EVENT_EXTRAS[event] || []).map(([key, help]) => [`{{ ${key} }}`, help])
	return (
		<Panel title="Placeholders" icon={Braces} subtitle="Click one to insert it where your cursor is.">
			<PlaceholderList items={GENERAL} onInsert={onInsert} />
			{extras.length ? (
				<>
					<p className="mb-1 mt-3 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Only for {event}</p>
					<PlaceholderList items={extras} onInsert={onInsert} />
				</>
			) : null}
			<p className="mt-3 text-xs text-ink-soft">
				{doctype ? (
					<>
						<code>doc</code> is the <b>{doctype}</b> record. Pick a sample below to see its fields.
					</>
				) : (
					<>This event has no record attached, so only the recipient, college and settings are available.</>
				)}
			</p>
			<p className="mt-2 text-xs text-ink-soft">
				Templates run in a safe sandbox: they see only these values and the formatting helpers above. Database lookups such as <code>frappe.db</code> or <code>frappe.get_doc</code> are not available.
			</p>
		</Panel>
	)
}

function PlaceholderList({ items, onInsert }) {
	return (
		<ul className="space-y-1.5">
			{items.map(([code, help]) => (
				<li key={code}>
					<button type="button" onClick={() => onInsert(code)} className="group flex w-full min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-left hover:bg-cream">
						<code className="max-w-full break-all rounded bg-cream px-1.5 py-0.5 font-mono text-[11px] text-brand-800 group-hover:bg-surface">{code}</code>
						<span className="min-w-0 flex-1 basis-24 pt-0.5 text-xs text-ink-soft">{help}</span>
					</button>
				</li>
			))}
		</ul>
	)
}

function Preview({ doc, event, dirty, onSave }) {
	const doctype = SAMPLE_DOCTYPE[event] || null
	const title = SAMPLE_TITLE[doctype]
	const [docname, setDocname] = useState("")
	const [result, setResult] = useState(null)
	const [busy, setBusy] = useState(false)
	const [showFields, setShowFields] = useState(false)
	const samples = useQuery({
		queryKey: ["tpl-samples", doctype],
		enabled: Boolean(doctype),
		retry: false,
		staleTime: 60000,
		queryFn: () => frappe.call("frappe.client.get_list", { doctype, fields: title ? ["name", title] : ["name"], order_by: "modified desc", limit_page_length: 25 }),
	})
	const fields = useQuery({
		queryKey: ["tpl-sample-doc", doctype, docname],
		enabled: Boolean(doctype && docname && showFields),
		retry: false,
		queryFn: () => frappe.call("frappe.client.get", { doctype, name: docname }),
	})
	const run = async () => {
		setBusy(true)
		try {
			let n = doc.name
			if (dirty) n = await onSave()
			if (!n) return
			setResult(await frappe.call(`${API}preview_template`, { name: n, doctype: docname ? doctype : undefined, docname: docname || undefined }))
		} catch (e) {
			toast.error(e?.message || "Preview failed")
		} finally {
			setBusy(false)
		}
	}
	const r = result?.rendered
	const errs = result?.errors || {}
	return (
		<Panel
			title="Preview"
			icon={Eye}
			actions={
				<Button size="sm" icon={Eye} loading={busy} onClick={run}>
					{dirty ? "Save & preview" : "Preview"}
				</Button>
			}
		>
			<div className="space-y-3">
				{doctype ? (
					samples.isError ? (
						<Alert tone="warning">Your role can't open {doctype} records, so placeholders from the record render blank.</Alert>
					) : (
						<Select
							label={`Sample ${doctype.toLowerCase()}`}
							placeholder={samples.isLoading ? "Loading…" : samples.data?.length ? "None (blank values)" : "No records yet"}
							options={(samples.data || []).map((s) => ({ value: s.name, label: title && s[title] ? `${s[title]} · ${s.name}` : s.name }))}
							value={docname}
							onChange={(e) => {
								setDocname(e.target.value)
								setResult(null)
							}}
						/>
					)
				) : null}
				{docname ? (
					<button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setShowFields((v) => !v)}>
						{showFields ? "Hide" : "Show"} this record's fields
					</button>
				) : null}
				{showFields && docname ? (
					fields.isLoading ? (
						<Spinner size={14} />
					) : fields.isError ? (
						<p className="text-xs text-red-600">{fields.error?.message}</p>
					) : (
						<div className="scroll-thin max-h-48 overflow-auto rounded-lg border border-line p-2 font-mono text-[11px]">
							{Object.entries(fields.data || {})
								.filter(([k, v]) => !SKIP.test(k) && v !== null && v !== "" && typeof v !== "object")
								.map(([k, v]) => (
									<div key={k} className="flex gap-2 truncate">
										<span className="text-brand-800">doc.{k}</span>
										<span className="truncate text-ink-soft">{String(v)}</span>
									</div>
								))}
						</div>
					)
				) : null}
				{r ? (
					<div className="space-y-3" data-preview="rendered">
						<p className="text-xs text-ink-soft">Rendered{result.document ? ` with ${result.document.name}` : " with blank record values"}, addressed to you.</p>
						<Section label="Subject" error={errs.subject}>
							<p className="font-semibold text-ink">{r.subject || "—"}</p>
						</Section>
						<Section label="Email" error={errs.email_body}>
							{r.email_body ? <Html html={r.email_body} className="max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 text-sm" /> : <p className="text-sm text-ink-soft">—</p>}
						</Section>
						<Section label={`SMS · ${r.sms_length} characters · ${r.sms_parts} part${r.sms_parts === 1 ? "" : "s"}`} error={errs.sms_body}>
							<p className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-cream px-3 py-2 text-sm text-ink">{r.sms_body || "—"}</p>
						</Section>
						<Section label="Portal" error={errs.in_app_body}>
							<p className="text-sm text-ink">{r.in_app_body || "—"}</p>
						</Section>
					</div>
				) : (
					<p className="text-sm text-ink-soft">{busy ? "Rendering…" : "Pick a sample (optional) and press Preview."}</p>
				)}
			</div>
		</Panel>
	)
}

function Section({ label, error, children }) {
	return (
		<div>
			<div className="label mb-1">{label}</div>
			{error ? <Alert tone="error" title="Template error">{error}</Alert> : children}
		</div>
	)
}
