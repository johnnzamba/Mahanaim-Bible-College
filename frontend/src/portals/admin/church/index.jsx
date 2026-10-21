import { Navigate, Route, Routes } from "react-router-dom"
import Overview from "./pages/Overview"
import Churches from "./pages/Churches"
import Sponsors from "./pages/Sponsors"
import SponsorDetail from "./pages/SponsorDetail"
import Sponsorships from "./pages/Sponsorships"
import Giving from "./pages/Giving"
import Chapel from "./pages/Chapel"
import ChapelDetail from "./pages/ChapelDetail"
import MinistryGroups from "./pages/MinistryGroups"

/** /admin/church/*: partner churches, sponsors, giving, chapel and ministry groups. */
export default function ChurchArea() {
	return (
		<Routes>
			<Route index element={<Overview />} />
			<Route path="churches" element={<Churches />} />
			<Route path="sponsors" element={<Sponsors />} />
			<Route path="sponsors/:name" element={<SponsorDetail />} />
			<Route path="sponsorships" element={<Sponsorships />} />
			<Route path="giving" element={<Giving />} />
			<Route path="chapel" element={<Chapel />} />
			<Route path="chapel/:name" element={<ChapelDetail />} />
			<Route path="ministry-groups" element={<MinistryGroups />} />
			<Route path="*" element={<Navigate to="/admin/church" replace />} />
		</Routes>
	)
}
