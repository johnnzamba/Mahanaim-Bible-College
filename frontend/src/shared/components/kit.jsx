import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowDown, ArrowUp, ChevronsUpDown, Check, Circle, Download, Search, X } from "lucide-react"
import { Badge, Empty, Pagination, SkeletonRows, ErrorState, Card, BUTTON_VARIANTS } from "./ui"

export function useDebounced(value, ms = 300) {
	const [v, setV] = useState(value)
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms)
		return () => clearTimeout(t)
	}, [value, ms])
	return v
}

export function Section({ title, subtitle, actions, children, className }) {
	return (
		<section className={clsx("mb-6", className)}>
			{title || actions ? (
				<div className="mb-3 flex items-end justify-between gap-3">
					<div>
						{title ? <h2 className="text-base font-semibold text-ink">{title}</h2> : null}
						{subtitle ? <p className="text-xs text-ink-soft">{subtitle}</p> : null}
					</div>
					{actions ? <div className="flex items-center gap-2">{actions}</div> : null}
				</div>
			) : null}
			{children}
		</section>
	)
}

export function SearchInput({ value, onChange, placeholder = "Search…", className, autoFocus }) {
	return (
		<div className={clsx("relative", className)}>
			<Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
			<input
				type="search"
				value={value}
				autoFocus={autoFocus}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="input py-2 pl-9 pr-8"
			/>
			{value ? (
				<button type="button" aria-label="Clear" onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink">
					<X size={14} />
				</button>
			) : null}
		</div>
	)
}

/**
 * Toolbar: search + chip filters + right-side actions.
 * chips: [{ id, label, count }]
 */
export function Toolbar({ search, onSearch, placeholder, chips, active, onChip, right, children, className }) {
	return (
		<div className={clsx("mb-4 flex flex-col gap-3 lg:flex-row lg:items-center", className)}>
			{onSearch ? <SearchInput value={search} onChange={onSearch} placeholder={placeholder} className="w-full lg:max-w-xs" /> : null}
			{chips?.length ? (
				<div className="scroll-thin flex gap-1.5 overflow-x-auto pb-0.5">
					{chips.map((c) => (
						<button key={c.id} type="button" className={clsx("chip shrink-0", active === c.id && "chip-active")} onClick={() => onChip(c.id)}>
							{c.label}
							{c.count != null ? <span className="opacity-70">{c.count}</span> : null}
						</button>
					))}
				</div>
			) : null}
			{children}
			{right ? <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{right}</div> : null}
		</div>
	)
}

function getVal(row, col) {
	if (typeof col.sortValue === "function") return col.sortValue(row)
	return row?.[col.key]
}

/**
 * DataTable
 * cols: [{ key, label, render?(row), className?, align?: "right"|"center", sortable?, sortValue?(row), hideOnMobile?, width? }]
 * rows: array; rowKey: fn|string (default "name")
 * onRow(row) | rowTo(row) → link; selectable + selected/onSelect for bulk actions
 * query: optional react-query result; shows skeleton / error automatically
 * Mobile: renders stacked cards (first col = title) unless `noCards`.
 */
// Module-level so mobile cards keep their identity across DataTable re-renders (an inline component remounts).
function RowWrap({ to, children }) {
	return to ? (
		<Link to={to} className="block">
			{children}
		</Link>
	) : (
		children
	)
}

export function DataTable({
	cols,
	rows,
	query,
	rowKey = "name",
	onRow,
	rowTo,
	empty = "Nothing to show yet",
	emptyIcon,
	emptyAction,
	dense,
	maxHeight,
	selectable,
	selected,
	onSelect,
	pageSize,
	noCards,
	className,
	footer,
	initialSort,
}) {
	const data = rows ?? query?.data ?? []
	const list = Array.isArray(data) ? data : data?.rows || data?.data || []
	const [sort, setSort] = useState(initialSort || null)
	const [page, setPage] = useState(1)
	const keyOf = (r, i) => (typeof rowKey === "function" ? rowKey(r) : r?.[rowKey]) ?? i

	const sorted = useMemo(() => {
		if (!sort) return list
		const col = cols.find((c) => c.key === sort.key)
		if (!col) return list
		const dir = sort.dir === "desc" ? -1 : 1
		return [...list].sort((a, b) => {
			const va = getVal(a, col)
			const vb = getVal(b, col)
			if (va == null && vb == null) return 0
			if (va == null) return 1
			if (vb == null) return -1
			if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir
			return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir
		})
	}, [list, sort, cols])

	useEffect(() => setPage(1), [list.length, sort])
	const visible = pageSize ? sorted.slice((page - 1) * pageSize, page * pageSize) : sorted
	const allKeys = visible.map(keyOf)
	const sel = selected || []
	const allOn = selectable && allKeys.length > 0 && allKeys.every((k) => sel.includes(k))

	const toggleAll = () => onSelect?.(allOn ? sel.filter((k) => !allKeys.includes(k)) : [...new Set([...sel, ...allKeys])])
	const toggle = (k) => onSelect?.(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k])
	const clickable = Boolean(onRow || rowTo)

	if (query?.isLoading && !rows) {
		return (
			<Card className={clsx("p-5", className)}>
				<SkeletonRows rows={6} />
			</Card>
		)
	}
	if (query?.isError && !rows) {
		return (
			<Card className={className}>
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			</Card>
		)
	}

	const cellContent = (c, r) => (c.render ? c.render(r) : r?.[c.key] ?? "—")
	return (
		<div className={clsx("card overflow-hidden", className)}>
			{list.length === 0 ? (
				typeof empty === "string" ? (
					<Empty title={empty} icon={emptyIcon} action={emptyAction} compact />
				) : (
					empty
				)
			) : (
				<>
					<div className={clsx("scroll-thin overflow-auto", !noCards && "hidden md:block")} style={maxHeight ? { maxHeight } : undefined}>
						<table className="table-base">
							<thead>
								<tr>
									{selectable ? (
										<th className="w-10">
											<input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" className="h-4 w-4 accent-[rgb(var(--brand-700))]" />
										</th>
									) : null}
									{cols.map((c) => {
										const sortable = c.sortable ?? Boolean(c.key && (!c.render || c.sortValue))
										const on = sort?.key === c.key
										return (
											<th
												key={c.key || c.label}
												style={c.width ? { width: c.width } : undefined}
												className={clsx(c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}
											>
												{sortable ? (
													<button
														type="button"
														className="inline-flex items-center gap-1 uppercase hover:text-ink"
														onClick={() => setSort(on && sort.dir === "asc" ? { key: c.key, dir: "desc" } : on && sort.dir === "desc" ? null : { key: c.key, dir: "asc" })}
													>
														{c.label}
														{on ? sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ChevronsUpDown size={12} className="opacity-40" />}
													</button>
												) : (
													c.label
												)}
											</th>
										)
									})}
								</tr>
							</thead>
							<tbody>
								{visible.map((r, i) => {
									const k = keyOf(r, i)
									const to = rowTo?.(r)
									return (
										<tr
											key={k}
											onClick={onRow ? () => onRow(r) : undefined}
											className={clsx(clickable && "cursor-pointer hover:bg-cream/60", sel.includes(k) && "bg-brand-50/60")}
										>
											{selectable ? (
												<td onClick={(e) => e.stopPropagation()}>
													<input type="checkbox" checked={sel.includes(k)} onChange={() => toggle(k)} aria-label="Select row" className="h-4 w-4 accent-[rgb(var(--brand-700))]" />
												</td>
											) : null}
											{cols.map((c, ci) => (
												<td
													key={c.key || c.label}
													className={clsx(dense && "!py-2", c.align === "right" && "text-right tabular-nums", c.align === "center" && "text-center", c.className)}
												>
													{to && ci === 0 ? (
														<Link to={to} className="hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
															{cellContent(c, r)}
														</Link>
													) : (
														cellContent(c, r)
													)}
												</td>
											))}
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
					{noCards ? null : (
						<ul className="divide-y divide-line md:hidden">
							{visible.map((r, i) => {
								const k = keyOf(r, i)
								const [first, ...rest] = cols.filter((c) => !c.hideOnMobile)
								return (
									<li key={k} onClick={onRow ? () => onRow(r) : undefined} className={clsx("px-4 py-3", clickable && "active:bg-cream")}>
										<RowWrap to={rowTo?.(r)}>
											<div className="flex items-start gap-3">
												{selectable ? (
													<input
														type="checkbox"
														checked={sel.includes(k)}
														onClick={(e) => e.stopPropagation()}
														onChange={() => toggle(k)}
														className="mt-1 h-4 w-4 accent-[rgb(var(--brand-700))]"
													/>
												) : null}
												<div className="min-w-0 flex-1">
													<div className="font-medium text-ink">{first ? cellContent(first, r) : null}</div>
													<dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
														{rest.map((c) => (
															<div key={c.key || c.label} className="min-w-0">
																<dt className="text-ink-soft">{c.label}</dt>
																<dd className="truncate text-ink-muted">{cellContent(c, r)}</dd>
															</div>
														))}
													</dl>
												</div>
											</div>
										</RowWrap>
									</li>
								)
							})}
						</ul>
					)}
					{pageSize ? <Pagination className="border-t border-line px-4" page={page} pageSize={pageSize} total={sorted.length} onChange={setPage} /> : null}
					{footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
				</>
			)}
		</div>
	)
}

/** Bulk-action bar shown while rows are selected. */
export function SelectionBar({ count, onClear, children }) {
	if (!count) return null
	return (
		<div className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit max-w-full animate-fade-up items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lift">
			<span className="text-sm font-semibold text-ink">{count} selected</span>
			<span className="h-5 w-px bg-line" />
			<div className="flex flex-wrap items-center gap-2">{children}</div>
			<button type="button" onClick={onClear} className="text-ink-soft hover:text-ink" aria-label="Clear selection">
				<X size={16} />
			</button>
		</div>
	)
}

/** steps: [{ label, date?, note?, status: "done"|"current"|"pending"|"failed" }] */
export function Timeline({ steps = [], className }) {
	return (
		<ol className={clsx("relative space-y-5", className)}>
			{steps.map((s, i) => {
				const last = i === steps.length - 1
				const done = s.status === "done"
				const cur = s.status === "current"
				const failed = s.status === "failed"
				return (
					<li key={`${s.label}-${i}`} className="relative flex gap-3.5">
						{!last ? <span className={clsx("absolute left-[11px] top-7 h-[calc(100%-4px)] w-0.5", done ? "bg-brand-600" : "bg-line")} /> : null}
						<span
							className={clsx(
								"relative z-[1] grid h-6 w-6 shrink-0 place-items-center rounded-full border-2",
								done && "border-brand-700 bg-brand-700 text-white",
								cur && "border-gold-500 bg-gold-50 text-gold-700",
								failed && "border-red-500 bg-red-50 text-red-600",
								!done && !cur && !failed && "border-line bg-surface text-ink-soft"
							)}
						>
							{done ? <Check size={13} strokeWidth={3} /> : failed ? <X size={13} strokeWidth={3} /> : <Circle size={7} fill="currentColor" />}
						</span>
						<div className="min-w-0 pb-1">
							<div className={clsx("text-sm font-semibold", done || cur ? "text-ink" : "text-ink-soft")}>{s.label}</div>
							{s.date ? <div className="text-xs text-ink-soft">{s.date}</div> : null}
							{s.note ? <div className="mt-1 text-xs text-ink-muted">{s.note}</div> : null}
						</div>
					</li>
				)
			})}
		</ol>
	)
}

/** Horizontal stepper for wizards. steps: [label]; current: index */
export function Stepper({ steps, current, onStep, className }) {
	return (
		<ol className={clsx("scroll-thin flex items-center gap-2 overflow-x-auto pb-1", className)}>
			{steps.map((label, i) => {
				const done = i < current
				const on = i === current
				return (
					<li key={label} className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							disabled={!onStep || i > current}
							onClick={() => onStep?.(i)}
							className={clsx(
								"flex items-center gap-2 rounded-full px-1 py-1 pr-3 text-xs font-semibold transition",
								on ? "bg-brand-800 text-white" : done ? "bg-brand-50 text-brand-700" : "text-ink-soft"
							)}
						>
							<span
								className={clsx(
									"grid h-6 w-6 place-items-center rounded-full text-[11px]",
									on ? "bg-gold-500 text-brand-900" : done ? "bg-brand-700 text-white" : "bg-line/70 text-ink-soft"
								)}
							>
								{done ? <Check size={12} strokeWidth={3} /> : i + 1}
							</span>
							{label}
						</button>
						{i < steps.length - 1 ? <span className={clsx("h-px w-6", done ? "bg-brand-600" : "bg-line")} /> : null}
					</li>
				)
			})}
		</ol>
	)
}

/** Kanban board. columns: [{ id, label, tone? }]; cards: [{ ..., [columnKey]: id }] */
export function Board({ columns, cards, columnKey = "status", renderCard, onCard, className }) {
	return (
		<div className={clsx("scroll-thin flex gap-4 overflow-x-auto pb-2", className)}>
			{columns.map((col) => {
				const items = cards.filter((c) => c[columnKey] === col.id)
				return (
					<div key={col.id} className="flex w-72 shrink-0 flex-col rounded-2xl bg-cream/70 p-2.5">
						<div className="mb-2 flex items-center justify-between px-1.5">
							<Badge status={col.id} tone={col.tone}>
								{col.label || col.id}
							</Badge>
							<span className="text-xs font-semibold text-ink-soft">{items.length}</span>
						</div>
						<div className="flex flex-col gap-2">
							{items.map((c) => (
								<button key={c.name} type="button" onClick={() => onCard?.(c)} className="card p-3 text-left transition hover:shadow-soft">
									{renderCard(c)}
								</button>
							))}
							{items.length === 0 ? <div className="px-2 py-6 text-center text-xs text-ink-soft">Empty</div> : null}
						</div>
					</div>
				)
			})}
		</div>
	)
}

export function BarRow({ label, value, max = 100, caption, tone = "bg-brand-700" }) {
	const pct = max ? Math.min(100, (Number(value || 0) / max) * 100) : 0
	return (
		<div>
			<div className="mb-1 flex items-center justify-between gap-2 text-xs">
				<span className="truncate font-medium text-ink-muted">{label}</span>
				<span className="shrink-0 font-semibold text-ink">{caption ?? value}</span>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-line/70">
				<div className={clsx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
			</div>
		</div>
	)
}

export function PersonRow({ name, sub, image, right, to, Avatar }) {
	const inner = (
		<div className="flex items-center gap-3 py-2.5">
			{Avatar ? <Avatar name={name} src={image} size={36} /> : null}
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-semibold text-ink">{name}</div>
				{sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
			</div>
			{right}
		</div>
	)
	return to ? (
		<Link to={to} className="block rounded-lg px-1 hover:bg-cream/60">
			{inner}
		</Link>
	) : (
		inner
	)
}

/** Client-side CSV export of the rows currently shown. cols as DataTable (uses `exportValue` or raw key). */
export function exportCsv(filename, cols, rows) {
	const esc = (v) => {
		const s = v == null ? "" : String(v)
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
	}
	const usable = cols.filter((c) => c.key && c.export !== false)
	const lines = [usable.map((c) => esc(c.label)).join(",")]
	for (const r of rows) lines.push(usable.map((c) => esc(c.exportValue ? c.exportValue(r) : r[c.key])).join(","))
	const blob = new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" })
	const a = document.createElement("a")
	a.href = URL.createObjectURL(blob)
	a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`
	a.click()
	setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function ExportButton({ filename, cols, rows, label = "Export" }) {
	return (
		<button type="button" className="btn btn-secondary btn-sm" disabled={!rows?.length} onClick={() => exportCsv(filename, cols, rows || [])}>
			<Download size={14} /> {label}
		</button>
	)
}

export function DownloadLink({ href, children = "Download", className, variant = "secondary" }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" className={clsx("btn btn-sm", BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary, className)}>
			<Download size={14} /> {children}
		</a>
	)
}
