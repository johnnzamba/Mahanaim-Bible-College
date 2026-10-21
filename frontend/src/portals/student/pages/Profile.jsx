import { useState } from "react"
import { Link } from "react-router-dom"
import { BookOpenCheck, Camera, Church, GraduationCap, HeartHandshake, History, Pencil, Phone, User } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Avatar, Badge, Button, KeyValueGrid, PageHeader, Panel, QueryState, Skeleton, Spinner } from "@/shared/components/ui"
import { Timeline } from "@/shared/components/kit"
import { toast } from "@/shared/components/toast"
import { date, dateTime, num } from "@/shared/utils/format"
import { PROFILE_SECTIONS as SECTIONS, ProfileEditModal } from "../components/ProfileEditModal"
import { API, INV } from "../components/lib"

export default function Profile() {
	const q = useApi(API.profile)
	const [edit, setEdit] = useState(null)
	return (
		<>
			<PageHeader eyebrow="Me" title="My profile" subtitle="Keep your contact, next-of-kin and church details up to date." />
			<QueryState
				query={q}
				skeleton={
					<div className="space-y-4">
						<Skeleton className="h-36 rounded-2xl" />
						<div className="grid gap-4 lg:grid-cols-2">
							<Skeleton className="h-48 rounded-2xl" />
							<Skeleton className="h-48 rounded-2xl" />
						</div>
					</div>
				}
			>
				{(p) => {
					const editable = p.editable_fields || []
					const editBtn = (key) =>
						SECTIONS[key].fields.some((f) => editable.includes(f.key)) ? (
							<Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(key)} aria-label={`Edit ${SECTIONS[key].title.toLowerCase()}`}>
								Edit
							</Button>
						) : null
					return (
						<div className="space-y-5">
							<IdentityCard p={p} canPhoto={editable.includes("photo")} />
							<div className="grid gap-5 lg:grid-cols-2">
								<Panel title="Personal" icon={User}>
									<KeyValueGrid
										items={[
											{ label: "Full name", value: p.full_name },
											{ label: "Gender", value: p.gender || "—" },
											{ label: "Date of birth", value: p.date_of_birth ? date(p.date_of_birth) : "—" },
											{ label: "Marital status", value: p.marital_status || "—" },
											{ label: "National ID / Passport", value: p.national_id || "—" },
											{ label: "Nationality", value: p.nationality || "—" },
										]}
									/>
									<p className="mt-4 text-xs text-ink-soft">
										To correct your name, ID or date of birth,{" "}
										<Link to="/student/requests?new" className="link">
											send a request to the Registrar
										</Link>
										.
									</p>
								</Panel>
								<Panel title={SECTIONS.contact.title} icon={Phone} actions={editBtn("contact")}>
									<KeyValueGrid
										items={[
											{ label: "Email", value: p.email },
											{ label: "Mobile phone", value: p.phone || "—" },
											{ label: "County", value: p.county || "—" },
											{ label: "Postal address", value: p.postal_address || "—" },
										]}
									/>
								</Panel>
								<Panel title={SECTIONS.nok.title} icon={HeartHandshake} actions={editBtn("nok")}>
									<KeyValueGrid
										items={[
											{ label: "Name", value: p.nok_name || "—" },
											{ label: "Relationship", value: p.nok_relationship || "—" },
											{ label: "Phone", value: p.nok_phone || "—" },
										]}
									/>
								</Panel>
								<Panel title={SECTIONS.church.title} icon={Church} actions={editBtn("church")}>
									<KeyValueGrid
										items={[
											{ label: "Home church", value: p.home_church || "—" },
											{ label: "Partner church", value: p.partner_church || "—" },
											{ label: "Denomination", value: p.denomination || "—" },
											{ label: "Pastor", value: [p.pastor_name, p.pastor_phone].filter(Boolean).join(" · ") || "—" },
											{ label: "Ministry role", value: p.ministry_role || "—" },
										]}
									/>
								</Panel>
								<Panel title="Academic record" icon={GraduationCap}>
									<KeyValueGrid
										items={[
											{ label: "Programme", value: p.programme_name || p.programme },
											{ label: "Campus", value: p.campus_name || p.campus },
											{ label: "Study mode", value: p.study_mode || "—" },
											{ label: "Year of study", value: p.year_of_study || "—" },
											{ label: "Current term", value: p.term_label || p.current_term || "—" },
											{ label: "Intake", value: p.intake || p.admission_year || "—" },
											{ label: "Enrolled", value: p.enrollment_date ? date(p.enrollment_date) : "—" },
											{ label: "Expected completion", value: p.expected_completion ? date(p.expected_completion) : "—" },
											{ label: "CGPA", value: p.cgpa != null ? num(p.cgpa, 2) : "—" },
											{ label: "Credits earned", value: num(p.credits_earned) },
											{ label: "Fee category", value: p.fee_category || "—" },
											{ label: "Sponsor", value: p.primary_sponsor || "Self" },
										]}
									/>
									<div className="mt-4 flex flex-wrap gap-2">
										<Link to="/student/results" className="btn btn-secondary btn-sm">
											<BookOpenCheck size={14} /> Results
										</Link>
										<Link to="/student/documents" className="btn btn-ghost btn-sm">
											Documents
										</Link>
									</div>
								</Panel>
								<Panel title="Status history" icon={History}>
									{(p.status_log || []).length ? (
										<Timeline
											steps={[...p.status_log].reverse().map((s, i) => ({
												label: s.from_status ? `${s.from_status} → ${s.to_status}` : s.to_status,
												date: dateTime(s.timestamp),
												status: i === 0 ? "current" : "done",
											}))}
										/>
									) : (
										<p className="text-sm text-ink-soft">No status changes recorded.</p>
									)}
								</Panel>
							</div>
							{edit ? <ProfileEditModal open onClose={() => setEdit(null)} title={`Edit ${SECTIONS[edit].title.toLowerCase()}`} fields={SECTIONS[edit].fields} editable={editable} profile={p} /> : null}
						</div>
					)
				}}
			</QueryState>
		</>
	)
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"]

function IdentityCard({ p, canPhoto }) {
	const session = useSession()
	const invalidate = useInvalidate()
	const [busy, setBusy] = useState(false)
	const onPhoto = async (e) => {
		const file = e.target.files?.[0]
		e.target.value = ""
		if (!file) return
		if (!PHOTO_TYPES.includes(file.type)) return toast.error("Choose a JPG, PNG or WebP image")
		if (file.size > 5 * 1024 * 1024) return toast.error("Photos must be 5 MB or smaller")
		setBusy(true)
		try {
			const up = await frappe.uploadFile(file, false)
			await frappe.call(API.updateProfile, { data: { photo: up.file_url } })
			toast.success("Photo updated")
			invalidate(INV.students)
			session.reload?.()
		} catch (err) {
			toast.error(err.message || "Couldn't update your photo")
		} finally {
			setBusy(false)
		}
	}
	return (
		<section className="card flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:text-left">
			<div className="relative">
				<Avatar name={p.full_name} src={p.photo} size={96} className="ring-4 ring-gold-400/40" />
				{canPhoto ? (
					<label className="absolute -bottom-1 -right-1 grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 border-surface bg-brand-800 text-white shadow transition hover:bg-brand-700 dark:bg-brand-600 dark:text-brand-50" title="Change photo">
						{busy ? <Spinner size={15} /> : <Camera size={16} />}
						<span className="sr-only">Change profile photo</span>
						<input type="file" accept={PHOTO_TYPES.join(",")} className="sr-only" onChange={onPhoto} disabled={busy} />
					</label>
				) : null}
			</div>
			<div className="min-w-0 flex-1">
				<h2 className="font-serif text-2xl text-ink">{p.full_name}</h2>
				<p className="font-mono text-sm text-ink-muted">{p.student_number}</p>
				<p className="mt-1 text-sm text-ink-soft">
					{p.programme_name} · {p.campus_name || p.campus}
				</p>
				<div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
					<Badge status={p.status} dot />
					{p.year_of_study ? <Badge tone="gray">Year {p.year_of_study}</Badge> : null}
					{p.academic_standing ? <Badge tone="gold">{p.academic_standing}</Badge> : null}
				</div>
			</div>
		</section>
	)
}
