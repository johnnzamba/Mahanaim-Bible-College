import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { EyeOff, ExternalLink, Save, Send, Star, Trash2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Html, Input, PageHeader, Panel, QueryState, Select, SkeletonRows, Tabs, Textarea } from "@/shared/components/ui"
import { date, num } from "@/shared/utils/format"
import { API, ImageField, INVALIDATE, NEWS_CATEGORIES, WebTabs, slugify, toneOf, useWebRoles } from "../components/common"
import { today } from "../components/kit"
import { htmlToText, textToHtml } from "../components/text"

const BLANK = { title: "", route: "", category: "News", author: "", published_on: "", is_featured: 0, cover_image: "", excerpt: "", content: "", tags: "", meta_description: "" }

export default function NewsEditor() {
	const { name } = useParams()
	const isNew = name === "new"
	const { canCms } = useWebRoles()
	const q = useApi(`${API}get_news`, { name }, { enabled: !isNew && canCms })
	if (!canCms) {
		return (
			<>
				<WebTabs />
				<PageHeader back={{ to: "/admin/website/news", label: "News" }} title="News" />
				<Alert tone="warning" title="News is written by the communications office" />
			</>
		)
	}
	return isNew ? <Editor doc={null} /> : <QueryState query={q} skeleton={<SkeletonRows rows={10} />}>{(doc) => <Editor doc={doc} />}</QueryState>
}

function Editor({ doc }) {
	const nav = useNavigate()
	const qc = useQueryClient()
	const [form, setForm] = useState(BLANK)
	const [raw, setRaw] = useState(false)
	const [routeTouched, setRouteTouched] = useState(false)
	const [dirty, setDirty] = useState(false)
	const [errors, setErrors] = useState({})
	const [tab, setTab] = useState("write")
	const [busy, setBusy] = useState("")
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [seen, setSeen] = useState(undefined)
	if (doc !== seen) {
		setSeen(doc)
		const f = { ...BLANK }
		for (const k of Object.keys(BLANK)) if (doc?.[k] != null) f[k] = doc[k]
		const t = htmlToText(doc?.content)
		f.content = t.text
		setForm(f)
		setRaw(t.html)
		setRouteTouched(Boolean(doc))
		setDirty(false)
		setErrors({})
	}
	const set = (k) => (e) => {
		const v = e?.target ? e.target.value : e
		setForm((f) => ({ ...f, [k]: v, ...(k === "title" && !routeTouched ? { route: slugify(v) } : {}) }))
		setDirty(true)
	}
	const state = doc?.state || "Draft"
	const published = state !== "Draft"

	const refresh = () => qc.invalidateQueries({ predicate: (qq) => typeof qq.queryKey[0] === "string" && qq.queryKey[0].startsWith(API) })
	const save = async (publish) => {
		const errs = {}
		if (!form.title.trim()) errs.title = "Give the article a title"
		if (!form.content.trim()) errs.content = "Write the article"
		if (form.route && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.route)) errs.route = "Lowercase letters, numbers and hyphens only"
		setErrors(errs)
		if (Object.keys(errs).length) return toast.error(Object.values(errs)[0])
		setBusy(publish === undefined ? "save" : "publish")
		try {
			const data = {
				...(doc ? { name: doc.name } : {}),
				...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v])),
				title: form.title.trim(),
				content: raw ? form.content : textToHtml(form.content),
				is_featured: form.is_featured ? 1 : 0,
				route: routeTouched ? form.route || null : null,
			}
			let saved = await frappe.call(`${API}save_news`, { data })
			if (publish !== undefined) saved = await frappe.call(`${API}publish_news`, { name: saved.name, publish: publish ? 1 : 0, published_on: publish ? form.published_on || today() : undefined })
			setDirty(false)
			refresh()
			toast.success(publish === true ? (saved.state === "Scheduled" ? `Scheduled for ${date(saved.published_on)}` : "Published on the website") : publish === false ? "Moved back to drafts" : "Saved")
			if (!doc) nav(`/admin/website/news/${encodeURIComponent(saved.name)}`, { replace: true })
		} catch (e) {
			toast.error(e?.message || "Couldn't save")
		} finally {
			setBusy("")
		}
	}
	const remove = useAction(`${API}delete_news`, { invalidate: INVALIDATE, success: "Article deleted", onSuccess: () => nav("/admin/website/news", { replace: true }) })
	const preview = form.route ? `/news/${form.route}` : null

	return (
		<>
			<WebTabs />
			<PageHeader
				back={{ to: "/admin/website/news", label: "News" }}
				title={doc ? doc.title : "Write news"}
				subtitle={doc ? (published ? `${state} ${date(doc.published_on)} · ${num(doc.views || 0)} views` : "Draft, not visible on the website") : "Drafts stay private until you publish."}
				actions={
					<>
						{doc ? (
							<Button variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setConfirmDelete(true)}>
								Delete
							</Button>
						) : null}
						{doc && preview ? (
							<a href={preview} target="_blank" rel="noreferrer" className="btn btn-secondary">
								<ExternalLink size={16} /> {published ? "View on site" : "Preview link"}
							</a>
						) : null}
						<Button variant="secondary" icon={Save} loading={busy === "save"} disabled={Boolean(doc) && !dirty} onClick={() => save()}>
							Save
						</Button>
						{published ? (
							<Button variant="secondary" icon={EyeOff} loading={busy === "publish"} onClick={() => save(false)}>
								Unpublish
							</Button>
						) : (
							<Button icon={Send} loading={busy === "publish"} onClick={() => save(true)}>
								{form.published_on && form.published_on > today() ? "Schedule" : "Publish"}
							</Button>
						)}
					</>
				}
			>
				<div className="mt-2 flex flex-wrap gap-2">
					{doc ? <Badge status={state} tone={toneOf(state)} /> : null}
					{dirty ? <Badge tone="orange">Unsaved changes</Badge> : null}
				</div>
			</PageHeader>
			{doc && !published && preview ? (
				<Alert tone="info" className="mb-4">
					The public link <b>{preview}</b> works once the article is published.
				</Alert>
			) : null}
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<Card className="min-w-0 space-y-4 p-5">
					<Input label="Title" required value={form.title} onChange={set("title")} error={errors.title} maxLength={140} />
					<Textarea label="Summary" rows={2} value={form.excerpt || ""} onChange={set("excerpt")} hint="Shown on news cards. Left blank, the first lines of the article are used." />
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
							label="Article"
							required
							rows={18}
							value={form.content}
							onChange={set("content")}
							error={errors.content}
							hint={raw ? "This article has rich formatting, so it is shown as HTML." : "Leave a blank line between paragraphs. Links become clickable."}
						/>
					) : (
						<article className="min-h-[20rem] rounded-xl border border-line p-5">
							{form.cover_image ? <img src={form.cover_image} alt="" className="mb-4 aspect-[16/9] w-full rounded-lg object-cover" /> : null}
							<p className="text-xs font-bold uppercase tracking-wide text-gold-700">{form.category}</p>
							<h2 className="mb-3 font-serif text-2xl text-ink">{form.title || "Untitled"}</h2>
							<Html html={raw ? form.content : textToHtml(form.content)} />
						</article>
					)}
				</Card>
				<div className="space-y-4">
					<Panel title="Publishing">
						<div className="space-y-3">
							<Select label="Category" options={NEWS_CATEGORIES} value={form.category} onChange={set("category")} />
							<Input label="Publish date" type="date" value={form.published_on || ""} onChange={set("published_on")} hint="A future date schedules it. Blank = today when you publish." />
							<Input label="Author" value={form.author || ""} onChange={set("author")} hint="Blank = your name." />
							<Checkbox checked={Boolean(form.is_featured)} onChange={(v) => set("is_featured")(v ? 1 : 0)} label={<span className="inline-flex items-center gap-1"><Star size={13} className="text-gold-500" /> Feature on the home page</span>} />
						</div>
					</Panel>
					<Panel title="Cover image">
						<ImageField value={form.cover_image} onChange={set("cover_image")} meta={doc ? { doctype: "News Post", docname: doc.name, fieldname: "cover_image" } : null} />
					</Panel>
					<Panel title="Search & sharing">
						<div className="space-y-3">
							<Input
								label="Web address"
								value={form.route || ""}
								onChange={(e) => {
									setRouteTouched(true)
									set("route")(e.target.value.toLowerCase())
								}}
								error={errors.route}
								hint={form.route ? `/news/${form.route}` : "Generated from the title."}
							/>
							<Input label="Tags" value={form.tags || ""} onChange={set("tags")} hint="Comma separated, e.g. graduation, missions" />
							<Textarea label="Search description" rows={3} maxLength={160} value={form.meta_description || ""} onChange={set("meta_description")} hint={`${(form.meta_description || "").length}/160 · shown by Google and when shared.`} />
						</div>
					</Panel>
				</div>
			</div>
			<ConfirmDialog
				open={confirmDelete}
				tone="danger"
				title="Delete this article?"
				message={published ? "It disappears from the website and any shared links stop working. Unpublish instead if you may need it again." : "The draft is removed for good."}
				confirmLabel="Delete"
				loading={remove.isPending}
				onConfirm={() => remove.mutate({ name: doc.name })}
				onClose={() => setConfirmDelete(false)}
			/>
		</>
	)
}
