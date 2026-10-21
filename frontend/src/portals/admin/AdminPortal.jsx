import { lazy } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { PortalShell } from "@/shared/layout/PortalShell"
import { Empty, PageHeader } from "@/shared/components/ui"

import dashboardNav from "./dashboard/nav"
import admissionsNav from "./admissions/nav"
import studentsNav from "./students/nav"
import academicsNav from "./academics/nav"
import credentialsNav from "./credentials/nav"
import alumniNav from "./alumni/nav"
import financeNav from "./finance/nav"
import churchNav from "./church/nav"
import communicationNav from "./communication/nav"
import websiteNav from "./website/nav"
import libraryNav from "./library/nav"
import staffNav from "./staff/nav"
import reportsNav from "./reports/nav"
import settingsNav from "./settings/nav"
import auditNav from "./audit/nav"

const AccountSettings = lazy(() => import("@/shared/pages/AccountSettings"))

/**
 * Each admin area is a folder `./<area>/` with `index.jsx` (its own <Routes>, lazy-loaded here)
 * and `nav.js` (its rail section). Areas never import each other's screens; shared pieces go in
 * `@/shared`. The rail is filtered per role through access.canAccess (ADMIN_ACCESS).
 */
const AREAS = {
	admissions: lazy(() => import("./admissions")),
	students: lazy(() => import("./students")),
	academics: lazy(() => import("./academics")),
	credentials: lazy(() => import("./credentials")),
	alumni: lazy(() => import("./alumni")),
	finance: lazy(() => import("./finance")),
	church: lazy(() => import("./church")),
	communication: lazy(() => import("./communication")),
	website: lazy(() => import("./website")),
	library: lazy(() => import("./library")),
	staff: lazy(() => import("./staff")),
	reports: lazy(() => import("./reports")),
	settings: lazy(() => import("./settings")),
	audit: lazy(() => import("./audit")),
}
const Dashboard = lazy(() => import("./dashboard"))

/** Rail order. Areas that share a section name (e.g. "System") are merged into one group. */
const SECTIONS = [
	dashboardNav,
	admissionsNav,
	studentsNav,
	academicsNav,
	credentialsNav,
	financeNav,
	churchNav,
	communicationNav,
	libraryNav,
	staffNav,
	alumniNav,
	websiteNav,
	reportsNav,
	settingsNav,
	auditNav,
]

const NAV = SECTIONS.reduce((groups, s) => {
	const same = groups.find((g) => g.section === s.section)
	if (same) same.items = [...same.items, ...s.items]
	else groups.push({ ...s, items: [...s.items] })
	return groups
}, [])

const TABS = [
	{ to: "/admin", label: "Home", icon: dashboardNav.icon },
	{ to: "/admin/students", label: "Students", icon: studentsNav.icon },
	{ to: "/admin/finance", label: "Finance", icon: financeNav.icon },
]

/** Old top-level links (/admin/exams/…, /admin/results/…) now live under /admin/academics. */
function MovedTo({ base }) {
	const { pathname, search } = useLocation()
	const rest = pathname.replace(/^\/admin\/[^/]+/, "")
	return <Navigate to={`/admin/academics/${base}${rest}${search}`} replace />
}

export default function AdminPortal() {
	return (
		<PortalShell portal="admin" nav={NAV} tabs={TABS} serverSearch searchPlaceholder="Search students, invoices, screens…">
			<Routes>
				<Route index element={<Dashboard />} />
				{Object.entries(AREAS).map(([path, Area]) => (
					<Route key={path} path={`${path}/*`} element={<Area />} />
				))}
				<Route path="exams/*" element={<MovedTo base="exams" />} />
				<Route path="results/*" element={<MovedTo base="results" />} />
				<Route path="account" element={<AccountSettings />} />
				<Route
					path="*"
					element={
						<>
							<PageHeader title="Page not found" subtitle="This admin screen does not exist or has moved." />
							<Empty title="Nothing here" subtitle="Use the menu or search to find what you need." />
						</>
					}
				/>
			</Routes>
		</PortalShell>
	)
}
