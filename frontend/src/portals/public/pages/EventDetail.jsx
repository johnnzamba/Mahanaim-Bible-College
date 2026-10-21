import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import clsx from "clsx"
import {
	ArrowLeft,
	BellRing,
	CalendarDays,
	CalendarPlus,
	CheckCircle2,
	Clock,
	Hourglass,
	Info,
	Lock,
	MapPin,
	Radio,
	Ticket,
	UserRound,
	Users,
} from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { plainText } from "@/shared/api/frappe"
import { Alert, Badge, Button, Empty, ErrorState, Html, Input, Skeleton } from "@/shared/components/ui"
import { useSession } from "@/shared/session"
import { date, isValidMpesaPhone, money, normalisePhone, num, time } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { Band, Breadcrumbs, Container, CtaBand, ShareLinks } from "../components/Blocks"
import { Cover, DateBlock, EventCard, eventWhen } from "../components/Cards"
import { MpesaWait, usePaymentPoll } from "../components/MpesaWait"
import { W, absoluteUrl, isHtml, toDate, usePageMeta, useInstitution } from "../lib"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function icsStamp(d) {
	return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

function downloadIcs(ev, inst) {
	const start = toDate(ev.start_datetime)
	if (!start) return
	const end = toDate(ev.end_datetime) || new Date(start.getTime() + 2 * 3600_000)
	const esc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n")
	const body = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:-//${esc(inst)}//Events//EN`,
		"BEGIN:VEVENT",
		`UID:${ev.name}@${window.location.host}`,
		`DTSTAMP:${icsStamp(new Date())}`,
		`DTSTART:${icsStamp(start)}`,
		`DTEND:${icsStamp(end)}`,
		`SUMMARY:${esc(ev.title)}`,
		`LOCATION:${esc([ev.venue, ev.campus].filter(Boolean).join(", "))}`,
		`DESCRIPTION:${esc(`${plainText(ev.summary || "")}\n${absoluteUrl(`/events/${ev.route}`)}`)}`,
		`URL:${absoluteUrl(`/events/${ev.route}`)}`,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n")
	const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }))
	const a = document.createElement("a")
	a.href = url
	a.download = `${ev.route || "event"}.ics`
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function DetailRow({ icon: Icon, label, children }) {
	return (
		<div className="flex gap-3">
			<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
				<Icon size={17} />
			</span>
			<div className="min-w-0">
				<div className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">{label}</div>
				<div className="mt-0.5 text-sm font-medium text-ink">{children}</div>
			</div>
		</div>
	)
}

function PaymentStep({ payment, email, phone, reference, signedIn }) {
	const [current, setCurrent] = useState(payment)
	const [retryPhone, setRetryPhone] = useState(phone || "")
	const poll = usePaymentPoll("mahanaim.api.finance.payment_request_status", { request: current?.request }, { enabled: Boolean(current?.request) && signedIn, guest: false })
	const retry = useAction(`${W}pay_event_fee`, { onSuccess: (r) => setCurrent(r) })
	const resend = () => retry.mutate({ registration: reference, email, phone: normalisePhone(retryPhone) })

	if (!current?.request) {
		return (
			<div className="space-y-4">
				<Alert tone="warning" title="Your seat is reserved, but payment hasn't started">
					{current?.error || "We could not send the M-Pesa prompt."} Check the number below and try again.
				</Alert>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
					<Input
						label="M-Pesa phone number"
						value={retryPhone}
						onChange={(e) => setRetryPhone(e.target.value)}
						inputMode="tel"
						placeholder="0712 345 678"
						className="flex-1"
						error={retryPhone && !isValidMpesaPhone(retryPhone) ? "Enter a Safaricom number, e.g. 0712 345 678" : undefined}
					/>
					<Button onClick={resend} loading={retry.isPending} disabled={!isValidMpesaPhone(retryPhone)}>
						Send M-Pesa prompt
					</Button>
				</div>
			</div>
		)
	}
	return (
		<MpesaWait
			phone={retryPhone}
			amount={current.amount}
			currency={current.currency}
			message={signedIn ? undefined : current.customer_message}
			status={signedIn ? poll.status : undefined}
			receipt={poll.data?.mpesa_receipt_number}
			timedOut={signedIn ? poll.timedOut : false}
			polling={signedIn}
			onRetry={resend}
			retrying={retry.isPending}
			successTitle="Payment received. See you there!"
			successText={`Your seat is confirmed. Registration reference ${reference}.`}
		>
			{!signedIn ? (
				<div className="space-y-3 text-sm text-ink-muted">
					<p>
						Once you enter your PIN, M-Pesa will send you an SMS receipt and we will email your confirmation
						{email ? ` to ${email}` : ""}. Keep your registration reference: <span className="font-mono font-semibold text-ink">{reference}</span>
					</p>
					<button type="button" className="link text-sm font-semibold" onClick={resend} disabled={retry.isPending}>
						{retry.isPending ? "Sending…" : "Didn't get the prompt? Send it again"}
					</button>
				</div>
			) : null}
		</MpesaWait>
	)
}

function RegisterPanel({ ev }) {
	const session = useSession()
	const inst = useInstitution()
	const reg = ev.registration || {}
	const signedIn = !session.isGuest
	const [form, setForm] = useState(() => ({
		full_name: signedIn ? session.full_name || "" : "",
		email: signedIn && String(session.email || "").includes("@") ? session.email : "",
		phone: signedIn ? session.phone || "" : "",
		attendees: "1",
		church: "",
		website: "",
	}))
	const [errors, setErrors] = useState({})
	const [result, setResult] = useState(null)
	const register = useAction(`${W}register_for_event`, { onSuccess: setResult, invalidate: [`${W}event`] })
	const set = (k) => (e) => {
		setForm((f) => ({ ...f, [k]: e.target.value }))
		setErrors((x) => ({ ...x, [k]: undefined }))
	}
	const fee = Number(reg.fee || ev.fee) || 0

	const submit = (e) => {
		e.preventDefault()
		const errs = {}
		if (form.full_name.trim().length < 3) errs.full_name = "Enter your full name"
		if (!EMAIL_RE.test(form.email.trim())) errs.email = "Enter a valid email address"
		if (fee && !reg.waitlist && !isValidMpesaPhone(form.phone)) errs.phone = "Enter the Safaricom number that will pay, e.g. 0712 345 678"
		else if (form.phone && !/^[\d\s+()-]{9,16}$/.test(form.phone)) errs.phone = "Enter a valid phone number"
		const n = Number(form.attendees)
		if (!Number.isInteger(n) || n < 1 || n > 20) errs.attendees = "Between 1 and 20"
		setErrors(errs)
		if (Object.keys(errs).length) return
		register.mutate({
			event: ev.route || ev.name,
			full_name: form.full_name.trim(),
			email: form.email.trim(),
			phone: form.phone ? normalisePhone(form.phone) : undefined,
			attendees: n,
			church: form.church.trim() || undefined,
			website: form.website || undefined,
		})
	}

	if (result) {
		if (result.payment?.required) {
			return (
				<div className="space-y-4">
					<Alert tone="brand" icon={Ticket} title={`Registration ${result.reference} received`}>
						{result.message}
					</Alert>
					<PaymentStep payment={result.payment} email={form.email.trim()} phone={form.phone} reference={result.reference} signedIn={signedIn} />
				</div>
			)
		}
		return (
			<div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center" aria-live="polite">
				<span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600 text-white">
					{result.waitlisted ? <Hourglass size={26} /> : <CheckCircle2 size={28} />}
				</span>
				<h3 className="mt-4 font-serif text-2xl text-ink">{result.waitlisted ? "You're on the waiting list" : "You're registered!"}</h3>
				<p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{result.message}</p>
				{result.reference ? (
					<div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-emerald-200">
						<span className="text-ink-soft">Reference</span>
						<span className="font-mono font-semibold text-ink">{result.reference}</span>
					</div>
				) : null}
				<div className="mt-5 flex flex-wrap justify-center gap-2">
					<Button variant="secondary" icon={CalendarPlus} onClick={() => downloadIcs(ev, inst.name)}>
						Add to calendar
					</Button>
					<Link to="/events" className="btn btn-ghost">
						More events
					</Link>
				</div>
			</div>
		)
	}

	if (!reg.required) {
		return (
			<Alert tone="success" icon={CheckCircle2} title="No registration needed">
				{reg.reason || "Just come; everyone is welcome."}
			</Alert>
		)
	}
	if (reg.my_registration) {
		const mine = reg.my_registration
		return (
			<div className="space-y-4">
				<Alert tone="success" icon={CheckCircle2} title="You're registered for this event">
					Reference <span className="font-mono font-semibold">{mine.name}</span> · {mine.status}
					{mine.attendees > 1 ? ` · ${mine.attendees} attendees` : ""}
					{mine.payment_status && mine.payment_status !== "Not Required" ? ` · Payment ${String(mine.payment_status).toLowerCase()}` : ""}
				</Alert>
				{mine.payment_status === "Pending" ? (
					<PaymentStep payment={{ required: true, amount: fee, request: null, error: "Your payment is still pending." }} email="" phone={session.phone || ""} reference={mine.name} signedIn />
				) : null}
			</div>
		)
	}
	if (!reg.open) {
		return (
			<Alert tone="warning" icon={Lock} title="Registration closed">
				{reg.reason || "Registration for this event is closed."}
			</Alert>
		)
	}

	return (
		<form onSubmit={submit} noValidate className="space-y-4">
			{reg.waitlist ? (
				<Alert tone="warning" icon={Hourglass}>
					{reg.reason}
				</Alert>
			) : null}
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Full name" required autoComplete="name" value={form.full_name} onChange={set("full_name")} error={errors.full_name} className="sm:col-span-2" />
				<Input label="Email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} />
				<Input
					label={fee ? "M-Pesa phone number" : "Phone number"}
					required={Boolean(fee)}
					type="tel"
					inputMode="tel"
					autoComplete="tel"
					placeholder="0712 345 678"
					value={form.phone}
					onChange={set("phone")}
					error={errors.phone}
					hint={fee && !reg.waitlist ? "We'll send the M-Pesa prompt to this number." : undefined}
				/>
				<Input label="Number attending" type="number" min={1} max={20} value={form.attendees} onChange={set("attendees")} error={errors.attendees} />
				<Input label="Church or organisation" value={form.church} onChange={set("church")} placeholder="Optional" />
			</div>
			<div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
				<label>
					Website
					<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
				</label>
			</div>
			<div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="text-sm text-ink-muted">
					{fee && !reg.waitlist ? (
						<>
							Total <span className="font-semibold text-ink">{money(fee * (Number(form.attendees) || 1))}</span> via M-Pesa
						</>
					) : reg.waitlist ? (
						"You'll join the waiting list."
					) : (
						"Free event · confirmation by email"
					)}
				</div>
				<Button type="submit" size="lg" loading={register.isPending} icon={Ticket}>
					{reg.waitlist ? "Join the waiting list" : fee ? "Register and pay" : "Register"}
				</Button>
			</div>
			<p className="text-xs text-ink-soft">
				We use your details only to manage this event. See our{" "}
				<Link to="/privacy" className="link">
					privacy notice
				</Link>
				.
			</p>
		</form>
	)
}

export default function EventDetail() {
	const { route } = useParams()
	const inst = useInstitution()
	const q = useApi(`${W}event`, { route }, { guest: true })
	const ev = q.data
	usePageMeta(ev?.title || (q.isError ? "Event not found" : "Event"), ev?.summary)
	const more = useApi(`${W}events`, { scope: "upcoming", page: 1, page_length: 4 }, { guest: true, enabled: Boolean(ev) })
	const others = useMemo(() => (more.data?.data || []).filter((e) => e.name !== ev?.name).slice(0, 3), [more.data, ev?.name])

	if (q.isLoading)
		return (
			<>
				<div className="hero-wash">
					<Container className="space-y-4 py-14">
						<Skeleton className="h-4 w-40 bg-white/10" />
						<Skeleton className="h-10 w-3/4 bg-white/10" />
						<Skeleton className="h-4 w-1/2 bg-white/10" />
					</Container>
				</div>
				<Container className="grid gap-8 py-12 lg:grid-cols-[minmax(0,1fr)_360px]">
					<Skeleton className="h-80 rounded-3xl" />
					<Skeleton className="h-80 rounded-3xl" />
				</Container>
			</>
		)
	if (q.isError) {
		const missing = q.error?.status === 404 || q.error?.exc_type === "DoesNotExistError"
		return (
			<Band>
				<div className="card">
					{missing ? (
						<Empty
							icon={CalendarDays}
							title="We couldn't find that event"
							subtitle="It may have been moved or is no longer public."
							action={
								<Link to="/events" className="btn btn-primary">
									<ArrowLeft size={16} /> All events
								</Link>
							}
						/>
					) : (
						<ErrorState error={q.error} onRetry={() => q.refetch()} />
					)}
				</div>
			</Band>
		)
	}

	const reg = ev.registration || {}
	const fee = Number(reg.fee ?? ev.fee) || 0
	const start = toDate(ev.start_datetime)
	const end = toDate(ev.end_datetime)
	const past = end ? end < new Date() : start ? start < new Date() : false
	const cancelled = ev.status === "Cancelled"
	const live = ev.status === "Ongoing"

	return (
		<>
			<section className="hero-wash relative overflow-hidden text-white">
				<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-30" />
				<Container className="relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
					<div className="min-w-0 animate-fade-up">
						<Breadcrumbs items={[{ label: "Events", to: "/events" }, { label: ev.title }]} />
						<div className="flex flex-wrap items-center gap-2">
							{ev.event_type ? <span className="chip border-white/20 bg-white/10 text-white">{ev.event_type}</span> : null}
							{cancelled ? <Badge tone="red">Cancelled</Badge> : live ? <Badge tone="green">Happening now</Badge> : past ? <Badge tone="gray">Past event</Badge> : null}
						</div>
						<div className="mt-4 flex items-start gap-4">
							<DateBlock value={ev.start_datetime} dark className="hidden sm:flex" />
							<h1 className="font-serif text-[30px] text-white leading-[1.15] sm:text-[44px]">{ev.title}</h1>
						</div>
						{ev.summary ? <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg">{plainText(ev.summary)}</p> : null}
						<div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
							<span className="inline-flex items-center gap-2">
								<CalendarDays size={16} className="text-gold-300" /> {eventWhen(ev)}
							</span>
							{ev.venue || ev.campus ? (
								<span className="inline-flex items-center gap-2">
									<MapPin size={16} className="text-gold-300" /> {[ev.venue, ev.campus].filter(Boolean).join(", ")}
								</span>
							) : null}
						</div>
						<div className="mt-7 flex flex-wrap gap-3">
							{reg.required && reg.open && !past && !cancelled ? (
								<a href="#register" className="btn btn-gold">
									<Ticket size={16} /> {reg.my_registration ? "View my registration" : reg.waitlist ? "Join the waiting list" : "Register now"}
								</a>
							) : null}
							{safeUrl(ev.livestream_url) ? (
								<a href={safeUrl(ev.livestream_url)} target="_blank" rel="noreferrer" className="btn border border-white/25 bg-white/10 text-white hover:bg-white/20">
									<Radio size={16} /> {live ? "Watch live" : "Live stream link"}
								</a>
							) : null}
							{!past ? (
								<button type="button" onClick={() => downloadIcs(ev, inst.name)} className="btn border border-white/25 bg-transparent text-white hover:bg-white/10">
									<CalendarPlus size={16} /> Add to calendar
								</button>
							) : null}
						</div>
					</div>
					<Cover src={ev.cover_image} seed={ev.name} icon={CalendarDays} label={ev.event_type} className="hidden aspect-[4/3] rounded-3xl shadow-lift ring-1 ring-white/15 lg:block" />
				</Container>
			</section>

			<Container className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_360px]">
				<div className="min-w-0 space-y-10">
					{cancelled ? (
						<Alert tone="error" title="This event has been cancelled">
							We're sorry for any inconvenience. Registered guests will be contacted directly.
						</Alert>
					) : null}
					{ev.cover_image ? <img src={ev.cover_image} alt="" className="aspect-[16/9] w-full rounded-3xl object-cover lg:hidden" /> : null}
					<section>
						<h2 className="mb-4 font-serif text-2xl text-ink">About this event</h2>
						{ev.description ? (
							isHtml(ev.description) ? (
								<Html html={ev.description} />
							) : (
								<p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-muted">{ev.description}</p>
							)
						) : (
							<p className="text-[15px] leading-relaxed text-ink-muted">{plainText(ev.summary) || "Full details will be shared soon."}</p>
						)}
					</section>
					{ev.notices?.length ? (
						<section className="rounded-2xl bg-cream/70 p-6 ring-1 ring-gold-200">
							<h2 className="flex items-center gap-2 font-serif text-xl text-ink">
								<BellRing size={18} className="text-gold-600" /> Good to know
							</h2>
							<ul className="mt-4 space-y-2.5">
								{ev.notices.map((n) => (
									<li key={n} className="flex gap-2.5 text-sm text-ink-muted">
										<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
										{n}
									</li>
								))}
							</ul>
						</section>
					) : null}

					{reg.required && !cancelled ? (
						<section id="register" className="card scroll-mt-24 p-5 sm:p-7">
							<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
								<div>
									<div className="eyebrow">Registration</div>
									<h2 className="mt-1 font-serif text-2xl text-ink">Reserve your seat</h2>
								</div>
								{reg.capacity ? (
									<div className="w-full text-sm sm:w-auto sm:text-right">
										<div className={clsx("font-semibold", reg.seats_left ? "text-ink" : "text-red-700")}>
											{reg.seats_left ? `${num(reg.seats_left)} of ${num(reg.capacity)} seats left` : "Fully booked"}
										</div>
										<div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line sm:w-40">
											<div className="h-full rounded-full bg-gold-500" style={{ width: `${Math.min(100, (100 * (reg.registered || 0)) / reg.capacity)}%` }} />
										</div>
									</div>
								) : null}
							</div>
							<RegisterPanel ev={ev} />
						</section>
					) : null}

					<div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
						<div className="text-sm font-semibold text-ink">Invite a friend</div>
						<ShareLinks title={ev.title} url={`/events/${ev.route}`} />
					</div>
				</div>

				<aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
					<div className="card space-y-5 p-6">
						<h2 className="font-serif text-lg text-ink">Event details</h2>
						<DetailRow icon={CalendarDays} label="Date">
							{start ? date(ev.start_datetime, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "To be announced"}
							{end && start && end.toDateString() !== start.toDateString() ? ` to ${date(ev.end_datetime, { weekday: "long", day: "numeric", month: "long" })}` : ""}
						</DetailRow>
						{start ? (
							<DetailRow icon={Clock} label="Time">
								{time(ev.start_datetime)}
								{end ? ` – ${time(ev.end_datetime)}` : ""} <span className="text-ink-soft">(EAT)</span>
							</DetailRow>
						) : null}
						{ev.venue || ev.campus ? (
							<DetailRow icon={MapPin} label="Venue">
								{[ev.venue, ev.campus].filter(Boolean).join(", ")}
							</DetailRow>
						) : null}
						<DetailRow icon={Ticket} label="Entry">
							{fee ? `${money(fee)} per person` : "Free"}
							{reg.required ? " · registration required" : ""}
						</DetailRow>
						{reg.deadline ? (
							<DetailRow icon={Hourglass} label="Register by">
								{date(reg.deadline, { day: "numeric", month: "long", year: "numeric" })}
							</DetailRow>
						) : null}
						{ev.organiser || ev.partner_church ? (
							<DetailRow icon={UserRound} label="Hosted by">
								{[ev.organiser, ev.partner_church].filter(Boolean).join(" with ")}
							</DetailRow>
						) : null}
						{reg.capacity ? (
							<DetailRow icon={Users} label="Capacity">
								{num(reg.capacity)} seats · {num(reg.registered || 0)} registered
							</DetailRow>
						) : null}
						{reg.required && reg.open && !cancelled ? (
							<a href="#register" className="btn btn-primary w-full">
								{reg.my_registration ? "My registration" : "Register"}
							</a>
						) : null}
					</div>
					<div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-5 text-sm text-brand-900 ring-1 ring-brand-100">
						<Info size={18} className="mt-0.5 shrink-0" />
						<p>
							Questions about this event?{" "}
							<Link to={`/contact?type=General&subject=${encodeURIComponent(ev.title)}`} className="font-semibold underline">
								Contact us
							</Link>{" "}
							and we'll be glad to help.
						</p>
					</div>
				</aside>
			</Container>

			{others.length ? (
				<Band tone="cream">
					<div className="mb-8 flex items-end justify-between gap-4">
						<h2 className="font-serif text-3xl text-ink">More upcoming events</h2>
						<Link to="/events" className="link shrink-0 whitespace-nowrap text-sm font-semibold">
							All events
						</Link>
					</div>
					<div className="grid gap-4 lg:grid-cols-3">
						{others.map((e) => (
							<EventCard key={e.name} ev={e} compact />
						))}
					</div>
				</Band>
			) : null}
			<CtaBand />
		</>
	)
}
