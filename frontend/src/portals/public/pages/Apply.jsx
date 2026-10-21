import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import clsx from "clsx"
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, FileCheck2, GraduationCap, KeyRound, Lock, LogIn, Mail, MapPin, Phone, ShieldCheck, UserRound, Wallet } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Button, Checkbox, Input, PasswordInput, Select, Skeleton, Spinner } from "@/shared/components/ui"
import { Stepper } from "@/shared/components/kit"
import { OtpInput, ResendLink, useCountdown } from "@/shared/components/OtpInput"
import { portalHome, useSession } from "@/shared/session"
import { money, normalisePhone } from "@/shared/utils/format"
import { Container } from "../components/Blocks"
import { DOCUMENTS } from "../content"
import { W, signinUrl, sortLevels, useInstitution, useParamState, usePageMeta } from "../lib"

const A = "mahanaim.api.auth."
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STEPS = [
	{ id: "details", label: "Your details" },
	{ id: "verify", label: "Verify email" },
	{ id: "password", label: "Set password" },
]

function applyTarget(code) {
	return code ? `/applicant/apply?programme=${encodeURIComponent(code)}` : "/applicant/apply"
}

function strength(pw) {
	let s = 0
	if (pw.length >= 8) s += 1
	if (pw.length >= 12) s += 1
	if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1
	if (/\d/.test(pw)) s += 1
	if (/[^A-Za-z0-9]/.test(pw)) s += 1
	return Math.min(4, s)
}
const STRENGTH = [
	["Too short", "bg-red-500"],
	["Weak", "bg-red-500"],
	["Fair", "bg-gold-500"],
	["Good", "bg-emerald-500"],
	["Strong", "bg-emerald-600"],
]

function ProgrammePicker({ programmes, loading, code, onChange }) {
	const p = programmes.find((x) => x.code === code)
	const grouped = useMemo(() => {
		const levels = sortLevels([...new Set(programmes.map((x) => x.level || "Other"))])
		return levels.map((l) => [l, programmes.filter((x) => (x.level || "Other") === l)])
	}, [programmes])
	return (
		<div className="card p-5 sm:p-6">
			<div className="flex items-center gap-2 font-semibold text-ink">
				<GraduationCap size={18} className="text-brand-700" /> Programme
			</div>
			{loading ? (
				<Skeleton className="mt-4 h-11 rounded-xl" />
			) : (
				<Select className="mt-3" aria-label="Programme" value={code} onChange={(e) => onChange(e.target.value)}>
					<option value="">I'll choose in the application form</option>
					{grouped.map(([level, rows]) => (
						<optgroup key={level} label={level}>
							{rows.map((x) => (
								<option key={x.code} value={x.code}>
									{x.name}
								</option>
							))}
						</optgroup>
					))}
				</Select>
			)}
			{p ? (
				<div className="mt-4 space-y-2.5 rounded-xl bg-cream/70 p-4 text-sm ring-1 ring-gold-200">
					<div className="font-serif text-lg leading-snug text-ink">{p.award_title || p.name}</div>
					<div className="grid gap-2 text-ink-muted">
						{p.duration ? (
							<span className="inline-flex items-center gap-2">
								<Clock size={14} className="text-gold-700" /> {p.level} · {p.duration}
							</span>
						) : null}
						{p.campuses?.length ? (
							<span className="inline-flex items-center gap-2">
								<MapPin size={14} className="text-gold-700" /> {p.campuses.join(", ")}
							</span>
						) : null}
						{p.study_modes?.length ? (
							<span className="inline-flex items-center gap-2">
								<Clock size={14} className="text-gold-700" /> {p.study_modes.join(", ")}
							</span>
						) : null}
						{p.minimum_entry ? (
							<span className="inline-flex items-start gap-2">
								<FileCheck2 size={14} className="mt-0.5 shrink-0 text-gold-700" /> {p.minimum_entry}
							</span>
						) : null}
						{p.application_fee ? (
							<span className="inline-flex items-center gap-2">
								<Wallet size={14} className="text-gold-700" /> Application fee {money(p.application_fee)}
							</span>
						) : null}
					</div>
					<Link to={`/programmes/${encodeURIComponent(p.code)}`} className="link inline-flex items-center gap-1 text-xs">
						Programme details <ArrowRight size={12} />
					</Link>
				</div>
			) : (
				<p className="mt-3 text-xs text-ink-soft">
					Not sure yet?{" "}
					<Link to="/programmes" className="link">
						Compare programmes
					</Link>{" "}
					or choose later in the form.
				</p>
			)}
		</div>
	)
}

function Wizard({ code }) {
	const session = useSession()
	const navigate = useNavigate()
	const [step, setStep] = useState(0)
	const [d, setD] = useState({ first_name: "", last_name: "", email: "", phone: "" })
	const [errors, setErrors] = useState({})
	const [otp, setOtp] = useState("")
	const [otpError, setOtpError] = useState("")
	const [sent, setSent] = useState(null)
	const [token, setToken] = useState("")
	const [pw, setPw] = useState({ password: "", confirm: "" })
	const [agree, setAgree] = useState(false)
	const [exists, setExists] = useState(false)
	const [left, restart] = useCountdown(0)
	const target = applyTarget(code)

	const request = useAction(`${A}request_otp`, {
		onSuccess: (r, vars) => {
			setSent({ ...r, email: vars.recipient })
			restart(r?.resend_in || 60)
			setOtp("")
			setOtpError("")
			setStep(1)
		},
	})
	const verify = useAction(`${A}verify_otp`, {
		error: false,
		onSuccess: (r) => {
			setToken(r.otp_token)
			setStep(2)
		},
		onError: (e) => {
			setOtpError(e?.message || "That code is not correct.")
			setOtp("")
		},
	})
	const signup = useAction(`${A}signup_applicant`, {
		onSuccess: async () => {
			await session.reload()
			navigate(target, { replace: true })
		},
		onError: (e) => {
			const msg = String(e?.message || "")
			if (/already exists/i.test(msg)) setExists(true)
			if (/verify|expired|token/i.test(msg) && !/password/i.test(msg)) {
				setToken("")
				setStep(1)
			}
		},
	})

	const set = (k) => (e) => {
		setD((x) => ({ ...x, [k]: e.target.value }))
		setErrors((x) => ({ ...x, [k]: undefined }))
	}
	const email = d.email.trim().toLowerCase()

	const sendCode = () => request.mutate({ recipient: email, channel: "Email", purpose: "Signup" })
	const submitDetails = (e) => {
		e.preventDefault()
		const errs = {}
		if (!d.first_name.trim()) errs.first_name = "Enter your first name"
		if (!d.last_name.trim()) errs.last_name = "Enter your last name"
		if (!EMAIL_RE.test(email)) errs.email = "Enter a valid email address"
		if (!/^254\d{9}$/.test(normalisePhone(d.phone))) errs.phone = "Enter a valid phone number, e.g. 0712 345 678"
		setErrors(errs)
		if (Object.keys(errs).length) return
		setExists(false)
		if (token && sent?.email === email) {
			setStep(2)
			return
		}
		setToken("")
		sendCode()
	}
	const submitCode = (value = otp) => {
		if (value.length < 6) {
			setOtpError("Enter the 6-digit code from your email")
			return
		}
		verify.mutate({ recipient: email, purpose: "Signup", code: value, channel: "Email" })
	}
	const score = strength(pw.password)
	const submitPassword = (e) => {
		e.preventDefault()
		if (pw.password.length < 8 || pw.password !== pw.confirm || !agree) return
		signup.mutate({
			first_name: d.first_name.trim(),
			last_name: d.last_name.trim(),
			email,
			phone: normalisePhone(d.phone),
			password: pw.password,
			otp_token: token,
		})
	}

	return (
		<div className="card overflow-hidden">
			<div className="border-b border-line bg-cream/50 px-5 py-4 sm:px-7">
				<Stepper steps={STEPS.map((s) => s.label)} current={step} />
			</div>
			<div className="p-5 sm:p-7">
				{step === 0 ? (
					<form onSubmit={submitDetails} noValidate className="space-y-5 animate-fade-up">
						<div>
							<h2 className="font-serif text-2xl text-ink">Create your applicant account</h2>
							<p className="mt-1 text-sm text-ink-muted">Your account lets you save your application, upload documents, pay the fee and track your admission.</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<Input label="First name" required autoComplete="given-name" value={d.first_name} onChange={set("first_name")} error={errors.first_name} icon={UserRound} />
							<Input label="Last name" required autoComplete="family-name" value={d.last_name} onChange={set("last_name")} error={errors.last_name} />
							<Input label="Email address" required type="email" autoComplete="email" value={d.email} onChange={set("email")} error={errors.email} icon={Mail} hint="We'll send a 6-digit code to confirm it" />
							<Input label="Mobile number" required type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={d.phone} onChange={set("phone")} error={errors.phone} icon={Phone} />
						</div>
						<div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
							<p className="text-sm text-ink-muted">
								Already have an account?{" "}
								<Link to={signinUrl(target)} className="link font-semibold">
									Sign in
								</Link>
							</p>
							<Button type="submit" size="lg" iconRight={ArrowRight} loading={request.isPending}>
								Continue
							</Button>
						</div>
					</form>
				) : step === 1 ? (
					<form
						onSubmit={(e) => {
							e.preventDefault()
							submitCode()
						}}
						noValidate
						className="space-y-6 animate-fade-up"
					>
						<div>
							<h2 className="font-serif text-2xl text-ink">Check your email</h2>
							<p className="mt-1 text-sm text-ink-muted">
								We sent a 6-digit code to <span className="font-semibold text-ink">{sent?.destination || email}</span>. It expires in{" "}
								{Math.round((sent?.expires_in || 600) / 60)} minutes. Check your spam folder if it hasn't arrived.
							</p>
						</div>
						<OtpInput
							value={otp}
							onChange={(v) => {
								setOtp(v)
								setOtpError("")
							}}
							onComplete={(v) => submitCode(v)}
							autoFocus
							disabled={verify.isPending}
							error={otpError}
						/>
						<ResendLink left={left} onResend={sendCode} busy={request.isPending} />
						<div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
							<button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink" onClick={() => setStep(0)}>
								<ArrowLeft size={16} /> Change email
							</button>
							<Button type="submit" size="lg" icon={ShieldCheck} loading={verify.isPending}>
								Verify
							</Button>
						</div>
					</form>
				) : (
					<form onSubmit={submitPassword} noValidate className="space-y-5 animate-fade-up">
						<div>
							<div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
								<CheckCircle2 size={14} /> {email} verified
							</div>
							<h2 className="mt-3 font-serif text-2xl text-ink">Choose a password</h2>
							<p className="mt-1 text-sm text-ink-muted">Use at least 8 characters. A short phrase is easier to remember and harder to guess.</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<PasswordInput label="Password" required autoComplete="new-password" value={pw.password} onChange={(e) => setPw((x) => ({ ...x, password: e.target.value }))} />
								{pw.password ? (
									<div className="mt-2">
										<div className="flex gap-1">
											{[1, 2, 3, 4].map((i) => (
												<span key={i} className={clsx("h-1.5 flex-1 rounded-full", score >= i ? STRENGTH[score][1] : "bg-line")} />
											))}
										</div>
										<div className="mt-1 text-xs text-ink-soft">{pw.password.length < 8 ? "At least 8 characters" : STRENGTH[score][0]}</div>
									</div>
								) : null}
							</div>
							<PasswordInput
								label="Confirm password"
								required
								autoComplete="new-password"
								value={pw.confirm}
								onChange={(e) => setPw((x) => ({ ...x, confirm: e.target.value }))}
								error={pw.confirm && pw.confirm !== pw.password ? "Passwords don't match" : undefined}
							/>
						</div>
						<Checkbox
							checked={agree}
							onChange={setAgree}
							label={
								<span>
									I agree to the{" "}
									<Link to="/terms" target="_blank" className="link">
										terms of use
									</Link>{" "}
									and{" "}
									<Link to="/privacy" target="_blank" className="link">
										privacy notice
									</Link>
									, including the processing of my personal data for admission.
								</span>
							}
						/>
						{exists ? (
							<Alert tone="warning" title="You already have an account">
								<Link to={signinUrl(target)} className="font-semibold underline">
									Sign in
								</Link>{" "}
								to continue your application, or use "Forgot password" on the sign-in page.
							</Alert>
						) : null}
						<div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
							<button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink" onClick={() => setStep(0)}>
								<ArrowLeft size={16} /> Edit details
							</button>
							<Button type="submit" size="lg" icon={KeyRound} loading={signup.isPending} disabled={pw.password.length < 8 || pw.password !== pw.confirm || !agree}>
								Create account and continue
							</Button>
						</div>
					</form>
				)}
			</div>
		</div>
	)
}

export default function Apply() {
	const inst = useInstitution()
	usePageMeta("Apply online", `Start your application to ${inst.name}. Create an account, choose your programme and apply online in minutes.`)
	const session = useSession()
	const navigate = useNavigate()
	const [code, setCode] = useParamState("programme", "", { resetPage: false })
	const lookups = useApi(`${W}apply_lookups`, {}, { guest: true })
	const programmes = lookups.data?.programmes || []
	const isApplicant = !session.isGuest && (session.portals || []).includes("applicant")
	const target = applyTarget(code)

	useEffect(() => {
		if (isApplicant) navigate(target, { replace: true })
	}, [isApplicant, target, navigate])

	return (
		<>
			<section className="hero-wash relative overflow-hidden text-white">
				<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
				<Container className="relative py-10 sm:py-14">
					<div className="eyebrow text-gold-300">Admissions</div>
					<h1 className="mt-2 font-serif text-white text-[32px] leading-tight sm:text-5xl">Apply to {inst.name}</h1>
					<p className="mt-3 max-w-2xl text-base text-white/75 sm:text-lg">
						Answer the call in three simple steps: create your account, complete the application form and pay the application fee by M-Pesa.
					</p>
					<ol className="mt-7 flex flex-wrap gap-2 text-sm">
						{["Create account", "Complete application", "Pay fee via M-Pesa", "Receive your decision"].map((s, i) => (
							<li key={s} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 ring-1 ring-white/15">
								<span className="grid h-5 w-5 place-items-center rounded-full bg-gold-500 text-[11px] font-bold text-brand-900">{i + 1}</span>
								{s}
							</li>
						))}
					</ol>
				</Container>
			</section>

			<Container className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_360px]">
				<div className="min-w-0 space-y-6">
					{session.loading || isApplicant ? (
						<div className="card flex items-center gap-3 p-8 text-ink-muted">
							<Spinner /> {isApplicant ? "Taking you to your application…" : "Loading…"}
						</div>
					) : !session.isGuest ? (
						<div className="card space-y-5 p-6 sm:p-8">
							<Alert tone="info" title={`You're signed in as ${session.full_name || session.user}`}>
								Applications are made from an applicant account. You can continue with this account, or sign out and create a separate applicant account.
							</Alert>
							<div className="flex flex-wrap gap-2">
								<Link to={target} className="btn btn-primary">
									Continue to the application <ArrowRight size={16} />
								</Link>
								<Link to={portalHome(session)} className="btn btn-secondary">
									Go to my portal
								</Link>
							</div>
						</div>
					) : (
						<Wizard code={code} />
					)}
				</div>

				<aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
					<ProgrammePicker programmes={programmes} loading={lookups.isLoading} code={code} onChange={setCode} />
					<div className="card p-5 sm:p-6">
						<div className="flex items-center gap-2 font-semibold text-ink">
							<FileCheck2 size={18} className="text-brand-700" /> Have these ready
						</div>
						<ul className="mt-3 space-y-2">
							{DOCUMENTS.map((doc) => (
								<li key={doc.title} className="flex gap-2 text-sm text-ink-muted">
									<CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" /> {doc.title}
								</li>
							))}
						</ul>
						<p className="mt-3 text-xs text-ink-soft">You can save your application and upload documents later.</p>
					</div>
					<div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-5 text-sm text-brand-900 ring-1 ring-brand-100">
						<Lock size={18} className="mt-0.5 shrink-0" />
						<p>
							Your information is protected under the Kenya Data Protection Act, 2019.{" "}
							<Link to="/contact?type=Admissions" className="font-semibold underline">
								Need help applying?
							</Link>
						</p>
					</div>
					{session.isGuest ? (
						<Link to={signinUrl(target)} className="btn btn-ghost w-full">
							<LogIn size={16} /> Returning applicant? Sign in
						</Link>
					) : null}
				</aside>
			</Container>
		</>
	)
}
