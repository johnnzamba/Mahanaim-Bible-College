import { lazy } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { PortalShell } from "@/shared/layout/PortalShell"
import { useSession } from "@/shared/session"
import { NAV, TABS } from "./nav"
import { NoSponsorProfile } from "./components/NoSponsorProfile"

const AccountSettings = lazy(() => import("@/shared/pages/AccountSettings"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Students = lazy(() => import("./pages/Students"))
const StudentProgress = lazy(() => import("./pages/StudentProgress"))
const Giving = lazy(() => import("./pages/Giving"))
const Reports = lazy(() => import("./pages/Reports"))
const Profile = lazy(() => import("./pages/Profile"))

export default function SponsorPortal() {
	const session = useSession()
	const linked = Boolean(session.sponsor)
	return (
		<PortalShell portal="sponsor" nav={NAV} tabs={TABS} profileTo="/sponsor/profile" searchPlaceholder="Search the sponsor portal…">
			<Routes>
				<Route path="account" element={<AccountSettings />} />
				{linked ? (
					<>
						<Route index element={<Dashboard />} />
						<Route path="students" element={<Students />} />
						<Route path="students/:student" element={<StudentProgress />} />
						<Route path="giving" element={<Giving />} />
						<Route path="reports" element={<Reports />} />
						<Route path="profile" element={<Profile />} />
						<Route path="*" element={<Navigate to="/sponsor" replace />} />
					</>
				) : (
					<Route path="*" element={<NoSponsorProfile />} />
				)}
			</Routes>
		</PortalShell>
	)
}
