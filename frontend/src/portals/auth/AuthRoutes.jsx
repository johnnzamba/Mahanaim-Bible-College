import { useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, BookOpenCheck, GraduationCap, KeyRound, Mail, ShieldCheck, Users } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { BRAND } from "@/shared/brand"
import { useSession, portalHome } from "@/shared/session"
import { Alert, Button, Input, PasswordInput } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"

/**
 * /signin, /forgot-password, /reset-password.
 * Sign-in accepts email, username or student/staff number (resolved server-side by
 * mahanaim.api.auth.resolve_login when available) and lands on the user's portal or ?next=.
 */
export default function AuthRoutes() {
	const { pathname } = useLocation()
	if (pathname.startsWith("/forgot-password")) return <AuthFrame><ForgotPassword /></AuthFrame>
	if (pathname.startsWith("/reset-password")) return <AuthFrame><ResetPassword /></AuthFrame>
	return (
		<AuthFrame>
			<SignIn />
		</AuthFrame>
	)
}

function AuthFrame({ children }) {
	return (
		<div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
			<aside className="hero-wash relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
				<div className="pattern-dots absolute inset-0 opacity-40" aria-hidden="true" />
				<Link to="/" className="relative flex items-center gap-3">
					<img src={BRAND.logo} alt="" className="h-12 w-12" />
					<div>
						<div className="font-serif text-xl text-white">{BRAND.full}</div>
						<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300">{BRAND.product}</div>
					</div>
				</Link>
				<div className="relative max-w-md">
					<p className="font-serif text-[2rem] leading-snug text-white">“Study to shew thyself approved unto God, a workman that needeth not to be ashamed.”</p>
					<p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-gold-300">2 Timothy 2:15</p>
					<ul className="mt-10 space-y-4 text-sm text-white/80">
						{[
							[GraduationCap, "Students", "Courses, assignments, exams, results and fees in one place"],
							[BookOpenCheck, "Lecturers", "Teach, grade and track attendance from any device"],
							[Users, "Sponsors & churches", "Follow the students you support"],
						].map(([Icon, t, d]) => (
							<li key={t} className="flex gap-3">
								<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300">
									<Icon size={18} />
								</span>
								<span>
									<span className="block font-semibold text-white">{t}</span>
									{d}
								</span>
							</li>
						))}
					</ul>
				</div>
				<div className="relative text-xs text-white/50">© {new Date().getFullYear()} {BRAND.full}</div>
			</aside>
			<main className="flex flex-col px-5 py-8 sm:px-10">
				<div className="flex items-center justify-between">
					<Link to="/" className="flex items-center gap-2 lg:hidden">
						<img src={BRAND.logo} alt="" className="h-9 w-9" />
						<span className="font-serif text-brand-800 dark:text-ink">{BRAND.short}</span>
					</Link>
					<Link to="/" className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
						<ArrowLeft size={16} /> Website
					</Link>
				</div>
				<div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
			</main>
		</div>
	)
}

function SignIn() {
	const [params] = useSearchParams()
	const navigate = useNavigate()
	const session = useSession()
	const [usr, setUsr] = useState("")
	const [pwd, setPwd] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const next = params.get("next")

	if (!session.isGuest && !session.loading) {
		return (
			<div className="text-center">
				<h1 className="font-serif text-2xl">You're signed in</h1>
				<p className="mt-2 text-sm text-ink-muted">as {session.full_name}</p>
				<Button className="mt-6 w-full" iconRight={ArrowRight} onClick={() => navigate(next || portalHome(session))}>
					Continue to my portal
				</Button>
			</div>
		)
	}

	const submit = async (e) => {
		e.preventDefault()
		setBusy(true)
		setError("")
		try {
			let login = usr.trim()
			if (login && !login.includes("@")) {
				try {
					const resolved = await frappe.get("mahanaim.api.auth.resolve_login", { identifier: login })
					if (resolved) login = resolved
				} catch {
					/* fall back to raw identifier */
				}
			}
			await frappe.login(login, pwd)
			const s = await session.reload()
			toast.success(`Welcome back, ${(s?.full_name || "").split(" ")[0] || "friend"}`)
			const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null
			navigate(safeNext || portalHome(s), { replace: true })
		} catch (err) {
			setError(err?.status === 401 || /incorrect|invalid/i.test(err?.message) ? "Incorrect email/number or password." : err.message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<div className="eyebrow">Digital Campus</div>
			<h1 className="mt-2 font-serif text-[1.9rem] leading-tight">Sign in to your portal</h1>
			<p className="mt-2 text-sm text-ink-muted">Students, applicants, lecturers, staff and sponsors all sign in here.</p>
			<form onSubmit={submit} className="mt-8 space-y-4">
				{error ? <Alert tone="error">{error}</Alert> : null}
				<Input
					label="Email, student or staff number"
					icon={Mail}
					autoComplete="username"
					value={usr}
					onChange={(e) => setUsr(e.target.value)}
					required
					autoFocus
				/>
				<PasswordInput label="Password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
				<div className="flex justify-end">
					<Link to="/forgot-password" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-600">
						Forgot password?
					</Link>
				</div>
				<Button type="submit" className="w-full" size="lg" loading={busy}>
					Sign in
				</Button>
			</form>
			<div className="mt-8 rounded-2xl border border-line bg-cream/60 p-4 text-sm">
				<div className="font-semibold text-ink">New to {BRAND.short}?</div>
				<p className="mt-0.5 text-ink-muted">Create an applicant account and start your application online.</p>
				<Link to="/apply" className="mt-2 inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline dark:text-brand-600">
					Apply now <ArrowRight size={14} />
				</Link>
			</div>
		</>
	)
}

function ForgotPassword() {
	const [email, setEmail] = useState("")
	const [busy, setBusy] = useState(false)
	const [sent, setSent] = useState(false)
	const submit = async (e) => {
		e.preventDefault()
		setBusy(true)
		try {
			await frappe.call("mahanaim.api.auth.request_password_reset", { email: email.trim() })
		} catch {
			// Fall back to Frappe's own reset (sends /update-password?key= link).
			try {
				await frappe.call("frappe.core.doctype.user.user.reset_password", { user: email.trim() })
			} catch {
				/* never reveal whether the account exists */
			}
		} finally {
			setBusy(false)
			setSent(true)
		}
	}
	if (sent) {
		return (
			<div className="text-center">
				<span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
					<ShieldCheck size={26} />
				</span>
				<h1 className="font-serif text-2xl">Check your inbox</h1>
				<p className="mt-2 text-sm text-ink-muted">If an account exists for {email}, we've sent instructions to reset your password.</p>
				<Link to="/signin" className="btn btn-secondary mt-6 w-full">
					Back to sign in
				</Link>
			</div>
		)
	}
	return (
		<>
			<span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-cream text-gold-700">
				<KeyRound size={22} />
			</span>
			<h1 className="font-serif text-[1.8rem] leading-tight">Reset your password</h1>
			<p className="mt-2 text-sm text-ink-muted">Enter the email on your account and we'll send you a reset link.</p>
			<form onSubmit={submit} className="mt-8 space-y-4">
				<Input label="Email address" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
				<Button type="submit" className="w-full" size="lg" loading={busy}>
					Send reset link
				</Button>
				<Link to="/signin" className="block text-center text-sm font-semibold text-ink-muted hover:text-ink">
					Back to sign in
				</Link>
			</form>
		</>
	)
}

function ResetPassword() {
	const [params] = useSearchParams()
	const navigate = useNavigate()
	const key = params.get("key") || ""
	const [pwd, setPwd] = useState("")
	const [confirm, setConfirm] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const submit = async (e) => {
		e.preventDefault()
		if (pwd !== confirm) return setError("The two passwords don't match.")
		if (pwd.length < 8) return setError("Use at least 8 characters.")
		setBusy(true)
		setError("")
		try {
			await frappe.call("frappe.core.doctype.user.user.update_password", { new_password: pwd, key, logout_all_sessions: 1 })
			toast.success("Password updated. Please sign in.")
			navigate("/signin", { replace: true })
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}
	return (
		<>
			<h1 className="font-serif text-[1.8rem] leading-tight">Choose a new password</h1>
			<p className="mt-2 text-sm text-ink-muted">At least 8 characters, mixing letters and numbers.</p>
			{!key ? (
				<Alert tone="warning" className="mt-6">
					This reset link is incomplete. Request a new one from <Link to="/forgot-password" className="link">Forgot password</Link>.
				</Alert>
			) : (
				<form onSubmit={submit} className="mt-8 space-y-4">
					{error ? <Alert tone="error">{error}</Alert> : null}
					<PasswordInput label="New password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
					<PasswordInput label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
					<Button type="submit" className="w-full" size="lg" loading={busy}>
						Update password
					</Button>
				</form>
			)}
		</>
	)
}
