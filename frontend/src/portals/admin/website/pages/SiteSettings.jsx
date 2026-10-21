import { useState } from "react"
import { ExternalLink, Save } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Badge, Button, Card, Input, QueryState, SkeletonRows, Textarea } from "@/shared/components/ui"
import { API, ImageField } from "../components/common"
import { htmlToText, textToHtml } from "../components/text"

/** Sections and fields of Campus Website Settings, in the doctype's order. */
const SECTIONS = [
	{
		id: "home",
		label: "Home page",
		groups: [
			{
				title: "Announcement bar",
				fields: [
					{ k: "announcement_bar", label: "Text", hint: "A thin banner across the top of every page. Leave blank to hide it." },
					{ k: "announcement_link", label: "Link", hint: "Optional, e.g. /apply" },
				],
			},
			{
				title: "Hero",
				fields: [
					{ k: "hero_eyebrow", label: "Small heading" },
					{ k: "hero_title", label: "Headline" },
					{ k: "hero_subtitle", label: "Sub-headline", type: "small" },
					{ k: "hero_cta_label", label: "Button label" },
					{ k: "hero_cta_link", label: "Button link" },
					{ k: "hero_video_url", label: "Video link", hint: "Optional YouTube link" },
					{ k: "hero_image", label: "Background image", type: "image", wide: true },
				],
			},
			{
				title: "Highlights",
				fields: [
					{ k: "stat_students", label: "Students", type: "int" },
					{ k: "stat_graduates", label: "Graduates", type: "int" },
					{ k: "stat_churches", label: "Partner churches", type: "int" },
					{ k: "stat_years", label: "Years of ministry", type: "int" },
				],
			},
		],
	},
	{
		id: "about",
		label: "About",
		groups: [
			{
				title: "Who we are",
				fields: [
					{ k: "about_summary", label: "Summary", type: "small", wide: true },
					{ k: "mission", label: "Mission", type: "small" },
					{ k: "vision", label: "Vision", type: "small" },
					{ k: "core_values", label: "Core values", type: "small", hint: "One per line.", wide: true },
				],
			},
			{
				title: "Long-form pages",
				fields: [
					{ k: "about_body", label: "About the college", type: "rich", wide: true },
					{ k: "statement_of_faith", label: "Statement of faith", type: "rich", wide: true },
					{ k: "history", label: "History", type: "rich", wide: true },
				],
			},
			{
				title: "Principal's message",
				fields: [
					{ k: "principal_name", label: "Name" },
					{ k: "principal_title", label: "Title" },
					{ k: "principal_photo", label: "Photo", type: "image", aspect: "aspect-square", wide: true },
					{ k: "principal_message", label: "Message", type: "rich", wide: true },
				],
			},
		],
	},
	{
		id: "pages",
		label: "Pages",
		groups: [
			{
				title: "Admissions, fees and library",
				fields: [
					{ k: "admissions_intro", label: "Admissions introduction", type: "rich", wide: true },
					{ k: "admissions_steps", label: "How to apply (steps)", type: "small", hint: "One step per line.", wide: true },
					{ k: "fees_intro", label: "Fees introduction", type: "rich", wide: true },
					{ k: "library_intro", label: "Library introduction", type: "rich", wide: true },
				],
			},
		],
	},
	{
		id: "contact",
		label: "Contact & social",
		groups: [
			{
				title: "Contact",
				fields: [
					{ k: "contact_phone", label: "Phone" },
					{ k: "contact_email", label: "Email", inputType: "email" },
					{ k: "whatsapp", label: "WhatsApp number" },
					{ k: "map_embed_url", label: "Google Maps embed link" },
					{ k: "contact_address", label: "Address", type: "small" },
					{ k: "office_hours", label: "Office hours", type: "small" },
				],
			},
			{
				title: "Social",
				fields: [
					{ k: "facebook", label: "Facebook", inputType: "url" },
					{ k: "youtube", label: "YouTube", inputType: "url" },
					{ k: "instagram", label: "Instagram", inputType: "url" },
					{ k: "x_twitter", label: "X (Twitter)", inputType: "url" },
				],
			},
			{
				title: "Footer & search",
				fields: [
					{ k: "footer_text", label: "Footer text", type: "small" },
					{ k: "meta_description", label: "Search description", type: "small", hint: "About 160 characters, shown by Google." },
				],
			},
		],
	},
]
const FIELDS = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.fields))
const RICH = new Set(FIELDS.filter((f) => f.type === "rich").map((f) => f.k))

export default function SiteSettings() {
	const q = useApi(`${API}get_website_settings`, {})
	return (
		<QueryState query={q} skeleton={<SkeletonRows rows={10} />}>
			{(doc) => <Editor doc={doc} />}
		</QueryState>
	)
}

function toForm(doc) {
	const f = {}
	const raw = {}
	for (const { k, type } of FIELDS) {
		if (type === "rich") {
			const t = htmlToText(doc?.[k])
			f[k] = t.text
			raw[k] = t.html
		} else f[k] = doc?.[k] ?? ""
	}
	return { f, raw }
}

function Editor({ doc }) {
	const qc = useQueryClient()
	const [section, setSection] = useState("home")
	const [form, setForm] = useState({})
	const [raw, setRaw] = useState({})
	const [base, setBase] = useState({})
	const [saving, setSaving] = useState(false)
	const [seen, setSeen] = useState(undefined)
	if (doc !== seen) {
		setSeen(doc)
		const { f, raw: r } = toForm(doc)
		setForm(f)
		setBase(f)
		setRaw(r)
	}
	const changed = FIELDS.filter(({ k }) => String(form[k] ?? "") !== String(base[k] ?? "")).map((f) => f.k)
	const changedIn = (s) => s.groups.flatMap((g) => g.fields).filter((f) => changed.includes(f.k)).length
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const save = async () => {
		const data = {}
		for (const k of changed) {
			const v = form[k]
			const field = FIELDS.find((f) => f.k === k)
			data[k] = v === "" ? null : RICH.has(k) && !raw[k] ? textToHtml(v) : field.type === "int" ? Number(v) || 0 : v
		}
		setSaving(true)
		try {
			const saved = await frappe.call(`${API}update_website_settings`, { data })
			qc.setQueryData([`${API}get_website_settings`, {}], saved)
			toast.success(`Website updated (${changed.length} field${changed.length === 1 ? "" : "s"})`)
		} catch (e) {
			toast.error(e?.message || "Couldn't save")
		} finally {
			setSaving(false)
		}
	}
	const current = SECTIONS.find((s) => s.id === section)
	return (
		<div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
			<nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
				{SECTIONS.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => setSection(s.id)}
						className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ${section === s.id ? "bg-brand-50 text-brand-800" : "text-ink-muted hover:bg-cream"}`}
					>
						{s.label}
						{changedIn(s) ? <Badge tone="orange" size="xs">{changedIn(s)}</Badge> : null}
					</button>
				))}
				<a href="/" target="_blank" rel="noreferrer" className="mt-2 hidden items-center gap-1.5 px-3 text-xs font-semibold text-brand-700 hover:underline lg:flex">
					<ExternalLink size={12} /> Open the website
				</a>
			</nav>
			<div className="min-w-0 space-y-4">
				{current.groups.map((g) => (
					<Card key={g.title} className="p-5">
						<h3 className="mb-4 font-semibold text-ink">{g.title}</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							{g.fields.map((f) => (
								<SettingField key={f.k} f={f} value={form[f.k]} onChange={set(f.k)} raw={raw[f.k]} />
							))}
						</div>
					</Card>
				))}
				<div className="sticky bottom-4 z-20 flex justify-end">
					<div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lift">
						<span className={`text-sm ${changed.length ? "text-amber-700" : "text-ink-soft"}`}>{changed.length ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "All changes saved"}</span>
						{changed.length ? (
							<Button variant="ghost" size="sm" onClick={() => setForm(base)}>
								Discard
							</Button>
						) : null}
						<Button icon={Save} loading={saving} disabled={!changed.length} onClick={save}>
							Save website
						</Button>
					</div>
				</div>
			</div>
		</div>
	)
}

function SettingField({ f, value, onChange, raw }) {
	const cls = f.wide ? "sm:col-span-2" : ""
	if (f.type === "image") return <ImageField label={f.label} value={value} onChange={onChange} aspect={f.aspect || "aspect-[21/9]"} className={f.wide ? "sm:col-span-2 sm:max-w-md" : ""} />
	if (f.type === "rich") return <Textarea label={f.label} rows={8} className={cls} value={value || ""} onChange={onChange} hint={raw ? "Shown as HTML because it has rich formatting." : "Leave a blank line between paragraphs."} />
	if (f.type === "small") return <Textarea label={f.label} rows={3} className={cls} value={value || ""} onChange={onChange} hint={f.hint} />
	return <Input label={f.label} type={f.type === "int" ? "number" : f.inputType || "text"} min={f.type === "int" ? 0 : undefined} className={cls} value={value ?? ""} onChange={onChange} hint={f.hint} />
}
