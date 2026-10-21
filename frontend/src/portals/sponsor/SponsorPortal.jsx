import { lazy } from "react"
import { Route, Routes } from "react-router-dom"
import { LayoutDashboard } from "lucide-react"
import { PortalShell } from "@/shared/layout/PortalShell"
import { Empty, PageHeader } from "@/shared/components/ui"

const AccountSettings = lazy(() => import("@/shared/pages/AccountSettings"))

const NAV = [{ section: "Overview", items: [{ to: "/sponsor", label: "Dashboard", icon: LayoutDashboard, end: true }] }]

export default function SponsorPortal() {
	return (
		<PortalShell portal="sponsor" nav={NAV}>
			<Routes>
				<Route path="account" element={<AccountSettings />} />
				<Route
					path="*"
					element={
						<>
							<PageHeader title="Sponsor portal" subtitle="This workspace is being prepared." />
							<Empty title="Coming together" subtitle="Screens for this portal are under construction." />
						</>
					}
				/>
			</Routes>
		</PortalShell>
	)
}
