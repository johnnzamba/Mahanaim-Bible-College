import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { BellRing, FileText, Mail, MessageSquare, Plus } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Badge, Button, Card, Empty, PageHeader, QueryState, Select, SkeletonRows } from "@/shared/components/ui"
import { Toolbar, useDebounced } from "@/shared/components/kit"
import { ago } from "@/shared/utils/format"
import { API, CommsTabs, useCommsRoles } from "../components/common"

export function ChannelIcons({ t, size = 15 }) {
	return (
		<span className="flex items-center gap-2">
			<Mail size={size} className={t.send_email ? "text-brand-700" : "text-ink-soft/30"} aria-label={t.send_email ? "Email on" : "Email off"} />
			<MessageSquare size={size} className={t.send_sms ? "text-brand-700" : "text-ink-soft/30"} aria-label={t.send_sms ? "SMS on" : "SMS off"} />
			<BellRing size={size} className={t.send_in_app ? "text-brand-700" : "text-ink-soft/30"} aria-label={t.send_in_app ? "Portal on" : "Portal off"} />
		</span>
	)
}

export default function Templates() {
	const nav = useNavigate()
	const { isComms } = useCommsRoles()
	const [search, setSearch] = useState("")
	const [state, setState] = useState("")
	const [event, setEvent] = useState("")
	const ds = useDebounced(search)
	const q = useApi(`${API}list_templates`, { search: ds || undefined, event: event || undefined }, { enabled: isComms })
	const all = useApi(`${API}list_templates`, {}, { enabled: isComms, staleTime: 60000 })
	const rows = useMemo(() => (q.data?.data || []).filter((t) => (state === "active" ? t.is_active : state === "inactive" ? !t.is_active : true)), [q.data, state])
	const groups = useMemo(() => {
		const m = new Map()
		for (const t of rows) {
			if (!m.has(t.event)) m.set(t.event, [])
			m.get(t.event).push(t)
		}
		return [...m.entries()]
	}, [rows])
	const events = all.data?.events || []
	const covered = new Set((all.data?.data || []).filter((t) => t.is_active).map((t) => t.event))
	const uncovered = events.filter((e) => !covered.has(e))
	const active = (all.data?.data || []).filter((t) => t.is_active).length
	const total = all.data?.data?.length || 0

	if (!isComms) {
		return (
			<>
				<CommsTabs />
				<PageHeader title="Message templates" />
				<Alert tone="warning" title="Only the communications office edits templates" />
			</>
		)
	}
	return (
		<>
			<CommsTabs />
			<PageHeader
				title="Message templates"
				subtitle="The wording of every automatic email, SMS and portal notification, one or more per event."
				actions={
					<Button icon={Plus} onClick={() => nav("/admin/communication/templates/new")}>
						New template
					</Button>
				}
			/>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search name or subject…"
				chips={[
					{ id: "", label: "All", count: total },
					{ id: "active", label: "Active", count: active },
					{ id: "inactive", label: "Inactive", count: total - active },
				]}
				active={state}
				onChip={setState}
				right={<Select aria-label="Event" className="w-56" placeholder="Every event" options={events} value={event} onChange={(e) => setEvent(e.target.value)} />}
			/>
			<QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
				{() =>
					groups.length ? (
						<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							{groups.map(([ev, list]) => (
								<Card key={ev} className="p-4">
									<div className="mb-2 flex items-center justify-between gap-2">
										<h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">{ev}</h2>
										{list.length > 1 ? <span className="text-xs text-ink-soft">{list.length} templates</span> : null}
									</div>
									<ul className="divide-y divide-line">
										{list.map((t) => (
											<li key={t.name}>
												<Link to={`/admin/communication/templates/${encodeURIComponent(t.name)}`} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-cream/70">
													<FileText size={18} className="mt-0.5 shrink-0 text-brand-700" />
													<span className="min-w-0 flex-1">
														<span className="flex items-center gap-2">
															<span className="truncate font-semibold text-ink">{t.template_name}</span>
															{t.is_active ? null : <Badge tone="gray" size="xs">Inactive</Badge>}
														</span>
														<span className="block truncate text-xs text-ink-soft">{t.subject || "No email subject"}</span>
														<span className="mt-1 flex items-center justify-between text-xs text-ink-soft">
															<ChannelIcons t={t} size={13} />
															<span>edited {ago(t.modified)}</span>
														</span>
													</span>
												</Link>
											</li>
										))}
									</ul>
								</Card>
							))}
						</div>
					) : (
						<Card>
							<Empty icon={FileText} title={ds || event || state ? "No templates match" : "No templates yet"} />
						</Card>
					)
				}
			</QueryState>
			{uncovered.length && !ds && !event && !state ? (
				<Card className="mt-5 p-4">
					<h2 className="font-semibold text-ink">Events using the built-in wording</h2>
					<p className="mb-3 text-sm text-ink-soft">These have no active template, so the system sends a plain default message. Add one to use your own wording.</p>
					<div className="flex flex-wrap gap-2">
						{uncovered.map((e) => (
							<Link key={e} to={`/admin/communication/templates/new?event=${encodeURIComponent(e)}`} className="chip hover:border-brand-300">
								<Plus size={12} /> {e}
							</Link>
						))}
					</div>
				</Card>
			) : null}
		</>
	)
}
