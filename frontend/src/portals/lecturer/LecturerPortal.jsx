import { lazy } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { PortalShell } from "@/shared/layout/PortalShell"
import { NAV, TABS } from "./nav"

const AccountSettings = lazy(() => import("@/shared/pages/AccountSettings"))
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Courses = lazy(() => import("./pages/Courses"))
const CourseWorkspace = lazy(() => import("./pages/CourseWorkspace"))
const AssignmentGrading = lazy(() => import("./pages/AssignmentGrading"))
const Exams = lazy(() => import("./pages/Exams"))
const ExamBuilder = lazy(() => import("./pages/ExamBuilder"))
const ExamMonitor = lazy(() => import("./pages/ExamMonitor"))
const ExamMarking = lazy(() => import("./pages/ExamMarking"))
const QuestionBank = lazy(() => import("./pages/QuestionBank"))
const Gradebook = lazy(() => import("./pages/Gradebook"))
const MarkSheet = lazy(() => import("./pages/MarkSheet"))
const Attendance = lazy(() => import("./pages/Attendance"))
const RollCall = lazy(() => import("./pages/RollCall"))
const Timetable = lazy(() => import("./pages/Timetable"))
const Announcements = lazy(() => import("./pages/Announcements"))

export default function LecturerPortal() {
	return (
		<PortalShell portal="lecturer" nav={NAV} tabs={TABS} searchPlaceholder="Jump to a page…">
			<Routes>
				<Route index element={<Dashboard />} />
				<Route path="courses" element={<Courses />} />
				<Route path="courses/:offering" element={<CourseWorkspace />} />
				<Route path="assignments/:assignment" element={<AssignmentGrading />} />
				<Route path="exams" element={<Exams />} />
				<Route path="exams/:exam" element={<ExamBuilder />} />
				<Route path="exams/:exam/monitor" element={<ExamMonitor />} />
				<Route path="exams/:exam/marking" element={<ExamMarking />} />
				<Route path="question-bank" element={<QuestionBank />} />
				<Route path="gradebook" element={<Gradebook />} />
				<Route path="gradebook/:offering" element={<MarkSheet />} />
				<Route path="attendance" element={<Attendance />} />
				<Route path="attendance/:session" element={<RollCall />} />
				<Route path="timetable" element={<Timetable />} />
				<Route path="announcements" element={<Announcements />} />
				<Route path="account" element={<AccountSettings />} />
				<Route path="*" element={<Navigate to="/lecturer" replace />} />
			</Routes>
		</PortalShell>
	)
}
