import { Route, Routes } from "react-router-dom"
import { Empty, PageHeader } from "@/shared/components/ui"

/** /admin/communication/* (placeholder until this area is built). */
export default function CommunicationArea() {
	return (
		<Routes>
			<Route
				path="*"
				element={
					<>
						<PageHeader title="Communication" subtitle="This workspace is being prepared." />
						<Empty title="Coming together" subtitle="Screens for this area are under construction." />
					</>
				}
			/>
		</Routes>
	)
}
