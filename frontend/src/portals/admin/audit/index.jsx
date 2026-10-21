import { Route, Routes } from "react-router-dom"
import { Empty, PageHeader } from "@/shared/components/ui"

/** /admin/audit/* (placeholder until this area is built). */
export default function AuditArea() {
	return (
		<Routes>
			<Route
				path="*"
				element={
					<>
						<PageHeader title="Audit log" subtitle="This workspace is being prepared." />
						<Empty title="Coming together" subtitle="Screens for this area are under construction." />
					</>
				}
			/>
		</Routes>
	)
}
