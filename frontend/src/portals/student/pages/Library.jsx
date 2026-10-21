import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import clsx from "clsx"
import {
	AlertTriangle,
	BookCopy,
	BookMarked,
	BookOpen,
	CalendarClock,
	ExternalLink,
	FileText,
	Headphones,
	Library as LibraryIcon,
	MapPin,
	Newspaper,
	PlayCircle,
	ScrollText,
	SlidersHorizontal,
	X,
} from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import {
	Alert,
	Badge,
	Button,
	ConfirmDialog,
	Drawer,
	Empty,
	KeyValueGrid,
	PageHeader,
	Pagination,
	QueryState,
	Select,
	Skeleton,
	StatCard,
	Tabs,
	Textarea,
} from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { DataTable, SearchInput, useDebounced } from "@/shared/components/kit"
import { date, money } from "@/shared/utils/format"
import { API, INV, plural, safeUrl } from "../components/lib"

const PAGE = 24
const TYPE_ICON = { Book: BookOpen, "E-Book": BookOpen, Journal: Newspaper, Thesis: ScrollText, Audio: Headphones, Video: PlayCircle, Commentary: BookMarked, Article: FileText }
const SORTS = [
	{ value: "title", label: "Title A–Z" },
	{ value: "newest", label: "Newest added" },
	{ value: "popular", label: "Most popular" },
	{ value: "year", label: "Publication year" },
]

export default function Library() {
	const [params, setParams] = useSearchParams()
	const tab = params.get("tab") || "catalogue"
	const loans = useApi(API.loans, { include_history: 1 })
	const [itemName, setItemName] = useState(params.get("item") || null)
	const active = loans.data?.active || []
	const overdue = active.filter((l) => l.status === "Overdue" || (l.days_left != null && l.days_left < 0))
	const setTab = (t) => setParams((p) => (t === "catalogue" ? p.delete("tab") : p.set("tab", t), p), { replace: true })

	return (
		<>
			<PageHeader eyebrow="Campus life" title="Library" subtitle="Search the catalogue, read digital resources and track your loans." />
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="On loan" value={active.filter((l) => l.status !== "Requested").length} icon={BookCopy} loading={loans.isLoading} hint={loans.data ? `limit ${loans.data.limit}` : null} />
				<StatCard label="Requested" value={active.filter((l) => l.status === "Requested").length} icon={CalendarClock} tone="blue" loading={loans.isLoading} />
				<StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "red" : "gray"} loading={loans.isLoading} />
				<StatCard label="Fines due" value={money(loans.data?.fines_due || 0)} icon={ScrollText} tone={loans.data?.fines_due ? "orange" : "gray"} loading={loans.isLoading} />
			</div>
			{overdue.length ? (
				<Alert tone="error" title={`${plural(overdue.length, "item")} overdue`} className="mb-4" action={tab !== "loans" ? <Button size="sm" variant="secondary" onClick={() => setTab("loans")}>View loans</Button> : null}>
					Return {overdue.map((l) => l.item_title).join(", ")} to the library to stop fines growing.
				</Alert>
			) : null}
			<Tabs
				className="mb-4 pb-px"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "catalogue", label: "Catalogue" },
					{ id: "digital", label: "E-library" },
					{ id: "loans", label: "My loans", count: active.length || undefined },
				]}
			/>
			{tab === "loans" ? <Loans q={loans} onOpen={setItemName} /> : <Catalogue key={tab} digital={tab === "digital"} onOpen={setItemName} />}
			<ItemDrawer name={itemName} onClose={() => setItemName(null)} onOpen={setItemName} />
		</>
	)
}

function Catalogue({ digital, onOpen }) {
	const [search, setSearch] = useState("")
	const [f, setF] = useState({ subject: "", item_type: "", available: false, sort: "title" })
	const [page, setPage] = useState(1)
	const [showFilters, setShowFilters] = useState(false)
	const s = useDebounced(search, 350)
	const args = useMemo(
		() => ({
			search: s || undefined,
			subject: f.subject || undefined,
			item_type: f.item_type || undefined,
			available: f.available ? 1 : undefined,
			digital: digital ? 1 : undefined,
			sort: f.sort,
			start: (page - 1) * PAGE,
			page_length: PAGE,
		}),
		[s, f, page, digital]
	)
	const q = useApi(API.catalogue, args, { placeholderData: (prev) => prev })
	const facets = q.data?.facets || {}
	const set = (k, v) => (setF((x) => ({ ...x, [k]: v })), setPage(1))
	const activeCount = [f.subject, f.item_type, f.available].filter(Boolean).length
	const opts = (list, all) => [{ value: "", label: all }, ...(list || []).map((x) => ({ value: x.value, label: `${x.value} (${x.count})` }))]

	return (
		<div className="space-y-4">
			<div className="card space-y-3 p-3 sm:p-4">
				<div className="flex gap-2">
					<SearchInput className="flex-1" value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder={digital ? "Search e-books, articles, media…" : "Title, author, ISBN, subject or call number"} />
					<Button variant="secondary" className="md:hidden" icon={SlidersHorizontal} onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}>
						{activeCount ? activeCount : null}
						<span className="sr-only">Filters</span>
					</Button>
				</div>
				<div className={clsx("grid gap-2 sm:grid-cols-2 md:grid md:grid-cols-4", showFilters ? "grid" : "hidden")}>
					<Select aria-label="Subject" value={f.subject} onChange={(e) => set("subject", e.target.value)} options={opts(facets.subject, "All subjects")} />
					<Select aria-label="Type" value={f.item_type} onChange={(e) => set("item_type", e.target.value)} options={opts(facets.item_type, "All types")} />
					<Select aria-label="Sort by" value={f.sort} onChange={(e) => set("sort", e.target.value)} options={SORTS} />
					<div className="flex items-center gap-2">
						{!digital ? (
							<button type="button" className={clsx("chip", f.available && "chip-active")} aria-pressed={f.available} onClick={() => set("available", !f.available)}>
								Available now
							</button>
						) : null}
						{activeCount ? (
							<button type="button" className="chip" onClick={() => (setF({ subject: "", item_type: "", available: false, sort: f.sort }), setPage(1))}>
								<X size={12} /> Clear
							</button>
						) : null}
					</div>
				</div>
			</div>
			<QueryState
				query={q}
				isEmpty={(d) => !d.data?.length}
				skeleton={
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
						{Array.from({ length: 12 }, (_, i) => (
							<Skeleton key={i} className="aspect-[3/4] rounded-2xl" />
						))}
					</div>
				}
				empty={
					<div className="card">
						<Empty icon={LibraryIcon} title="No items match" subtitle={s ? `Nothing found for "${s}". Try another word or clear filters.` : "Try clearing some filters."} />
					</div>
				}
			>
				{(d) => (
					<>
						<p className="text-xs text-ink-soft">{plural(d.total, "item")} found</p>
						<div className={clsx("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6", q.isFetching && "opacity-70")}>
							{d.data.map((it) => (
								<ItemCard key={it.name} it={it} onClick={() => onOpen(it.name)} />
							))}
						</div>
						<Pagination page={page} pageSize={PAGE} total={d.total} onChange={(p) => (setPage(p), window.scrollTo({ top: 0, behavior: "smooth" }))} />
					</>
				)}
			</QueryState>
		</div>
	)
}

function Cover({ it, className }) {
	const Icon = TYPE_ICON[it.item_type] || BookOpen
	const cover = safeUrl(it.cover_image)
	if (cover)
		return <img src={cover} alt="" loading="lazy" className={clsx("aspect-[3/4] w-full rounded-xl object-cover", className)} />
	return (
		<div className={clsx("hero-wash relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-xl text-white", className)} aria-hidden>
			<div className="pattern-dots absolute inset-0 opacity-30" />
			<div className="relative flex flex-col items-center gap-2 px-3 text-center">
				<Icon size={26} className="text-gold-300" />
				<span className="line-clamp-3 font-serif text-[13px] leading-snug">{it.title}</span>
			</div>
		</div>
	)
}

function ItemCard({ it, onClick }) {
	return (
		<button type="button" onClick={onClick} className="card group flex flex-col p-2 text-left transition hover:-translate-y-0.5 hover:shadow-soft" aria-label={`${it.title} by ${it.authors || "unknown author"}`}>
			<Cover it={it} />
			<div className="mt-2 flex min-w-0 flex-1 flex-col px-1 pb-1">
				<span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink group-hover:text-brand-700">{it.title}</span>
				<span className="mt-0.5 truncate text-[11.5px] text-ink-soft">
					{it.authors || "—"}
					{it.publication_year ? ` · ${it.publication_year}` : ""}
				</span>
				<span className="mt-auto flex flex-wrap gap-1 pt-1.5">
					{it.is_digital ? <Badge tone="blue" size="xs">Digital</Badge> : null}
					{it.is_physical ? (
						<Badge tone={it.available_copies ? "green" : "orange"} size="xs">
							{it.available_copies ? `${it.available_copies} available` : "On loan"}
						</Badge>
					) : null}
				</span>
			</div>
		</button>
	)
}

/** Opens a POST-derived URL without tripping popup blockers: the tab is opened synchronously, then pointed at the link. */
async function openDigital(name) {
	const w = window.open("about:blank", "_blank")
	if (w) w.opener = null
	try {
		const r = await frappe.call(API.accessDigital, { name })
		const url = safeUrl(r?.url)
		if (!url) throw new Error("This item has no valid link. Please tell the library.")
		if (w) w.location.href = url
		else window.location.assign(url)
		return r
	} catch (e) {
		w?.close()
		toast.error(e.message || "Couldn't open this item")
		throw e
	}
}

function ItemDrawer({ name, onClose, onOpen }) {
	const q = useApi(API.libItem, { name }, { enabled: Boolean(name) })
	const [remarks, setRemarks] = useState("")
	const [opening, setOpening] = useState(false)
	const req = useAction(API.requestLoan, {
		invalidate: [INV.library],
		success: "Request sent. You'll be notified when your copy is ready to collect.",
		onSuccess: () => setRemarks(""),
	})
	const it = q.data
	const read = async () => {
		setOpening(true)
		try {
			await openDigital(name)
		} catch {
			/* toast shown */
		} finally {
			setOpening(false)
		}
	}
	return (
		<Drawer open={Boolean(name)} onClose={onClose} title={it?.title || "Library item"} subtitle={it?.authors}>
			<QueryState query={q} skeleton={<Skeleton className="h-96 rounded-2xl" />}>
				{(it) => (
					<div className="space-y-5">
						<div className="flex gap-4">
							<Cover it={it} className="!w-28 shrink-0 sm:!w-36" />
							<div className="min-w-0 space-y-2">
								<div className="flex flex-wrap gap-1.5">
									<Badge tone="gray">{it.item_type}</Badge>
									{it.is_digital ? <Badge tone="blue">Digital</Badge> : null}
									{it.access_level && it.access_level !== "Public" ? <Badge tone="gold">{it.access_level}</Badge> : null}
								</div>
								{it.is_physical ? (
									<p className={clsx("text-sm font-semibold", it.available_copies ? "text-emerald-600" : "text-amber-600")}>
										{it.available_copies ? `${it.available_copies} of ${it.total_copies} copies on the shelf` : "All copies are on loan"}
									</p>
								) : null}
								{it.location || it.call_number ? (
									<p className="flex items-center gap-1.5 text-xs text-ink-soft">
										<MapPin size={12} /> {[it.call_number, it.location, it.campus].filter(Boolean).join(" · ")}
									</p>
								) : null}
								{it.is_digital ? (
									<Button size="sm" icon={ExternalLink} loading={opening} onClick={read} disabled={!it.can_access}>
										{it.item_type === "Video" || it.item_type === "Audio" ? "Play" : "Read online"}
									</Button>
								) : null}
							</div>
						</div>
						{it.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{it.description}</p> : null}
						<KeyValueGrid
							items={[
								{ label: "Subject", value: it.subject },
								{ label: "Publisher", value: it.publisher },
								{ label: "Year", value: it.publication_year },
								{ label: "Edition", value: it.edition },
								{ label: "ISBN", value: it.isbn },
								{ label: "Call number", value: it.call_number },
							].filter((x) => x.value)}
						/>
						{it.my_loan ? (
							<Alert tone={it.my_loan.status === "Overdue" ? "error" : "info"} title={`Your loan: ${it.my_loan.status}`}>
								{it.my_loan.status === "Requested"
									? "Your request is with the librarian. Collect the book at the issue desk when notified."
									: `Due ${date(it.my_loan.due_date)}${Number(it.my_loan.fine_amount) ? ` · fine ${money(it.my_loan.fine_amount)}` : ""}`}
							</Alert>
						) : it.can_borrow ? (
							<div className="rounded-2xl border border-line p-4">
								<h4 className="text-sm font-semibold text-ink">Borrow a physical copy</h4>
								<p className="mb-3 text-xs text-ink-soft">The librarian will set a copy aside and notify you to collect it.</p>
								<Textarea rows={2} label="Note (optional)" placeholder="e.g. I'll collect on Monday" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
								<Button className="mt-3 w-full sm:w-auto" icon={BookCopy} loading={req.isPending} onClick={() => req.mutate({ item: it.name, remarks: remarks || undefined })}>
									{it.available_copies ? "Request this book" : "Join the waiting list"}
								</Button>
							</div>
						) : null}
						{(it.related || []).length ? (
							<div>
								<h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">More on {it.subject}</h4>
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
									{it.related.map((r) => (
										<ItemCard key={r.name} it={r} onClick={() => onOpen(r.name)} />
									))}
								</div>
							</div>
						) : null}
					</div>
				)}
			</QueryState>
		</Drawer>
	)
}

function Loans({ q, onOpen }) {
	const [cancel, setCancel] = useState(null)
	const act = useAction(API.cancelLoan, { invalidate: [INV.library], success: "Request cancelled", onSuccess: () => setCancel(null) })
	return (
		<QueryState query={q} skeleton={<Skeleton className="h-64 rounded-2xl" />}>
			{(d) => (
				<div className="space-y-5">
					{d.active.length ? (
						<div className="grid gap-3 md:grid-cols-2">
							{d.active.map((l) => (
								<LoanCard key={l.name} l={l} onOpen={() => onOpen(l.library_item)} onCancel={() => setCancel(l)} />
							))}
						</div>
					) : (
						<div className="card">
							<Empty icon={BookCopy} title="No active loans" subtitle="Find a book in the catalogue and request it. Your loans and due dates show here." />
						</div>
					)}
					<section>
						<h3 className="mb-2 font-serif text-lg text-ink">History</h3>
						<DataTable
							rows={d.history}
							empty="No past loans"
							pageSize={10}
							onRow={(l) => onOpen(l.library_item)}
							cols={[
								{ key: "item_title", label: "Item", render: (l) => <span className="font-semibold text-ink">{l.item_title}</span> },
								{ key: "issue_date", label: "Borrowed", render: (l) => date(l.issue_date) },
								{ key: "return_date", label: "Returned", render: (l) => (l.return_date ? date(l.return_date) : "—") },
								{ key: "fine_amount", label: "Fine", align: "right", render: (l) => (Number(l.fine_amount) ? `${money(l.fine_amount)}${l.fine_paid ? " (paid)" : ""}` : "—") },
								{ key: "status", label: "Status", render: (l) => <Badge status={l.status} dot /> },
							]}
						/>
					</section>
					<ConfirmDialog
						open={Boolean(cancel)}
						title="Cancel this request?"
						message={cancel ? `Your request for "${cancel.item_title}" will be withdrawn.` : ""}
						confirmLabel="Cancel request"
						tone="danger"
						loading={act.isPending}
						onClose={() => setCancel(null)}
						onConfirm={() => act.mutate({ loan: cancel.name })}
					/>
				</div>
			)}
		</QueryState>
	)
}

function LoanCard({ l, onOpen, onCancel }) {
	const overdue = l.status === "Overdue" || (l.days_left != null && l.days_left < 0)
	const soon = !overdue && l.days_left != null && l.days_left <= 3
	return (
		<div className={clsx("card flex gap-3 p-4", overdue && "border-red-300 dark:border-red-500/40")}>
			<div className="min-w-0 flex-1">
				<button type="button" onClick={onOpen} className="line-clamp-2 text-left font-semibold text-ink hover:text-brand-700">
					{l.item_title}
				</button>
				<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
					<Badge status={l.status} dot size="xs" />
					{l.status === "Requested" ? <span>Requested {date(l.issue_date)}</span> : <span>Borrowed {date(l.issue_date)}</span>}
				</div>
				{Number(l.fine_amount) && !l.fine_paid ? <p className="mt-1.5 text-xs font-semibold text-red-600">Fine {money(l.fine_amount)} — pay at the library desk</p> : null}
			</div>
			<div className="shrink-0 text-right">
				{l.status === "Requested" ? (
					<Button size="sm" variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
				) : l.due_date ? (
					<>
						<div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Due</div>
						<div className={clsx("text-sm font-bold", overdue ? "text-red-600" : soon ? "text-amber-600" : "text-ink")}>{date(l.due_date, { day: "numeric", month: "short" })}</div>
						<div className={clsx("text-xs", overdue ? "text-red-600" : "text-ink-soft")}>
							{l.days_left == null ? "" : l.days_left < 0 ? `${plural(-l.days_left, "day")} late` : l.days_left === 0 ? "today" : `in ${plural(l.days_left, "day")}`}
						</div>
					</>
				) : null}
			</div>
		</div>
	)
}
