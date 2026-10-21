import { useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import { ArrowLeft, ArrowRight, BookOpenCheck, GraduationCap, KeyRound, Mail, ShieldCheck, Smartphone, Users } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { BRAND } from "@/shared/brand"
import { useSession, portalHome } from "@/shared/session"
import { Alert, Button, Input, PasswordInput } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { OtpInput, ResendLink, useCountdown } from "@/shared/components/OtpInput"

/**
 * /signin, /forgot-password, /reset-password, all backed by mahanaim.api.auth.
 * Sign-in: password (email, phone, student or staff number, resolved server-side) with an emailed
 * security code for staff when MFA is on, or a passwordless one-time code for portal users.
 * Lands on ?next= (same-origin only) or the user's portal.
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

const AUTH = "mahanaim.api.auth"
const safeNext = (next) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null)

function SignIn() {
	const [params] = useSearchParams()
	const navigate = useNavigate()
	const session = useSession()
	const next = params.get("next")
	const [mode, setMode] = useState("password") // password | code
	const [mfa, setMfa] = useState(null) // { mfa_token, destination, resend_in }

	if (!session.isGuest && !session.loading) {
		return (
			<div className="text-center">
				<h1 className="font-serif text-2xl">You're signed in</h1>
				<p className="mt-2 text-sm text-ink-muted">as {session.full_name}</p>
				<Button className="mt-6 w-full" iconRight={ArrowRight} onClick={() => navigate(safeNext(next) || portalHome(session))}>
					Continue to my portal
				</Button>
			</div>
		)
	}

	const finish = async () => {
		const s = await session.reload()
		toast.success(`Welcome back, ${(s?.full_name || "").split(" ")[0] || "friend"}`)
		navigate(safeNext(next) || portalHome(s), { replace: true })
	}

	if (mfa) return <MfaStep mfa={mfa} onDone={finish} onCancel={() => setMfa(null)} />

	return (
		<>
			<div className="eyebrow">Digital Campus</div>
			<h1 className="mt-2 font-serif text-[1.9rem] leading-tight">Sign in to your portal</h1>
			<p className="mt-2 text-sm text-ink-muted">Students, applicants, lecturers, staff and sponsors all sign in here.</p>
			<div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-cream/60 p-1 text-sm font-semibold" role="tablist">
				{[
					["password", "Password"],
					["code", "One-time code"],
				].map(([k, label]) => (
					<button
						key={k}
						type="button"
						role="tab"
						aria-selected={mode === k}
						onClick={() => setMode(k)}
						className={clsx("rounded-lg py-2 transition", mode === k ? "bg-surface text-ink shadow-soft" : "text-ink-muted hover:text-ink")}
					>
						{label}
					</button>
				))}
			</div>
			{mode === "password" ? <PasswordSignIn onDone={finish} onMfa={setMfa} /> : <CodeSignIn onDone={finish} />}
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

function PasswordSignIn({ onDone, onMfa }) {
	const [usr, setUsr] = useState("")
	const [pwd, setPwd] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const submit = async (e) => {
		e.preventDefault()
		setBusy(true)
		setError("")
		try {
			const r = await frappe.call(`${AUTH}.login`, { usr: usr.trim(), pwd })
			if (r?.mfa_required) onMfa(r)
			else await onDone()
		} catch (err) {
			setError(err.message || "Incorrect email/number or password.")
		} finally {
			setBusy(false)
		}
	}
	return (
		<form onSubmit={submit} className="mt-6 space-y-4">
			{error ? <Alert tone="error">{error}</Alert> : null}
			<Input
				label="Email, phone, student or staff number"
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
	)
}

/** Passwordless sign-in for students, applicants and sponsors (staff always use a password). */
function CodeSignIn({ onDone }) {
	const [recipient, setRecipient] = useState("")
	const [sent, setSent] = useState(null)
	const [code, setCode] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const [left, restart] = useCountdown(0)

	const send = async (e) => {
		e?.preventDefault()
		setBusy(true)
		setError("")
		try {
			const r = await frappe.call(`${AUTH}.request_otp`, { recipient: recipient.trim(), purpose: "Login" })
			setSent(r)
			setCode("")
			restart(r?.resend_in || 60)
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}
	const verify = async (value = code) => {
		if (value.length < 6) return
		setBusy(true)
		setError("")
		try {
			await frappe.call(`${AUTH}.login_with_otp`, { recipient: recipient.trim(), code: value })
			await onDone()
		} catch (err) {
			setError(err.message)
			setCode("")
		} finally {
			setBusy(false)
		}
	}

	if (!sent) {
		return (
			<form onSubmit={send} className="mt-6 space-y-4">
				{error ? <Alert tone="error">{error}</Alert> : null}
				<Input
					label="Email or phone number"
					icon={Smartphone}
					autoComplete="username"
					value={recipient}
					onChange={(e) => setRecipient(e.target.value)}
					hint="We'll send a 6-digit code. Staff accounts sign in with a password."
					required
					autoFocus
				/>
				<Button type="submit" className="w-full" size="lg" loading={busy}>
					Send code
				</Button>
			</form>
		)
	}
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault()
				verify()
			}}
			className="mt-6 space-y-4"
		>
			<p className="text-sm text-ink-muted">{sent.message || "If the details match an account, a code has been sent."}{sent.destination ? ` (${sent.destination})` : ""}</p>
			{error ? <Alert tone="error">{error}</Alert> : null}
			<OtpInput value={code} onChange={setCode} onComplete={verify} autoFocus disabled={busy} />
			<Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length < 6}>
				Verify and sign in
			</Button>
			<div className="flex items-center justify-between">
				<ResendLink left={left} onResend={send} busy={busy} />
				<button type="button" className="text-sm font-semibold text-ink-muted hover:text-ink" onClick={() => setSent(null)}>
					Change
				</button>
			</div>
		</form>
	)
}

function MfaStep({ mfa, onDone, onCancel }) {
	const [code, setCode] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const [left, restart] = useCountdown(mfa.resend_in || 60)
	const [destination, setDestination] = useState(mfa.destination)

	const verify = async (value = code) => {
		if (value.length < 6) return
		setBusy(true)
		setError("")
		try {
			await frappe.call(`${AUTH}.verify_mfa`, { mfa_token: mfa.mfa_token, code: value })
			await onDone()
		} catch (err) {
			setError(err.message)
			setCode("")
		} finally {
			setBusy(false)
		}
	}
	const resend = async () => {
		setBusy(true)
		try {
			const r = await frappe.call(`${AUTH}.resend_mfa`, { mfa_token: mfa.mfa_token })
			if (r?.destination) setDestination(r.destination)
			restart(r?.resend_in || 60)
			toast.info("A new security code is on its way.")
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}
	return (
		<>
			<span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
				<ShieldCheck size={22} />
			</span>
			<h1 className="font-serif text-[1.8rem] leading-tight">Confirm it's you</h1>
			<p className="mt-2 text-sm text-ink-muted">
				Staff accounts need a security code. We've emailed one to <span className="font-semibold text-ink">{destination}</span>.
			</p>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					verify()
				}}
				className="mt-8 space-y-4"
			>
				{error ? <Alert tone="error">{error}</Alert> : null}
				<OtpInput value={code} onChange={setCode} onComplete={verify} autoFocus disabled={busy} label="Security code" />
				<Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length < 6}>
					Verify
				</Button>
				<div className="flex items-center justify-between">
					<ResendLink left={left} onResend={resend} busy={busy} />
					<button type="button" className="text-sm font-semibold text-ink-muted hover:text-ink" onClick={onCancel}>
						Back
					</button>
				</div>
			</form>
		</>
	)
}

function ForgotPassword() {
	const navigate = useNavigate()
	const [recipient, setRecipient] = useState("")
	const [sent, setSent] = useState(null)
	const [linkSent, setLinkSent] = useState(false)
	const [code, setCode] = useState("")
	const [pwd, setPwd] = useState("")
	const [confirm, setConfirm] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const [left, restart] = useCountdown(0)

	const send = async (e) => {
		e?.preventDefault()
		setBusy(true)
		setError("")
		try {
			const r = await frappe.call(`${AUTH}.forgot_password`, { email: recipient.trim() })
			setSent(r || { message: "If the details match an account, a code has been sent." })
			restart(r?.resend_in || 60)
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}
	const sendLink = async () => {
		setBusy(true)
		try {
			await frappe.call(`${AUTH}.request_password_reset`, { email: recipient.trim() })
		} catch {
			/* same answer whether or not the account exists */
		} finally {
			setBusy(false)
			setLinkSent(true)
		}
	}
	const reset = async (e) => {
		e.preventDefault()
		if (pwd !== confirm) return setError("The two passwords don't match.")
		setBusy(true)
		setError("")
		try {
			const r = await frappe.call(`${AUTH}.reset_password`, { recipient: recipient.trim(), code, new_password: pwd })
			toast.success(r?.message || "Password changed. Sign in with your new password.")
			navigate("/signin", { replace: true })
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}

	if (linkSent) {
		return (
			<div className="text-center">
				<span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
					<ShieldCheck size={26} />
				</span>
				<h1 className="font-serif text-2xl">Check your inbox</h1>
				<p className="mt-2 text-sm text-ink-muted">If an account exists for {recipient}, we've emailed a link to choose a new password.</p>
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
			{!sent ? (
				<>
					<p className="mt-2 text-sm text-ink-muted">Enter the email or phone number on your account and we'll send you a 6-digit code.</p>
					<form onSubmit={send} className="mt-8 space-y-4">
						{error ? <Alert tone="error">{error}</Alert> : null}
						<Input label="Email or phone number" icon={Mail} value={recipient} onChange={(e) => setRecipient(e.target.value)} required autoFocus />
						<Button type="submit" className="w-full" size="lg" loading={busy}>
							Send code
						</Button>
						{recipient.includes("@") ? (
							<button type="button" onClick={sendLink} disabled={busy} className="block w-full text-center text-sm font-semibold text-brand-700 hover:underline dark:text-brand-600">
								Email me a reset link instead
							</button>
						) : null}
						<Link to="/signin" className="block text-center text-sm font-semibold text-ink-muted hover:text-ink">
							Back to sign in
						</Link>
					</form>
				</>
			) : (
				<>
					<p className="mt-2 text-sm text-ink-muted">{sent.message}{sent.destination ? ` (${sent.destination})` : ""}</p>
					<form onSubmit={reset} className="mt-8 space-y-4">
						{error ? <Alert tone="error">{error}</Alert> : null}
						<OtpInput value={code} onChange={setCode} autoFocus disabled={busy} />
						<PasswordInput label="New password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} required hint="At least 8 characters; avoid your name or common words." />
						<PasswordInput label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
						<Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length < 6}>
							Set new password
						</Button>
						<div className="flex items-center justify-between">
							<ResendLink left={left} onResend={send} busy={busy} />
							<button type="button" className="text-sm font-semibold text-ink-muted hover:text-ink" onClick={() => setSent(null)}>
								Change
							</button>
						</div>
					</form>
				</>
			)}
		</>
	)
}

function ResetPassword() {
	const [params] = useSearchParams()
	const navigate = useNavigate()
	const session = useSession()
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
			// Frappe signs the user in after a successful key reset.
			const s = await session.reload().catch(() => null)
			toast.success("Password updated.")
			navigate(s && s.user && s.user !== "Guest" ? portalHome(s) : "/signin", { replace: true })
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
