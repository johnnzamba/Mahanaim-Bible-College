import { useState } from "react"
import clsx from "clsx"
import { Check, Plus } from "lucide-react"
import { SkeletonRows } from "@/shared/components/ui"
import { SearchInput, useDebounced } from "@/shared/components/kit"
import { useApi } from "@/shared/api/hooks"
import { ACAD, rowsOf } from "../lib"

/**
 * Server-searched course list. `selected` marks chosen codes; `exclude` hides codes entirely.
 * onPick(courseRow) fires on click; the parent decides whether that adds, toggles or replaces.
 */
export function CoursePicker({ onPick, selected = [], exclude = [], activeOnly = true, autoFocus, maxHeight = 280 }) {
	const [search, setSearch] = useState("")
	const debounced = useDebounced(search)
	const q = useApi(`${ACAD}list_courses`, { search: debounced || undefined, is_active: activeOnly ? 1 : undefined, page_length: 30 })
	const rows = rowsOf(q.data).filter((r) => !exclude.includes(r.name))
	return (
		<div>
			<SearchInput value={search} onChange={setSearch} placeholder="Search by course code or title…" autoFocus={autoFocus} />
			<div className="scroll-thin mt-2 overflow-y-auto rounded-xl border border-line" style={{ maxHeight }}>
				{q.isLoading ? (
					<div className="p-3">
						<SkeletonRows rows={4} />
					</div>
				) : rows.length ? (
					<ul className="divide-y divide-line">
						{rows.map((r) => {
							const on = selected.includes(r.name)
							return (
								<li key={r.name}>
									<button
										type="button"
										onClick={() => onPick(r)}
										className={clsx("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-cream/60", on && "bg-brand-50/70")}
									>
										<span className={clsx("grid h-6 w-6 shrink-0 place-items-center rounded-md", on ? "bg-brand-700 text-white" : "bg-cream text-ink-soft")}>
											{on ? <Check size={14} /> : <Plus size={14} />}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-semibold text-ink">
												{r.course_code} · {r.course_title}
											</span>
											<span className="block truncate text-xs text-ink-soft">
												{r.credits || 0} credits{r.department ? ` · ${r.department}` : ""}
												{r.prerequisites?.length ? ` · needs ${r.prerequisites.join(", ")}` : ""}
											</span>
										</span>
									</button>
								</li>
							)
						})}
					</ul>
				) : (
					<p className="px-3 py-6 text-center text-sm text-ink-soft">{search ? "No course matches that search." : "No courses available."}</p>
				)}
			</div>
		</div>
	)
}
