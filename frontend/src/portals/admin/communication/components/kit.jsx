import { useEffect, useRef, useState } from "react"
import { NavLink } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import clsx from "clsx"
import { Search, X } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { useDebounced } from "@/shared/components/kit"
import { Field, Pagination, Spinner } from "@/shared/components/ui"

export const today = () => {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const addDays = (iso, days) => {
	const d = new Date(`${iso || today()}T00:00:00`)
	d.setDate(d.getDate() + days)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** "2025-03" → "Mar 25" for chart axes. */
export const monthLabel = (m) => {
	const [y, mo] = String(m || "").split("-")
	if (!y || !mo) return m
	return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
}

/** Drop empty values so list filters and payloads stay tidy. */
export function compact(obj) {
	const out = {}
	for (const [k, v] of Object.entries(obj || {})) if (v !== "" && v !== null && v !== undefined) out[k] = v
	return out
}

/** Payload helper: empty strings become null so cleared fields are cleared on the server. */
export function nullify(obj) {
	const out = {}
	for (const [k, v] of Object.entries(obj || {})) {
		if (k.startsWith("_")) continue
		out[k] = v === "" ? null : v
	}
	return out
}

export function useLookups() {
	return useApi("mahanaim.api.setup.lookups", {}, { staleTime: 5 * 60 * 1000 })
}

/** Server-paginated list for endpoints returning `{data, total}`: `{ query, rows, total, pager }`. */
export function usePaged(method, args, pageSize = 20, options = {}) {
	const [page, setPage] = useState(1)
	const key = JSON.stringify(args)
	useEffect(() => setPage(1), [key])
	const query = useApi(method, { ...compact(args), start: (page - 1) * pageSize, page_length: pageSize }, { placeholderData: keepPreviousData, ...options })
	const total = query.data?.total || 0
	return {
		query,
		rows: query.data?.data || [],
		total,
		page,
		setPage,
		pager: total > pageSize ? <Pagination className="!py-0" page={page} pageSize={pageSize} total={total} onChange={setPage} /> : null,
	}
}

/** Underlined links between the screens of one area (the rail keeps only the main ones). */
export function SubTabs({ links, label }) {
	if (!links || links.length < 2) return null
	return (
		<nav className="scroll-thin -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label={label}>
			{links.map((l) => (
				<NavLink
					key={l.to}
					to={l.to}
					end={l.end}
					className={({ isActive }) =>
						clsx(
							"-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition",
							isActive ? "border-gold-500 text-ink" : "border-transparent text-ink-soft hover:text-ink"
						)
					}
				>
					{l.label}
				</NavLink>
			))}
		</nav>
	)
}

/**
 * Remote search picker. `search(q)` resolves to [{ value, label, description }].
 * `display` is the label shown for the current value (e.g. the student's name).
 */
export function SearchPick({ id, label, value, display, onChange, search, placeholder = "Type to search…", required, hint, error, disabled, minChars = 2, className }) {
	const [q, setQ] = useState("")
	const [open, setOpen] = useState(false)
	const box = useRef(null)
	const dq = useDebounced(q, 250)
	const query = useQuery({
		queryKey: ["pick", id, dq],
		queryFn: () => search(dq),
		enabled: open && dq.trim().length >= minChars,
		staleTime: 30000,
	})
	useEffect(() => {
		if (!open) return undefined
		const onDoc = (e) => {
			if (box.current && !box.current.contains(e.target)) setOpen(false)
		}
		document.addEventListener("mousedown", onDoc)
		return () => document.removeEventListener("mousedown", onDoc)
	}, [open])

	if (value) {
		return (
			<Field label={label} hint={hint} error={error} required={required} className={className}>
				<div className="input flex items-center justify-between gap-2">
					<span className="min-w-0 truncate">
						<span className="font-medium text-ink">{display || value}</span>
						{display && display !== value ? <span className="ml-2 text-xs text-ink-soft">{value}</span> : null}
					</span>
					{disabled ? null : (
						<button type="button" aria-label={`Clear ${label || "selection"}`} className="shrink-0 text-ink-soft hover:text-ink" onClick={() => onChange(null, null)}>
							<X size={15} />
						</button>
					)}
				</div>
			</Field>
		)
	}
	const results = query.data || []
	const searching = dq.trim().length >= minChars && (query.isFetching || dq !== q)
	return (
		<Field label={label} hint={hint} error={error} required={required} className={className}>
			<div ref={box} className="relative">
				<Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
				<input
					className={clsx("input pl-9", error && "border-red-400")}
					value={q}
					disabled={disabled}
					placeholder={placeholder}
					aria-label={label || placeholder}
					onFocus={() => setOpen(true)}
					onChange={(e) => {
						setQ(e.target.value)
						setOpen(true)
					}}
				/>
				{open && q.trim().length >= minChars ? (
					<ul className="scroll-thin absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lift" role="listbox">
						{query.isError ? (
							<li className="px-3 py-2 text-sm text-red-600">{query.error?.message || "Search failed"}</li>
						) : searching && !results.length ? (
							<li className="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft">
								<Spinner size={14} /> Searching…
							</li>
						) : results.length === 0 ? (
							<li className="px-3 py-2 text-sm text-ink-soft">No matches for “{q}”</li>
						) : (
							results.map((r) => (
								<li key={`${r.type || ""}${r.value}`}>
									<button
										type="button"
										role="option"
										aria-selected="false"
										data-pick={r.value}
										className="block w-full px-3 py-2 text-left hover:bg-cream"
										onClick={() => {
											onChange(r.value, r)
											setQ("")
											setOpen(false)
										}}
									>
										<span className="block truncate text-sm font-medium text-ink">{r.label}</span>
										{r.description ? <span className="block truncate text-xs text-ink-soft">{r.description}</span> : null}
									</button>
								</li>
							))
						)}
					</ul>
				) : null}
			</div>
		</Field>
	)
}

/** Small bordered figure used inside detail panels. */
export function Stat({ label, value, sub, tone }) {
	return (
		<div className="min-w-0 rounded-xl border border-line px-3 py-2.5">
			<div className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
			<div className={clsx("mt-0.5 truncate text-lg font-bold", tone || "text-ink")}>{value}</div>
			{sub ? <div className="truncate text-xs text-ink-soft">{sub}</div> : null}
		</div>
	)
}

/** Download text returned by an API (e.g. a CSV export) as a file. */
export function downloadText(filename, content, mimetype = "text/csv") {
	const blob = new Blob([content || ""], { type: `${mimetype};charset=utf-8` })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
