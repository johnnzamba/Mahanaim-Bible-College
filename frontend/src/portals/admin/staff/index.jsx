import { Route, Routes } from "react-router-dom"
import StaffList from "./pages/StaffList"
import StaffForm from "./pages/StaffForm"
import StaffDetail from "./pages/StaffDetail"

/** /admin/staff/* */
export default function StaffArea() {
	return (
		<Routes>
			<Route index element={<StaffList />} />
			<Route path="new" element={<StaffForm />} />
			<Route path=":name/edit" element={<StaffForm />} />
			<Route path=":name" element={<StaffDetail />} />
		</Routes>
	)
}
