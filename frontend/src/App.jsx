import { lazy, Suspense, useLayoutEffect } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SessionProvider, RequirePortal } from "./shared/session"
import { Toaster } from "./shared/components/toast"
import { ErrorBoundary } from "./shared/components/ErrorBoundary"
import { Loading } from "./shared/components/ui"
import { forceScheme } from "./shared/theme"

/*
 * One SPA, served by www/mbc.html for every public and portal route (see hooks.py _SPA_ROUTES).
 * Each portal is a lazy chunk with its own <Routes>, so a student never downloads the admin app.
 */
const PublicSite = lazy(() => import("./portals/public/PublicSite"))
const AuthRoutes = lazy(() => import("./portals/auth/AuthRoutes"))
const ApplicantPortal = lazy(() => import("./portals/applicant/ApplicantPortal"))
const StudentPortal = lazy(() => import("./portals/student/StudentPortal"))
const LecturerPortal = lazy(() => import("./portals/lecturer/LecturerPortal"))
const AdminPortal = lazy(() => import("./portals/admin/AdminPortal"))
const SponsorPortal = lazy(() => import("./portals/sponsor/SponsorPortal"))

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			retry: (count, err) => count < 1 && ![401, 403, 404, 417].includes(err?.status),
		},
	},
})

const portal = (name, El) => (
	<RequirePortal portal={name}>
		<El />
	</RequirePortal>
)

function LightOnly({ children }) {
	useLayoutEffect(() => forceScheme("light"), [])
	return children
}

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
				<SessionProvider>
					<ErrorBoundary>
						<Suspense fallback={<Loading className="min-h-screen" />}>
							<Routes>
								<Route path="/signin" element={<AuthRoutes />} />
								<Route path="/forgot-password" element={<AuthRoutes />} />
								<Route path="/reset-password" element={<AuthRoutes />} />
								<Route path="/applicant/*" element={portal("applicant", ApplicantPortal)} />
								<Route path="/student/*" element={portal("student", StudentPortal)} />
								<Route path="/lecturer/*" element={portal("lecturer", LecturerPortal)} />
								<Route path="/admin/*" element={portal("admin", AdminPortal)} />
								<Route path="/sponsor/*" element={portal("sponsor", SponsorPortal)} />
								<Route
									path="/*"
									element={
										<LightOnly>
											<PublicSite />
										</LightOnly>
									}
								/>
							</Routes>
						</Suspense>
					</ErrorBoundary>
					<Toaster />
				</SessionProvider>
			</BrowserRouter>
		</QueryClientProvider>
	)
}
