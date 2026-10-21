import { Route, Routes } from "react-router-dom"
import { LayoutDashboard } from "lucide-react"
import { PortalShell } from "@/shared/layout/PortalShell"
import { Empty, PageHeader } from "@/shared/components/ui"

const NAV = [{ section: "Overview", items: [{ to: "/lecturer", label: "Dashboard", icon: LayoutDashboard, end: true }] }]

export default function LecturerPortal() {
	return (
		<PortalShell portal="lecturer" nav={NAV}>
			<Routes>
				<Route
					path="*"
					element={
						<>
							<PageHeader title="Lecturer portal" subtitle="This workspace is being prepared." />
							<Empty title="Coming together" subtitle="Screens for this portal are under construction." />
						</>
					}
				/>
			</Routes>
		</PortalShell>
	)
}
