import { Route, Routes } from "react-router-dom"
import StudentsList from "./pages/StudentsList"
import StudentForm from "./pages/StudentForm"
import Student360 from "./pages/Student360"
import Registrations from "./pages/Registrations"
import RegistrationDetail from "./pages/RegistrationDetail"
import Requests from "./pages/Requests"
import RequestDetail from "./pages/RequestDetail"

/** /admin/students/*: directory, new/edit, Student 360, the registration approval queue and student requests. */
export default function StudentsArea() {
	return (
		<Routes>
			<Route index element={<StudentsList />} />
			<Route path="new" element={<StudentForm />} />
			<Route path="registrations" element={<Registrations />} />
			<Route path="registrations/:name" element={<RegistrationDetail />} />
			<Route path="requests" element={<Requests />} />
			<Route path="requests/:name" element={<RequestDetail />} />
			<Route path=":name/edit" element={<StudentForm />} />
			<Route path=":name" element={<Student360 />} />
		</Routes>
	)
}
