import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Save, Trash2, UserPlus } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { Alert, Avatar, Button, Checkbox, ErrorState, FileDrop, Input, PageHeader, Panel, Select, SkeletonRows, Switch, Textarea } from "@/shared/components/ui"
import { API, CAN, NoAccess, SALUTATIONS, STAFF_STATUSES, STAFF_TYPES, bioToText, isPermissionError, textToBio, today, useLookups } from "../lib"

const EMPTY = {
	salutation: "",
	first_name: "",
	last_name: "",
	staff_number: "",
	photo: "",
	status: "Active",
	date_joined: "",
	email: "",
	phone: "",
	staff_type: "Academic",
	designation: "",
	is_lecturer: false,
	department: "",
	campus: "",
	show_on_website: false,
	website_sequence: "",
	specialisation: "",
	qualifications: "",
	bio: "",
	additional_campuses: [],
}
const CHECKS = ["is_lecturer", "show_on_website"]
const REQUIRED = { first_name: "First name", last_name: "Last name", email: "Email", campus: "Campus" }

/** /admin/staff/new and /admin/staff/:name/edit */
export default function StaffForm() {
	const { name } = useParams()
	const { hasRole } = useSession()
	if (!hasRole(...CAN.write))
		return (
			<>
				<PageHeader title={name ? "Edit staff member" : "New staff member"} back={{ to: "/admin/staff", label: "Staff" }} />
				<NoAccess message="Only the registrar and college administrators can add or edit staff profiles." />
			</>
		)
	return name ? <EditStaff name={name} /> : <Form />
}

function EditStaff({ name }) {
	const q = useApi(`${API}get_staff`, { name })
	const back = { to: `/admin/staff/${encodeURIComponent(name)}`, label: "Staff member" }
	if (q.isLoading)
		return (
			<>
				<PageHeader title="Edit staff member" back={back} />
				<Panel>
					<SkeletonRows rows={10} />
				</Panel>
			</>
		)
	if (isPermissionError(q.error)) return <NoAccess />
	if (q.isError)
		return (
			<>
				<PageHeader title="Edit staff member" back={back} />
				<Panel>
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</Panel>
			</>
		)
	return <Form staff={q.data} />
}

function Form({ staff }) {
	const navigate = useNavigate()
	const editing = Boolean(staff)
	const lookups = useLookups()
	const L = lookups.data || {}
	const initial = useMemo(() => {
		if (!staff) return { ...EMPTY, date_joined: today() }
		const out = {}
		for (const k of Object.keys(EMPTY)) {
			const v = staff[k]
			if (CHECKS.includes(k)) out[k] = Boolean(Number(v))
			else if (k === "additional_campuses") out[k] = [...(v || [])]
			else if (k === "bio") out[k] = bioToText(v)
			else out[k] = v == null ? "" : String(v)
		}
		return out
	}, [staff])
	const [v, setV] = useState(initial)
	const [createUser, setCreateUser] = useState(true)
	const [errors, setErrors] = useState({})
	const [uploading, setUploading] = useState(false)
	useEffect(() => setV(initial), [initial])

	const field = (k) => ({
		value: v[k],
		onChange: (e) => {
			setV((p) => ({ ...p, [k]: e.target.value }))
			if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }))
		},
		error: errors[k],
	})
	const flag = (k) => ({ checked: v[k], onChange: (c) => setV((p) => ({ ...p, [k]: c })) })

	const save = useAction(`${API}save_staff`, {
		invalidate: [`${API}list_staff`, `${API}get_staff`, `${API}lookups`],
		success: (r, vars) =>
			editing
				? vars.data?.email && staff.user
					? `Staff profile updated. ${r.full_name} now signs in as ${r.user || vars.data.email}.`
					: "Staff profile updated"
				: `${r.full_name} added${r.user && createUser ? ". A sign-in account was created." : ""}`,
		onSuccess: (r) => navigate(`/admin/staff/${encodeURIComponent(r.name)}`, { replace: !editing }),
	})

	const validate = () => {
		const e = {}
		for (const [k, label] of Object.entries(REQUIRED)) if (!String(v[k] || "").trim()) e[k] = `${label} is required`
		if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e.email = "Enter a valid email address"
		if (v.phone && v.phone.replace(/\D/g, "").length < 9) e.phone = "Enter a valid phone number"
		if (v.date_joined && v.date_joined > today()) e.date_joined = "Cannot be in the future"
		if (v.website_sequence !== "" && Number(v.website_sequence) < 0) e.website_sequence = "Use 0 or more"
		setErrors(e)
		return !Object.keys(e).length
	}

	const clean = (k, val) => {
		if (CHECKS.includes(k)) return val ? 1 : 0
		if (k === "additional_campuses") return [...val].filter((c) => c && c !== v.campus).sort()
		if (k === "bio") return textToBio(val)
		if (k === "website_sequence") return val === "" ? 0 : Number(val)
		return typeof val === "string" ? val.trim() : val
	}

	const submit = (ev) => {
		ev.preventDefault()
		if (!validate()) {
			toast.error("Please fix the highlighted fields")
			return
		}
		const payload = {}
		for (const [k, val] of Object.entries(v)) {
			const now = clean(k, val)
			if (editing) {
				const was = k === "bio" ? textToBio(initial.bio) : clean(k, initial[k])
				const same = Array.isArray(now) ? JSON.stringify(now) === JSON.stringify(was) : now === was
				// An untouched bio keeps its original HTML.
				if (!same && !(k === "bio" && val === initial.bio)) payload[k] = now === "" ? null : now
			} else if (now !== "" && now != null && !(Array.isArray(now) && !now.length)) payload[k] = now
		}
		if (editing) {
			if (!Object.keys(payload).length) return toast.info("Nothing has changed")
			save.mutate({ name: staff.name, data: payload })
		} else {
			save.mutate({ data: { ...payload, create_user: createUser ? 1 : 0 } })
		}
	}

	const upload = async (file) => {
		if (!file.type.startsWith("image/")) return toast.error("Choose an image file (JPG or PNG)")
		if (file.size > 3 * 1024 * 1024) return toast.error("The photo must be smaller than 3 MB")
		setUploading(true)
		try {
			// Website profiles need a public photo; everyone else's stays private.
			const res = await frappe.uploadFile(file, !v.show_on_website, editing ? { doctype: "Staff Member", docname: staff.name, fieldname: "photo" } : {})
			setV((p) => ({ ...p, photo: res.file_url }))
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const toggleCampus = (c, on) => setV((p) => ({ ...p, additional_campuses: on ? [...p.additional_campuses, c] : p.additional_campuses.filter((x) => x !== c) }))

	const busy = save.isPending
	const back = editing ? `/admin/staff/${encodeURIComponent(staff.name)}` : "/admin/staff"
	const opt = (rows, value, label) => (rows || []).map((r) => ({ value: r[value], label: r[label] || r[value] }))
	const otherCampuses = (L.campuses || []).filter((c) => c.name !== v.campus)
	const lecturerChanged = editing && v.is_lecturer !== initial.is_lecturer

	return (
		<form onSubmit={submit} noValidate>
			<PageHeader
				back={{ to: back, label: editing ? staff.full_name : "Staff" }}
				eyebrow={editing ? staff.staff_number || staff.name : "People"}
				title={editing ? "Edit staff member" : "New staff member"}
				subtitle={editing ? "Changes apply to the staff profile and, where noted, to their sign-in account." : "Add a lecturer, administrator or support staff member."}
				actions={
					<>
						<Button variant="secondary" onClick={() => navigate(back)} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" icon={editing ? Save : UserPlus} loading={busy}>
							{editing ? "Save changes" : "Add staff member"}
						</Button>
					</>
				}
			/>

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-5 lg:col-span-2">
					<Panel title="Personal details">
						<div className="grid gap-4 sm:grid-cols-6">
							<Select label="Title" placeholder="—" options={SALUTATIONS} className="sm:col-span-2" {...field("salutation")} />
							<Input label="First name" required className="sm:col-span-2" {...field("first_name")} />
							<Input label="Last name" required className="sm:col-span-2" {...field("last_name")} />
							<Input label="Email" type="email" required className="sm:col-span-3" hint={editing && staff.user ? "Changing the email changes their sign-in address and signs them out." : "Work email, also used to sign in"} {...field("email")} />
							<Input label="Phone" type="tel" placeholder="07XX XXX XXX" className="sm:col-span-3" {...field("phone")} />
						</div>
					</Panel>

					<Panel title="Position">
						<div className="grid gap-4 sm:grid-cols-2">
							<Input label="Designation" placeholder="e.g. Senior Lecturer, Accountant" {...field("designation")} />
							<Select label="Staff type" options={STAFF_TYPES} {...field("staff_type")} />
							<Select label="Department" placeholder="No department" options={opt(L.departments, "name", "department_name")} {...field("department")} />
							<Input label="Date joined" type="date" max={today()} {...field("date_joined")} />
							<Select label="Home campus" required placeholder="Select campus…" options={opt(L.campuses, "name", "campus_name")} {...field("campus")} hint="Campus-scoped roles only see records from their campuses." />
							{!editing ? <Select label="Status" options={STAFF_STATUSES} {...field("status")} /> : <div />}
							<div className="sm:col-span-2">
								<div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">Also serves at</div>
								{otherCampuses.length ? (
									<div className="flex flex-wrap gap-x-5 gap-y-2">
										{otherCampuses.map((c) => (
											<Checkbox key={c.name} label={c.campus_name || c.name} checked={v.additional_campuses.includes(c.name)} onChange={(on) => toggleCampus(c.name, on)} />
										))}
									</div>
								) : (
									<p className="text-sm text-ink-soft">Choose a home campus first.</p>
								)}
							</div>
						</div>
					</Panel>

					<Panel title="Teaching">
						<div className="space-y-4">
							<Switch
								label="Teaches courses"
								description="Grants the Lecturer role, so the person appears in lecturer pickers and can use the lecturer portal."
								{...flag("is_lecturer")}
							/>
							{lecturerChanged ? (
								<Alert tone="warning">{v.is_lecturer ? "Saving adds the Lecturer role to their account." : "Saving removes the Lecturer role. Courses they are assigned to keep them listed until you reassign the offering."}</Alert>
							) : null}
							<div className="grid gap-4 sm:grid-cols-2">
								<Input label="Specialisation" placeholder="e.g. New Testament, Church history" {...field("specialisation")} />
								<Textarea label="Qualifications" rows={2} placeholder="One per line" {...field("qualifications")} />
							</div>
						</div>
					</Panel>

					<Panel title="College website">
						<div className="space-y-4">
							<Switch label="Show on the faculty and staff page" description="Publishes the photo, designation and bio on the public website." {...flag("show_on_website")} />
							<div className="grid gap-4 sm:grid-cols-3">
								<Input label="Display order" type="number" min={0} hint="Lower numbers appear first" {...field("website_sequence")} />
								<Textarea label="Bio" rows={5} className="sm:col-span-2" placeholder="A short public profile. Leave a blank line between paragraphs." {...field("bio")} />
							</div>
						</div>
					</Panel>
				</div>

				<aside className="min-w-0 space-y-5">
					<Panel title="Photo">
						<div className="flex flex-col items-center gap-3">
							<Avatar name={`${v.first_name} ${v.last_name}`.trim() || "?"} src={v.photo || undefined} size={96} />
							<FileDrop className="w-full" accept="image/*" hint="JPG or PNG, under 3 MB" onFile={upload} busy={uploading} value={v.photo} />
							{v.show_on_website && String(v.photo || "").startsWith("/private/") ? (
								<Alert tone="warning">This photo is private, so the website cannot show it. Upload it again to publish it.</Alert>
							) : null}
							{v.photo ? (
								<Button size="sm" variant="ghost" icon={Trash2} onClick={() => setV((p) => ({ ...p, photo: "" }))}>
									Remove photo
								</Button>
							) : null}
						</div>
					</Panel>

					<Panel title="Record">
						<div className="space-y-4">
							<Input label="Staff number" placeholder="Generated automatically" {...field("staff_number")} hint={editing ? "Change only to correct a mistake." : "Leave blank to use the next number in the series."} />
							{!editing ? (
								<Checkbox
									label="Create a sign-in account"
									description="Creates a staff login for this email and sends a welcome message. Roles other than Lecturer are assigned by a system manager."
									checked={createUser}
									onChange={setCreateUser}
								/>
							) : staff.user ? (
								<p className="text-sm text-ink-muted">
									Signs in as <span className="font-medium text-ink">{staff.user}</span>.
								</p>
							) : (
								<Alert tone="info">No sign-in account is linked. Saving with an email creates one.</Alert>
							)}
						</div>
					</Panel>
				</aside>
			</div>
		</form>
	)
}
