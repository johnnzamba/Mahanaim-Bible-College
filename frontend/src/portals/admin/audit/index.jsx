import { Route, Routes, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { canAccess } from "@/shared/access"
import { useSession } from "@/shared/session"
import { Button, PageHeader, Tabs } from "@/shared/components/ui"
import { A, NoAccess } from "./lib"
import Summary from "./pages/Summary"
import Changes from "./pages/Changes"
import Access from "./pages/Access"

const TABS = [
	{ id: "summary", label: "Summary" },
	{ id: "changes", label: "Record changes" },
	{ id: "access", label: "Sign-in activity" },
]

/** /admin/audit/* — read-only audit trail (Auditor, College Administrator, System Manager). */
export default function AuditArea() {
	return (
		<Routes>
			<Route path="*" element={<AuditLog />} />
		</Routes>
	)
}

function AuditLog() {
	const { roles } = useSession()
	const [params, setParams] = useSearchParams()
	const qc = useQueryClient()
	if (!canAccess(roles, "/audit")) return <NoAccess />
	const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "summary"
	const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey?.[0] || "").startsWith(A) })

	return (
		<div>
			<PageHeader
				eyebrow="System"
				title="Audit log"
				subtitle="Who changed which record, and who signed in. Read-only, drawn from the history kept for every campus record."
				actions={
					<Button size="sm" variant="secondary" icon={RefreshCw} onClick={refresh}>
						Refresh
					</Button>
				}
			/>
			<Tabs className="mb-5 overflow-y-hidden" tabs={TABS} active={tab} onChange={(id) => setParams(id === "summary" ? {} : { tab: id })} />
			{tab === "changes" ? <Changes /> : tab === "access" ? <Access /> : <Summary />}
			<p className="mt-6 text-xs text-ink-soft">
				Changes are recorded for saves made through the campus system. Values of password fields are never shown, and sign-in records older than 90 days are cleared automatically.
			</p>
		</div>
	)
}
