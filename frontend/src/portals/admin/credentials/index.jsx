import { Route, Routes } from "react-router-dom"
import CredentialsHome from "./pages/CredentialsHome"
import TranscriptDetail from "./pages/TranscriptDetail"
import CertificateDetail from "./pages/CertificateDetail"
import IssueWizard from "./pages/IssueWizard"

/** /admin/credentials/* */
export default function CredentialsArea() {
	return (
		<Routes>
			<Route index element={<CredentialsHome />} />
			<Route path="issue" element={<IssueWizard />} />
			<Route path="transcripts/:name" element={<TranscriptDetail />} />
			<Route path="certificates/:name" element={<CertificateDetail />} />
			<Route path="*" element={<CredentialsHome />} />
		</Routes>
	)
}
