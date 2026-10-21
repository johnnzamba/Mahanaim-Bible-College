import { Link } from "react-router-dom"
import { HandHeart, Mail, Settings } from "lucide-react"
import { useSession } from "@/shared/session"

/** Friendly state for a signed-in user whose account isn't linked to a Sponsor record yet. */
export function NoSponsorProfile() {
	const session = useSession()
	return (
		<div className="card mx-auto w-full max-w-2xl overflow-hidden">
			<div className="hero-wash px-6 py-8 text-center text-white">
				<span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/15">
					<HandHeart size={28} aria-hidden />
				</span>
				<h1 className="mt-4 font-serif text-2xl text-white">Your sponsor profile isn't linked yet</h1>
				<p className="mx-auto mt-2 max-w-md text-sm text-white/80">
					Thank you for partnering with Mahanaim Bible College. Our partnerships office links each sponsor account to its students and giving
					records — once that's done, this portal shows everything here.
				</p>
			</div>
			<div className="space-y-4 p-6 text-sm text-ink-muted">
				<p>
					You're signed in as <span className="font-semibold text-ink">{session.email || session.user}</span>. If you already sponsor a student or give
					to the college, let us know and we'll connect your records — usually within one working day.
				</p>
				<div className="flex flex-col gap-2 sm:flex-row">
					<Link to="/contact?type=Partnerships" className="btn btn-primary">
						<Mail size={16} /> Contact the partnerships office
					</Link>
					<Link to="/sponsor/account" className="btn btn-secondary">
						<Settings size={16} /> Account settings
					</Link>
				</div>
			</div>
		</div>
	)
}
