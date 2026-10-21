import { Route, Routes } from "react-router-dom"
import Applications from "./pages/Applications"
import ApplicationDetail from "./pages/ApplicationDetail"

/** /admin/admissions/*: the pipeline (list or board) and the application review page. */
export default function AdmissionsArea() {
	return (
		<Routes>
			<Route index element={<Applications />} />
			<Route path=":name" element={<ApplicationDetail />} />
		</Routes>
	)
}
