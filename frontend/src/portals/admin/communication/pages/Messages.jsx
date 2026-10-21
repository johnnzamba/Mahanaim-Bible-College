import { useRef, useState } from "react"
import { BellRing, Inbox, Mail, MessageSquare, RotateCcw, Send, Smartphone } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { Badge, Button, ConfirmDialog, Drawer, Html, Input, KeyValueGrid, PageHeader, Select, SkeletonRows, StatCard } from "@/shared/components/ui"
import { DataTable, SelectionBar, Toolbar, useDebounced } from "@/shared/components/kit"
import { dateTime, num } from "@/shared/utils/format"
import { API, CHANNELS, CommsTabs, INVALIDATE, LOG_STATUSES, toneOf, useCommsRoles } from "../components/common"
import { DirectMessage, TestSms } from "../components/DirectMessage"
import { compact, usePaged } from "../components/kit"

const CHANNEL_ICON = { Email: Mail, SMS: MessageSquare, "In-App": BellRing }
const PAGE = 50

const COLS = [
	{ key: "creation", label: "When", render: (r) => <span className="whitespace-nowrap text-sm">{dateTime(r.sent_on || r.creation)}</span>, sortValue: (r) => r.sent_on || r.creation },
	{
		key: "channel",
		label: "Channel",
		render: (r) => {
			const Icon = CHANNEL_ICON[r.channel] || Mail
			return (
				<span className="inline-flex items-center gap-1.5 text-sm">
					<Icon size={14} className="text-brand-700" /> {r.channel}
				</span>
			)
		},
	},
	{
		key: "recipient",
		label: "To",
		render: (r) => (
			<span className="block min-w-0">
				<span className="block truncate font-medium text-ink">{r.recipient || r.user || "—"}</span>
				{r.user && r.user !== r.recipient ? <span className="block truncate text-xs text-ink-soft">{r.user}</span> : null}
			</span>
		),
	},
	{
		key: "subject",
		label: "Message",
		hideOnMobile: true,
		render: (r) => (
			<span className="block min-w-0 max-w-md">
				<span className="block truncate text-sm text-ink">{r.subject || r.preview || "—"}</span>
				<span className="block truncate text-xs text-ink-soft">{r.event || r.template || ""}</span>
			</span>
		),
	},
	{
		key: "status",
		label: "Status",
		render: (r) => (
			<span className="inline-flex items-center gap-1.5">
				<Badge status={r.status} tone={toneOf(r.status)} size="xs" />
				{r.retries ? <span className="text-xs text-ink-soft">×{r.retries}</span> : null}
			</span>
		),
	},
]

export default function Messages() {
	const { canLog, canDirect, isComms } = useCommsRoles()
	const [search, setSearch] = useState("")
	const [status, setStatus] = useState("")
	const [channel, setChannel] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [selected, setSelected] = useState([])
	const [open, setOpen] = useState(null)
	const [dm, setDm] = useState(false)
	const [sms, setSms] = useState(false)
	const [retryAll, setRetryAll] = useState(false)
	const seenRows = useRef(new Map())
	const ds = useDebounced(search)
	const base = compact({ channel, search: ds, from_date: from, to_date: to })
	const { query, rows, total, pager } = usePaged(`${API}message_log`, { filters: JSON.stringify(compact({ ...base, status })) }, PAGE, { enabled: canLog })
	const all = useApi(`${API}message_log`, { filters: JSON.stringify(base), page_length: 1 }, { enabled: canLog })
	for (const r of rows) seenRows.current.set(r.name, r)
	const byStatus = all.data?.counts?.by_status || {}
	const byChannel = all.data?.counts?.by_channel || {}
	const allTotal = all.data?.total || 0
	const failedSms = all.data?.counts?.matrix?.SMS?.Failed || 0
	const eligible = selected.filter((n) => {
		const r = seenRows.current.get(n)
		return r && r.channel === "SMS" && r.status === "Failed"
	})
	const retry = useAction(`${API}retry_failed`, {
		invalidate: INVALIDATE,
		success: (r) => `${num(r.queued)} SMS queued again${r.skipped ? ` · ${num(r.skipped)} skipped` : ""}`,
		onSuccess: () => {
			setSelected([])
			setRetryAll(false)
		},
	})
	const delivered = (byStatus.Sent || 0) + (byStatus.Delivered || 0)

	if (!canLog) {
		return (
			<>
				<CommsTabs />
				<PageHeader title="Message log" />
				<p className="text-sm text-ink-soft">Only the communications office and auditors can see the message log.</p>
			</>
		)
	}
	return (
		<>
			<CommsTabs />
			<PageHeader
				title="Message log"
				subtitle="Every email, SMS and portal notification the system has sent, with its delivery status."
				actions={
					<>
						{isComms ? (
							<Button variant="secondary" icon={Smartphone} onClick={() => setSms(true)}>
								Test SMS
							</Button>
						) : null}
						{canDirect ? (
							<Button icon={Send} onClick={() => setDm(true)}>
								Send a message
							</Button>
						) : null}
					</>
				}
			/>
			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Messages" value={num(allTotal)} icon={Inbox} tone="brand" hint={CHANNELS.map((c) => `${c} ${num(byChannel[c] || 0)}`).join(" · ")} />
				<StatCard label="Delivered or sent" value={num(delivered)} icon={Mail} tone="green" hint={allTotal ? `${Math.round((delivered / allTotal) * 100)}% of messages` : null} />
				<StatCard label="Queued" value={num(byStatus.Queued || 0)} icon={RotateCcw} tone="blue" hint="Waiting for the gateway" />
				<StatCard label="Failed" value={num(byStatus.Failed || 0)} icon={MessageSquare} tone={byStatus.Failed ? "red" : "gray"} hint={failedSms ? `${num(failedSms)} SMS can be retried` : "Nothing to retry"} />
			</div>
			<Toolbar
				search={search}
				onSearch={setSearch}
				placeholder="Search recipient or subject…"
				chips={[{ id: "", label: "All", count: allTotal }, ...LOG_STATUSES.map((s) => ({ id: s, label: s, count: byStatus[s] || 0 }))]}
				active={status}
				onChip={(s) => {
					setStatus(s)
					setSelected([])
				}}
			/>
			<div className="-mt-1 mb-4 grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
				<Select label="Channel" className="col-span-2 sm:w-40" placeholder="All channels" options={CHANNELS} value={channel} onChange={(e) => setChannel(e.target.value)} />
				<Input label="From" type="date" className="min-w-0 sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
				<Input label="To" type="date" className="min-w-0 sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} />
				{channel || from || to ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setChannel("")
							setFrom("")
							setTo("")
						}}
					>
						Clear filters
					</Button>
				) : null}
				{isComms && failedSms ? (
					<Button variant="secondary" size="sm" icon={RotateCcw} className="sm:ml-auto" onClick={() => setRetryAll(true)}>
						Retry failed SMS
					</Button>
				) : null}
			</div>
			<DataTable
				cols={COLS}
				query={query}
				onRow={(r) => setOpen(r)}
				selectable={isComms}
				selected={selected}
				onSelect={setSelected}
				empty={ds || status || channel || from || to ? "No messages match" : "Nothing sent yet"}
				emptyIcon={Inbox}
				dense
				footer={
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<span className="text-ink-soft">{num(total)} messages</span>
						{pager}
					</div>
				}
			/>
			<SelectionBar count={selected.length} onClear={() => setSelected([])}>
				<Button size="sm" icon={RotateCcw} disabled={!eligible.length} loading={retry.isPending} onClick={() => retry.mutate({ names: JSON.stringify(eligible) })}>
					{eligible.length ? `Retry ${eligible.length} failed SMS` : "Only failed SMS can be retried"}
				</Button>
			</SelectionBar>
			<LogDrawer row={open} onClose={() => setOpen(null)} canRetry={isComms} onRetry={(n) => retry.mutate({ names: JSON.stringify([n]) }, { onSuccess: () => setOpen(null) })} retrying={retry.isPending} />
			<ConfirmDialog
				open={retryAll}
				title={`Retry ${num(failedSms)} failed SMS?`}
				message="They go back to the gateway queue. Emails are retried automatically by the mail queue."
				confirmLabel="Retry all"
				loading={retry.isPending}
				onConfirm={() => retry.mutate({})}
				onClose={() => setRetryAll(false)}
			/>
			<DirectMessage open={dm} onClose={() => setDm(false)} />
			<TestSms open={sms} onClose={() => setSms(false)} />
		</>
	)
}

function LogDrawer({ row, onClose, canRetry, onRetry, retrying }) {
	const full = useQuery({
		queryKey: ["message-log-doc", row?.name],
		enabled: Boolean(row),
		retry: false,
		queryFn: () => frappe.call("frappe.client.get", { doctype: "Message Log", name: row.name }),
	})
	const d = full.data || row
	return (
		<Drawer
			open={Boolean(row)}
			onClose={onClose}
			title={row ? `${row.channel} to ${row.recipient || row.user}` : ""}
			subtitle={row ? dateTime(row.sent_on || row.creation) : ""}
			footer={
				row && canRetry && row.channel === "SMS" && row.status === "Failed" ? (
					<Button icon={RotateCcw} loading={retrying} onClick={() => onRetry(row.name)}>
						Retry this SMS
					</Button>
				) : null
			}
		>
			{row ? (
				<div className="space-y-5">
					<KeyValueGrid
						cols={2}
						items={[
							{ label: "Status", value: <Badge status={row.status} tone={toneOf(row.status)} size="xs" /> },
							{ label: "Retries", value: num(row.retries || 0) },
							{ label: "Event", value: row.event || "—" },
							{ label: "Template", value: row.template || "Built-in wording" },
							{ label: "Portal user", value: row.user || "—" },
							{ label: "Related record", value: row.reference_name ? `${row.reference_doctype} ${row.reference_name}` : "—" },
							row.provider_response ? { label: "Gateway response", value: <code className="break-all text-xs">{row.provider_response}</code>, wide: true } : null,
						].filter(Boolean)}
					/>
					<div>
						<div className="label mb-1">{row.subject || "Message"}</div>
						{full.isLoading ? (
							<SkeletonRows rows={3} />
						) : row.channel === "Email" && d.message ? (
							<Html html={d.message} className="rounded-xl border border-line bg-surface p-4 text-sm" />
						) : (
							<p className="whitespace-pre-wrap rounded-xl bg-cream p-3 text-sm text-ink">{d.message || row.preview || "—"}</p>
						)}
					</div>
				</div>
			) : null}
		</Drawer>
	)
}
