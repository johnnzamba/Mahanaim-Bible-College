import { useState } from "react"
import { Link } from "react-router-dom"
import { CalendarHeart, Church, HandHeart, Info, Megaphone, Pencil, Users } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Button, Empty, KeyValueGrid, PageHeader, Panel, QueryState, Skeleton } from "@/shared/components/ui"

import { Hero, ListRow } from "../components/bits"
import { PROFILE_SECTIONS, ProfileEditModal } from "../components/ProfileEditModal"
import { API, since } from "../components/lib"

const CHAPEL_WORDS = /chapel|worship|devotion|prayer|mission|ministry|fellowship|retreat|revival|choir/i

export default function Chapel() {
	const profile = useApi(API.profile)
	const ann = useApi(API.announcements, { limit: 50 })
	const [edit, setEdit] = useState(false)
	const notices = (ann.data?.data || []).filter((a) => CHAPEL_WORDS.test(`${a.title} ${a.summary || ""}`)).slice(0, 6)
	return (
		<>
			<PageHeader eyebrow="Campus life" title="Chapel & ministry" subtitle="Worship, spiritual formation and your ministry connections." />
			<div className="space-y-5">
				<Hero>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
						<span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
							<Church size={28} className="text-gold-300" />
						</span>
						<div className="min-w-0">
							<blockquote className="font-serif text-lg leading-snug sm:text-xl">
								“And when Jacob saw them, he said, This is God&apos;s host: and he called the name of that place Mahanaim.”
							</blockquote>
							<p className="mt-1 text-sm text-gold-200">Genesis 32:2</p>
						</div>
					</div>
				</Hero>

				<div className="grid gap-5 lg:grid-cols-3">
					<Panel
						className="lg:col-span-2"
						title="My church & ministry"
						icon={Users}
						actions={
							profile.data ? (
								<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(true)}>
									Edit
								</Button>
							) : null
						}
					>
						<QueryState query={profile} skeleton={<Skeleton className="h-32 rounded-xl" />}>
							{(p) => (
								<KeyValueGrid
									items={[
										{ label: "Home church", value: p.home_church || "—" },
										{ label: "Partner church", value: p.partner_church || "—" },
										{ label: "Denomination", value: p.denomination || "—" },
										{ label: "Pastor", value: p.pastor_name || "—" },
										{ label: "Pastor's phone", value: p.pastor_phone || "—" },
										{ label: "Ministry role", value: p.ministry_role || "—" },
									]}
								/>
							)}
						</QueryState>
					</Panel>
					<Panel title="Give" icon={HandHeart}>
						<p className="text-sm text-ink-muted">Support the college, chapel offerings and student sponsorships through M-Pesa.</p>
						<Link to="/give" className="btn btn-primary btn-sm mt-4">
							<HandHeart size={14} /> Give online
						</Link>
					</Panel>
				</div>

				<div className="grid gap-5 lg:grid-cols-2">
					<Panel title="Chapel attendance" icon={CalendarHeart}>
						<Empty
							compact
							icon={Info}
							title="Attendance isn't online yet"
							subtitle="The chaplaincy records chapel attendance at each service. Your personal attendance summary will appear here once it's published to the portal."
						/>
					</Panel>
					<Panel title="Chapel notices" icon={Megaphone} bodyClass="p-0">
						<QueryState
							query={ann}
							skeleton={<Skeleton className="m-4 h-24 rounded-xl" />}
							isEmpty={() => !notices.length}
							empty={<Empty compact icon={Megaphone} title="No chapel notices" subtitle="Service schedules, retreats and ministry opportunities will be announced here." />}
						>
							{() => (
								<div className="divide-y divide-line">
									{notices.map((a) => (
										<ListRow key={a.name} icon={Megaphone} tone="gold" title={a.title} sub={`${a.posted_by_name || "Chaplaincy"} · ${since(a.sent_on || a.publish_on)}`} to={`/student/announcements?open=${encodeURIComponent(a.name)}`} />
									))}
								</div>
							)}
						</QueryState>
					</Panel>
				</div>
			</div>
			{profile.data ? (
				<ProfileEditModal
					open={edit}
					onClose={() => setEdit(false)}
					title="Edit church & ministry"
					fields={PROFILE_SECTIONS.church.fields}
					editable={profile.data.editable_fields || []}
					profile={profile.data}
				/>
			) : null}
		</>
	)
}
