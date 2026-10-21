import { Badge } from "@/shared/components/ui"
import { statusTone } from "../lib"

export function AppStatus({ status, size, className }) {
	if (!status) return null
	return <Badge status={status} tone={statusTone(status)} dot size={size} className={className} />
}

/** Pass appStatus so an unpaid fee on a Draft reads as "due at submission" rather than an alarm. */
export function FeeBadge({ status, size, appStatus }) {
	if (!status) return null
	if (appStatus === "Draft" && status !== "Paid" && status !== "Waived")
		return (
			<Badge tone="gray" dot size={size}>
				Fee due at submission
			</Badge>
		)
	const tone = status === "Paid" || status === "Waived" ? "green" : status === "Pending" ? "orange" : "red"
	return (
		<Badge tone={tone} dot size={size}>
			Fee {String(status).toLowerCase()}
		</Badge>
	)
}
