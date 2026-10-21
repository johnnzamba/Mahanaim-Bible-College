import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, Ban, CheckCircle2, ChevronDown, ChevronsUpDown, FilePlus2, History, PencilLine, UserRoundCog, X } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Button, Empty, ErrorState, SkeletonRows, TONE } from "@/shared/components/ui"
import { SearchInput } from "@/shared/components/kit"
import { dateTime, num } from "@/shared/utils/format"
import { A, DateRange, ExportButton, FilterSelect, Pager, RecordLink, rowsOf, since, useRecordRoute, usePaged, useUrlFilters, useUrlSearch } from "../lib"

const KEYS = ["doctype", "docname", "user", "from", "to", "q"]

const ACTIONS = {
	created: { label: "Created", icon: FilePlus2, tone: "green" },
	submitted: { label: "Submitted", icon: CheckCircle2, tone: "blue" },
	cancelled: { label: "Cancelled", icon: Ban, tone: "red" },
	updated: { label: "Updated", icon: PencilLine, tone: "brand" },
}

function actionOf(r) {
	if (r.is_new) return "created"
	const ds = (r.changed || []).find((c) => c.field === "docstatus")
	if (ds && /cancel/i.test(String(ds.new))) return "cancelled"
	if (ds && /submit/i.test(String(ds.new))) return "submitted"
	return "updated"
}

function summarise(r) {
	const labels = [...new Set((r.changed || []).filter((c) => c.field !== "docstatus").map((c) => c.label || c.field))]
	const parts = []
	if (labels.length) parts.push(labels.length > 3 ? `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more` : labels.join(", "))
	if (r.added) parts.push(`${r.added} row${r.added === 1 ? "" : "s"} added`)
	if (r.removed) parts.push(`${r.removed} row${r.removed === 1 ? "" : "s"} removed`)
	if (!parts.length) return r.is_new ? "Record created" : "Saved without field changes"
	return parts.join(" · ")
}

export default function Changes() {
	const filters = useUrlFilters(KEYS)
	const f = filters.values
	const [search, setSearch] = useUrlSearch(filters)
	const doctypes = useApi(`${A}audit_doctypes`, {}, { staleTime: 30 * 60_000 })
	const people = useApi(`${A}audit_summary`, {}, { staleTime: 5 * 60_000 })
	const list = usePaged(`${A}document_changes`, { doctype: f.doctype, docname: f.docname, user: f.user, from_date: f.from, to_date: f.to, search: f.q })
	const [open, setOpen] = useState(() => new Set())
	const allOpen = list.rows.length > 0 && list.rows.every((r) => open.has(r.name))
	const toggle = (name) =>
		setOpen((s) => {
			const n = new Set(s)
			n.has(name) ? n.delete(name) : n.add(name)
			return n
		})

	const groups = useMemo(() => {
		const g = {}
		for (const d of rowsOf(doctypes.data)) (g[d.module || "Other"] ||= []).push(d)
		return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
	}, [doctypes.data])
	const users = useMemo(() => {
		const m = new Map()
		for (const u of people.data?.top_users || []) m.set(u.user, u.full_name)
		for (const r of list.rows) if (r.owner && !m.has(r.owner)) m.set(r.owner, r.owner_name)
		return [...m.entries()]
	}, [people.data, list.rows])

	return (
		<div>
			<div className="card mb-4 p-3 sm:p-4">
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
					<SearchInput value={search} onChange={setSearch} placeholder="Search record, value or user…" className="sm:col-span-2 lg:min-w-[13rem] lg:flex-1" />
					<FilterSelect label="Record type" value={f.doctype} onChange={(v) => filters.set("doctype", v)} className="lg:w-44">
						<option value="">All record types</option>
						{groups.map(([mod, items]) => (
							<optgroup key={mod} label={mod}>
								{items.map((d) => (
									<option key={d.value} value={d.value}>
										{d.label || d.value}
									</option>
								))}
							</optgroup>
						))}
					</FilterSelect>
					<UserFilter value={f.user} onChange={(v) => filters.set("user", v)} users={users} />
					<DateRange from={f.from} to={f.to} onFrom={(v) => filters.set("from", v)} onTo={(v) => filters.set("to", v)} className="sm:col-span-2 lg:col-span-1" />
				</div>
				{filters.any ? (
					<div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
						{f.docname ? (
							<FilterPill onClear={() => filters.set("docname", "")}>
								Record <b className="font-semibold">{f.docname}</b>
							</FilterPill>
						) : null}
						{f.user ? (
							<FilterPill onClear={() => filters.set("user", "")}>
								User <b className="font-semibold">{f.user}</b>
							</FilterPill>
						) : null}
						<button
							type="button"
							className="font-semibold text-brand-700 hover:underline"
							onClick={() => {
								setSearch("")
								filters.clear()
							}}
						>
							Clear all filters
						</button>
					</div>
				) : null}
			</div>

			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<span className="text-sm text-ink-soft">
					{list.query.data ? `${num(list.total)} change${list.total === 1 ? "" : "s"}` : " "}
					{list.query.isFetching && list.query.data ? " · updating…" : ""}
				</span>
				<div className="flex items-center gap-2">
					{list.rows.length ? (
						<Button size="sm" variant="ghost" icon={ChevronsUpDown} onClick={() => setOpen(allOpen ? new Set() : new Set(list.rows.map((r) => r.name)))}>
							{allOpen ? "Collapse all" : "Expand all"}
						</Button>
					) : null}
					<ExportButton kind="document_changes" filters={{ doctype: f.doctype, docname: f.docname, user: f.user, from_date: f.from, to_date: f.to, search: f.q }} disabled={!list.total} />
				</div>
			</div>

			<div className="card overflow-hidden">
				{list.query.isError && !list.query.data ? (
					<ErrorState error={list.query.error} onRetry={list.query.refetch} />
				) : !list.query.data ? (
					<SkeletonRows rows={8} className="p-4" />
				) : !list.rows.length ? (
					<Empty
						icon={History}
						title="No changes match these filters"
						subtitle="Widen the dates or clear a filter. Only saves made through the app are recorded."
						action={
							filters.any ? (
								<Button size="sm" variant="secondary" onClick={() => (setSearch(""), filters.clear())}>
									Clear filters
								</Button>
							) : null
						}
					/>
				) : (
					<ul className={clsx("divide-y divide-line", list.query.isFetching && "opacity-70 transition-opacity")}>
						{list.rows.map((r) => (
							<ChangeRow key={r.name} row={r} open={open.has(r.name)} onToggle={() => toggle(r.name)} onHistory={() => filters.only({ doctype: r.ref_doctype, docname: r.docname })} filters={filters} />
						))}
					</ul>
				)}
			</div>
			<Pager list={list} />
		</div>
	)
}

function UserFilter({ value, onChange, users }) {
	const [text, setText] = useState(value)
	const [seen, setSeen] = useState(value)
	if (seen !== value) {
		setSeen(value)
		setText(value)
	}
	const commit = () => text.trim() !== value && onChange(text.trim())
	return (
		<div className="relative">
			<input
				type="text"
				list="audit-users"
				aria-label="User"
				value={text}
				placeholder="User email"
				onChange={(e) => {
					setText(e.target.value)
					if (users.some(([u]) => u === e.target.value)) onChange(e.target.value)
				}}
				onBlur={commit}
				onKeyDown={(e) => e.key === "Enter" && commit()}
				className="input h-10 w-full py-0 text-sm lg:w-44"
			/>
			<datalist id="audit-users">
				{users.map(([u, n]) => (
					<option key={u} value={u}>
						{n && n !== u ? n : undefined}
					</option>
				))}
			</datalist>
		</div>
	)
}

function FilterPill({ children, onClear }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-brand-800 dark:text-brand-200">
			<span className="truncate">{children}</span>
			<button type="button" aria-label="Remove filter" onClick={onClear} className="grid h-5 w-5 place-items-center rounded-full hover:bg-brand-100 dark:hover:bg-white/10">
				<X size={12} />
			</button>
		</span>
	)
}

function ChangeRow({ row: r, open, onToggle, onHistory, filters }) {
	const act = ACTIONS[actionOf(r)]
	const Icon = act.icon
	const single = r.docname === r.ref_doctype
	const who = r.owner_name || r.owner
	return (
		<li>
			<div
				role="button"
				tabIndex={0}
				aria-expanded={open}
				onClick={onToggle}
				onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
				className={clsx("flex cursor-pointer items-start gap-3 px-4 py-3 transition hover:bg-cream/60 sm:px-5", open && "bg-cream/50")}
			>
				<span className={clsx("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONE[act.tone].soft)} title={act.label}>
					<Icon size={17} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						{single ? <span className="font-semibold text-ink">{r.ref_doctype}</span> : <RecordLink doctype={r.ref_doctype} name={r.docname} />}
						{single ? null : (
							<Badge tone="gray" size="xs">
								{r.ref_doctype}
							</Badge>
						)}
						{act.label !== "Updated" ? (
							<Badge tone={act.tone} size="xs">
								{act.label}
							</Badge>
						) : null}
						{r.impersonated_by ? (
							<Badge tone="orange" size="xs">
								<UserRoundCog size={11} className="mr-0.5 inline" /> via {r.impersonated_by}
							</Badge>
						) : null}
					</div>
					<p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{summarise(r)}</p>
					<p className="mt-1 text-xs text-ink-soft sm:hidden">
						{who} · {dateTime(r.creation)}
					</p>
				</div>
				<div className="hidden shrink-0 text-right sm:block">
					<button
						type="button"
						className="text-sm font-medium text-ink hover:text-brand-700 hover:underline"
						title={`Show changes by ${r.owner}`}
						onClick={(e) => (e.stopPropagation(), filters.set("user", r.owner))}
					>
						{who}
					</button>
					<div className="text-xs text-ink-soft" title={dateTime(r.creation)}>
						{dateTime(r.creation)}
					</div>
				</div>
				<ChevronDown size={16} className={clsx("mt-2.5 shrink-0 text-ink-soft transition", open && "rotate-180")} />
			</div>
			{open ? <Diff row={r} onHistory={onHistory} /> : null}
		</li>
	)
}

function Diff({ row: r, onHistory }) {
	const route = useRecordRoute()(r.ref_doctype, r.docname)
	const changed = r.changed || []
	return (
		<div className="bg-cream/50 px-4 pb-4 pt-1 sm:pl-[4.25rem] sm:pr-5">
			{changed.length ? (
				<div className="overflow-hidden rounded-xl border border-line bg-surface">
					<div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] gap-3 border-b border-line bg-cream px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft sm:grid">
						<span>Field</span>
						<span>Before</span>
						<span>After</span>
					</div>
					<div className="divide-y divide-line">
						{changed.map((c, i) => (
							<div key={`${c.field}:${i}`} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] sm:gap-3">
								<div className="min-w-0">
									<div className="text-sm font-medium text-ink">{c.label || c.field}</div>
									<div className="truncate font-mono text-[11px] text-ink-soft" title={c.field}>
										{c.field}
									</div>
								</div>
								<Val v={c.old} kind="old" />
								<Val v={c.new} kind="new" />
							</div>
						))}
					</div>
				</div>
			) : (
				<p className="rounded-xl border border-dashed border-line bg-surface px-3 py-3 text-sm text-ink-soft">
					{r.is_new ? "The record was created; Frappe keeps no field list for creations." : "No individual field values changed in this save."}
				</p>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
				{r.added ? <span className="font-medium text-emerald-700 dark:text-emerald-300">+{num(r.added)} table row{r.added === 1 ? "" : "s"} added</span> : null}
				{r.removed ? <span className="font-medium text-red-700 dark:text-red-300">−{num(r.removed)} table row{r.removed === 1 ? "" : "s"} removed</span> : null}
				{r.row_changed ? <span>{num(r.row_changed)} table row{r.row_changed === 1 ? "" : "s"} edited</span> : null}
				<span>
					By {r.owner_name || r.owner}
					{r.owner_name && r.owner_name !== r.owner ? ` (${r.owner})` : ""} · {since(r.creation)}
				</span>
				<span className="ml-auto flex flex-wrap items-center gap-3">
					<button type="button" onClick={onHistory} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
						<History size={13} /> Full history of this record
					</button>
					{route ? (
						<Link to={route} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
							Open record <ArrowRight size={13} />
						</Link>
					) : null}
				</span>
			</div>
		</div>
	)
}

function Val({ v, kind }) {
	const empty = v === null || v === undefined || v === ""
	const text = empty ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v)
	return (
		<div
			className={clsx(
				"min-w-0 whitespace-pre-wrap break-words rounded-lg px-2 py-1 text-[13px] leading-snug",
				empty ? "italic text-ink-soft" : kind === "old" ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
			)}
		>
			<span className="mr-1.5 text-[10px] font-semibold uppercase not-italic tracking-wide opacity-60 sm:hidden">{kind === "old" ? "Before" : "After"}</span>
			{text}
		</div>
	)
}
