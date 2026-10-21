import { Route, Routes } from "react-router-dom"
import { PublicLayout } from "@/shared/layout/PublicLayout"
import { Empty } from "@/shared/components/ui"

export default function PublicSite() {
	return (
		<Routes>
			<Route
				path="*"
				element={
					<PublicLayout>
						<div className="mx-auto max-w-3xl px-4 py-24">
							<Empty title="Welcome" subtitle="The public website is being prepared." />
						</div>
					</PublicLayout>
				}
			/>
		</Routes>
	)
}
