import { lazy } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { PortalShell } from "@/shared/layout/PortalShell"
import { useSession } from "@/shared/session"
import { NAV, TABS } from "./nav"
import { useApi } from "@/shared/api/hooks"
import { NotFound, useServerTime } from "./components/bits"
import { API } from "./components/lib"

const AccountSettings = lazy(() => import("@/shared/pages/AccountSettings"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Courses = lazy(() => import("./pages/Courses"))
const CourseHome = lazy(() => import("./pages/CourseHome"))
const Assignments = lazy(() => import("./pages/Assignments"))
const AssignmentDetail = lazy(() => import("./pages/AssignmentDetail"))
const Exams = lazy(() => import("./pages/Exams"))
const ExamRoom = lazy(() => import("./pages/ExamRoom"))
const ExamResult = lazy(() => import("./pages/ExamResult"))
const Results = lazy(() => import("./pages/Results"))
const Timetable = lazy(() => import("./pages/Timetable"))
const Attendance = lazy(() => import("./pages/Attendance"))
const Registration = lazy(() => import("./pages/Registration"))
const Fees = lazy(() => import("./pages/Fees"))
const Library = lazy(() => import("./pages/Library"))
const Documents = lazy(() => import("./pages/Documents"))
const Requests = lazy(() => import("./pages/Requests"))
const Chapel = lazy(() => import("./pages/Chapel"))
const Announcements = lazy(() => import("./pages/Announcements"))
const Profile = lazy(() => import("./pages/Profile"))
const Alumni = lazy(() => import("./pages/Alumni"))

export default function StudentPortal() {
	const session = useSession()
	const isAlumni = (session.roles || []).includes("Alumni")
	return (
		<PortalShell portal="student" nav={NAV} tabs={TABS} profileTo="/student/profile" searchPlaceholder="Jump to a page…">
			<ServerClock enabled={Boolean(session.student)} />
			<Routes>
				<Route index element={<Dashboard />} />
				<Route path="courses" element={<Courses />} />
				<Route path="courses/:offering" element={<CourseHome />} />
				<Route path="assignments" element={<Assignments />} />
				<Route path="assignments/:name" element={<AssignmentDetail />} />
				<Route path="exams" element={<Exams />} />
				<Route path="exams/result/:attempt" element={<ExamResult />} />
				<Route path="exams/:exam" element={<ExamRoom />} />
				<Route path="results" element={<Results />} />
				<Route path="timetable" element={<Timetable />} />
				<Route path="attendance" element={<Attendance />} />
				<Route path="registration" element={<Registration />} />
				<Route path="fees" element={<Fees />} />
				<Route path="fees/pay" element={<Fees pay />} />
				<Route path="finance/*" element={<Navigate to="/student/fees" replace />} />
				<Route path="library" element={<Library />} />
				<Route path="documents" element={<Documents />} />
				<Route path="requests" element={<Requests />} />
				<Route path="chapel" element={<Chapel />} />
				<Route path="announcements" element={<Announcements />} />
				<Route path="profile" element={<Profile />} />
				<Route path="alumni" element={isAlumni ? <Alumni /> : <Navigate to="/student/profile" replace />} />
				<Route path="account" element={<AccountSettings />} />
				<Route path="*" element={<NotFound />} />
			</Routes>
		</PortalShell>
	)
}

/** Deadlines, sessions and exam windows are naive server-local times, so learn the server clock once for every page. */
function ServerClock({ enabled }) {
	const q = useApi(API.exams, {}, { enabled, retry: false, staleTime: 5 * 60_000 })
	useServerTime(q.data?.server_time, q.dataUpdatedAt)
	return null
}
