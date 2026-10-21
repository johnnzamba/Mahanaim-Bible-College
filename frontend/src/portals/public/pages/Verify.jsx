import { useEffect, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import clsx from "clsx"
import {
	Building2,
	ChevronDown,
	FileCheck2,
	Fingerprint,
	Printer,
	QrCode,
	RotateCcw,
	ScanLine,
	SearchX,
	ShieldAlert,
	ShieldCheck,
	ShieldQuestion,
	Smartphone,
} from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Button, ErrorState, Input, Skeleton } from "@/shared/components/ui"
import { date, dateTime, money } from "@/shared/utils/format"
import { Band, Feature, PageHero, SectionHeading, Steps } from "../components/Blocks"
import { useInstitution, usePageMeta } from "../lib"

const STATES = {
	valid: {
		icon: ShieldCheck,
		title: "Authentic document",
		text: "This document was issued by the college and is valid.",
		cls: "border-emerald-200 bg-emerald-50",
		badge: "bg-emerald-600",
	},
	revoked: {
		icon: ShieldAlert,
		title: "Document revoked",
		text: "This document was issued by the college but has since been revoked. It is no longer valid.",
		cls: "border-red-200 bg-red-50",
		badge: "bg-red-600",
	},
	cancelled: {
		icon: ShieldAlert,
		title: "Document cancelled",
		text: "This financial document was cancelled by the college and is not valid.",
		cls: "border-red-200 bg-red-50",
		badge: "bg-red-600",
	},
	not_found: {
		icon: ShieldQuestion,
		title: "No matching document",
		text: "We could not find a document with this code. Check the code carefully (letters, numbers and dashes) and try again.",
		cls: "border-gold-200 bg-cream",
		badge: "bg-gold-600",
	},
}

const QR_STEPS = [
	{ title: "Scan the QR code", text: "Every certificate, transcript and receipt we issue carries a QR code beside the official seal." },
	{ title: "Open this page", text: "The code opens this page with the verification code filled in, straight from our own records." },
	{ title: "Compare the details", text: "Check that the name, programme and dates on screen match the paper document in front of you." },
]

function Row({ label, value, mono }) {
	if (value == null || value === "") return null
	return (
		<div className="border-b border-line py-3 last:border-0 sm:grid sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
			<dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">{label}</dt>
			<dd className={clsx("mt-1 text-[15px] font-medium text-ink sm:mt-0", mono && "font-mono")}>{value}</dd>
		</div>
	)
}

function Result({ r, code, onReset }) {
	const inst = useInstitution()
	const state = STATES[r.status] || STATES.not_found
	const Icon = state.icon
	const found = r.status !== "not_found"
	const title = r.award || (r.document_type === "Transcript" ? `${r.transcript_type || "Academic"} transcript` : r.document_type)
	return (
		<div className="animate-fade-up overflow-hidden rounded-3xl border border-line bg-surface shadow-card print:border-0 print:shadow-none" aria-live="polite">
			<div className={clsx("flex items-start gap-4 border-b p-5 sm:p-7", state.cls)}>
				<span className={clsx("grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white", state.badge)}>
					<Icon size={28} />
				</span>
				<div className="min-w-0">
					<h2 className="font-serif text-2xl text-ink sm:text-3xl">{state.title}</h2>
					<p className="mt-1 text-sm leading-relaxed text-ink-muted">{r.message || state.text}</p>
				</div>
			</div>
			{found ? (
				<dl className="px-5 py-2 sm:px-7">
					<Row label="Document" value={title} />
					<Row label="Document type" value={r.document_type} />
					<Row label="Issued to" value={r.student_name} />
					<Row label="Student number" value={r.student_number} mono />
					<Row label="Programme" value={r.programme} />
					<Row label="Classification" value={r.classification} />
					<Row label="Certificate serial" value={r.certificate_serial} mono />
					<Row label="Document number" value={r.document_number} mono />
					<Row label="Graduation date" value={r.graduation_date ? date(r.graduation_date, { day: "numeric", month: "long", year: "numeric" }) : null} />
					<Row label="Issue date" value={r.issue_date ? date(r.issue_date, { day: "numeric", month: "long", year: "numeric" }) : null} />
					<Row label="Date" value={r.date ? date(r.date, { day: "numeric", month: "long", year: "numeric" }) : null} />
					<Row label="Amount" value={r.amount ? money(r.amount, { currency: r.currency, decimals: 2 }) : null} />
					<Row label="Issued by" value={r.institution || inst.name} />
				</dl>
			) : null}
			<div className="flex flex-col gap-4 border-t border-line bg-canvas/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
				<div className="text-xs text-ink-soft">
					Code <span className="font-mono font-semibold text-ink">{code}</span> · checked {dateTime(new Date())} · {r.institution || inst.name}
				</div>
				<div className="no-print flex flex-wrap gap-2">
					{found ? (
						<Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
							Print
						</Button>
					) : null}
					<Button variant="ghost" size="sm" icon={RotateCcw} onClick={onReset}>
						Check another
					</Button>
				</div>
			</div>
		</div>
	)
}

export default function Verify() {
	const inst = useInstitution()
	const params = useParams()
	const [search] = useSearchParams()
	const navigate = useNavigate()
	const fromUrl = (params.code || search.get("code") || "").trim()
	const [code, setCode] = useState(fromUrl)
	const [who, setWho] = useState({ requester_name: "", requester_organisation: "" })
	const [showWho, setShowWho] = useState(false)
	const [submitted, setSubmitted] = useState(fromUrl ? { code: fromUrl } : null)
	const [error, setError] = useState("")
	usePageMeta(submitted ? `Verify ${submitted.code}` : "Verify a document", `Confirm that a certificate, transcript or receipt issued by ${inst.name} is genuine.`)

	useEffect(() => {
		if (fromUrl && fromUrl !== submitted?.code) {
			setCode(fromUrl)
			setSubmitted({ code: fromUrl })
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fromUrl])

	const q = useApi("mahanaim.api.credentials.verify", submitted || {}, { guest: true, enabled: Boolean(submitted?.code), retry: false, staleTime: Infinity })

	const submit = (e) => {
		e.preventDefault()
		const c = code.trim()
		if (!/^[A-Za-z0-9][A-Za-z0-9\-./]{3,63}$/.test(c)) {
			setError("Enter the verification code exactly as printed on the document (at least 4 characters).")
			return
		}
		setError("")
		setSubmitted({
			code: c,
			requester_name: who.requester_name.trim() || undefined,
			requester_organisation: who.requester_organisation.trim() || undefined,
		})
		navigate(`/verify/${encodeURIComponent(c)}`, { replace: true })
	}
	const reset = () => {
		setSubmitted(null)
		setCode("")
		navigate("/verify", { replace: true })
		setTimeout(() => document.getElementById("verify-code")?.focus(), 50)
	}

	return (
		<>
			<div className="no-print">
				<PageHero
					eyebrow="Document verification"
					title="Is this certificate genuine?"
					subtitle={`Employers, churches and universities can confirm any certificate, transcript or receipt issued by ${inst.name} in seconds, at no cost.`}
					crumbs={[{ label: "Verify a document" }]}
					compact
					aside={
						<form onSubmit={submit} noValidate className="rounded-3xl bg-surface p-5 text-ink shadow-lift sm:p-6">
							<div className="flex items-center gap-2 font-semibold">
								<Fingerprint size={18} className="text-brand-700" /> Enter the verification code
							</div>
							<p className="mt-1 text-xs text-ink-soft">It's printed under the QR code, for example MBC-TR-2025-0042.</p>
							<Input
								id="verify-code"
								className="mt-4"
								inputClassName="h-12 font-mono text-base tracking-wide"
								value={code}
								onChange={(e) => {
									setCode(e.target.value.replace(/\s+/g, ""))
									setError("")
								}}
								placeholder="Verification code"
								autoComplete="off"
								autoCapitalize="characters"
								spellCheck={false}
								aria-label="Verification code"
								error={error}
								icon={QrCode}
							/>
							<button type="button" onClick={() => setShowWho((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700" aria-expanded={showWho}>
								<ChevronDown size={14} className={clsx("transition", showWho && "rotate-180")} /> Verifying on behalf of an organisation? (optional)
							</button>
							{showWho ? (
								<div className="mt-3 grid gap-3">
									<Input label="Your name" value={who.requester_name} onChange={(e) => setWho((w) => ({ ...w, requester_name: e.target.value }))} />
									<Input label="Organisation" value={who.requester_organisation} onChange={(e) => setWho((w) => ({ ...w, requester_organisation: e.target.value }))} />
								</div>
							) : null}
							<Button type="submit" size="lg" icon={ShieldCheck} className="mt-4 w-full" loading={q.isFetching}>
								Verify document
							</Button>
						</form>
					}
				/>
			</div>

			{submitted ? (
				<Band narrow className="print:!py-0">
					<div className="mb-6 hidden print:block">
						<div className="font-serif text-2xl text-ink">{inst.name}</div>
						<div className="text-sm text-ink-muted">Document verification result</div>
					</div>
					{q.isLoading ? (
						<div className="space-y-3 rounded-3xl border border-line bg-surface p-7">
							<Skeleton className="h-14 w-2/3" />
							<Skeleton className="h-4" />
							<Skeleton className="h-4 w-5/6" />
							<Skeleton className="h-4 w-4/6" />
						</div>
					) : q.isError ? (
						<ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't check this code" />
					) : q.data ? (
						<Result r={q.data} code={submitted.code} onReset={reset} />
					) : null}
					{q.data && q.data.status === "not_found" ? (
						<div className="no-print mt-6 flex items-start gap-3 rounded-2xl bg-cream/80 p-5 text-sm text-ink-muted ring-1 ring-gold-200">
							<SearchX size={18} className="mt-0.5 shrink-0 text-gold-700" />
							<p>
								Still not found? The document may be fraudulent, or it may pre-date online verification. Please{" "}
								<Link to="/contact?type=General&subject=Document%20verification" className="link">
									contact the registrar
								</Link>{" "}
								with a scan of the document and we will confirm it manually.
							</p>
						</div>
					) : null}
				</Band>
			) : null}

			<div className="no-print">
				<Band tone={submitted ? "cream" : "plain"}>
					<SectionHeading
						eyebrow="How it works"
						title="QR codes on every document"
						subtitle="Our certificates, transcripts, fee statements and receipts are verifiable online. Each one carries a unique code and QR code that links straight to this page."
					/>
					<Steps steps={QR_STEPS} cols={3} />
				</Band>
				<Band tone={submitted ? "plain" : "cream"}>
					<div className="grid gap-6 md:grid-cols-3">
						<Feature icon={FileCheck2} title="What we confirm">
							That the document was issued by us, to whom, for which programme or award, and whether it is still valid. We never show grades or fee balances.
						</Feature>
						<Feature icon={Building2} title="For employers and institutions">
							Adding your name and organisation keeps a record of the check in our registry. For a sealed transcript sent directly to you, contact the registrar.
						</Feature>
						<Feature icon={Smartphone} title="Revoked documents">
							If a document is withdrawn it shows here as revoked immediately, even though the paper copy still exists.
						</Feature>
					</div>
					<p className="mt-10 text-xs text-ink-soft">
						<ScanLine size={14} className="mr-1.5 inline align-[-2px]" /> Every check is logged with its date and time under the Kenya Data Protection Act, 2019. See our{" "}
						<Link to="/privacy" className="link">
							privacy notice
						</Link>
						.
					</p>
				</Band>
			</div>
		</>
	)
}
