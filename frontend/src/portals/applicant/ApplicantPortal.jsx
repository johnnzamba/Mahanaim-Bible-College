import { lazy } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { PortalShell } from "@/shared/layout/PortalShell"
import { NAV, TABS } from "./nav"

const AccountSettings = lazy(() => import("@/shared/pages/AccountSettings"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Apply = lazy(() => import("./pages/Apply"))
const Applications = lazy(() => import("./pages/Applications"))
const ApplicationDetail = lazy(() => import("./pages/ApplicationDetail"))
const Documents = lazy(() => import("./pages/Documents"))
const Payments = lazy(() => import("./pages/Payments"))

export default function ApplicantPortal() {
	return (
		<PortalShell portal="applicant" nav={NAV} tabs={TABS} searchPlaceholder="Search the applicant portal…">
			<Routes>
				<Route index element={<Dashboard />} />
				<Route path="apply" element={<Apply />} />
				<Route path="application" element={<Applications />} />
				<Route path="application/:name" element={<ApplicationDetail />} />
				<Route path="documents" element={<Documents />} />
				<Route path="payments" element={<Payments />} />
				<Route path="account" element={<AccountSettings />} />
				<Route path="*" element={<Navigate to="/applicant" replace />} />
			</Routes>
		</PortalShell>
	)
}
