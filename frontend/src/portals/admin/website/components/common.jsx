import { useState } from "react"
import { ImageOff, Trash2 } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"
import { toast } from "@/shared/components/toast"
import { FileDrop } from "@/shared/components/ui"
import { SubTabs } from "./kit"

export const API = "mahanaim.api.website."
export const INVALIDATE = [API]

export const NEWS_CATEGORIES = ["News", "Announcement", "Devotional", "Campus Life", "Ministry", "Alumni", "Press"]
export const EVENT_TYPES = ["Chapel", "Conference", "Seminar", "Retreat", "Graduation", "Open Day", "Mission", "Fellowship", "Concert", "Sports", "Other"]
export const EVENT_STATUSES = ["Draft", "Upcoming", "Ongoing", "Completed", "Cancelled"]
export const REG_STATUSES = ["Registered", "Confirmed", "Waitlisted", "Attended", "Cancelled"]
export const ENQ_SUBJECTS = ["General", "Admissions", "Fees", "Partnership", "Media", "Prayer Request", "Other"]
export const ENQ_STATUSES = ["New", "In Progress", "Responded", "Closed"]
export const FAQ_CATEGORIES = ["Admissions", "Fees", "Academics", "Online Learning", "Accommodation", "General"]

const TONES = {
	Draft: "gray",
	Published: "green",
	Scheduled: "blue",
	Upcoming: "blue",
	Ongoing: "purple",
	Completed: "green",
	Cancelled: "red",
	Registered: "blue",
	Confirmed: "brand",
	Waitlisted: "orange",
	Attended: "green",
	New: "orange",
	"In Progress": "blue",
	Responded: "green",
	Closed: "gray",
	Paid: "green",
	Pending: "orange",
	Waived: "gray",
}
export const toneOf = (status) => TONES[status]

/** Role checks mirroring CMS_ROLES / EVENT_ROLES / ENQUIRY_ROLES in mahanaim/api/website.py. */
export function useWebRoles() {
	const { hasRole } = useSession()
	const canCms = hasRole(ROLES.COMMS)
	const canEvents = hasRole(ROLES.COMMS, ROLES.CHAPLAIN)
	const canEnquiries = hasRole(ROLES.COMMS, ROLES.ADMISSIONS)
	return { canCms, canEvents, canEnquiries, canFaqs: canCms || canEnquiries, any: canCms || canEvents || canEnquiries }
}

export function WebTabs() {
	const { canCms, canEvents, canEnquiries, canFaqs, any } = useWebRoles()
	const links = [
		any ? { to: "/admin/website", label: "Overview", end: true } : null,
		canCms ? { to: "/admin/website/news", label: "News" } : null,
		canEvents ? { to: "/admin/website/events", label: "Events" } : null,
		canEnquiries ? { to: "/admin/website/enquiries", label: "Enquiries" } : null,
		canFaqs ? { to: "/admin/website/content", label: "Content" } : null,
	].filter(Boolean)
	return <SubTabs label="Website sections" links={links} />
}

export const toLocal = (v) => (v ? String(v).slice(0, 16).replace(" ", "T") : "")
export const fromLocal = (v) => (v ? `${v.replace("T", " ")}${v.length === 16 ? ":00" : ""}` : null)
export const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export const slugify = (s) =>
	String(s || "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)

/** Public image upload with a preview (website images must be public files). */
export function ImageField({ label, hint, value, onChange, meta, aspect = "aspect-[16/9]", className }) {
	const [busy, setBusy] = useState(false)
	const upload = async (file) => {
		if (!file.type.startsWith("image/")) return toast.error("Choose an image file (JPG, PNG or WebP)")
		if (file.size > 5 * 1024 * 1024) return toast.error("Images must be under 5 MB")
		setBusy(true)
		try {
			const r = await frappe.uploadFile(file, false, meta || {})
			onChange(r.file_url)
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setBusy(false)
		}
	}
	return (
		<div className={className}>
			{value ? (
				<div className="space-y-2">
					<span className="label">{label}</span>
					<div className={`relative overflow-hidden rounded-xl border border-line bg-cream ${aspect}`}>
						<img src={value} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.opacity = "0.2")} />
						<button type="button" onClick={() => onChange("")} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-surface/90 px-2 py-1 text-xs font-semibold text-red-600 shadow hover:bg-surface">
							<Trash2 size={12} /> Remove
						</button>
					</div>
					<FileDrop label={null} hint={hint} accept="image/*" onFile={upload} busy={busy} />
				</div>
			) : (
				<FileDrop label={label} hint={hint || "JPG, PNG or WebP, up to 5 MB."} accept="image/*" onFile={upload} busy={busy} />
			)}
		</div>
	)
}

export function NoImage({ className }) {
	return (
		<span className={`grid place-items-center bg-cream text-ink-soft/40 ${className || ""}`}>
			<ImageOff size={18} />
		</span>
	)
}
