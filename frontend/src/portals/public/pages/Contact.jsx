import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
	ArrowRight,
	CheckCircle2,
	Clock,
	Facebook,
	GraduationCap,
	HandHeart,
	Instagram,
	Mail,
	MapPin,
	MessageCircle,
	Newspaper,
	Phone,
	Send,
	Twitter,
	Wallet,
	Youtube,
} from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Button, Input, Select, Textarea } from "@/shared/components/ui"
import { safeUrl } from "@/shared/utils/sanitize"
import { Band, PageHero, Scripture } from "../components/Blocks"
import { VERSES } from "../content"
import { W, lines, prettyPhone, useInstitution, usePageMeta, useSite } from "../lib"

const TYPES = ["General", "Admissions", "Fees", "Partnership", "Media", "Prayer Request", "Other"]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function waLink(n) {
	const d = String(n || "").replace(/\D/g, "").replace(/^0/, "254")
	return d ? `https://wa.me/${d}` : null
}

const DESKS = [
	{ icon: GraduationCap, title: "Admissions", text: "Programmes, entry requirements, intakes and your application.", type: "Admissions" },
	{ icon: Wallet, title: "Finance", text: "Fees, invoices, M-Pesa payments and sponsorship.", type: "Fees" },
	{ icon: HandHeart, title: "Partnerships", text: "Churches, ministries and sponsors who want to partner with us.", type: "Partnership" },
	{ icon: Newspaper, title: "Media", text: "Interviews, stories and official statements.", type: "Media" },
]

function ContactLine({ icon: Icon, label, children, href }) {
	const body = (
		<>
			<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
				<Icon size={19} />
			</span>
			<span className="min-w-0">
				<span className="block text-[11px] font-bold uppercase tracking-wider text-white/55">{label}</span>
				<span className="mt-0.5 block break-words text-[15px] font-medium text-white">{children}</span>
			</span>
		</>
	)
	const safe = safeUrl(href)
	return safe ? (
		<a href={safe} target={safe.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="flex items-start gap-3.5 rounded-xl p-1 transition hover:bg-white/5">
			{body}
		</a>
	) : (
		<div className="flex items-start gap-3.5 p-1">{body}</div>
	)
}

export default function Contact() {
	usePageMeta("Contact us", "Call, email, WhatsApp or visit the college, or send us an enquiry online and we will reply within two working days.")
	const site = useSite()
	const inst = useInstitution()
	const [params] = useSearchParams()
	const c = site.contact || {}
	const s = site.social || {}
	const initialType = TYPES.includes(params.get("type")) ? params.get("type") : "General"
	const [form, setForm] = useState({ full_name: "", email: "", phone: "", enquiry_type: initialType, subject: params.get("subject") || "", message: "", website: "" })
	const [errors, setErrors] = useState({})
	const [done, setDone] = useState(null)
	const send = useAction(`${W}submit_enquiry`, { onSuccess: setDone })
	const set = (k) => (e) => {
		setForm((f) => ({ ...f, [k]: e.target.value }))
		setErrors((x) => ({ ...x, [k]: undefined }))
	}
	const hours = lines(c.office_hours)
	const mapEmbed = /^https:\/\//i.test(c.map_url || "") && /\/embed|output=embed|export\/embed/i.test(c.map_url) ? c.map_url : null
	const whatsapp = c.whatsapp || s.whatsapp
	const socials = [
		[s.facebook, Facebook, "Facebook"],
		[s.youtube, Youtube, "YouTube"],
		[s.instagram, Instagram, "Instagram"],
		[s.x, Twitter, "X (Twitter)"],
	]
		.map(([u, ...rest]) => [safeUrl(u), ...rest])
		.filter(([u]) => u)

	const submit = (e) => {
		e.preventDefault()
		const errs = {}
		if (form.full_name.trim().length < 3) errs.full_name = "Please tell us your name"
		if (!EMAIL_RE.test(form.email.trim())) errs.email = "Enter a valid email so we can reply"
		if (form.phone && !/^[\d\s+()-]{9,16}$/.test(form.phone)) errs.phone = "Enter a valid phone number"
		if (form.message.trim().length < 10) errs.message = "Please write a little more (at least 10 characters)"
		if (form.message.length > 5000) errs.message = "Please keep your message under 5,000 characters"
		setErrors(errs)
		if (Object.keys(errs).length) return
		send.mutate({
			full_name: form.full_name.trim(),
			email: form.email.trim(),
			phone: form.phone.trim() || undefined,
			enquiry_type: form.enquiry_type,
			subject: form.subject.trim() || undefined,
			message: form.message.trim(),
			website: form.website || undefined,
		})
	}

	return (
		<>
			<PageHero
				eyebrow="Contact"
				title="We'd love to hear from you"
				subtitle="Whether you are exploring a call to ministry, supporting a student or partnering with us, our team is ready to help. We reply to every message within two working days."
				crumbs={[{ label: "Contact" }]}
				compact
			/>

			<Band className="!pt-10 sm:!pt-14">
				<div className="grid gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
					<aside className="hero-wash relative h-fit overflow-hidden rounded-3xl p-6 text-white shadow-lift sm:p-8">
						<div aria-hidden className="pattern-dots pointer-events-none absolute inset-0 opacity-25" />
						<div className="relative space-y-5">
							<div>
								<div className="eyebrow text-gold-300">Reach us</div>
								<h2 className="mt-1.5 font-serif text-2xl text-white">{inst.name}</h2>
							</div>
							<div className="space-y-3">
								{c.phone ? (
									<ContactLine icon={Phone} label="Call us" href={`tel:${String(c.phone).replace(/[^\d+]/g, "").replace(/^254/, "+254")}`}>
										{prettyPhone(c.phone)}
									</ContactLine>
								) : null}
								{c.email ? (
									<ContactLine icon={Mail} label="Email" href={`mailto:${c.email}`}>
										{c.email}
									</ContactLine>
								) : null}
								{whatsapp ? (
									<ContactLine icon={MessageCircle} label="WhatsApp" href={/^https?:/.test(whatsapp) ? whatsapp : waLink(whatsapp)}>
										{/^https?:/.test(whatsapp) ? "Chat with us" : prettyPhone(whatsapp)}
									</ContactLine>
								) : null}
								<ContactLine icon={MapPin} label="Visit us" href={c.map_url && !mapEmbed ? c.map_url : undefined}>
									{c.address ? <span className="whitespace-pre-line">{c.address}</span> : "Main campus, Kenya. Call ahead to arrange a visit."}
								</ContactLine>
								<ContactLine icon={Clock} label="Office hours">
									{hours.length ? (
										<span className="block space-y-0.5">
											{hours.map((h) => (
												<span key={h} className="block">
													{h}
												</span>
											))}
										</span>
									) : (
										"Monday to Friday, 8:00am to 5:00pm"
									)}
								</ContactLine>
							</div>
							{socials.length ? (
								<div className="border-t border-white/15 pt-5">
									<div className="text-[11px] font-bold uppercase tracking-wider text-white/55">Follow us</div>
									<div className="mt-3 flex gap-2">
										{socials.map(([u, Icon, label]) => (
											<a key={label} href={u} target="_blank" rel="noreferrer" aria-label={label} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 transition hover:bg-gold-500 hover:text-brand-900">
												<Icon size={18} />
											</a>
										))}
									</div>
								</div>
							) : null}
							<div className="border-t border-white/15 pt-5">
								<Scripture verse={VERSES.callUnto} dark size="sm" />
							</div>
						</div>
					</aside>

					<div id="enquiry" className="card scroll-mt-28 p-5 sm:p-8">
						{done ? (
							<div className="py-10 text-center" aria-live="polite">
								<span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-600 text-white">
									<CheckCircle2 size={30} />
								</span>
								<h2 className="mt-5 font-serif text-3xl text-ink">Message sent</h2>
								<p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-muted">
									{done.message || "Thank you. We have received your message and will respond within two working days."}
								</p>
								{done.reference ? (
									<div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cream px-3 py-2 text-sm ring-1 ring-gold-200">
										<span className="text-ink-soft">Reference</span>
										<span className="font-mono font-semibold text-ink">{done.reference}</span>
									</div>
								) : null}
								<div className="mt-7 flex flex-wrap justify-center gap-2">
									<Button
										variant="secondary"
										onClick={() => {
											setDone(null)
											setForm((f) => ({ ...f, subject: "", message: "" }))
										}}
									>
										Send another message
									</Button>
									<Link to="/programmes" className="btn btn-ghost">
										Explore programmes <ArrowRight size={16} />
									</Link>
								</div>
							</div>
						) : (
							<form onSubmit={submit} noValidate className="relative space-y-5">
								<div>
									<h2 className="font-serif text-2xl text-ink">Send us a message</h2>
									<p className="mt-1 text-sm text-ink-muted">Fields marked * are required.</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<Input label="Full name" required autoComplete="name" value={form.full_name} onChange={set("full_name")} error={errors.full_name} />
									<Input label="Email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} />
									<Input
										label="Phone"
										type="tel"
										inputMode="tel"
										autoComplete="tel"
										placeholder="0712 345 678"
										value={form.phone}
										onChange={set("phone")}
										error={errors.phone}
										hint="Optional, if you'd like a call back"
									/>
									<Select label="What is it about?" value={form.enquiry_type} onChange={set("enquiry_type")} options={TYPES} />
									<Input label="Subject" value={form.subject} onChange={set("subject")} placeholder="Optional" className="sm:col-span-2" maxLength={140} />
									<Textarea
										label="Message"
										required
										rows={6}
										value={form.message}
										onChange={set("message")}
										error={errors.message}
										className="sm:col-span-2"
										placeholder={form.enquiry_type === "Prayer Request" ? "Share your prayer request. Our chaplaincy team will pray with you." : "How can we help?"}
										hint={`${form.message.length.toLocaleString()} / 5,000`}
									/>
								</div>
								<div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
									<label>
										Website
										<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
									</label>
								</div>
								<div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
									<p className="text-xs text-ink-soft">
										By sending this message you agree to our{" "}
										<Link to="/privacy" className="link">
											privacy notice
										</Link>
										.
									</p>
									<Button type="submit" size="lg" icon={Send} loading={send.isPending}>
										Send message
									</Button>
								</div>
							</form>
						)}
					</div>
				</div>
			</Band>

			<Band tone="cream">
				<h2 className="font-serif text-3xl text-ink">Which office do you need?</h2>
				<p className="mt-2 max-w-2xl text-[15px] text-ink-muted">Pick a topic and your message goes straight to the right team.</p>
				<div className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
					{DESKS.map(({ icon: Icon, title, text, type }) => (
						<button
							key={title}
							type="button"
							onClick={() => {
								setDone(null)
								setForm((f) => ({ ...f, enquiry_type: type }))
								document.getElementById("enquiry")?.scrollIntoView({ behavior: "smooth", block: "start" })
							}}
							className="card group flex gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift sm:block sm:p-5"
						>
							<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-700 group-hover:text-white">
								<Icon size={20} />
							</span>
							<span className="block min-w-0">
								<span className="block font-semibold text-ink sm:mt-4">{title}</span>
								<span className="mt-1 block text-sm leading-relaxed text-ink-muted">{text}</span>
							</span>
						</button>
					))}
				</div>
			</Band>

			{mapEmbed ? (
				<Band>
					<div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-stretch">
						<div className="flex flex-col justify-center">
							<div className="eyebrow">Find us</div>
							<h2 className="mt-2 font-serif text-3xl text-ink">Visit the campus</h2>
							{c.address ? <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">{c.address}</p> : null}
							<p className="mt-3 text-sm text-ink-muted">Visitors are welcome during office hours. Please report to the main reception on arrival.</p>
							<a
								href={mapEmbed.replace(/&?output=embed/, "")}
								target="_blank"
								rel="noreferrer"
								className="link mt-4 inline-flex items-center gap-1.5 text-sm font-semibold"
							>
								<MapPin size={15} /> Open in Google Maps
							</a>
						</div>
						<div className="relative overflow-hidden rounded-3xl bg-cream ring-1 ring-line">
							<div aria-hidden className="pattern-dots absolute inset-0 opacity-40" />
							<iframe
								title={`Map: ${inst.name}`}
								src={mapEmbed}
								className="relative block h-[360px] w-full border-0 sm:h-[420px]"
								loading="lazy"
								referrerPolicy="no-referrer-when-downgrade"
								allowFullScreen
							/>
						</div>
					</div>
				</Band>
			) : null}
		</>
	)
}
