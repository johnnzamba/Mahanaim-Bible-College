import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import {
	BookMarked,
	BookOpen,
	BookText,
	Download,
	ExternalLink,
	FileText,
	Filter,
	GraduationCap,
	Headphones,
	Library as LibraryIcon,
	LibraryBig,
	Lock,
	LogIn,
	MapPin,
	Newspaper,
	SearchX,
	Video,
} from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Checkbox, Drawer, Empty, ErrorState, KeyValueGrid, Pagination, Select, Skeleton, Textarea } from "@/shared/components/ui"
import { SearchInput, useDebounced } from "@/shared/components/kit"
import { useSession } from "@/shared/session"
import { num } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { Band, CtaBand, Feature, PageHero, Scripture } from "../components/Blocks"
import { Cover } from "../components/Cards"
import { VERSES } from "../content"
import { clip, signinUrl, useParamState, usePageMeta, useUpdateParams } from "../lib"

const L = "mahanaim.api.library."
const PAGE = 24
const TYPE_ICON = {
	Book: BookOpen,
	"E-Book": BookMarked,
	Journal: Newspaper,
	Periodical: Newspaper,
	Thesis: GraduationCap,
	Audio: Headphones,
	Video: Video,
	Commentary: BookText,
	Reference: LibraryIcon,
}
const SORTS = [
	{ value: "title", label: "Title A–Z" },
	{ value: "newest", label: "Recently added" },
	{ value: "popular", label: "Most popular" },
	{ value: "year", label: "Publication year" },
]

/** A drawn "book" for items without a cover image. */
function BookJacket({ it, compact }) {
	return (
		<div aria-hidden className="absolute inset-0 flex items-center justify-center">
			<div
				className={clsx(
					"relative flex aspect-[3/4] h-[80%] flex-col rounded-[3px_8px_8px_3px] bg-cream shadow-lift transition duration-500 group-hover:-translate-y-1 group-hover:rotate-[-1deg]",
					compact ? "py-2 pl-3.5 pr-1.5 sm:py-3 sm:pl-5 sm:pr-3" : "py-3 pl-5 pr-3"
				)}
			>
				<span className={clsx("absolute inset-y-0 left-0 rounded-l-[3px] bg-gold-300/70", compact ? "w-1.5 sm:w-2.5" : "w-2.5")} />
				<span className={clsx("absolute inset-y-0 w-px bg-black/10", compact ? "left-1.5 sm:left-2.5" : "left-2.5")} />
				<span className={clsx("text-[8px] font-bold uppercase tracking-[0.14em] text-gold-700", compact && "hidden sm:block")}>{it.item_type}</span>
				<span className={clsx("line-clamp-4 font-serif leading-tight text-brand-900", compact ? "text-[9px] sm:mt-2 sm:text-[13px]" : "mt-2 text-[13px]")}>{it.title}</span>
				<span className="mt-auto h-px w-8 bg-gold-500/70" />
				<span className={clsx("mt-1.5 line-clamp-1 text-[9px] text-ink-muted", compact && "hidden sm:block")}>{it.authors || "Mahanaim Library"}</span>
			</div>
		</div>
	)
}

function ItemCard({ it, onOpen }) {
	const Icon = TYPE_ICON[it.item_type] || BookOpen
	return (
		<button type="button" onClick={onOpen} className="card group flex h-full flex-col overflow-hidden text-left transition hover:-translate-y-1 hover:shadow-lift">
			<Cover src={it.cover_image} seed={it.name} icon={Icon} label={it.cover_image ? it.item_type : undefined} className="aspect-[4/3]">
				{!it.cover_image ? <BookJacket it={it} /> : null}
				{!it.can_access ? (
					<span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-brand-900/70 text-white">
						<Lock size={14} />
					</span>
				) : null}
			</Cover>
			<div className="flex flex-1 flex-col p-4">
				{it.subject ? <div className="text-[11px] font-bold uppercase tracking-wider text-gold-700">{it.subject}</div> : null}
				<h3 className="mt-1 line-clamp-2 font-serif text-[17px] leading-snug text-ink group-hover:text-brand-800">{it.title}</h3>
				<div className="mt-1 line-clamp-1 text-xs text-ink-soft">
					{[it.authors, it.publication_year].filter(Boolean).join(" · ") || "\u00a0"}
				</div>
				<div className="mt-auto flex flex-wrap gap-1.5 pt-3">
					{it.is_digital ? (
						<Badge tone="green">
							<Download size={11} className="mr-0.5 inline" /> Digital
						</Badge>
					) : null}
					{it.is_physical ? (
						<Badge tone={it.available_copies ? "blue" : "gray"}>{it.available_copies ? `${it.available_copies} on shelf` : "All copies on loan"}</Badge>
					) : null}
					{it.access_level && it.access_level !== "Public" ? <Badge tone="purple">{it.access_level}</Badge> : null}
				</div>
			</div>
		</button>
	)
}

function FacetList({ title, options = [], value, onChange, icons }) {
	if (!options.length) return null
	return (
		<div>
			<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">{title}</div>
			<ul className="space-y-0.5">
				{options.map((o) => {
					const Icon = icons?.[o.value]
					const on = value === o.value
					return (
						<li key={o.value}>
							<button
								type="button"
								onClick={() => onChange(on ? "" : o.value)}
								aria-pressed={on}
								className={clsx(
									"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition",
									on ? "bg-brand-700 font-semibold text-white" : "text-ink-muted hover:bg-cream"
								)}
							>
								{Icon ? <Icon size={15} className={on ? "text-gold-300" : "text-ink-soft"} /> : null}
								<span className="min-w-0 flex-1 truncate">{o.value}</span>
								<span className={clsx("text-xs", on ? "text-white/70" : "text-ink-soft")}>{num(o.count)}</span>
							</button>
						</li>
					)
				})}
			</ul>
		</div>
	)
}

function Filters({ facets, params, update }) {
	return (
		<div className="space-y-6">
			<FacetList title="Format" options={facets.item_type} value={params.type} onChange={(v) => update({ type: v })} icons={TYPE_ICON} />
			<FacetList title="Subject" options={facets.subject} value={params.subject} onChange={(v) => update({ subject: v })} />
			{facets.access_level?.length > 1 ? (
				<FacetList title="Access" options={facets.access_level} value={params.access} onChange={(v) => update({ access: v })} />
			) : null}
			<div className="space-y-2.5">
				<div className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Availability</div>
				<Checkbox label="Digital copies only" checked={params.digital === "1"} onChange={(c) => update({ digital: c ? "1" : "" })} />
				<Checkbox label="On the shelf now" checked={params.available === "1"} onChange={(c) => update({ available: c ? "1" : "" })} />
			</div>
		</div>
	)
}

function ItemDetail({ name, onOpen }) {
	const session = useSession()
	const q = useApi(`${L}item`, { name }, { guest: true, retry: false })
	const it = q.data
	const [remarks, setRemarks] = useState("")
	const [link, setLink] = useState(null)
	const [requested, setRequested] = useState(null)
	const access = useAction(`${L}access_digital`)
	const borrow = useAction(`${L}request_loan`, { onSuccess: setRequested, invalidate: [`${L}item`] })
	const next = `/e-library?item=${encodeURIComponent(name)}`

	const open = async () => {
		const win = window.open("", "_blank")
		try {
			const r = await access.mutateAsync({ name })
			const url = safeUrl(r?.url)
			if (!url) {
				win?.close()
				return
			}
			if (win) {
				win.opener = null
				win.location.href = url
			} else setLink({ ...r, url })
		} catch {
			win?.close()
		}
	}

	if (q.isLoading)
		return (
			<div className="space-y-4">
				<Skeleton className="aspect-[4/3] rounded-2xl" />
				<Skeleton className="h-6 w-3/4" />
				<Skeleton className="h-4 w-1/2" />
				<Skeleton className="h-24" />
			</div>
		)
	if (q.isError) {
		const needsLogin = q.error?.status === 401 || q.error?.exc_type === "AuthenticationError"
		return needsLogin ? (
			<Empty
				icon={Lock}
				title="Members only"
				subtitle="Sign in with your student or staff account to view this item."
				action={
					<Link to={signinUrl(next)} className="btn btn-primary">
						<LogIn size={16} /> Sign in
					</Link>
				}
			/>
		) : (
			<ErrorState error={q.error} onRetry={() => q.refetch()} />
		)
	}

	const Icon = TYPE_ICON[it.item_type] || BookOpen
	return (
		<div className="space-y-6">
			<div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-5">
				<Cover src={it.cover_image} seed={it.name} icon={Icon} className="aspect-[3/4] self-start rounded-2xl">
					{!it.cover_image ? <BookJacket it={it} compact /> : null}
				</Cover>
				<div className="min-w-0">
					<div className="flex flex-wrap gap-1.5">
						<Badge tone="brand">{it.item_type}</Badge>
						{it.access_level ? <Badge tone={it.access_level === "Public" ? "green" : "purple"}>{it.access_level}</Badge> : null}
					</div>
					<h3 className="mt-2 font-serif text-xl leading-snug text-ink sm:text-2xl">{it.title}</h3>
					{it.authors ? <div className="mt-1 text-sm text-ink-muted">by {it.authors}</div> : null}
					{it.description ? <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{it.description}</p> : null}
				</div>
			</div>

			<KeyValueGrid
				items={[
					{ label: "Subject", value: it.subject },
					{ label: "Publisher", value: it.publisher },
					{ label: "Year", value: it.publication_year },
					{ label: "Edition", value: it.edition },
					{ label: "ISBN", value: it.isbn },
					{ label: "Call number", value: it.call_number },
					{ label: "Location", value: [it.location, it.campus].filter(Boolean).join(", ") || null },
					{ label: "Copies", value: it.is_physical ? `${it.available_copies} of ${it.total_copies} available` : null },
				].filter((r) => r.value)}
			/>

			<div className="space-y-3 rounded-2xl bg-cream/70 p-5 ring-1 ring-gold-200">
				{it.is_digital ? (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="text-sm">
							<div className="font-semibold text-ink">Digital copy</div>
							<div className="text-ink-muted">Read online or download{it.downloads ? ` · ${num(it.downloads)} reads` : ""}</div>
						</div>
						<Button icon={it.item_type === "Video" || it.item_type === "Audio" ? ExternalLink : Download} onClick={open} loading={access.isPending}>
							{it.item_type === "Video" || it.item_type === "Audio" ? "Open" : "Read now"}
						</Button>
					</div>
				) : null}
				{link ? (
					<Alert tone="success" title="Your link is ready">
						<a href={link.url} target="_blank" rel="noreferrer" className="font-semibold underline">
							Open {link.title || "the item"}
						</a>
						{link.expires_in ? " (valid for 10 minutes)" : ""}
					</Alert>
				) : null}
				{it.is_physical ? (
					<div className={clsx(it.is_digital && "border-t border-gold-200 pt-3")}>
						<div className="flex items-start gap-2 text-sm">
							<MapPin size={16} className="mt-0.5 shrink-0 text-gold-700" />
							<div>
								<div className="font-semibold text-ink">Printed copy</div>
								<div className="text-ink-muted">
									{it.available_copies ? `${it.available_copies} of ${it.total_copies} on the shelf` : "All copies are on loan just now"}
									{it.call_number ? ` · shelf mark ${it.call_number}` : ""}
								</div>
							</div>
						</div>
						{it.my_loan || requested ? (
							<Alert tone="brand" className="mt-3" title="You have this item">
								{requested ? `Request ${requested.name} sent. The librarian will let you know when it's ready to collect.` : `Loan ${it.my_loan.name} · ${it.my_loan.status}`}
								{it.my_loan?.due_date ? ` · due ${it.my_loan.due_date}` : ""}
							</Alert>
						) : it.can_borrow ? (
							<div className="mt-3 space-y-3">
								<Textarea label="Note to the librarian" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional, e.g. when you will collect it" />
								<Button variant="secondary" icon={BookMarked} loading={borrow.isPending} onClick={() => borrow.mutate({ item: it.name, remarks: remarks || undefined })}>
									Reserve a copy
								</Button>
							</div>
						) : session.isGuest ? (
							<Link to={signinUrl(next)} className="btn btn-secondary btn-sm mt-3">
								<LogIn size={14} /> Sign in to borrow
							</Link>
						) : (
							<p className="mt-2 text-xs text-ink-soft">Borrowing is available to registered students and staff. Visit the library desk for help.</p>
						)}
					</div>
				) : null}
				{!it.is_digital && !it.is_physical ? <p className="text-sm text-ink-muted">Ask at the library desk for access to this item.</p> : null}
			</div>

			{it.related?.length ? (
				<div>
					<div className="mb-3 text-sm font-semibold text-ink">More on {it.subject}</div>
					<div className="space-y-2">
						{it.related.map((r) => {
							const RIcon = TYPE_ICON[r.item_type] || BookOpen
							return (
								<button
									key={r.name}
									type="button"
									onClick={() => onOpen(r.name)}
									className="flex w-full items-center gap-3 rounded-xl p-2 text-left ring-1 ring-line transition hover:bg-cream"
								>
									<span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
										<RIcon size={18} />
									</span>
									<span className="min-w-0">
										<span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
										<span className="block truncate text-xs text-ink-soft">{[r.item_type, r.authors].filter(Boolean).join(" · ")}</span>
									</span>
								</button>
							)
						})}
					</div>
				</div>
			) : null}
		</div>
	)
}

export default function Library() {
	usePageMeta("E-Library", "Search the college library: e-books, commentaries, journals, theses and sermon archives. Students and staff sign in to borrow and read more.")
	const session = useSession()
	const update = useUpdateParams()
	const [qParam] = useParamState("q")
	const [type] = useParamState("type")
	const [subject] = useParamState("subject")
	const [accessLvl] = useParamState("access")
	const [digital] = useParamState("digital")
	const [available] = useParamState("available")
	const [sort] = useParamState("sort", "title")
	const [pageParam] = useParamState("page", "1")
	const [item, setItem] = useParamState("item", "", { resetPage: false })
	const [filtersOpen, setFiltersOpen] = useState(false)
	const page = Math.max(1, Number(pageParam) || 1)
	const [search, setSearch] = useState(qParam)
	const debounced = useDebounced(search, 350)
	useEffect(() => {
		if (debounced !== qParam) update({ q: debounced.trim() })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debounced])

	const q = useApi(
		`${L}catalogue`,
		{
			search: qParam || undefined,
			subject: subject || undefined,
			item_type: type || undefined,
			access: accessLvl || undefined,
			digital: digital || undefined,
			available: available || undefined,
			sort,
			start: (page - 1) * PAGE,
			page_length: PAGE,
		},
		{ guest: true, placeholderData: (prev) => prev }
	)
	const d = q.data || {}
	const rows = d.data || []
	const facets = d.facets || {}
	const params = { type, subject, access: accessLvl, digital, available }
	const active = [type, subject, accessLvl, digital, available, qParam].filter(Boolean).length
	const levels = d.access_levels || ["Public"]
	const openItem = (name) => setItem(name)

	return (
		<>
			<PageHero
				eyebrow="E-Library"
				title="A library for the whole harvest field"
				subtitle="E-books, commentaries, journals, theses and sermon archives for study and ministry. Browse the open collection here; students and staff sign in for the full library."
				crumbs={[{ label: "Academics", to: "/academics" }, { label: "E-Library" }]}
				compact
			>
				<div className="mt-7 max-w-2xl">
					<SearchInput value={search} onChange={setSearch} placeholder="Search by title, author, subject or ISBN" className="[&_input]:h-12 [&_input]:text-base" />
				</div>
			</PageHero>

			<Band className="!pt-10">
				<div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)]">
					<aside className="hidden lg:block">
						<div className="sticky top-24">
							<Filters facets={facets} params={params} update={update} />
						</div>
					</aside>
					<div className="min-w-0">
						<div className="mb-6 flex flex-wrap items-center gap-3">
							<div className="mr-auto text-sm text-ink-muted">
								{q.isLoading ? "Searching…" : `${num(d.total || 0)} item${d.total === 1 ? "" : "s"}`}
								{qParam ? (
									<>
										{" "}
										for <span className="font-semibold text-ink">"{qParam}"</span>
									</>
								) : null}
							</div>
							<Button variant="secondary" size="sm" icon={Filter} className="lg:hidden" onClick={() => setFiltersOpen(true)}>
								Filters{active ? ` (${active})` : ""}
							</Button>
							{active ? (
								<button
									type="button"
									className="link text-sm"
									onClick={() => {
										setSearch("")
										update({ q: "", type: "", subject: "", access: "", digital: "", available: "" })
									}}
								>
									Clear all
								</button>
							) : null}
							<Select aria-label="Sort by" value={sort} onChange={(e) => update({ sort: e.target.value === "title" ? "" : e.target.value })} options={SORTS} className="w-44" />
						</div>

						{q.isLoading ? (
							<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
								{Array.from({ length: 6 }).map((_, i) => (
									<Skeleton key={i} className="h-72 rounded-2xl" />
								))}
							</div>
						) : q.isError ? (
							<ErrorState error={q.error} onRetry={() => q.refetch()} />
						) : !rows.length ? (
							<div className="card">
								<Empty
									icon={active ? SearchX : LibraryBig}
									title={active ? "Nothing matches your search" : "The open collection is growing"}
									subtitle={
										active
											? "Try fewer words, another spelling or a different filter."
											: "New titles are catalogued every term. Students and staff can sign in to see the full library."
									}
									action={
										active ? (
											<button
												type="button"
												className="btn btn-secondary"
												onClick={() => {
													setSearch("")
													update({ q: "", type: "", subject: "", access: "", digital: "", available: "" })
												}}
											>
												Clear filters
											</button>
										) : session.isGuest ? (
											<Link to={signinUrl("/e-library")} className="btn btn-primary">
												<LogIn size={16} /> Member sign in
											</Link>
										) : null
									}
								/>
							</div>
						) : (
							<div className={q.isFetching ? "opacity-70 transition" : ""}>
								<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
									{rows.map((it) => (
										<ItemCard key={it.name} it={it} onOpen={() => openItem(it.name)} />
									))}
								</div>
								<Pagination
									page={page}
									pageSize={PAGE}
									total={d.total || 0}
									onChange={(p) => {
										update({ page: String(p) })
										window.scrollTo({ top: 0, behavior: "smooth" })
									}}
									className="mt-8 border-t border-line pt-4"
								/>
							</div>
						)}
					</div>
				</div>
			</Band>

			<Band tone="cream">
				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center">
					<div>
						<div className="eyebrow">Library membership</div>
						<h2 className="mt-2 font-serif text-3xl text-ink">More for students and staff</h2>
						<p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
							{session.isGuest
								? "Guests can browse and read the open collection. Sign in with your college account to unlock course readers, journals and theses, and to reserve printed books."
								: `You're signed in and can see the ${levels.join(", ").toLowerCase()} collections.`}
						</p>
						{session.isGuest ? (
							<Link to={signinUrl("/e-library")} className="btn btn-primary mt-6">
								<LogIn size={16} /> Sign in to the library
							</Link>
						) : null}
						<div className="mt-8">
							<Scripture verse={VERSES.study} size="sm" />
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<Feature icon={BookMarked} title="Read anywhere">
							E-books and articles open in your browser on phone or laptop, ideal for distance learners.
						</Feature>
						<Feature icon={BookOpen} title="Reserve printed books">
							Request a copy online and collect it from the library desk when it's ready.
						</Feature>
						<Feature icon={FileText} title="Theses and journals">
							Research by our graduates and faculty, plus theological journals for deeper study.
						</Feature>
						<Feature icon={Headphones} title="Sermons and lectures">
							Audio and video from chapel, conferences and guest lectures.
						</Feature>
					</div>
				</div>
			</Band>
			<CtaBand />

			<Drawer open={filtersOpen} title="Filter the catalogue" onClose={() => setFiltersOpen(false)} footer={<Button onClick={() => setFiltersOpen(false)}>Show {num(d.total || 0)} results</Button>}>
				<Filters facets={facets} params={params} update={update} />
			</Drawer>
			<Drawer open={Boolean(item)} title="Library item" subtitle={clip(rows.find((r) => r.name === item)?.title || "", 60)} onClose={() => setItem("")}>
				{item ? <ItemDetail key={item} name={item} onOpen={openItem} /> : null}
			</Drawer>
		</>
	)
}
