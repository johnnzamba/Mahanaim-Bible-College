import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { BookOpen, Megaphone, Paperclip, Pin } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Button, Empty, Html, Modal, PageHeader, QueryState, SkeletonRows } from "@/shared/components/ui"
import { Toolbar } from "@/shared/components/kit"
import { dateTime } from "@/shared/utils/format"
import { IconChip } from "../components/bits"
import { API, safeUrl, since } from "../components/lib"

const PAGE = 20
const CHIPS = [
	{ id: "all", label: "All" },
	{ id: "pinned", label: "Pinned" },
	{ id: "course", label: "My courses" },
	{ id: "college", label: "College-wide" },
]

export default function Announcements() {
	const [params, setParams] = useSearchParams()
	const [limit, setLimit] = useState(PAGE)
	const [chip, setChip] = useState("all")
	const [search, setSearch] = useState("")
	const q = useApi(API.announcements, { limit, start: 0 }, { placeholderData: (prev) => prev })
	const rows = q.data?.data || []
	const more = rows.length >= limit && limit < 100
	const list = useMemo(() => {
		const s = search.trim().toLowerCase()
		return rows
			.filter((a) => chip === "all" || (chip === "pinned" ? a.is_pinned : chip === "course" ? a.course_offering : !a.course_offering))
			.filter((a) => !s || `${a.title} ${a.summary || ""} ${a.course_title || ""}`.toLowerCase().includes(s))
			.sort((a, b) => (b.is_pinned || 0) - (a.is_pinned || 0))
	}, [rows, chip, search])
	const openName = params.get("open")
	const current = rows.find((a) => a.name === openName)
	const setOpen = (name) => setParams((p) => (name ? p.set("open", name) : p.delete("open"), p), { replace: true })

	return (
		<>
			<PageHeader eyebrow="Campus life" title="Announcements" subtitle="News from the college, your programme and your lecturers." />
			<Toolbar search={search} onSearch={setSearch} placeholder="Search announcements" chips={CHIPS} active={chip} onChip={setChip} />
			<QueryState
				query={q}
				skeleton={<SkeletonRows rows={5} className="card p-4" />}
				isEmpty={() => !list.length}
				empty={
					<div className="card">
						<Empty icon={Megaphone} title={rows.length ? "Nothing matches" : "No announcements yet"} subtitle={rows.length ? "Try another filter." : "When the college or your lecturers post news, it shows here."} />
					</div>
				}
			>
				{() => (
					<div className="space-y-3">
						{list.map((a) => (
							<button
								key={a.name}
								type="button"
								onClick={() => setOpen(a.name)}
								className={clsx("card flex w-full items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft", a.is_pinned && "border-gold-300 dark:border-gold-500/40")}
							>
								<IconChip icon={a.course_offering ? BookOpen : Megaphone} tone={a.is_pinned ? "gold" : a.course_offering ? "blue" : "brand"} size={40} />
								<span className="min-w-0 flex-1">
									<span className="flex flex-wrap items-center gap-1.5">
										{a.is_pinned ? (
											<Badge tone="gold" size="xs">
												<Pin size={10} /> Pinned
											</Badge>
										) : null}
										{a.course_title ? (
											<Badge tone="blue" size="xs">
												{a.course_title}
											</Badge>
										) : a.audience && a.audience !== "Everyone" ? (
											<Badge tone="gray" size="xs">
												{a.programme || a.campus || a.audience}
											</Badge>
										) : null}
									</span>
									<span className="mt-1 block font-semibold text-ink">{a.title}</span>
									<span className="mt-0.5 line-clamp-2 block text-sm text-ink-muted">{a.summary}</span>
									<span className="mt-1.5 flex items-center gap-2 text-xs text-ink-soft">
										{a.posted_by_name ? <span>{a.posted_by_name}</span> : null}
										<span>· {since(a.sent_on || a.publish_on)}</span>
										{a.attachment ? <Paperclip size={12} aria-label="Has attachment" /> : null}
									</span>
								</span>
							</button>
						))}
						{more ? (
							<div className="flex justify-center pt-2">
								<Button variant="secondary" loading={q.isFetching} onClick={() => setLimit((l) => Math.min(100, l + PAGE))}>
									Load more
								</Button>
							</div>
						) : null}
					</div>
				)}
			</QueryState>
			<Modal open={Boolean(current)} onClose={() => setOpen(null)} title={current?.title} subtitle={current ? `${current.posted_by_name || "Mahanaim"} · ${dateTime(current.sent_on || current.publish_on)}` : null} size="lg">
				{current ? (
					<div className="space-y-4">
						{current.course_title ? <Badge tone="blue">{current.course_title}</Badge> : null}
						<Html html={current.body} />
						{safeUrl(current.attachment) ? (
							<a className="btn btn-secondary btn-sm" href={safeUrl(current.attachment)} target="_blank" rel="noreferrer">
								<Paperclip size={14} /> {current.attachment.split("/").pop()}
							</a>
						) : null}
					</div>
				) : null}
			</Modal>
		</>
	)
}
