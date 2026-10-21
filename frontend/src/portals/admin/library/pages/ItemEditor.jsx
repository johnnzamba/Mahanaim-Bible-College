import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { BookOpen, ExternalLink, FileDown, Library, Save, Trash2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, Card, FileDrop, Input, PageHeader, Panel, QueryState, RadioCards, Select, SkeletonRows, Switch, Textarea } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, fileSize, money, num } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { ACCESS_LEVELS, API, DIGITAL_TYPES, ITEM_TYPES, LibTabs, NoAccess, SUBJECTS, dueText, toneOf, useLibRoles } from "../components/common"
import { Stat, nullify, useLookups } from "../components/kit"
import { IssueLoanModal } from "../components/IssueLoan"

const BLANK = {
	title: "",
	item_type: "Book",
	authors: "",
	subject: "General",
	isbn: "",
	publisher: "",
	publication_year: "",
	edition: "",
	call_number: "",
	cover_image: "",
	description: "",
	access_level: "Students",
	is_active: 1,
	digital_file: "",
	external_url: "",
	campus: "",
	location: "",
	total_copies: 1,
}
const KEYS = Object.keys(BLANK)
const pick = (doc) => Object.fromEntries(KEYS.map((k) => [k, doc?.[k] ?? BLANK[k] ?? ""]))

export default function ItemEditor() {
	const { name } = useParams()
	const isNew = name === "new"
	const { canRead } = useLibRoles()
	const q = useApi(`${API}get_item`, { name }, { enabled: canRead && !isNew })
	if (!canRead) return <NoAccess title="Catalogue" />
	if (isNew) return <Editor doc={null} />
	return (
		<>
			<LibTabs />
			<QueryState query={q} skeleton={<SkeletonRows rows={10} />}>
				{(doc) => <Editor doc={doc} />}
			</QueryState>
		</>
	)
}

function Editor({ doc }) {
	const { canManage } = useLibRoles()
	const nav = useNavigate()
	const qc = useQueryClient()
	const lookups = useLookups()
	const initial = useMemo(() => pick(doc), [doc])
	const [form, setForm] = useState(initial)
	const [seen, setSeen] = useState(initial)
	if (initial !== seen) {
		setSeen(initial)
		setForm(initial)
	}
	const [saving, setSaving] = useState(false)
	const [uploading, setUploading] = useState("")
	const [issuing, setIssuing] = useState(false)
	const dirty = KEYS.some((k) => String(form[k] ?? "") !== String(initial[k] ?? ""))
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }))
	const ro = !canManage
	const digitalType = DIGITAL_TYPES.has(form.item_type)
	const needsDigital = digitalType && !form.digital_file && !form.external_url
	const onLoan = doc ? Number(doc.total_copies || 0) - Number(doc.available_copies || 0) : 0
	const campuses = (lookups.data?.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))
	const externalHref = safeUrl(form.external_url)

	const upload = (field, isPrivate) => async (file) => {
		if (field === "cover_image" && !file.type.startsWith("image/")) return toast.error("Choose an image (JPG, PNG or WebP)")
		if (file.size > 50 * 1024 * 1024) return toast.error("Files must be under 50 MB")
		setUploading(field)
		try {
			const meta = doc ? { doctype: "Library Item", docname: doc.name, fieldname: field } : {}
			const r = await frappe.uploadFile(file, isPrivate, meta)
			setForm((f) => ({ ...f, [field]: r.file_url }))
			if (field === "digital_file") toast.success(`${file.name} (${fileSize(file.size)}) uploaded. Save to keep it.`)
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setUploading("")
		}
	}

	const save = async (e) => {
		e?.preventDefault()
		if (!form.title.trim()) return toast.error("Give the item a title")
		const data = nullify({
			...form,
			publication_year: form.publication_year ? Number(form.publication_year) : "",
			total_copies: Number(form.total_copies) || 0,
			is_active: form.is_active ? 1 : 0,
		})
		if (doc) data.name = doc.name
		setSaving(true)
		try {
			const saved = await frappe.call(`${API}save_item`, { data })
			qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith(API) && x.queryKey[0] !== `${API}get_item` })
			if (doc) {
				qc.setQueryData([`${API}get_item`, { name: doc.name }], { ...saved, loans: doc.loans })
				toast.success("Item saved")
			} else {
				toast.success(`${saved.title} added to the catalogue`)
				nav(`/admin/library/catalogue/${encodeURIComponent(saved.name)}`, { replace: true })
			}
		} catch (err) {
			toast.error(err?.message || "Couldn't save")
		} finally {
			setSaving(false)
		}
	}

	return (
		<>
			{doc ? null : <LibTabs />}
			<PageHeader
				back={{ to: "/admin/library/catalogue", label: "Catalogue" }}
				eyebrow={doc ? doc.name : "New item"}
				title={doc ? doc.title : "Add to the catalogue"}
				subtitle={doc ? [doc.item_type, doc.authors, doc.subject].filter(Boolean).join(" · ") : "A book, journal, thesis or digital resource."}
				actions={
					doc && canManage ? (
						<Button variant="secondary" icon={BookOpen} disabled={!doc.is_active || !doc.available_copies} onClick={() => setIssuing(true)}>
							Issue a copy
						</Button>
					) : null
				}
			/>
			{ro ? (
				<Alert tone="info" className="mb-4">
					You can view the catalogue. Only the Library Officer can change it.
				</Alert>
			) : null}
			<form onSubmit={save} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<fieldset disabled={ro} className="min-w-0 space-y-5">
					<Card className="p-5">
						<h3 className="mb-4 font-semibold text-ink">Catalogue details</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<Input label="Title" required className="sm:col-span-2" value={form.title} onChange={set("title")} />
							<Select label="Type" options={ITEM_TYPES} value={form.item_type} onChange={set("item_type")} />
							<Select label="Subject" options={SUBJECTS} value={form.subject} onChange={set("subject")} />
							<Input label="Author(s)" className="sm:col-span-2" value={form.authors} onChange={set("authors")} hint="Separate several authors with commas." />
							<Input label="Publisher" value={form.publisher} onChange={set("publisher")} />
							<div className="grid grid-cols-2 gap-3">
								<Input label="Year" type="number" min="1400" max={new Date().getFullYear() + 1} value={form.publication_year} onChange={set("publication_year")} />
								<Input label="Edition" value={form.edition} onChange={set("edition")} />
							</div>
							<Input label="ISBN / ISSN" value={form.isbn} onChange={set("isbn")} />
							<Input label="Call number" value={form.call_number} onChange={set("call_number")} placeholder="e.g. 220.7 BRU" />
							<Textarea label="Description" rows={4} className="sm:col-span-2" value={form.description} onChange={set("description")} hint="Shown in the online catalogue." />
						</div>
					</Card>

					<Card className="p-5">
						<h3 className="mb-1 font-semibold text-ink">Copies & shelf</h3>
						<p className="mb-4 text-sm text-ink-soft">Physical copies that can be lent. Use 0 for a digital-only item.</p>
						<div className="grid gap-4 sm:grid-cols-3">
							<Input label="Total copies" type="number" min={Math.max(0, onLoan)} value={form.total_copies} onChange={set("total_copies")} hint={doc ? `${num(onLoan)} out on loan now` : null} />
							<Select label="Campus" placeholder="Any campus" options={campuses} value={form.campus} onChange={set("campus")} />
							<Input label="Shelf location" value={form.location} onChange={set("location")} placeholder="e.g. Stack B, shelf 3" />
						</div>
					</Card>

					<Card className="p-5">
						<h3 className="mb-1 font-semibold text-ink">E-library</h3>
						<p className="mb-4 text-sm text-ink-soft">Upload a file or link to an external resource. E-Books, audio and video need one of these.</p>
						{needsDigital ? (
							<Alert tone="warning" className="mb-4">
								{form.item_type} items need an uploaded file or an external link.
							</Alert>
						) : null}
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<FileDrop
									label="Digital file"
									hint={form.access_level === "Public" ? "Stored as a public file." : "Stored privately; readers get a short-lived download link."}
									onFile={upload("digital_file", form.access_level !== "Public")}
									busy={uploading === "digital_file"}
									value={form.digital_file}
								/>
								{form.digital_file ? (
									<div className="flex items-center gap-3 text-sm">
										<a href={safeUrl(form.digital_file)} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-brand-700 hover:underline">
											<FileDown size={14} className="shrink-0" /> <span className="truncate">{form.digital_file.split("/").pop()}</span>
										</a>
										{ro ? null : (
											<button type="button" className="shrink-0 text-red-600 hover:underline" onClick={() => set("digital_file")("")}>
												Remove
											</button>
										)}
									</div>
								) : null}
							</div>
							<div className="space-y-2">
								<Input label="External link" type="url" placeholder="https://…" value={form.external_url} onChange={set("external_url")} hint="Must start with http:// or https://" />
								{externalHref ? (
									<a href={externalHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
										<ExternalLink size={13} /> Open link
									</a>
								) : null}
							</div>
						</div>
					</Card>
				</fieldset>

				<div className="space-y-5">
					<fieldset disabled={ro} className="space-y-5">
						<Card className="p-5">
							<h3 className="mb-3 font-semibold text-ink">Cover</h3>
							{form.cover_image ? (
								<div className="relative mx-auto mb-3 w-36">
									<img src={form.cover_image} alt="" className="aspect-[2/3] w-full rounded-lg object-cover shadow" />
									{ro ? null : (
										<button type="button" onClick={() => set("cover_image")("")} className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-surface/90 px-1.5 py-0.5 text-xs font-semibold text-red-600 shadow">
											<Trash2 size={11} /> Remove
										</button>
									)}
								</div>
							) : null}
							<FileDrop label={null} hint="JPG or PNG, portrait." accept="image/*" onFile={upload("cover_image", false)} busy={uploading === "cover_image"} />
						</Card>
						<Card className="space-y-4 p-5">
							<h3 className="font-semibold text-ink">Who can see it</h3>
							<RadioCards cols={1} options={ACCESS_LEVELS} value={form.access_level} onChange={set("access_level")} />
							<Switch label="Active" description="Inactive items are hidden from the catalogue and can't be borrowed." checked={Boolean(form.is_active)} onChange={(v) => set("is_active")(v ? 1 : 0)} />
						</Card>
					</fieldset>
					{doc ? (
						<Card className="p-5">
							<h3 className="mb-3 font-semibold text-ink">Circulation</h3>
							<div className="grid grid-cols-2 gap-2.5">
								<Stat label="On the shelf" value={`${num(doc.available_copies)} / ${num(doc.total_copies)}`} />
								<Stat label="Times lent" value={num(doc.loans_count)} />
								<Stat label="Downloads" value={num(doc.downloads)} />
								<Stat label="Status" value={doc.is_active ? "Active" : "Inactive"} tone={doc.is_active ? "text-brand-700" : "text-ink-soft"} />
							</div>
						</Card>
					) : null}
				</div>

				{canManage ? (
					<div className="sticky bottom-4 z-20 flex justify-end lg:col-span-2">
						<div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lift">
							<span className={`text-sm ${dirty ? "text-amber-700" : "text-ink-soft"}`}>{doc ? (dirty ? "Unsaved changes" : "All changes saved") : "New item"}</span>
							{doc && dirty ? (
								<Button variant="ghost" size="sm" onClick={() => setForm(initial)}>
									Discard
								</Button>
							) : null}
							<Button type="submit" icon={Save} loading={saving} disabled={Boolean(doc) && !dirty}>
								{doc ? "Save item" : "Add item"}
							</Button>
						</div>
					</div>
				) : null}
			</form>

			{doc ? <LoanHistory doc={doc} /> : null}
			{doc ? <IssueLoanModal open={issuing} onClose={() => setIssuing(false)} item={doc} /> : null}
		</>
	)
}

function LoanHistory({ doc }) {
	const loans = doc.loans || []
	return (
		<Panel title="Loans" subtitle="The 50 most recent loans and requests for this item." icon={Library} className="mt-5" bodyClass="p-0">
			<DataTable
				rows={loans}
				cols={[
					{
						key: "borrower_name",
						label: "Borrower",
						render: (r) => (
							<span className="block min-w-0">
								<span className="block truncate font-medium text-ink">{r.borrower_name}</span>
								<span className="block truncate text-xs text-ink-soft">
									{r.borrower_type} · {r.name}
								</span>
							</span>
						),
					},
					{ key: "issue_date", label: "Issued", render: (r) => date(r.issue_date) },
					{
						key: "due_date",
						label: "Due / returned",
						render: (r) => (
							<span className="block text-sm">
								{r.return_date ? `Returned ${date(r.return_date)}` : r.due_date ? date(r.due_date) : "—"}
								{dueText(r) ? <span className={`block text-xs ${r.status === "Overdue" ? "text-red-600" : "text-ink-soft"}`}>{dueText(r)}</span> : null}
							</span>
						),
					},
					{ key: "fine_amount", label: "Fine", align: "right", hideOnMobile: true, render: (r) => (Number(r.fine_amount) > 0 ? `${money(r.fine_amount)}${r.fine_paid ? " paid" : ""}` : "—") },
					{ key: "status", label: "Status", render: (r) => <Badge status={r.status} tone={toneOf(r.status)} size="xs" /> },
				]}
				rowTo={(r) => `/admin/library/loans?loan=${encodeURIComponent(r.name)}`}
				empty="Never borrowed yet"
				emptyIcon={BookOpen}
				pageSize={10}
			/>
		</Panel>
	)
}
