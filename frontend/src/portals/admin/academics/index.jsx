import { lazy } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Empty, PageHeader } from "@/shared/components/ui"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { Restricted } from "./components/common"

const Overview = lazy(() => import("./pages/Overview"))
const Programmes = lazy(() => import("./pages/Programmes"))
const ProgrammeDetail = lazy(() => import("./pages/ProgrammeDetail"))
const Courses = lazy(() => import("./pages/Courses"))
const CourseDetail = lazy(() => import("./pages/CourseDetail"))
const Offerings = lazy(() => import("./pages/Offerings"))
const OfferingDetail = lazy(() => import("./pages/OfferingDetail"))
const Calendar = lazy(() => import("./pages/Calendar"))
const Exams = lazy(() => import("./pages/Exams"))
const ExamDetail = lazy(() => import("./pages/ExamDetail"))
const QuestionBank = lazy(() => import("./pages/QuestionBank"))
const MarkSheets = lazy(() => import("./pages/MarkSheets"))
const MarkSheetDetail = lazy(() => import("./pages/MarkSheetDetail"))
const Results = lazy(() => import("./pages/Results"))
const Grading = lazy(() => import("./pages/Grading"))

/** AdminPortal mounts areas without a route guard, so the area applies access.js itself. */
function Gate({ children }) {
	const { roles } = useSession()
	const { pathname } = useLocation()
	const path = pathname.replace(/^\/admin/, "").replace(/\/$/, "")
	return canAccess(roles, path) ? children : <Restricted />
}

/** /admin/academics/* */
export default function AcademicsArea() {
	return (
		<Gate>
			<Routes>
				<Route index element={<Overview />} />
				<Route path="programmes" element={<Programmes />} />
				<Route path="programmes/new" element={<ProgrammeDetail />} />
				<Route path="programmes/:code" element={<ProgrammeDetail />} />
				<Route path="courses" element={<Courses />} />
				<Route path="courses/new" element={<CourseDetail />} />
				<Route path="courses/:code" element={<CourseDetail />} />
				<Route path="offerings" element={<Offerings />} />
				<Route path="offerings/:name" element={<OfferingDetail />} />
				<Route path="calendar" element={<Calendar />} />
				<Route path="exams" element={<Exams />} />
				<Route path="exams/:name" element={<ExamDetail />} />
				<Route path="question-bank" element={<QuestionBank />} />
				<Route path="mark-sheets" element={<MarkSheets />} />
				<Route path="mark-sheets/:name" element={<MarkSheetDetail />} />
				<Route path="results" element={<Results />} />
				<Route path="results/*" element={<Navigate to="/admin/academics/results" replace />} />
				<Route path="grading" element={<Grading />} />
				<Route
					path="*"
					element={
						<>
							<PageHeader title="Page not found" subtitle="This academic screen does not exist or has moved." back={{ to: "/admin/academics", label: "Academics" }} />
							<Empty title="Nothing here" subtitle="Use the Academics menu to find what you need." />
						</>
					}
				/>
			</Routes>
		</Gate>
	)
}
