import { Link } from "react-router-dom"
import { CalendarDays, CalendarPlus, History, Radio, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Empty, ErrorState, Pagination, Tabs } from "@/shared/components/ui"
import { Band, CtaBand, Feature, PageHero, SectionHeading } from "../components/Blocks"
import { EventCard, ListSkeleton } from "../components/Cards"
import { W, useParamState, usePageMeta, useUpdateParams } from "../lib"

const PAGE = 9

export default function Events() {
	const [scopeParam] = useParamState("scope", "upcoming")
	const scope = scopeParam === "past" ? "past" : "upcoming"
	const [pageParam] = useParamState("page", "1")
	const page = Math.max(1, Number(pageParam) || 1)
	const update = useUpdateParams()
	usePageMeta(scope === "past" ? "Past events" : "Events", "Conferences, open days, graduation, chapel services, seminars and outreach events at the college.")
	const q = useApi(`${W}events`, { scope, page, page_length: PAGE }, { guest: true, placeholderData: (prev) => prev })
	const d = q.data || {}
	const rows = d.data || []

	return (
		<>
			<PageHero
				eyebrow="Events"
				title="Gather, learn and be sent"
				subtitle="Conferences, open days, chapel services, seminars, graduation and outreach. Everyone is welcome; some events need registration."
				crumbs={[{ label: "Events" }]}
				compact
			/>
			<Band className="!pt-10">
				<div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<Tabs
						tabs={[
							{ id: "upcoming", label: "Upcoming" },
							{ id: "past", label: "Past events" },
						]}
						active={scope}
						onChange={(id) => update({ scope: id === "upcoming" ? "" : id })}
					/>
					{d.total ? (
						<div className="text-sm text-ink-soft">
							{d.total} {scope === "past" ? "past" : "upcoming"} event{d.total === 1 ? "" : "s"}
						</div>
					) : null}
				</div>

				{q.isLoading ? (
					<ListSkeleton rows={4} />
				) : q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : !rows.length ? (
					<div className="card">
						<Empty
							icon={scope === "past" ? History : CalendarDays}
							title={scope === "past" ? "No past events to show" : "No upcoming events just now"}
							subtitle={
								scope === "past"
									? "Our event archive will appear here."
									: "New conferences, open days and seminars are announced here first. Check back soon or ask us about visiting campus."
							}
							action={
								<div className="flex flex-wrap justify-center gap-2">
									{scope === "past" ? (
										<button type="button" className="btn btn-secondary" onClick={() => update({ scope: "" })}>
											See upcoming events
										</button>
									) : (
										<button type="button" className="btn btn-secondary" onClick={() => update({ scope: "past" })}>
											Browse past events
										</button>
									)}
									<Link to="/contact?type=General" className="btn btn-ghost">
										Plan a campus visit
									</Link>
								</div>
							}
						/>
					</div>
				) : (
					<div className={q.isFetching ? "opacity-70 transition" : ""}>
						<div className="grid gap-4 lg:grid-cols-2">
							{rows.map((ev) => (
								<EventCard key={ev.name} ev={ev} />
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
			</Band>

			<Band tone="cream">
				<SectionHeading eyebrow="Taking part" title="What to expect" align="center" />
				<div className="grid gap-6 md:grid-cols-3">
					<Feature icon={Users} title="Open to all">
						Most events are open to students, alumni, partner churches and the public. Events that need a seat count show how many seats are left.
					</Feature>
					<Feature icon={CalendarPlus} title="Register online">
						Register in a minute on the event page. Paid events are confirmed with an M-Pesa prompt to your phone.
					</Feature>
					<Feature icon={Radio} title="Join from anywhere">
						Selected chapel services, lectures and conferences are streamed live. Look for the live-stream badge.
					</Feature>
				</div>
			</Band>
			<CtaBand />
		</>
	)
}
