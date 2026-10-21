import { Link } from "react-router-dom"
import { FileText, Mail, Printer, ShieldCheck } from "lucide-react"
import { Container, PageHero } from "../components/Blocks"
import { useHashScroll, useInstitution, usePageMeta, useSite } from "../lib"

const UPDATED = "1 January 2026"

function privacy({ name, email }) {
	return [
		{
			id: "who-we-are",
			title: "Who we are",
			body: (
				<>
					<p>
						{name} ("the college", "we", "us") is a Christian theological college in Kenya. We are the data controller for the personal data described in
						this notice, which explains how we collect, use, share and protect your information when you visit our website, apply for admission, study
						with us, make payments or gifts, register for events or use the Digital Campus.
					</p>
					<p>
						We process personal data in line with the <strong>Data Protection Act, 2019</strong> and the Data Protection (General) Regulations, 2021. Questions
						about this notice can be sent to our Data Protection Officer at <a href={`mailto:${email}`}>{email}</a>.
					</p>
				</>
			),
		},
		{
			id: "what-we-collect",
			title: "Information we collect",
			body: (
				<>
					<ul>
						<li>
							<strong>Applicants:</strong> name, date of birth, gender, national ID or passport number, contact details, academic history and certificates,
							church affiliation and pastor's recommendation, personal testimony, sponsorship details and uploaded documents.
						</li>
						<li>
							<strong>Students:</strong> student number, programme, registration, attendance, assignments, examination results, transcripts, fee invoices
							and payments, library loans, hostel and welfare records, and communication with the college.
						</li>
						<li>
							<strong>Payments and gifts:</strong> the M-Pesa phone number, amount, M-Pesa receipt number and the payer name returned by Safaricom.
						</li>
						<li>
							<strong>Visitors:</strong> details you give in enquiry, event registration and giving forms, and basic technical data such as your IP address,
							browser type and the pages you visit.
						</li>
					</ul>
					<p>
						Some information, such as your <strong>religious beliefs</strong> (testimony and church affiliation) and any <strong>health information</strong> you
						share for welfare or disability support, is <em>sensitive personal data</em> under the Act. We collect it only because it is necessary for
						admission to a theological college or for your welfare, and we protect it with additional safeguards.
					</p>
				</>
			),
		},
		{
			id: "how-we-use",
			title: "How and why we use it",
			body: (
				<>
					<p>We use personal data only for specific, explicit purposes, and on one of the lawful bases in section 30 of the Act:</p>
					<ul>
						<li>
							<strong>Contract:</strong> to assess your application, admit and register you, teach and assess you, issue certificates and transcripts, and
							manage fees.
						</li>
						<li>
							<strong>Legal obligation:</strong> to keep financial records, report to regulators and examining bodies, and respond to lawful requests.
						</li>
						<li>
							<strong>Legitimate interests:</strong> to keep our systems secure, prevent fraud, improve our services and keep in touch with alumni and
							partners.
						</li>
						<li>
							<strong>Consent:</strong> for optional communications such as newsletters and prayer updates. You may withdraw consent at any time.
						</li>
					</ul>
					<p>We do not sell personal data, and we do not use it for automated decisions that significantly affect you.</p>
				</>
			),
		},
		{
			id: "mpesa",
			title: "M-Pesa payments",
			body: (
				<>
					<p>
						When you pay fees, an application fee, an event fee or make a gift, we send a payment request (STK push) to your phone through Safaricom's M-Pesa
						platform. You confirm the payment on your own phone; <strong>we never see or store your M-Pesa PIN</strong>.
					</p>
					<p>
						Safaricom returns the transaction result to us, including the receipt number and payer details, which we use to receipt the payment and update
						your account. Safaricom processes your data under its own privacy policy. Pay only through the official channels shown on this website or in
						your portal.
					</p>
				</>
			),
		},
		{
			id: "sharing",
			title: "Who we share it with",
			body: (
				<ul>
					<li>Your sponsor, church or employer, where they pay or guarantee your fees, limited to what the arrangement needs (such as fee status and progress).</li>
					<li>Service providers who host our systems or send email and SMS on our behalf, under written data processing agreements.</li>
					<li>Safaricom, for M-Pesa payments.</li>
					<li>Government agencies, regulators, examining and accreditation bodies, and law enforcement, where the law requires it.</li>
					<li>
						Anyone checking a certificate or transcript on our <Link to="/verify">verification page</Link>, who sees only the holder's name, programme, award,
						issue date and a masked student number.
					</li>
				</ul>
			),
		},
		{
			id: "transfers",
			title: "Transfers outside Kenya",
			body: (
				<p>
					Some of our service providers may store data on servers outside Kenya. Where this happens we make sure there are appropriate safeguards, as required by
					sections 48 to 50 of the Act, such as contractual protections and providers with strong security standards.
				</p>
			),
		},
		{
			id: "retention",
			title: "How long we keep it",
			body: (
				<ul>
					<li>Academic records, transcripts and certificates are kept permanently so we can confirm your qualifications for life.</li>
					<li>Financial records are kept for as long as tax and audit law requires.</li>
					<li>Applications that do not lead to admission are kept for two years, then deleted or anonymised.</li>
					<li>Enquiries, event registrations and verification logs are kept for up to two years.</li>
				</ul>
			),
		},
		{
			id: "security",
			title: "How we protect it",
			body: (
				<p>
					We use encrypted connections (HTTPS), role-based access so staff see only what their work requires, one-time verification codes, audit logs and
					regular backups. If a personal data breach occurs that is likely to put you at risk, we will notify the Data Commissioner and, where required, you.
				</p>
			),
		},
		{
			id: "your-rights",
			title: "Your rights",
			body: (
				<>
					<p>Under section 26 of the Act you have the right to:</p>
					<ul>
						<li>be informed of how your data is used;</li>
						<li>access the personal data we hold about you;</li>
						<li>object to processing of all or part of your data;</li>
						<li>have false or misleading data corrected;</li>
						<li>have data deleted where we no longer have a lawful reason to keep it; and</li>
						<li>receive your data in a portable format, where applicable.</li>
					</ul>
					<p>
						To exercise any of these rights, email <a href={`mailto:${email}`}>{email}</a> or use our <Link to="/contact">contact form</Link>. We may need to
						confirm your identity first. Some records, such as issued transcripts, cannot be deleted because we must keep them by law.
					</p>
				</>
			),
		},
		{
			id: "children",
			title: "Applicants under 18",
			body: (
				<p>
					Our programmes are designed for adults. If an applicant is under 18, we process their data only with the consent of a parent or guardian, as section 33
					of the Act requires.
				</p>
			),
		},
		{
			id: "cookies",
			title: "Cookies",
			body: (
				<>
					<p>We use a small number of cookies and similar storage:</p>
					<ul>
						<li>
							<strong>Essential cookies</strong> keep you signed in and protect forms against forgery. The site cannot work without them.
						</li>
						<li>
							<strong>Preference storage</strong> remembers choices such as your display settings on this device.
						</li>
					</ul>
					<p>We do not use advertising or cross-site tracking cookies. You can clear cookies in your browser settings at any time; you will then need to sign in again.</p>
				</>
			),
		},
		{
			id: "complaints",
			title: "Complaints",
			body: (
				<p>
					If you are unhappy with how we handle your data, please contact us first so we can put it right. You also have the right to complain to the{" "}
					<a href="https://www.odpc.go.ke" target="_blank" rel="noreferrer">
						Office of the Data Protection Commissioner
					</a>
					.
				</p>
			),
		},
		{
			id: "changes",
			title: "Changes to this notice",
			body: <p>We may update this notice from time to time. The date at the top shows when it last changed; significant changes will be announced on the website.</p>,
		},
	]
}

function terms({ name, email }) {
	return [
		{
			id: "about",
			title: "About these terms",
			body: (
				<p>
					These terms govern your use of the {name} website and Digital Campus (the student, applicant, staff and partner portals). By using them you agree to
					these terms and to our <Link to="/privacy">privacy notice</Link>. If you do not agree, please do not use the site.
				</p>
			),
		},
		{
			id: "accounts",
			title: "Your account",
			body: (
				<ul>
					<li>Give accurate information and keep it up to date.</li>
					<li>Keep your password and one-time codes private. We will never ask for your password or M-Pesa PIN by phone, SMS or email.</li>
					<li>You are responsible for activity on your account. Tell us at once if you think someone else has used it.</li>
					<li>We may suspend accounts that are misused or that put other users or our systems at risk.</li>
				</ul>
			),
		},
		{
			id: "applications",
			title: "Applications and admission",
			body: (
				<ul>
					<li>All information and documents you submit must be true and your own. False or forged documents lead to cancellation of the application or admission and may be reported to the authorities.</li>
					<li>The application fee covers processing and is not refundable.</li>
					<li>An offer of admission is conditional on verification of your documents and on meeting the entry requirements of the programme.</li>
				</ul>
			),
		},
		{
			id: "fees",
			title: "Fees and M-Pesa payments",
			body: (
				<>
					<ul>
						<li>Fees are charged according to the published fee structure for your programme and term.</li>
						<li>
							When you pay by M-Pesa, check the amount and the recipient on your phone before entering your PIN. Payments are confirmed automatically and a
							receipt appears in your portal.
						</li>
						<li>Pay only through the official Paybill, STK prompts started from this website or your portal, or the college bank accounts. We are not responsible for money sent to any other number.</li>
						<li>Refunds and transfers of fees follow the college's finance policy. Payments sent in error should be reported to the finance office as soon as possible.</li>
					</ul>
				</>
			),
		},
		{
			id: "giving",
			title: "Online giving",
			body: (
				<p>
					Gifts are voluntary and are used for the purpose you choose, or for the general work of the college where a designated need is fully met. Gifts are not
					refundable except where a payment was made in error, which you should report to us within 14 days.
				</p>
			),
		},
		{
			id: "events",
			title: "Events",
			body: (
				<p>
					Event registrations are confirmed by email. Paid registrations are confirmed once payment is received. If we cancel an event we will refund any fee you
					paid; if you cannot attend, please let us know so your seat can go to someone else.
				</p>
			),
		},
		{
			id: "acceptable-use",
			title: "Acceptable use",
			body: (
				<>
					<p>You must not:</p>
					<ul>
						<li>post or share unlawful, abusive, defamatory or indecent content;</li>
						<li>submit another person's work as your own, or help others cheat in assessments;</li>
						<li>try to access accounts or data that are not yours, or to disrupt or probe our systems, which may be an offence under the Computer Misuse and Cybercrimes Act, 2018;</li>
						<li>use automated tools to scrape the site or send bulk requests.</li>
					</ul>
				</>
			),
		},
		{
			id: "content",
			title: "Course materials and the e-library",
			body: (
				<p>
					Lecture notes, recordings, assessments and e-library resources are protected by copyright under the Copyright Act (Cap. 130) and licence terms. They
					are provided for your personal study only. You may not copy, share, sell or publish them without permission.
				</p>
			),
		},
		{
			id: "certificates",
			title: "Certificates and verification",
			body: (
				<p>
					Certificates and transcripts are issued by the college and remain its property. Any document can be checked on our <Link to="/verify">verification page</Link>.
					Altering or forging a college document is a criminal offence and will be reported.
				</p>
			),
		},
		{
			id: "liability",
			title: "Availability and liability",
			body: (
				<p>
					We work hard to keep the website accurate and available, but it is provided "as is" and may occasionally be unavailable for maintenance. To the extent
					the law allows, we are not liable for indirect loss arising from your use of the site. Nothing in these terms limits your rights under the Consumer
					Protection Act, 2012 or other Kenyan law.
				</p>
			),
		},
		{
			id: "law",
			title: "Governing law",
			body: (
				<p>
					These terms are governed by the laws of Kenya, and the courts of Kenya have jurisdiction over any dispute. We would always prefer to resolve concerns
					with you directly first: contact us at <a href={`mailto:${email}`}>{email}</a>.
				</p>
			),
		},
	]
}

export default function Policy({ kind = "privacy" }) {
	const inst = useInstitution()
	const site = useSite()
	const email = site.contact?.email || "info@mahanaim.ac.ke"
	const isPrivacy = kind === "privacy"
	usePageMeta(
		isPrivacy ? "Privacy notice" : "Terms of use",
		isPrivacy
			? `How ${inst.name} collects, uses and protects personal data under the Kenya Data Protection Act, 2019.`
			: `The terms that apply when you use the ${inst.name} website, Digital Campus, M-Pesa payments and online giving.`
	)
	const sections = (isPrivacy ? privacy : terms)({ name: inst.name, email })
	useHashScroll(true)

	return (
		<>
			<div className="no-print">
				<PageHero
					eyebrow={isPrivacy ? "Your data" : "Legal"}
					title={isPrivacy ? "Privacy notice" : "Terms of use"}
					subtitle={
						isPrivacy
							? "We are trusted with the personal stories, records and payments of the people we serve. This notice explains how we look after them."
							: "Plain-language terms for using our website, the Digital Campus, M-Pesa payments and online giving."
					}
					crumbs={[{ label: isPrivacy ? "Privacy" : "Terms" }]}
					compact
				/>
			</div>
			<Container className="grid gap-10 py-12 sm:py-16 lg:grid-cols-[260px_minmax(0,1fr)]">
				<aside className="no-print hidden lg:block">
					<nav aria-label="On this page" className="sticky top-24">
						<div className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">On this page</div>
						<ol className="mt-3 space-y-1 border-l border-line">
							{sections.map((s, i) => (
								<li key={s.id}>
									<a href={`#${s.id}`} className="-ml-px block border-l-2 border-transparent py-1 pl-4 text-sm text-ink-muted transition hover:border-gold-500 hover:text-ink">
										{i + 1}. {s.title}
									</a>
								</li>
							))}
						</ol>
						<Link to={isPrivacy ? "/terms" : "/privacy"} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline">
							{isPrivacy ? <FileText size={15} /> : <ShieldCheck size={15} />} {isPrivacy ? "Terms of use" : "Privacy notice"}
						</Link>
					</nav>
				</aside>
				<article className="min-w-0">
					<div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream/70 px-5 py-4 text-sm ring-1 ring-gold-200">
						<span className="text-ink-muted">
							Last updated <span className="font-semibold text-ink">{UPDATED}</span>
						</span>
						<button type="button" onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline">
							<Printer size={15} /> Print
						</button>
					</div>
					<div className="space-y-10">
						{sections.map((s, i) => (
							<section key={s.id} id={s.id} className="scroll-mt-24">
								<h2 className="font-serif text-2xl text-ink">
									<span className="mr-2 text-gold-600">{i + 1}.</span>
									{s.title}
								</h2>
								<div className="prose-mbc mt-3 max-w-none text-[15px]">{s.body}</div>
							</section>
						))}
					</div>
					<div className="no-print mt-12 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="font-semibold text-ink">Questions about this {isPrivacy ? "notice" : "page"}?</div>
							<div className="text-sm text-ink-muted">We're happy to explain anything in plain terms.</div>
						</div>
						<a href={`mailto:${email}`} className="btn btn-secondary">
							<Mail size={16} /> {email}
						</a>
					</div>
				</article>
			</Container>
		</>
	)
}
