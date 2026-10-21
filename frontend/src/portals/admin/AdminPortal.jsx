import { Route, Routes } from "react-router-dom"
import { LayoutDashboard } from "lucide-react"
import { PortalShell } from "@/shared/layout/PortalShell"
import { Empty, PageHeader } from "@/shared/components/ui"

const NAV = [{ section: "Overview", items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true }] }]

export default function AdminPortal() {
	return (
		<PortalShell portal="admin" nav={NAV}>
			<Routes>
				<Route
					path="*"
					element={
						<>
							<PageHeader title="Administration portal" subtitle="This workspace is being prepared." />
							<Empty title="Coming together" subtitle="Screens for this portal are under construction." />
						</>
					}
				/>
			</Routes>
		</PortalShell>
	)
}
