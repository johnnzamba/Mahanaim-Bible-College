import { Route, Routes } from "react-router-dom"
import AlumniDirectory from "./pages/AlumniDirectory"
import Graduation from "./pages/Graduation"

/** /admin/alumni/* */
export default function AlumniArea() {
	return (
		<Routes>
			<Route index element={<AlumniDirectory />} />
			<Route path="graduation" element={<Graduation />} />
			<Route path="*" element={<AlumniDirectory />} />
		</Routes>
	)
}
