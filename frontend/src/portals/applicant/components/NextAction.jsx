import { Link } from "react-router-dom"
import clsx from "clsx"
import {
	ArrowRight,
	CalendarClock,
	FilePlus2,
	FileUp,
	GraduationCap,
	Hourglass,
	PartyPopper,
	PenLine,
	SearchCheck,
	Smartphone,
	TimerOff,
} from "lucide-react"
import { Button, TONE } from "@/shared/components/ui"
import { date, dateTime, money } from "@/shared/utils/format"
import { CLOSED_STATUSES, DOC_UPLOAD_STATUSES } from "../lib"

/** Decide the single most useful thing the applicant should do next. */
export function resolveNextAction(app, { checklist, progress = 0, portals = [] } = {}) {
	if (!app) return null
	const detail = `/applicant/application/${app.name}`
	const missingDocs = checklist?.missing?.length || 0
	const docsNeeded = missingDocs > 0 && DOC_UPLOAD_STATUSES.includes(app.status) && app.status !== "Draft"
	switch (app.next_action) {
		case "complete_application":
			return {
				icon: PenLine,
				tone: "brand",
				title: "Finish your application",
				text: `You're about ${progress}% of the way there. Your answers are saved — pick up where you left off.`,
				cta: { label: "Continue application", to: `/applicant/apply?application=${app.name}` },
			}
		case "pay_fee":
			return {
				icon: Smartphone,
				tone: "gold",
				title: "Pay the application fee",
				text: `Your application is submitted. Pay ${money(app.application_fee)} by M-Pesa so the admissions team can start reviewing it.`,
				cta: { label: `Pay ${money(app.application_fee)}`, action: "pay" },
				secondary: docsNeeded ? { label: "Upload missing documents", to: "/applicant/documents" } : null,
			}
		case "attend_interview":
			return {
				icon: CalendarClock,
				tone: "purple",
				title: "You're invited to an interview",
				text: app.interview_date
					? `Your interview is on ${dateTime(app.interview_date)}. Bring your original documents.`
					: "The admissions office will contact you with the date and venue.",
				cta: { label: "View details", to: detail },
			}
		case "accept_offer":
			return {
				icon: PartyPopper,
				tone: "green",
				title: "Congratulations — you've been offered a place!",
				text: `Read your admission letter and respond${app.offer_expiry ? ` by ${date(app.offer_expiry)}` : ""} to secure your place.`,
				cta: { label: "View offer & respond", to: `${detail}#offer` },
			}
		case "offer_expired":
			return {
				icon: TimerOff,
				tone: "red",
				title: "Your offer has expired",
				text: "The response window has closed. Contact the admissions office if you still wish to join this intake.",
				cta: { label: "View application", to: detail },
			}
		case "go_to_student_portal":
			return {
				icon: GraduationCap,
				tone: "green",
				title: "Welcome to Mahanaim!",
				text: `You're now a student${app.student_number ? ` — your student number is ${app.student_number}` : ""}. Register for units, view fees and follow your classes in the student portal.`,
				cta: portals.includes("student") ? { label: "Go to student portal", to: "/student" } : { label: "View application", to: detail },
			}
		case "await_student_number":
			return {
				icon: Hourglass,
				tone: "blue",
				title: "Setting up your student record",
				text: "You've accepted your offer. The registry is creating your student record — you'll be notified with your student number.",
				cta: { label: "View application", to: detail },
			}
		default:
			break
	}
	if (docsNeeded) {
		return {
			icon: FileUp,
			tone: "orange",
			title: "Upload your missing documents",
			text: `${missingDocs} required document${missingDocs === 1 ? " is" : "s are"} still missing. Upload ${missingDocs === 1 ? "it" : "them"} so the review isn't delayed.`,
			cta: { label: "Upload documents", to: "/applicant/documents" },
		}
	}
	if (app.next_action === "await_review" || app.next_action === "await_decision" || ["Submitted", "Under Review", "Waitlisted"].includes(app.status)) {
		return {
			icon: app.status === "Under Review" ? SearchCheck : Hourglass,
			tone: "blue",
			title: app.status === "Waitlisted" ? "You're on the waiting list" : app.status === "Under Review" ? "Your application is under review" : "Your application is with us",
			text:
				app.status === "Waitlisted"
					? "We'll let you know as soon as a place opens up in this intake."
					: "There's nothing you need to do right now. We'll notify you by email and SMS at every step.",
			cta: { label: "Track application", to: detail },
		}
	}
	if (CLOSED_STATUSES.includes(app.status)) {
		return {
			icon: FilePlus2,
			tone: "brand",
			title: app.status === "Rejected" ? "Not successful this time" : app.status === "Declined" ? "You declined this offer" : "Application withdrawn",
			text: "You're welcome to apply again for another programme or a later intake.",
			cta: { label: "Start a new application", to: "/applicant/apply" },
		}
	}
	return { icon: SearchCheck, tone: "brand", title: "Track your application", text: "See every step of your application.", cta: { label: "View application", to: detail } }
}

export function NextActionCard({ action, onPay, className }) {
	if (!action) return null
	const t = TONE[action.tone] || TONE.brand
	const Icon = action.icon
	const cta = action.cta
	return (
		<div className={clsx("flex flex-col gap-4 rounded-2xl border border-line bg-cream/60 p-4 sm:flex-row sm:items-center", className)}>
			<span className={clsx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", t.soft)}>
				<Icon size={22} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="eyebrow">Next step</div>
				<div className="mt-0.5 font-semibold text-ink">{action.title}</div>
				<p className="mt-0.5 text-sm text-ink-muted">{action.text}</p>
			</div>
			<div className="flex shrink-0 flex-wrap gap-2">
				{action.secondary ? (
					<Link to={action.secondary.to} className="btn btn-secondary">
						{action.secondary.label}
					</Link>
				) : null}
				{cta?.action === "pay" ? (
					<Button variant="gold" icon={Smartphone} onClick={onPay}>
						{cta.label}
					</Button>
				) : cta?.to ? (
					<Link to={cta.to} className={clsx("btn", action.tone === "gold" ? "btn-gold" : "btn-primary")} aria-label={cta.label}>
						{cta.label} <ArrowRight size={16} />
					</Link>
				) : null}
			</div>
		</div>
	)
}
