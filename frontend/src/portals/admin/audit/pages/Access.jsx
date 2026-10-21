import { useMemo } from "react"
import clsx from "clsx"
import { AlertTriangle, LogIn, LogOut, ShieldCheck, UserRoundCog } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Alert, Avatar, Badge, Button, Chip, Empty, ErrorState, SkeletonRows } from "@/shared/components/ui"
import { dateTime, num } from "@/shared/utils/format"
import { A, DateRange, ExportButton, FilterSelect, Pager, relative, usePaged, useUrlFilters } from "../lib"

const KEYS = ["user", "operation", "status", "from", "to"]

const OPS = {
	Login: { label: "Sign-in", icon: LogIn },
	Logout: { label: "Sign-out", icon: LogOut },
	Impersonate: { label: "Impersonation", icon: UserRoundCog },
}
const STATUS_TONE = { Success: "green", Failed: "red", Linked: "blue", Closed: "gray" }

export default function Access() {
	const filters = useUrlFilters(KEYS)
	const f = filters.values
	const args = { user: f.user, operation: f.operation, status: f.status, from_date: f.from, to_date: f.to }
	const list = usePaged(`${A}access_log`, args)
	const failed = useApi(`${A}access_log`, { ...list.filters, status: "Failed", start: 0, page_length: 1 }, { enabled: !f.status, staleTime: 30_000 })
	const failedTotal = failed.data?.total || 0
	const users = useMemo(() => [...new Map(list.rows.map((r) => [r.user, r.full_name])).entries()], [list.rows])

	return (
		<div>
			<div className="card mb-4 p-3 sm:p-4">
				<div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
					<div className="scroll-thin flex gap-1.5 overflow-x-auto pb-0.5">
						{[
							["", "All"],
							["Success", "Successful"],
							["Failed", "Failed"],
						].map(([id, label]) => (
							<Chip key={id || "all"} active={f.status === id} onClick={() => filters.set("status", id)} className={clsx("shrink-0", id === "Failed" && f.status !== id && "text-red-700 dark:text-red-300")}>
								{label}
								{id === "Failed" && !f.status && failedTotal ? <span className="ml-1 rounded-full bg-red-100 px-1.5 text-[11px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">{num(failedTotal)}</span> : null}
							</Chip>
						))}
					</div>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
						<FilterSelect label="Event" value={f.operation} onChange={(v) => filters.set("operation", v)}>
							<option value="">All events</option>
							{Object.entries(OPS).map(([id, o]) => (
								<option key={id} value={id}>
									{o.label}
								</option>
							))}
						</FilterSelect>
						<UserInput value={f.user} onChange={(v) => filters.set("user", v)} users={users} />
						<DateRange from={f.from} to={f.to} onFrom={(v) => filters.set("from", v)} onTo={(v) => filters.set("to", v)} className="sm:col-span-2 lg:col-span-1" />
					</div>
					{filters.any ? (
						<button type="button" className="text-left text-xs font-semibold text-brand-700 hover:underline lg:ml-auto" onClick={filters.clear}>
							Clear filters
						</button>
					) : null}
				</div>
			</div>

			{!f.status && failedTotal ? (
				<Alert
					tone="error"
					icon={AlertTriangle}
					title={`${num(failedTotal)} failed sign-in attempt${failedTotal === 1 ? "" : "s"} in this view`}
					action={
						<Button size="sm" variant="secondary" onClick={() => filters.set("status", "Failed")}>
							Show only failed
						</Button>
					}
					className="mb-4"
				>
					Repeated failures for one account or from one address can mean someone is guessing passwords.
				</Alert>
			) : null}

			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<span className="text-sm text-ink-soft">
					{list.query.data ? `${num(list.total)} event${list.total === 1 ? "" : "s"}` : " "}
					{list.query.isFetching && list.query.data ? " · updating…" : ""}
				</span>
				<ExportButton kind="access_log" filters={args} disabled={!list.total} />
			</div>

			<div className="card overflow-hidden">
				{list.query.isError && !list.query.data ? (
					<ErrorState error={list.query.error} onRetry={list.query.refetch} />
				) : !list.query.data ? (
					<SkeletonRows rows={8} className="p-4" />
				) : !list.rows.length ? (
					<Empty
						icon={ShieldCheck}
						title={f.status === "Failed" ? "No failed sign-ins" : "No sign-in activity matches"}
						subtitle="Sign-in records older than 90 days are cleared automatically."
						action={
							filters.any ? (
								<Button size="sm" variant="secondary" onClick={filters.clear}>
									Clear filters
								</Button>
							) : null
						}
					/>
				) : (
					<div className={clsx(list.query.isFetching && "opacity-70 transition-opacity")}>
						<table className="hidden w-full text-sm md:table">
							<thead>
								<tr className="border-b border-line bg-cream text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
									<th className="px-5 py-2.5">When</th>
									<th className="px-3 py-2.5">User</th>
									<th className="px-3 py-2.5">Event</th>
									<th className="px-3 py-2.5">IP address</th>
									<th className="px-5 py-2.5">Detail</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-line">
								{list.rows.map((r) => (
									<Row key={r.name} r={r} onUser={(u) => filters.set("user", u)} />
								))}
							</tbody>
						</table>
						<ul className="divide-y divide-line md:hidden">
							{list.rows.map((r) => (
								<Card key={r.name} r={r} onUser={(u) => filters.set("user", u)} />
							))}
						</ul>
					</div>
				)}
			</div>
			<Pager list={list} />
		</div>
	)
}

function UserInput({ value, onChange, users }) {
	return (
		<>
			<input
				type="text"
				list="audit-access-users"
				aria-label="User"
				defaultValue={value}
				key={value}
				placeholder="User email"
				onBlur={(e) => e.target.value.trim() !== value && onChange(e.target.value.trim())}
				onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
				className="input h-10 w-full py-0 text-sm lg:w-52"
			/>
			<datalist id="audit-access-users">
				{users.map(([u, n]) => (
					<option key={u} value={u}>
						{n && n !== u ? n : undefined}
					</option>
				))}
			</datalist>
		</>
	)
}

function EventLabel({ r }) {
	const op = OPS[r.operation] || { label: r.operation, icon: LogIn }
	const Icon = op.icon
	return (
		<span className="inline-flex items-center gap-2">
			<Icon size={15} className={r.status === "Failed" ? "text-red-600" : "text-ink-soft"} />
			<span className="font-medium text-ink">{op.label}</span>
			<Badge tone={STATUS_TONE[r.status] || "gray"} size="xs">
				{r.status === "Success" ? "Successful" : r.status}
			</Badge>
		</span>
	)
}

function Row({ r, onUser }) {
	const bad = r.status === "Failed"
	return (
		<tr className={clsx("align-top", bad ? "bg-red-50/70 dark:bg-red-950/25" : "hover:bg-cream/50")}>
			<td className={clsx("whitespace-nowrap px-5 py-3", bad && "shadow-[inset_4px_0_0_#ef4444]")}>
				<div className="font-medium text-ink">{dateTime(r.creation)}</div>
				{relative(r.creation) ? <div className="text-xs text-ink-soft">{relative(r.creation)}</div> : null}
			</td>
			<td className="px-3 py-3">
				<button type="button" onClick={() => onUser(r.user)} className="flex items-center gap-2.5 text-left" title={`Only ${r.user}`}>
					<Avatar name={r.full_name || r.user} size={30} />
					<span className="min-w-0">
						<span className="block truncate font-medium text-ink hover:text-brand-700 hover:underline">{r.full_name || r.user}</span>
						<span className="block truncate text-xs text-ink-soft">{r.user}</span>
					</span>
				</button>
			</td>
			<td className="px-3 py-3">
				<EventLabel r={r} />
			</td>
			<td className="px-3 py-3 font-mono text-xs text-ink-muted">{r.ip_address || "—"}</td>
			<td className={clsx("max-w-[18rem] px-5 py-3 text-xs", bad ? "font-medium text-red-700 dark:text-red-300" : "text-ink-muted")}>
				<span className="line-clamp-2" title={r.subject}>
					{r.subject || "—"}
				</span>
			</td>
		</tr>
	)
}

function Card({ r, onUser }) {
	const bad = r.status === "Failed"
	return (
		<li className={clsx("px-4 py-3", bad && "bg-red-50/70 shadow-[inset_4px_0_0_#ef4444] dark:bg-red-950/25")}>
			<div className="flex items-start justify-between gap-3">
				<button type="button" onClick={() => onUser(r.user)} className="min-w-0 text-left">
					<span className="block truncate font-semibold text-ink">{r.full_name || r.user}</span>
					<span className="block truncate text-xs text-ink-soft">{r.user}</span>
				</button>
				<span className="shrink-0 text-right text-xs text-ink-soft">{dateTime(r.creation)}</span>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
				<EventLabel r={r} />
				{r.ip_address ? <span className="font-mono text-ink-muted">{r.ip_address}</span> : null}
			</div>
			{r.subject ? <p className={clsx("mt-1.5 text-xs", bad ? "font-medium text-red-700 dark:text-red-300" : "text-ink-muted")}>{r.subject}</p> : null}
		</li>
	)
}
