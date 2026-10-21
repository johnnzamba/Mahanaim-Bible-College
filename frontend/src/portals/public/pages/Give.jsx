import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, BadgeCheck, Building, Church, Gift, HandCoins, HandHeart, Heart, Lock, Receipt, ShieldCheck, Smartphone, Users } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Alert, Button, Checkbox, Input, Skeleton, Textarea } from "@/shared/components/ui"
import { useSession } from "@/shared/session"
import { isValidMpesaPhone, money, normalisePhone, num } from "@/shared/utils/format"
import { Band, Feature, PageHero, Scripture, SectionHeading } from "../components/Blocks"
import { MpesaWait, usePaymentPoll } from "../components/MpesaWait"
import { NamedIcon } from "../components/NamedIcon"
import { DEFAULT_AMOUNTS, DEFAULT_GIVING_TYPES, GIVING_IMPACT, VERSES } from "../content"
import { prettyPhone, usePageMeta } from "../lib"

const C = "mahanaim.api.church."
const MAX = 250000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HINTS = {
	Tithe: "Honour the Lord with the firstfruits of your increase.",
	Offering: "A freewill offering for the work of the college.",
	Missions: "Student mission trips, church planting and outreach.",
	"Building Fund": "Classrooms, library, hostels and chapel.",
	"Scholarship Fund": "Tuition for called students who cannot afford fees.",
	Thanksgiving: "Give thanks for God's faithfulness.",
	Pledge: "Fulfil a pledge you have made to the college.",
}

function GiftFlow({ start, onReset }) {
	const poll = usePaymentPoll(`${C}giving_status`, { request: start.request, checkout_request_id: start.checkout_request_id || undefined }, { enabled: Boolean(start.request), guest: true })
	const status = poll.status
	return (
		<MpesaWait
			phone={start.phone}
			amount={start.amount}
			currency={start.currency}
			message={status && !["Initiated", "Pending", "Completed"].includes(status) ? poll.data?.message : undefined}
			status={status}
			receipt={poll.data?.receipt}
			timedOut={poll.timedOut}
			onRetry={onReset}
			successTitle="Thank you for your gift!"
			successText={`Your ${money(start.amount, { currency: start.currency })} gift towards ${start.typeLabel} has been received. ${start.email ? `A receipt is on its way to ${start.email}.` : "M-Pesa has sent you an SMS confirmation."}`}
		>
			{status === "Completed" ? (
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" icon={Heart} onClick={onReset}>
						Give again
					</Button>
					<Link to="/news" className="btn btn-ghost">
						See what God is doing <ArrowRight size={16} />
					</Link>
				</div>
			) : null}
			{start.simulation && status !== "Completed" ? <p className="text-xs text-ink-soft">Test mode: no real money will move.</p> : null}
		</MpesaWait>
	)
}

export default function Give() {
	usePageMeta("Give online", "Support theological training, scholarships and missions with a secure M-Pesa gift.")
	const session = useSession()
	const opts = useApi(`${C}giving_options`, {}, { guest: true, retry: 1 })
	const liveTypes = opts.data?.types || []
	const types = liveTypes.length ? liveTypes : DEFAULT_GIVING_TYPES
	const ready = liveTypes.length > 0
	const currency = opts.data?.currency || "KES"
	const paybill = opts.data?.paybill

	const [type, setType] = useState("")
	const selected = types.find((t) => t.name === type) || types[0]
	const presets = selected?.suggested_amounts?.length ? selected.suggested_amounts : DEFAULT_AMOUNTS
	const [preset, setPreset] = useState(1000)
	const [custom, setCustom] = useState("")
	const [form, setForm] = useState(() => ({
		full_name: session.isGuest ? "" : session.full_name || "",
		email: !session.isGuest && String(session.email || "").includes("@") ? session.email : "",
		phone: session.isGuest ? "" : session.phone || "",
		note: "",
		website: "",
	}))
	const [anonymous, setAnonymous] = useState(false)
	const [errors, setErrors] = useState({})
	const [started, setStarted] = useState(null)
	const amount = custom ? Number(custom) : preset
	const impact = useMemo(() => [...GIVING_IMPACT].reverse().find((i) => amount >= i.amount) || GIVING_IMPACT[0], [amount])

	const give = useAction(`${C}give`, {
		onSuccess: (r, vars) => {
			if (!r?.request) return
			setStarted({
				...r,
				amount: vars.amount,
				phone: prettyPhone(normalisePhone(form.phone)),
				email: vars.email,
				currency,
				typeLabel: selected?.giving_type_name || selected?.name,
			})
			window.scrollTo({ top: document.getElementById("give-form")?.offsetTop - 90 || 0, behavior: "smooth" })
		},
	})
	const set = (k) => (e) => {
		setForm((f) => ({ ...f, [k]: e.target.value }))
		setErrors((x) => ({ ...x, [k]: undefined }))
	}

	const submit = (e) => {
		e.preventDefault()
		const errs = {}
		if (!amount || amount < 10) errs.amount = `Enter at least ${money(10, { currency })}`
		else if (amount > MAX) errs.amount = `M-Pesa allows at most ${money(MAX, { currency })} per transaction`
		if (!isValidMpesaPhone(form.phone)) errs.phone = "Enter a Safaricom M-Pesa number, e.g. 0712 345 678"
		if (!anonymous && form.full_name.trim().length < 3) errs.full_name = "Enter your name, or give anonymously"
		if (form.email && !EMAIL_RE.test(form.email.trim())) errs.email = "Enter a valid email address"
		setErrors(errs)
		if (Object.keys(errs).length) return
		give.mutate({
			giving_type: selected.name,
			amount,
			phone: normalisePhone(form.phone),
			full_name: anonymous ? undefined : form.full_name.trim(),
			email: form.email.trim() || undefined,
			anonymous: anonymous ? 1 : 0,
			note: form.note.trim() || undefined,
			website: form.website || undefined,
		})
	}

	return (
		<>
			<PageHero
				eyebrow="Give"
				title="Partner with us in the harvest"
				subtitle="Your gift trains pastors, evangelists and missionaries for churches across Kenya and beyond. Give securely with M-Pesa in under a minute."
				crumbs={[{ label: "Give" }]}
				aside={
					<div className="rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur-sm">
						<Scripture verse={VERSES.cheerful} dark />
					</div>
				}
			/>

			<Band className="!pt-10 sm:!pt-14" id="give-form">
				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
					<div className={clsx("card p-5 sm:p-8", started && "lg:self-start")}>
						{started ? (
							<GiftFlow start={started} onReset={() => setStarted(null)} />
						) : (
							<form onSubmit={submit} noValidate className="relative space-y-8">
								<fieldset>
									<legend className="flex items-center gap-2 font-serif text-xl text-ink">
										<span className="grid h-7 w-7 place-items-center rounded-full bg-brand-800 text-xs font-bold text-white">1</span> Choose where your gift goes
									</legend>
									{opts.isLoading ? (
										<div className="mt-4 grid gap-3 sm:grid-cols-2">
											{Array.from({ length: 4 }).map((_, i) => (
												<Skeleton key={i} className="h-20 rounded-xl" />
											))}
										</div>
									) : (
										<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup">
											{types.map((t) => {
												const on = selected?.name === t.name
												return (
													<button
														key={t.name}
														type="button"
														role="radio"
														aria-checked={on}
														onClick={() => setType(t.name)}
														className={clsx(
															"rounded-xl border p-4 text-left transition",
															on ? "border-brand-700 bg-brand-50 ring-2 ring-brand-700/20" : "border-line bg-surface hover:border-brand-300 hover:bg-cream/50"
														)}
													>
														<div className="flex items-center justify-between gap-2">
															<span className="font-semibold text-ink">{t.giving_type_name || t.name}</span>
															<span className={clsx("grid h-5 w-5 place-items-center rounded-full border-2", on ? "border-brand-700 bg-brand-700" : "border-line")}>
																{on ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
															</span>
														</div>
														<p className="mt-1 text-xs leading-relaxed text-ink-muted">{t.description || HINTS[t.name] || "Support the ministry of the college."}</p>
													</button>
												)
											})}
										</div>
									)}
								</fieldset>

								<fieldset>
									<legend className="flex items-center gap-2 font-serif text-xl text-ink">
										<span className="grid h-7 w-7 place-items-center rounded-full bg-brand-800 text-xs font-bold text-white">2</span> Amount ({currency})
									</legend>
									<div className="mt-4 flex flex-wrap gap-2">
										{presets.map((a) => (
											<button
												key={a}
												type="button"
												onClick={() => {
													setPreset(a)
													setCustom("")
													setErrors((x) => ({ ...x, amount: undefined }))
												}}
												aria-pressed={!custom && preset === a}
												className={clsx(
													"min-w-[96px] rounded-xl border px-4 py-3 text-base font-semibold transition",
													!custom && preset === a ? "border-brand-800 bg-brand-800 text-white shadow-card" : "border-line bg-surface text-ink hover:border-brand-300"
												)}
											>
												{num(a)}
											</button>
										))}
									</div>
									<div className="mt-3 max-w-xs">
										<Input
											label="Or enter another amount"
											type="number"
											inputMode="numeric"
											min={10}
											max={MAX}
											value={custom}
											onChange={(e) => {
												setCustom(e.target.value)
												setErrors((x) => ({ ...x, amount: undefined }))
											}}
											placeholder="e.g. 3,000"
											error={errors.amount}
										/>
									</div>
									{impact && amount ? (
										<div className="mt-4 flex items-start gap-3 rounded-xl bg-cream/80 p-4 text-sm text-ink-muted ring-1 ring-gold-200">
											<NamedIcon name={impact.icon} size={18} className="mt-0.5 shrink-0 text-gold-700" />
											<span>
												<span className="font-semibold text-ink">{money(impact.amount, { currency })}</span> {impact.text}.
											</span>
										</div>
									) : null}
								</fieldset>

								<fieldset>
									<legend className="flex items-center gap-2 font-serif text-xl text-ink">
										<span className="grid h-7 w-7 place-items-center rounded-full bg-brand-800 text-xs font-bold text-white">3</span> Your details
									</legend>
									<div className="mt-4 grid gap-4 sm:grid-cols-2">
										<Input
											label="M-Pesa phone number"
											required
											type="tel"
											inputMode="tel"
											autoComplete="tel"
											placeholder="0712 345 678"
											value={form.phone}
											onChange={set("phone")}
											error={errors.phone}
											icon={Smartphone}
											hint="The prompt is sent to this number"
										/>
										<Input label="Email for your receipt" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} placeholder="Optional" />
										{!anonymous ? (
											<Input label="Full name" required autoComplete="name" value={form.full_name} onChange={set("full_name")} error={errors.full_name} className="sm:col-span-2" />
										) : null}
										<div className="sm:col-span-2">
											<Checkbox
												label="Give anonymously"
												description="Your name won't be recorded with the gift. M-Pesa still shows your number to the college's finance office."
												checked={anonymous}
												onChange={(c) => {
													setAnonymous(c)
													setErrors((x) => ({ ...x, full_name: undefined }))
												}}
											/>
										</div>
										<Textarea label="Note or prayer request" rows={2} value={form.note} onChange={set("note")} placeholder="Optional" className="sm:col-span-2" maxLength={500} />
									</div>
									<div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
										<label>
											Website
											<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
										</label>
									</div>
								</fieldset>

								{!opts.isLoading && !ready ? (
									<Alert tone="warning" title="Online giving is being set up">
										{opts.isError
											? "We couldn't load the giving options. Please refresh the page or try again shortly."
											: "Online gifts will open shortly. In the meantime, please contact the finance office to give."}
									</Alert>
								) : null}

								<div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex items-center gap-2 text-xs text-ink-soft">
										<Lock size={14} /> Secured by Safaricom M-Pesa. We never see your PIN.
									</div>
									<Button type="submit" size="lg" icon={HandHeart} loading={give.isPending} disabled={!ready}>
										Give {amount ? money(amount, { currency }) : ""}
									</Button>
								</div>
							</form>
						)}
					</div>

					<aside className="space-y-6">
						<div className="hero-wash relative overflow-hidden rounded-3xl p-6 text-white shadow-lift">
							<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-25" />
							<div className="relative">
								<div className="eyebrow text-gold-300">Your impact</div>
								<ul className="mt-4 space-y-4">
									{GIVING_IMPACT.map((i) => (
										<li key={i.amount} className="flex gap-3">
											<span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
												<NamedIcon name={i.icon} size={18} />
											</span>
											<p className="text-sm leading-relaxed text-white/80">
												<span className="font-semibold text-white">{money(i.amount, { currency })}</span> {i.text}
											</p>
										</li>
									))}
								</ul>
							</div>
						</div>
						{paybill?.shortcode ? (
							<div className="card p-6">
								<div className="flex items-center gap-2 font-semibold text-ink">
									<HandCoins size={18} className="text-gold-600" /> Give from the M-Pesa menu
								</div>
								<dl className="mt-4 space-y-3 text-sm">
									<div className="flex justify-between gap-3">
										<dt className="text-ink-soft">{paybill.type === "Till" ? "Buy Goods till" : "Paybill number"}</dt>
										<dd className="font-mono text-base font-semibold text-ink">{paybill.shortcode}</dd>
									</div>
									{paybill.account_hint ? (
										<div className="flex justify-between gap-3">
											<dt className="text-ink-soft">Account</dt>
											<dd className="font-mono text-base font-semibold text-ink">{paybill.account_hint}</dd>
										</div>
									) : null}
								</dl>
							</div>
						) : null}
						<div className="card space-y-4 p-6">
							<div className="flex gap-3">
								<Receipt size={18} className="mt-0.5 shrink-0 text-brand-700" />
								<p className="text-sm text-ink-muted">
									<span className="font-semibold text-ink">Receipted.</span> Every gift is recorded and receipted by the finance office.
								</p>
							</div>
							<div className="flex gap-3">
								<ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-700" />
								<p className="text-sm text-ink-muted">
									<span className="font-semibold text-ink">Accountable.</span> Designated gifts are used only for the purpose you choose.
								</p>
							</div>
							<div className="flex gap-3">
								<BadgeCheck size={18} className="mt-0.5 shrink-0 text-brand-700" />
								<p className="text-sm text-ink-muted">
									<span className="font-semibold text-ink">Private.</span> Your details are protected under our{" "}
									<Link to="/privacy" className="link">
										privacy notice
									</Link>
									.
								</p>
							</div>
						</div>
					</aside>
				</div>
			</Band>

			<Band tone="cream">
				<SectionHeading eyebrow="More ways to partner" title="Give beyond a single gift" align="center" />
				<div className="grid gap-6 md:grid-cols-3">
					<Feature icon={Users} title="Sponsor a student">
						Walk with one student through their studies: pay their fees, pray for them and receive term updates.{" "}
						<Link to="/contact?type=Partnership&subject=Sponsor%20a%20student" className="link">
							Become a sponsor
						</Link>
					</Feature>
					<Feature icon={Church} title="Church partnership">
						Partner churches send and support students, host practicum placements and give through regular missions budgets.{" "}
						<Link to="/contact?type=Partnership" className="link">
							Partner with us
						</Link>
					</Feature>
					<Feature icon={Building} title="Major gifts and legacies">
						Fund a building, endow a scholarship or remember the college in your will. Our principal would be glad to meet you.{" "}
						<Link to="/contact?type=Partnership&subject=Major%20gift" className="link">
							Talk to us
						</Link>
					</Feature>
				</div>
			</Band>

			<Band tone="dark" narrow>
				<div className="text-center">
					<Gift size={32} className="mx-auto text-gold-300" />
					<Scripture verse={VERSES.giveMeasure} dark size="lg" className="mt-4 [&_svg]:hidden" />
				</div>
			</Band>
		</>
	)
}
