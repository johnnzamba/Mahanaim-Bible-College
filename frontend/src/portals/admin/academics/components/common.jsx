import { Link, useLocation, useNavigate } from "react-router-dom"
import { Lock } from "lucide-react"
import { Badge, Empty, Select, Tabs } from "@/shared/components/ui"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { BASE, SHEET_TONE, termOptions } from "../lib"

const GROUPS = {
	catalogue: [
		{ id: "programmes", label: "Programmes" },
		{ id: "courses", label: "Courses" },
	],
	exams: [
		{ id: "exams", label: "Exams" },
		{ id: "question-bank", label: "Question bank" },
	],
	results: [
		{ id: "results", label: "Results" },
		{ id: "mark-sheets", label: "Mark sheets" },
		{ id: "grading", label: "Grading scales" },
	],
}

/** Second-level tabs for the screens one rail item covers (keeps the rail to six items). */
export function SubNav({ group }) {
	const navigate = useNavigate()
	const { pathname } = useLocation()
	const { roles } = useSession()
	const seg = pathname.slice(BASE.length).split("/")[1] || ""
	const tabs = GROUPS[group].filter((t) => canAccess(roles, `/academics/${t.id}`))
	if (tabs.length < 2) return null
	return <Tabs tabs={tabs} active={seg} onChange={(id) => navigate(`${BASE}/${id}`)} className="mb-5" />
}

export function TermSelect({ lookups, value, onChange, className, label, allowAll }) {
	return (
		<Select
			aria-label="Academic term"
			label={label}
			className={className}
			value={value || ""}
			onChange={(e) => onChange(e.target.value)}
			options={termOptions(lookups)}
			placeholder={allowAll ? "All terms" : undefined}
		/>
	)
}

export function SheetBadge({ status, size }) {
	const s = status || "Not Started"
	return <Badge status={s} tone={SHEET_TONE[s]} size={size} />
}

export function ResultBadge({ status }) {
	const tone = { Pass: "green", Fail: "red", Absent: "red", Incomplete: "orange", Supplementary: "orange" }[status]
	return <Badge status={status} tone={tone} size="xs" />
}

/** Shown when a role reaches an academic screen that access.js does not open to it. */
export function Restricted() {
	const { roles } = useSession()
	const results = canAccess(roles, "/academics/results")
	return (
		<Empty
			icon={Lock}
			title="This screen is for the Registrar and Academic Dean"
			subtitle={results ? "You can review term results read-only." : "Ask the Registrar if you need access."}
			action={
				results ? (
					<Link to={`${BASE}/results`} className="btn btn-primary btn-sm">
						Open results
					</Link>
				) : null
			}
		/>
	)
}

/** Compact "label value" facts under a page title. */
export function Facts({ items }) {
	return (
		<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
			{items.filter(Boolean).map((it) => (
				<span key={it.label} className="inline-flex items-center gap-1">
					{it.icon ? <it.icon size={13} /> : null}
					<span>{it.label}</span>
					{it.value != null ? <span className="font-semibold text-ink-muted">{it.value}</span> : null}
				</span>
			))}
		</div>
	)
}
