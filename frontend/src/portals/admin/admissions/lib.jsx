import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { ShieldOff } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Empty, Panel } from "@/shared/components/ui"
import { ROLES } from "@/shared/access"

export const API = "mahanaim.api.admissions."

/** Statuses in pipeline order (matches the Programme Application doctype). */
export const STATUSES = ["Draft", "Submitted", "Under Review", "Interview", "Waitlisted", "Admitted", "Accepted", "Rejected", "Declined", "Withdrawn"]

export const BOARD_COLUMNS = [
	{ id: "Submitted", label: "Submitted" },
	{ id: "Under Review", label: "Under review" },
	{ id: "Interview", label: "Interview", tone: "purple" },
	{ id: "Waitlisted", label: "Waitlisted" },
	{ id: "Admitted", label: "Admitted" },
	{ id: "Accepted", label: "Accepted" },
	{ id: "Rejected", label: "Rejected" },
]

export const STATUS_TONE = { Interview: "purple", Declined: "red", Draft: "gray" }

export function StatusBadge({ status, size }) {
	return <Badge status={status} tone={STATUS_TONE[status]} size={size} />
}

const FEE_TONE = { Paid: "green", Waived: "blue", Pending: "orange", Unpaid: "red" }

export function FeeBadge({ status, awaiting, size = "xs" }) {
	if (!status) return null
	return (
		<Badge tone={FEE_TONE[status] || "gray"} size={size}>
			{status === "Unpaid" && !awaiting ? "Fee unpaid" : `Fee ${status.toLowerCase()}`}
		</Badge>
	)
}

/** Roles mirrored from mahanaim/api/admissions.py require_roles lists. */
export const CAN = {
	review: [ROLES.ADMISSIONS, ROLES.REGISTRAR, ROLES.DEAN],
	waive: [ROLES.ADMISSIONS, ROLES.REGISTRAR, ROLES.FINANCE],
	convert: [ROLES.ADMISSIONS, ROLES.REGISTRAR],
	verify: [ROLES.ADMISSIONS, ROLES.REGISTRAR],
}

/** "3/5 verified" plus a flagged count, from documents_total / _verified / _flagged on application dicts and list rows. */
export function DocsChip({ row, size = "xs", onClick }) {
	const total = Number(row?.documents_total || 0)
	if (!total) return null
	const done = Number(row.documents_verified || 0)
	const flagged = Number(row.documents_flagged || 0)
	const body = (
		<>
			<Badge tone={done >= total ? "green" : "gray"} size={size}>
				{done}/{total} verified
			</Badge>
			{flagged ? (
				<Badge tone="orange" size={size}>
					{flagged} flagged
				</Badge>
			) : null}
		</>
	)
	return onClick ? (
		<button type="button" onClick={onClick} title="Open the documents" className="inline-flex items-center gap-1.5 rounded-full">
			{body}
		</button>
	) : (
		<span className="inline-flex flex-wrap items-center gap-1">{body}</span>
	)
}

/** Groups of documents of which at least one must be uploaded (services/admissions.py REQUIRED_DOCUMENTS). */
export const REQUIRED_DOCUMENTS = [["National ID"], ["Passport Photo"], ["KCSE Certificate", "Academic Certificate"]]

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

export function isPermissionError(err) {
	return err?.status === 403 || err?.exc_type === "PermissionError"
}

export const fileName = (url) => decodeURIComponent(String(url || "").split("/").pop() || "")
export const isImage = (url) => /\.(png|jpe?g|gif|webp|svg)$/i.test(String(url || ""))
export const isPdf = (url) => /\.pdf$/i.test(String(url || ""))
