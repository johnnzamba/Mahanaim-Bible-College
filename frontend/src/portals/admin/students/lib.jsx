import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { ShieldOff } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { exportCsv } from "@/shared/components/kit"
import { Badge, Empty, Panel } from "@/shared/components/ui"
import { ROLES } from "@/shared/access"
import { date } from "@/shared/utils/format"

export const API = "mahanaim.api.students."

/** DataTable draws its own card; inside a Panel with bodyClass="p-0" it should sit flat. */
export const FLAT = "!rounded-none !border-0 !shadow-none"

/** Student doctype status options, in lifecycle order. */
export const STUDENT_STATUSES = ["Applicant", "Admitted", "Registered", "Active", "Deferred", "Suspended", "Withdrawn", "Completed", "Alumni"]
export const STANDINGS = ["Good Standing", "Dean's List", "Academic Warning", "Probation"]
export const FEE_CATEGORIES = ["Standard", "Sponsored", "Staff Dependent", "International"]
export const GENDERS = ["Male", "Female"]
export const MARITAL = ["Single", "Married", "Widowed", "Divorced", "Separated"]
export const REQUEST_TYPES = ["Deferment", "Withdrawal", "Resumption", "Programme Transfer", "Campus Transfer", "Course Drop", "Document Request", "Transcript Request", "Clearance", "Other"]

const STATUS_TONE = {
	Applicant: "gray",
	Admitted: "blue",
	Registered: "purple",
	Active: "green",
	Deferred: "orange",
	Suspended: "red",
	Withdrawn: "gray",
	Completed: "gold",
	Alumni: "brand",
}
const STANDING_TONE = { "Good Standing": "green", "Dean's List": "gold", "Academic Warning": "orange", Probation: "red" }

export function StudentStatus({ status, size }) {
	if (!status) return null
	return <Badge status={status} tone={STATUS_TONE[status]} size={size} />
}

export function Standing({ value, size = "xs" }) {
	if (!value) return null
	return (
		<Badge tone={STANDING_TONE[value] || "gray"} size={size}>
			{value}
		</Badge>
	)
}

/** Roles mirrored from mahanaim/api/students.py (STAFF_READ / STAFF_WRITE) and the other APIs this area calls. */
export const CAN = {
	read: [ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE],
	write: [ROLES.REGISTRAR, ROLES.DEAN],
	results: [ROLES.REGISTRAR, ROLES.DEAN],
	account: [ROLES.FINANCE, ROLES.AUDITOR],
	credentials: [ROLES.REGISTRAR, ROLES.DEAN, ROLES.AUDITOR],
	financeArea: [ROLES.FINANCE, ROLES.AUDITOR],
	academics: [ROLES.REGISTRAR, ROLES.DEAN],
	applications: [ROLES.ADMISSIONS, ROLES.REGISTRAR, ROLES.DEAN, ROLES.FINANCE],
	/** REQUEST_STAFF adds the library to STAFF_READ for list_requests / get_request. */
	requestsRead: [ROLES.LIBRARY],
}

export function useLookups() {
	return useApi("mahanaim.api.setup.lookups", {}, { staleTime: 10 * 60_000 })
}

/** KeyValueGrid shows "—" only for null, so blank strings from the server become null. */
export const kv = (items) => items.filter(Boolean).map((i) => ({ ...i, value: i.value === "" || i.value == null ? null : i.value }))

/** Drop empty values so query keys stay stable and the server sees only real filters. */
export function compact(obj) {
	const out = {}
	for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null && v !== false) out[k] = v
	return out
}

/** Filters live in the URL so lists survive back-navigation and can be shared. Changing a filter resets `page`. */
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

export const STUDENTS_FORBIDDEN = "Student records are open to the registrar, the academic dean and finance."

export function isPermissionError(err) {
	return err?.status === 403 || err?.exc_type === "PermissionError"
}

export const fileName = (url) => decodeURIComponent(String(url || "").split("/").pop() || "")

export const termLabel = (lookups, term) => (lookups?.terms || []).find((t) => t.name === term)?.term_label || term

/** Export every row matching the filters (the list endpoints cap a page at 200). */
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

/** One-line summary of what the student asked for. */
export function requestSummary(r) {
	switch (r.request_type) {
		case "Deferment":
		case "Withdrawal":
			return r.from_date ? `From ${date(r.from_date)}${r.to_date ? ` to ${date(r.to_date)}` : ""}` : r.academic_term || ""
		case "Programme Transfer":
			return r.new_programme ? `To ${r.new_programme}` : ""
		case "Campus Transfer":
			return r.new_campus ? `To ${r.new_campus}` : ""
		case "Course Drop":
			return r.course?.course || r.course_enrolment || ""
		case "Transcript Request":
		case "Document Request":
			return [r.document_type, r.copies ? `${r.copies} cop${Number(r.copies) === 1 ? "y" : "ies"}` : null, r.delivery_method].filter(Boolean).join(" · ")
		default:
			return r.academic_term || ""
	}
}
