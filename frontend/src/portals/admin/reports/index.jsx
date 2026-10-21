import { lazy } from "react"
import { Route, Routes } from "react-router-dom"
import Catalog from "./Catalog"

const ReportRun = lazy(() => import("./ReportRun"))

/** /admin/reports/*: catalog and the report runner. */
export default function ReportsArea() {
	return (
		<Routes>
			<Route index element={<Catalog />} />
			<Route path=":report" element={<ReportRun />} />
			<Route path="*" element={<Catalog />} />
		</Routes>
	)
}
