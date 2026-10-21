import { Navigate, Route, Routes } from "react-router-dom"
import Overview from "./pages/Overview"
import Catalogue from "./pages/Catalogue"
import ItemEditor from "./pages/ItemEditor"
import Loans from "./pages/Loans"

/** /admin/library/*: catalogue, circulation desk and e-library. */
export default function LibraryArea() {
	return (
		<Routes>
			<Route index element={<Overview />} />
			<Route path="catalogue" element={<Catalogue />} />
			<Route path="catalogue/:name" element={<ItemEditor />} />
			<Route path="loans" element={<Loans />} />
			<Route path="*" element={<Navigate to="/admin/library" replace />} />
		</Routes>
	)
}
