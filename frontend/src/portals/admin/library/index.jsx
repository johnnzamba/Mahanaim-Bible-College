import { Route, Routes } from "react-router-dom"
import { Empty, PageHeader } from "@/shared/components/ui"

/** /admin/library/* (placeholder until this area is built). */
export default function LibraryArea() {
	return (
		<Routes>
			<Route
				path="*"
				element={
					<>
						<PageHeader title="Library" subtitle="This workspace is being prepared." />
						<Empty title="Coming together" subtitle="Screens for this area are under construction." />
					</>
				}
			/>
		</Routes>
	)
}
