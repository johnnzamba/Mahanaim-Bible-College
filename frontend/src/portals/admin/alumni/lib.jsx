import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { ShieldOff } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { exportCsv } from "@/shared/components/kit"
import { Empty, Panel } from "@/shared/components/ui"
import { ROLES } from "@/shared/access"

export const API = "mahanaim.api.alumni."

/** DataTable draws its own card; inside a Panel with bodyClass="p-0" it should sit flat. */
export const FLAT = "!rounded-none !border-0 !shadow-none"

/**
 * alumni_directory: any signed-in user (opted-in alumni only).
 * alumni_stats, graduation_candidates, graduate_students: Registrar and Academic Dean (plus admins).
 * Student 360 links need STAFF_READ in students.py.
 */
export const CAN = {
	staff: [ROLES.REGISTRAR, ROLES.DEAN],
	student360: [ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE],
	certificates: [ROLES.REGISTRAR],
}

/** Today's date in the browser's time zone (toISOString would give the UTC date). */
export function today() {
	const d = new Date()
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function useLookups() {
	return useApi("mahanaim.api.setup.lookups", {}, { staleTime: 10 * 60_000 })
}

export const campusName = (L, name) => (L?.campuses || []).find((c) => c.name === name)?.campus_name || name
export const programmeName = (L, name) => (L?.programmes || []).find((p) => p.name === name)?.programme_name || name

export function compact(obj) {
	const out = {}
	for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null && v !== false) out[k] = v
	return out
}

/** Filters live in the URL so lists survive back-navigation. Changing a filter resets `page`. */
export function useUrlFilters() {
	const [params, setParams] = useSearchParams()
	const get = useCallback((k) => params.get(k) || "", [params])
	const set = useCallback(
		(patch) =>
			setParams(
				(prev) => {
					const next = new URLSearchParams(prev)
					for (const [k, v] of Object.entries(patch)) {
						if (v === "" || v == null || v === false) next.delete(k)
						else next.set(k, String(v))
					}
					if (!("page" in patch)) next.delete("page")
					return next
				},
				{ replace: true }
			),
		[setParams]
	)
	return [get, set, params]
}

export function NoAccess({ message = "Your role cannot open this screen." }) {
	return (
		<Panel>
			<Empty icon={ShieldOff} title="Not available for your role" subtitle={message} />
		</Panel>
	)
}

export function isPermissionError(err) {
	return err?.status === 403 || err?.exc_type === "PermissionError"
}

/** Export every row matching the filters; alumni_directory caps a page at 100. */
export async function exportAll(method, args, cols, filename, step = 100, max = 5000) {
	const rows = []
	for (let start = 0; start < max; start += step) {
		const res = await frappe.call(method, { ...args, start, page_length: step })
		rows.push(...(res?.data || []))
		if (rows.length >= (res?.total || 0) || (res?.data || []).length < step) break
	}
	exportCsv(filename, cols, rows)
	return rows.length
}

/** "Associate Pastor at Grace Chapel" from the two ministry fields. */
export function ministryLine(r) {
	const pos = (r?.current_position || "").trim()
	const min = (r?.current_ministry || "").trim()
	if (pos && min) return min.toLowerCase().includes(pos.toLowerCase()) ? min : `${pos}, ${min}`
	return pos || min || ""
}
