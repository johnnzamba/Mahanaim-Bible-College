import { Navigate, Route, Routes } from "react-router-dom"
import Announcements from "./pages/Announcements"
import AnnouncementEditor from "./pages/AnnouncementEditor"
import Templates from "./pages/Templates"
import TemplateEditor from "./pages/TemplateEditor"
import Messages from "./pages/Messages"

/** /admin/communication/*: announcements, message templates and the delivery log. */
export default function CommunicationArea() {
	return (
		<Routes>
			<Route index element={<Announcements />} />
			<Route path="announcements" element={<Navigate to="/admin/communication" replace />} />
			<Route path="announcements/:name" element={<AnnouncementEditor />} />
			<Route path="templates" element={<Templates />} />
			<Route path="templates/:name" element={<TemplateEditor />} />
			<Route path="messages" element={<Messages />} />
			<Route path="*" element={<Navigate to="/admin/communication" replace />} />
		</Routes>
	)
}
