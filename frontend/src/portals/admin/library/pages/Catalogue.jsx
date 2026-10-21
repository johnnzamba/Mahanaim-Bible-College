import { useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, FileDown, Library, Link2, Plus } from "lucide-react"
import { Badge, PageHeader, ProgressBar, Select } from "@/shared/components/ui"
import { DataTable, ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { num } from "@/shared/utils/format"
import { ACCESS_LEVELS, API, ITEM_TYPES, LibTabs, NoAccess, SUBJECTS, toneOf, useLibRoles } from "../components/common"
import { usePaged } from "../components/kit"

const COLS = [
	{
		key: "title",
		label: "Title",
		render: (r) => (
			<span className="flex min-w-0 items-center gap-3">
				{r.cover_image ? (
					<img src={r.cover_image} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded object-cover shadow-sm" />
				) : (
					<span className="grid h-12 w-9 shrink-0 place-items-center rounded bg-cream text-ink-soft/50">
						<BookOpen size={15} />
					</span>
				)}
				<span className="min-w-0">
					<span className="block truncate font-semibold text-ink">{r.title}</span>
					<span className="block truncate text-xs text-ink-soft">
						{r.authors || "Unknown author"}
						{r.publication_year ? ` · ${r.publication_year}` : ""}
						{r.call_number ? ` · ${r.call_number}` : ""}
					</span>
				</span>
			</span>
		),
	},
	{ key: "item_type", label: "Type", hideOnMobile: true, render: (r) => <span className="whitespace-nowrap text-sm">{r.item_type}</span> },
	{ key: "subject", label: "Subject", hideOnMobile: true, render: (r) => <span className="text-sm text-ink-muted">{r.subject || "—"}</span> },
	{
		key: "available_copies",
		label: "Copies",
		sortValue: (r) => r.available_copies,
		render: (r) =>
			Number(r.total_copies) > 0 ? (
				<span className="block w-28 text-xs text-ink-soft">
					<span className="font-semibold text-ink">{num(r.available_copies)}</span> of {num(r.total_copies)} in
					<ProgressBar className="mt-1" size="sm" value={(r.available_copies / r.total_copies) * 100} tone={r.available_copies ? "brand" : "red"} />
				</span>
			) : (
				<span className="text-xs text-ink-soft">Digital only</span>
			),
	},
	{
		key: "digital",
		label: "Digital",
		hideOnMobile: true,
		render: (r) =>
			r.digital_file ? (
				<span className="inline-flex items-center gap-1 text-xs text-brand-700">
					<FileDown size={13} /> File · {num(r.downloads)}
				</span>
			) : r.external_url ? (
				<span className="inline-flex items-center gap-1 text-xs text-brand-700">
					<Link2 size={13} /> Link · {num(r.downloads)}
				</span>
			) : (
				<span className="text-xs text-ink-soft">—</span>
			),
	},
	{
		key: "access_level",
		label: "Access",
		render: (r) => (
			<span className="inline-flex flex-wrap gap-1">
				<Badge tone={toneOf(r.access_level)} size="xs">
					{r.access_level}
				</Badge>
				{r.is_active ? null : (
					<Badge tone="gray" size="xs">
						Inactive
					</Badge>
				)}
			</span>
		),
	},
]

const EXPORT = [
	{ key: "name", label: "ID" },
	{ key: "title", label: "Title" },
	{ key: "authors", label: "Authors" },
	{ key: "item_type", label: "Type" },
	{ key: "subject", label: "Subject" },
	{ key: "isbn", label: "ISBN" },
	{ key: "call_number", label: "Call number" },
	{ key: "total_copies", label: "Copies" },
	{ key: "available_copies", label: "Available" },
	{ key: "access_level", label: "Access" },
	{ key: "loans_count", label: "Loans" },
	{ key: "downloads", label: "Downloads" },
]

export default function Catalogue() {
	const { canRead, canManage } = useLibRoles()
	const [search, setSearch] = useState("")
	const [active, setActive] = useState("1")
	const [type, setType] = useState("")
	const [subject, setSubject] = useState("")
	const [access, setAccess] = useState("")
	const ds = useDebounced(search)
	const { query, rows, total, pager } = usePaged(`${API}list_items`, { search: ds, is_active: active, item_type: type, subject, access_level: access }, 25, { enabled: canRead })
	if (!canRead) return <NoAccess title="Catalogue" />
	const filtered = ds || type || subject || access
	return (
		<>
			<LibTabs />
			<PageHeader
				title="Catalogue"
				subtitle="Books, journals, theses and the e-library."
				actions={
					canManage ? (
						<Link to="/admin/library/catalogue/new" className="btn btn-primary">
							<Plus size={16} /> Add item
						</Link>
					) : null
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Title, author, ISBN or call number…"
				chips={[
					{ id: "1", label: "Active" },
					{ id: "0", label: "Inactive" },
					{ id: "", label: "All" },
				]}
				active={active}
				onChip={setActive}
				right={
					<div className="flex flex-wrap items-center gap-2">
						<Select aria-label="Type" className="w-32" placeholder="Any type" options={ITEM_TYPES} value={type} onChange={(e) => setType(e.target.value)} />
						<Select aria-label="Subject" className="w-44" placeholder="Any subject" options={SUBJECTS} value={subject} onChange={(e) => setSubject(e.target.value)} />
						<Select aria-label="Access" className="w-32" placeholder="Any access" options={ACCESS_LEVELS.map((a) => a.value)} value={access} onChange={(e) => setAccess(e.target.value)} />
						<ExportButton filename="library-catalogue.csv" cols={EXPORT} rows={rows} />
					</div>
				}
			/>
			<DataTable
				cols={COLS}
				query={query}
				rowTo={(r) => `/admin/library/catalogue/${encodeURIComponent(r.name)}`}
				empty={filtered ? "No items match" : active === "0" ? "No inactive items" : "The catalogue is empty"}
				emptyIcon={Library}
				emptyAction={
					canManage && !filtered ? (
						<Link to="/admin/library/catalogue/new" className="btn btn-primary btn-sm">
							<Plus size={14} /> Add the first item
						</Link>
					) : null
				}
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">
							{num(total)} item{total === 1 ? "" : "s"}
						</span>
						{pager}
					</div>
				}
			/>
		</>
	)
}
