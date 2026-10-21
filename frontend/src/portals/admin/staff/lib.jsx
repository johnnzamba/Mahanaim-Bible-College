import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { ShieldOff } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { frappe, plainText } from "@/shared/api/frappe"
import { exportCsv } from "@/shared/components/kit"
import { Badge, Empty, Panel } from "@/shared/components/ui"
import { ADMIN_ACCESS, ROLES, canAccess } from "@/shared/access"

export const API = "mahanaim.api.setup."

/** DataTable draws its own card; inside a Panel with bodyClass="p-0" it should sit flat. */
export const FLAT = "!rounded-none !border-0 !shadow-none"

/** Staff Member doctype options (also in lookups.options). */
export const STAFF_STATUSES = ["Active", "On Leave", "Inactive"]
export const STAFF_TYPES = ["Academic", "Administrative", "Support", "Adjunct", "Visiting"]
export const SALUTATIONS = ["Mr", "Mrs", "Ms", "Dr", "Rev.", "Rt. Rev.", "Pastor", "Bishop", "Prof."]

/** list_staff / get_staff need any staff role; save_staff and set_staff_status are Registrar (plus admins). */
export const CAN = {
	write: [ROLES.REGISTRAR],
	academics: [ROLES.REGISTRAR, ROLES.DEAN],
}

const STATUS_TONE = { Active: "green", "On Leave": "orange", Inactive: "gray" }
const TYPE_TONE = { Academic: "brand", Administrative: "blue", Support: "gray", Adjunct: "purple", Visiting: "gold" }

export function StaffStatus({ status, size }) {
	if (!status) return null
	return <Badge status={status} tone={STATUS_TONE[status]} size={size} />
}

export function StaffType({ type, size = "xs" }) {
	if (!type) return null
	return (
		<Badge tone={TYPE_TONE[type] || "gray"} size={size}>
			{type}
		</Badge>
	)
}

/** Today's date in the browser's time zone (toISOString would give the UTC date). */
export function today() {
	const d = new Date()
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const displayName = (s) => [s?.salutation, s?.full_name].filter(Boolean).join(" ")

export function useLookups() {
	return useApi("mahanaim.api.setup.lookups", {}, { staleTime: 10 * 60_000 })
}

export const campusName = (L, name) => (L?.campuses || []).find((c) => c.name === name)?.campus_name || name

/** KeyValueGrid shows "—" only for null, so blank strings from the server become null. */
export const kv = (items) => items.filter(Boolean).map((i) => ({ ...i, value: i.value === "" || i.value == null ? null : i.value }))

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

/** Export every row matching the filters (list endpoints cap a page at 200). */
export async function exportAll(method, args, cols, filename, max = 5000) {
	const rows = []
	for (let start = 0; start < max; start += 200) {
		const res = await frappe.call(method, { ...args, start, page_length: 200 })
		rows.push(...(res?.data || []))
		if (rows.length >= (res?.total || 0) || !(res?.data || []).length) break
	}
	exportCsv(filename, cols, rows)
	return rows.length
}

/** `bio` is a Text Editor field: edit it as plain paragraphs and save it back as simple HTML. */
export function bioToText(html) {
	if (!html) return ""
	return plainText(String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n"))
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function textToBio(text) {
	const t = String(text || "").trim()
	if (!t) return ""
	return t
		.split(/\n{2,}/)
		.map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
		.join("")
}

const AREA_LABELS = {
	"/admissions": "Admissions",
	"/students": "Students",
	"/academics": "Academics",
	"/credentials": "Credentials",
	"/finance": "Finance",
	"/church": "Church partners",
	"/communication": "Communication",
	"/website": "Website",
	"/library": "Library",
	"/staff": "Staff",
	"/alumni": "Alumni",
	"/reports": "Reports",
	"/settings": "Settings",
	"/audit": "Audit",
}

/** Which staff-workspace areas a set of roles opens (mirrors shared/access.js). */
export function workspaceAreas(roles = []) {
	const staffRoles = ADMIN_ACCESS[0][1]
	if (!roles.some((r) => staffRoles.includes(r) || r === ROLES.SYS)) return []
	return ADMIN_ACCESS.filter(([p]) => AREA_LABELS[p] && canAccess(roles, p)).map(([p]) => ({ path: p, label: AREA_LABELS[p] }))
}
