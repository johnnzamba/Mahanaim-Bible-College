import { Navigate, Route, Routes } from "react-router-dom"
import Overview from "./pages/Overview"
import News from "./pages/News"
import NewsEditor from "./pages/NewsEditor"
import Events from "./pages/Events"
import EventDetail from "./pages/EventDetail"
import Enquiries from "./pages/Enquiries"
import EnquiryDetail from "./pages/EnquiryDetail"
import Content from "./pages/Content"

/** /admin/website/*: the public website's news, events, enquiries and content. */
export default function WebsiteArea() {
	return (
		<Routes>
			<Route index element={<Overview />} />
			<Route path="news" element={<News />} />
			<Route path="news/:name" element={<NewsEditor />} />
			<Route path="events" element={<Events />} />
			<Route path="events/:name" element={<EventDetail />} />
			<Route path="enquiries" element={<Enquiries />} />
			<Route path="enquiries/:name" element={<EnquiryDetail />} />
			<Route path="content" element={<Content />} />
			<Route path="*" element={<Navigate to="/admin/website" replace />} />
		</Routes>
	)
}
