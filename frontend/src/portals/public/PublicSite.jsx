import { lazy, Suspense } from "react"
import { Route, Routes, useLocation } from "react-router-dom"
import { PublicLayout } from "@/shared/layout/PublicLayout"
import { ErrorBoundary } from "@/shared/components/ErrorBoundary"
import { Spinner } from "@/shared/components/ui"

const Home = lazy(() => import("./pages/Home"))
const About = lazy(() => import("./pages/About"))
const Academics = lazy(() => import("./pages/Academics"))
const Programmes = lazy(() => import("./pages/Programmes"))
const ProgrammeDetail = lazy(() => import("./pages/ProgrammeDetail"))
const Admissions = lazy(() => import("./pages/Admissions"))
const Fees = lazy(() => import("./pages/Fees"))
const Faculty = lazy(() => import("./pages/Faculty"))
const News = lazy(() => import("./pages/News"))
const NewsPost = lazy(() => import("./pages/NewsPost"))
const Events = lazy(() => import("./pages/Events"))
const EventDetail = lazy(() => import("./pages/EventDetail"))
const Contact = lazy(() => import("./pages/Contact"))
const Faq = lazy(() => import("./pages/Faq"))
const Library = lazy(() => import("./pages/Library"))
const Verify = lazy(() => import("./pages/Verify"))
const Give = lazy(() => import("./pages/Give"))
const Apply = lazy(() => import("./pages/Apply"))
const Policy = lazy(() => import("./pages/Policy"))
const Search = lazy(() => import("./pages/Search"))
const NotFound = lazy(() => import("./pages/NotFound"))

function PageFallback() {
	return (
		<div className="grid min-h-[60vh] place-items-center" role="status" aria-label="Loading page">
			<Spinner size={26} className="text-brand-700" />
		</div>
	)
}

/** Public website: every route renders inside the shared header/footer; pages are lazy chunks. */
export default function PublicSite() {
	const { pathname } = useLocation()
	return (
		<PublicLayout transparentHeader={pathname === "/"}>
			<ErrorBoundary resetKey={pathname}>
				<Suspense fallback={<PageFallback />}>
					<Routes>
						<Route index element={<Home />} />
						<Route path="about" element={<About />} />
						<Route path="academics" element={<Academics />} />
						<Route path="programmes" element={<Programmes />} />
						<Route path="programmes/:code" element={<ProgrammeDetail />} />
						<Route path="admissions" element={<Admissions />} />
						<Route path="fees" element={<Fees />} />
						<Route path="faculty" element={<Faculty />} />
						<Route path="news" element={<News />} />
						<Route path="news/:route" element={<NewsPost />} />
						<Route path="events" element={<Events />} />
						<Route path="events/:route" element={<EventDetail />} />
						<Route path="contact" element={<Contact />} />
						<Route path="faq" element={<Faq />} />
						<Route path="e-library" element={<Library />} />
						<Route path="verify" element={<Verify />} />
						<Route path="verify/:code" element={<Verify />} />
						<Route path="give" element={<Give />} />
						<Route path="apply" element={<Apply />} />
						<Route path="privacy" element={<Policy kind="privacy" />} />
						<Route path="terms" element={<Policy kind="terms" />} />
						<Route path="search" element={<Search />} />
						<Route path="*" element={<NotFound />} />
					</Routes>
				</Suspense>
			</ErrorBoundary>
		</PublicLayout>
	)
}
