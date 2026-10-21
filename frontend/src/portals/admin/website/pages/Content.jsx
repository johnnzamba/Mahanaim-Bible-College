import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { GripVertical, HelpCircle, MessageSquareQuote, Plus, Save, Trash2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Avatar, Badge, Button, Card, ConfirmDialog, Empty, Input, PageHeader, QueryState, Select, SkeletonRows, Switch, Tabs, Textarea } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { API, FAQ_CATEGORIES, ImageField, INVALIDATE, WebTabs, useWebRoles } from "../components/common"
import { useLookups } from "../components/kit"
import { htmlToText, textToHtml } from "../components/text"
import SiteSettings from "./SiteSettings"

export default function Content() {
	const { canCms, canFaqs } = useWebRoles()
	const [params, setParams] = useSearchParams()
	const tabs = [canFaqs && { id: "faqs", label: "FAQs" }, canCms && { id: "testimonials", label: "Testimonials" }, canCms && { id: "settings", label: "Site settings" }].filter(Boolean)
	const tab = tabs.find((t) => t.id === params.get("tab"))?.id || tabs[0]?.id
	if (!tabs.length) {
		return (
			<>
				<WebTabs />
				<PageHeader title="Website content" />
				<Alert tone="warning" title="Website content is managed by the communications office" />
			</>
		)
	}
	return (
		<>
			<WebTabs />
			<PageHeader title="Website content" subtitle="Questions, testimonials and the words and contacts across the public site." />
			<Tabs className="mb-5" tabs={tabs} active={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
			{tab === "faqs" ? <Faqs /> : tab === "testimonials" ? <Testimonials /> : <SiteSettings />}
		</>
	)
}

/* ------------------------------------------------------------------ FAQs */

function Faqs() {
	const [category, setCategory] = useState("")
	const [search, setSearch] = useState("")
	const [adding, setAdding] = useState(false)
	const q = useApi(`${API}list_faqs`, {})
	const rows = useMemo(() => {
		const s = search.trim().toLowerCase()
		return (q.data?.data || []).filter((f) => (!category || f.category === category) && (!s || f.question.toLowerCase().includes(s) || (f.answer || "").toLowerCase().includes(s)))
	}, [q.data, category, search])
	const counts = useMemo(() => {
		const c = {}
		for (const f of q.data?.data || []) c[f.category] = (c[f.category] || 0) + 1
		return c
	}, [q.data])
	const groups = FAQ_CATEGORIES.map((c) => [c, rows.filter((f) => f.category === c)]).filter(([, l]) => l.length)
	return (
		<>
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<SearchInput value={search} onChange={setSearch} placeholder="Search questions…" />
				<div className="flex flex-wrap gap-1.5">
					<button type="button" className={`chip ${!category ? "chip-active" : ""}`} onClick={() => setCategory("")}>
						All {q.data ? <span className="opacity-60">{q.data.total}</span> : null}
					</button>
					{FAQ_CATEGORIES.map((c) => (
						<button key={c} type="button" className={`chip ${category === c ? "chip-active" : ""}`} onClick={() => setCategory(c)}>
							{c} <span className="opacity-60">{counts[c] || 0}</span>
						</button>
					))}
				</div>
				<Button className="ml-auto" icon={Plus} onClick={() => setAdding(true)} disabled={adding}>
					Add question
				</Button>
			</div>
			{adding ? <FaqRow faq={{ question: "", answer: "", category: category || "General", is_published: 1, sequence: 10 }} onDone={() => setAdding(false)} initiallyOpen /> : null}
			<QueryState query={q} skeleton={<SkeletonRows rows={6} />}>
				{() =>
					groups.length ? (
						<div className="space-y-5">
							{groups.map(([c, list]) => (
								<section key={c}>
									<h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">{c}</h2>
									<div className="space-y-2">
										{list.map((f) => (
											<FaqRow key={f.name} faq={f} />
										))}
									</div>
								</section>
							))}
						</div>
					) : adding ? null : (
						<Card>
							<Empty icon={HelpCircle} title={search || category ? "No questions match" : "No FAQs yet"} subtitle="Answer the questions applicants ask most; they appear on the FAQ page and in site search." />
						</Card>
					)
				}
			</QueryState>
		</>
	)
}

function FaqRow({ faq, onDone, initiallyOpen = false }) {
	const qc = useQueryClient()
	const [open, setOpen] = useState(initiallyOpen)
	const [form, setForm] = useState(() => ({ ...faq, answer: htmlToText(faq.answer).text }))
	const [raw, setRaw] = useState(() => htmlToText(faq.answer).html)
	const [seen, setSeen] = useState(faq)
	if (faq !== seen && !open) {
		setSeen(faq)
		setForm({ ...faq, answer: htmlToText(faq.answer).text })
		setRaw(htmlToText(faq.answer).html)
	}
	const [busy, setBusy] = useState(false)
	const [confirm, setConfirm] = useState(false)
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const remove = useAction(`${API}delete_faq`, { invalidate: INVALIDATE, success: "Question removed" })
	const save = async (patch) => {
		const next = { ...form, ...(patch || {}) }
		if (!next.question.trim() || !next.answer.trim()) return toast.error("Write both the question and the answer")
		setBusy(true)
		try {
			await frappe.call(`${API}save_faq`, {
				data: { ...(faq.name ? { name: faq.name } : {}), question: next.question.trim(), answer: raw ? next.answer : textToHtml(next.answer), category: next.category, is_published: next.is_published ? 1 : 0, sequence: Number(next.sequence) || 0 },
			})
			qc.invalidateQueries({ predicate: (qq) => typeof qq.queryKey[0] === "string" && qq.queryKey[0].startsWith(API) })
			toast.success(faq.name ? "Saved" : "Question added")
			if (patch === undefined) setOpen(false)
			onDone?.()
		} catch (e) {
			toast.error(e?.message || "Couldn't save")
		} finally {
			setBusy(false)
		}
	}
	if (!open) {
		return (
			<Card className="flex items-start gap-3 p-3.5">
				<GripVertical size={16} className="mt-0.5 shrink-0 text-ink-soft/40" aria-hidden />
				<button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(true)}>
					<span className="block font-semibold text-ink">{faq.question}</span>
					<span className="line-clamp-2 text-sm text-ink-soft">{htmlToText(faq.answer).text}</span>
				</button>
				<span className="flex shrink-0 items-center gap-3">
					<span className="hidden text-xs text-ink-soft sm:inline">#{faq.sequence}</span>
					<Switch checked={Boolean(faq.is_published)} onChange={(v) => save({ is_published: v ? 1 : 0 })} label={<span className="sr-only">Published</span>} disabled={busy} />
				</span>
			</Card>
		)
	}
	return (
		<Card className="space-y-3 border-brand-200 p-4" data-faq-editor={faq.name || "new"}>
			<Input label="Question" required value={form.question} onChange={set("question")} autoFocus={!faq.name} />
			<Textarea label="Answer" required rows={4} value={form.answer} onChange={set("answer")} hint={raw ? "Shown as HTML because it has rich formatting." : "Blank line between paragraphs."} />
			<div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
				<Select label="Category" options={FAQ_CATEGORIES} value={form.category} onChange={set("category")} />
				<Input label="Order" type="number" value={form.sequence ?? 10} onChange={set("sequence")} />
				<Switch className="pb-2" checked={Boolean(form.is_published)} onChange={(v) => set("is_published")(v ? 1 : 0)} label="Published" />
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{faq.name ? (
					<Button variant="ghost" size="sm" icon={Trash2} className="text-red-600" onClick={() => setConfirm(true)}>
						Delete
					</Button>
				) : null}
				<span className="flex-1" />
				<Button variant="secondary" size="sm" onClick={() => (faq.name ? setOpen(false) : onDone?.())}>
					Cancel
				</Button>
				<Button size="sm" icon={Save} loading={busy} onClick={() => save()}>
					Save
				</Button>
			</div>
			<ConfirmDialog open={confirm} tone="danger" title="Delete this question?" message={faq.question} confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate({ name: faq.name })} onClose={() => setConfirm(false)} />
		</Card>
	)
}

/* ------------------------------------------------------------------ Testimonials */

function Testimonials() {
	const [adding, setAdding] = useState(false)
	const q = useApi(`${API}list_testimonials`, {})
	const lookups = useLookups()
	const programmes = (lookups.data?.programmes || []).map((p) => ({ value: p.name, label: p.programme_name || p.name }))
	return (
		<>
			<div className="mb-4 flex items-center justify-between gap-3">
				<p className="text-sm text-ink-soft">Shown on the home page in order. Unpublished ones stay here for later.</p>
				<Button icon={Plus} onClick={() => setAdding(true)} disabled={adding}>
					Add testimonial
				</Button>
			</div>
			{adding ? (
				<div className="mb-4">
					<TestimonialRow t={{ person_name: "", role_title: "", programme: "", photo: "", quote: "", is_published: 1, sequence: 10 }} programmes={programmes} onDone={() => setAdding(false)} initiallyOpen />
				</div>
			) : null}
			<QueryState query={q} skeleton={<SkeletonRows rows={4} />}>
				{(d) =>
					d.data.length ? (
						<div className="grid gap-4 md:grid-cols-2">
							{d.data.map((t) => (
								<TestimonialRow key={t.name} t={t} programmes={programmes} />
							))}
						</div>
					) : adding ? null : (
						<Card>
							<Empty icon={MessageSquareQuote} title="No testimonials yet" subtitle="Short words from students, graduates and partners build trust with new applicants." />
						</Card>
					)
				}
			</QueryState>
		</>
	)
}

function TestimonialRow({ t, programmes, onDone, initiallyOpen = false }) {
	const qc = useQueryClient()
	const [open, setOpen] = useState(initiallyOpen)
	const [form, setForm] = useState(t)
	const [seen, setSeen] = useState(t)
	if (t !== seen && !open) {
		setSeen(t)
		setForm(t)
	}
	const [busy, setBusy] = useState(false)
	const [confirm, setConfirm] = useState(false)
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const remove = useAction(`${API}delete_testimonial`, { invalidate: INVALIDATE, success: "Testimonial removed" })
	const save = async (patch) => {
		const next = { ...form, ...(patch || {}) }
		if (!next.person_name.trim() || !next.quote.trim()) return toast.error("Add the person's name and their words")
		setBusy(true)
		try {
			await frappe.call(`${API}save_testimonial`, {
				data: {
					...(t.name ? { name: t.name } : {}),
					person_name: next.person_name.trim(),
					role_title: next.role_title || null,
					programme: next.programme || null,
					photo: next.photo || null,
					quote: next.quote.trim(),
					is_published: next.is_published ? 1 : 0,
					sequence: Number(next.sequence) || 0,
				},
			})
			qc.invalidateQueries({ predicate: (qq) => typeof qq.queryKey[0] === "string" && qq.queryKey[0].startsWith(API) })
			toast.success(t.name ? "Saved" : "Testimonial added")
			if (patch === undefined) setOpen(false)
			onDone?.()
		} catch (e) {
			toast.error(e?.message || "Couldn't save")
		} finally {
			setBusy(false)
		}
	}
	if (!open) {
		return (
			<Card className="flex gap-4 p-4">
				<Avatar name={t.person_name} src={t.photo} size={48} />
				<div className="min-w-0 flex-1">
					<blockquote className="line-clamp-4 font-serif text-[15px] italic text-ink">“{t.quote}”</blockquote>
					<div className="mt-2 text-sm font-semibold text-ink">{t.person_name}</div>
					<div className="text-xs text-ink-soft">{[t.role_title, t.programme].filter(Boolean).join(" · ")}</div>
					<div className="mt-3 flex items-center gap-3">
						<Switch checked={Boolean(t.is_published)} onChange={(v) => save({ is_published: v ? 1 : 0 })} label="Published" disabled={busy} />
						{t.is_published ? null : <Badge tone="gray" size="xs">Hidden</Badge>}
						<span className="text-xs text-ink-soft">#{t.sequence}</span>
						<Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
							Edit
						</Button>
					</div>
				</div>
			</Card>
		)
	}
	return (
		<Card className="space-y-3 border-brand-200 p-4 md:col-span-2">
			<div className="grid gap-3 sm:grid-cols-3">
				<Input label="Name" required value={form.person_name} onChange={set("person_name")} />
				<Input label="Role or title" value={form.role_title || ""} onChange={set("role_title")} placeholder="e.g. Class of 2024, Pastor" />
				<Select label="Programme" placeholder="None" options={programmes} value={form.programme || ""} onChange={set("programme")} />
			</div>
			<div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
				<Textarea label="Their words" required rows={5} value={form.quote} onChange={set("quote")} hint={`${form.quote.length} characters · two or three sentences read best.`} />
				<ImageField label="Photo" value={form.photo} onChange={set("photo")} aspect="aspect-square" meta={t.name ? { doctype: "Testimonial", docname: t.name, fieldname: "photo" } : null} />
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Switch checked={Boolean(form.is_published)} onChange={(v) => set("is_published")(v ? 1 : 0)} label="Published" />
				<Input aria-label="Order" className="w-24" type="number" value={form.sequence ?? 10} onChange={set("sequence")} />
				{t.name ? (
					<Button variant="ghost" size="sm" icon={Trash2} className="text-red-600" onClick={() => setConfirm(true)}>
						Delete
					</Button>
				) : null}
				<span className="flex-1" />
				<Button variant="secondary" size="sm" onClick={() => (t.name ? setOpen(false) : onDone?.())}>
					Cancel
				</Button>
				<Button size="sm" icon={Save} loading={busy} onClick={() => save()}>
					Save
				</Button>
			</div>
			<ConfirmDialog open={confirm} tone="danger" title="Delete this testimonial?" message={t.person_name} confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate({ name: t.name })} onClose={() => setConfirm(false)} />
		</Card>
	)
}
