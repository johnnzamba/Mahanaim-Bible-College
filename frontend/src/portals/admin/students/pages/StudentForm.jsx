import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Save, Trash2, UserPlus } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { Alert, Avatar, Button, Checkbox, ErrorState, FileDrop, Input, PageHeader, Panel, Select, SkeletonRows, Textarea } from "@/shared/components/ui"
import { API, CAN, FEE_CATEGORIES, GENDERS, MARITAL, NoAccess, STUDENTS_FORBIDDEN, isPermissionError, useLookups } from "../lib"

const EMPTY = {
	first_name: "",
	middle_name: "",
	last_name: "",
	gender: "",
	date_of_birth: "",
	marital_status: "",
	national_id: "",
	nationality: "Kenyan",
	email: "",
	phone: "",
	county: "",
	postal_address: "",
	photo: "",
	nok_name: "",
	nok_relationship: "",
	nok_phone: "",
	home_church: "",
	denomination: "",
	pastor_name: "",
	pastor_phone: "",
	ministry_role: "",
	programme: "",
	campus: "",
	study_mode: "",
	intake: "",
	admission_year: "",
	year_of_study: "1",
	current_term: "",
	enrollment_date: "",
	expected_completion: "",
	graduation_date: "",
	fee_category: "Standard",
	student_number: "",
	current_ministry: "",
	current_position: "",
	alumni_consent: false,
}
const REQUIRED = { first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", programme: "Programme", campus: "Campus" }
const NEW_STATUSES = ["Admitted", "Registered", "Active"]

/** /admin/students/new and /admin/students/:name/edit */
export default function StudentForm() {
	const { name } = useParams()
	const { hasRole } = useSession()
	if (!hasRole(...CAN.write)) return <><PageHeader title={name ? "Edit student" : "New student"} back={{ to: "/admin/students", label: "Students" }} /><NoAccess message="Only the registrar and the academic dean can create or edit student records." /></>
	return name ? <EditStudent name={name} /> : <Form />
}

function EditStudent({ name }) {
	const q = useApi(`${API}student_360`, { name })
	if (q.isLoading) return <><PageHeader title="Edit student" back={{ to: `/admin/students/${encodeURIComponent(name)}`, label: "Student" }} /><Panel><SkeletonRows rows={10} /></Panel></>
	if (isPermissionError(q.error)) return <NoAccess message={STUDENTS_FORBIDDEN} />
	if (q.isError) return <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel>
	return <Form profile={q.data.profile} />
}

function Form({ profile }) {
	const navigate = useNavigate()
	const editing = Boolean(profile)
	const lookups = useLookups()
	const L = lookups.data || {}
	const initial = useMemo(() => {
		if (!profile) return { ...EMPTY }
		const out = {}
		for (const k of Object.keys(EMPTY)) {
			const v = profile[k]
			out[k] = k === "alumni_consent" ? Boolean(v) : v == null ? "" : String(v)
		}
		return out
	}, [profile])
	const [v, setV] = useState(initial)
	const [status, setStatus] = useState("Admitted")
	const [createUser, setCreateUser] = useState(true)
	const [errors, setErrors] = useState({})
	const [uploading, setUploading] = useState(false)
	useEffect(() => setV(initial), [initial])

	useEffect(() => {
		if (!editing && !v.current_term && L.current_term) setV((p) => ({ ...p, current_term: L.current_term, admission_year: p.admission_year || L.current_year || "" }))
	}, [editing, L.current_term, L.current_year, v.current_term])

	const field = (k) => ({
		value: v[k],
		onChange: (e) => {
			setV((p) => ({ ...p, [k]: e.target.value }))
			if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }))
		},
		error: errors[k],
	})

	const create = useAction(`${API}create_student`, {
		invalidate: [API],
		success: (r) => `Student ${r.student_number || r.name} created`,
		onSuccess: (r) => navigate(`/admin/students/${encodeURIComponent(r.name)}`, { replace: true }),
	})
	const update = useAction(`${API}update_student`, {
		invalidate: [API],
		success: "Student record updated",
		onSuccess: (r) => navigate(`/admin/students/${encodeURIComponent(r.name)}`),
	})

	const validate = () => {
		const e = {}
		for (const [k, label] of Object.entries(REQUIRED)) if (!String(v[k] || "").trim()) e[k] = `${label} is required`
		if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e.email = "Enter a valid email address"
		if (v.phone && v.phone.replace(/\D/g, "").length < 9) e.phone = "Enter a valid phone number"
		if (v.year_of_study && (Number(v.year_of_study) < 1 || Number(v.year_of_study) > 8)) e.year_of_study = "Between 1 and 8"
		if (v.date_of_birth && v.date_of_birth > new Date().toISOString().slice(0, 10)) e.date_of_birth = "Cannot be in the future"
		setErrors(e)
		return !Object.keys(e).length
	}

	const submit = (ev) => {
		ev.preventDefault()
		if (!validate()) {
			toast.error("Please fix the highlighted fields")
			return
		}
		const payload = {}
		for (const [k, val] of Object.entries(v)) {
			const clean = k === "alumni_consent" ? (val ? 1 : 0) : typeof val === "string" ? val.trim() : val
			if (editing) {
				const was = k === "alumni_consent" ? (initial[k] ? 1 : 0) : initial[k]
				if (clean !== was) payload[k] = clean === "" ? null : clean
			} else if (clean !== "" && clean != null) payload[k] = clean
		}
		if (editing) {
			if (!Object.keys(payload).length) return toast.info("Nothing has changed")
			update.mutate({ name: profile.name, data: payload })
		} else {
			create.mutate({ data: { ...payload, status, create_user: createUser ? 1 : 0 } })
		}
	}

	const upload = async (file) => {
		if (!file.type.startsWith("image/")) return toast.error("Choose an image file (JPG or PNG)")
		if (file.size > 3 * 1024 * 1024) return toast.error("The photo must be smaller than 3 MB")
		setUploading(true)
		try {
			const res = await frappe.uploadFile(file, true, editing ? { doctype: "Student", docname: profile.name, fieldname: "photo" } : {})
			setV((p) => ({ ...p, photo: res.file_url }))
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const busy = create.isPending || update.isPending
	const back = editing ? `/admin/students/${encodeURIComponent(profile.name)}` : "/admin/students"
	const opt = (rows, value, label) => (rows || []).map((r) => ({ value: r[value], label: r[label] || r[value] }))

	return (
		<form onSubmit={submit} noValidate>
			<PageHeader
				back={{ to: back, label: editing ? profile.full_name : "Students" }}
				eyebrow={editing ? profile.student_number || profile.name : "Students"}
				title={editing ? "Edit student" : "New student"}
				subtitle={editing ? "Changes are saved to the student record and logged." : "Create a student record directly, for example a transfer or a returning student."}
				actions={
					<>
						<Button variant="secondary" onClick={() => navigate(back)} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" icon={editing ? Save : UserPlus} loading={busy}>
							{editing ? "Save changes" : "Create student"}
						</Button>
					</>
				}
			/>

			{!editing ? (
				<Alert tone="info" className="mb-5" title="Admitting an applicant?">
					Applicants who apply online get their student record from the application page (Create student record), which keeps their documents and history.
				</Alert>
			) : null}

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 space-y-5 lg:col-span-2">
					<Panel title="Personal details">
						<div className="grid gap-4 sm:grid-cols-3">
							<Input label="First name" required {...field("first_name")} />
							<Input label="Middle name" {...field("middle_name")} />
							<Input label="Last name" required {...field("last_name")} />
							<Select label="Gender" placeholder="Select…" options={GENDERS} {...field("gender")} />
							<Input label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)} {...field("date_of_birth")} />
							<Select label="Marital status" placeholder="Select…" options={MARITAL} {...field("marital_status")} />
							<Input label="National ID / passport" {...field("national_id")} />
							<Input label="Nationality" {...field("nationality")} />
							<Input label="County" {...field("county")} />
						</div>
					</Panel>

					<Panel title="Contact">
						<div className="grid gap-4 sm:grid-cols-2">
							<Input label="Email" type="email" required hint={!editing && createUser ? "Used to sign in to the student portal" : undefined} {...field("email")} />
							<Input label="Phone" type="tel" required placeholder="07XX XXX XXX" {...field("phone")} />
							<Textarea label="Postal address" rows={2} className="sm:col-span-2" {...field("postal_address")} />
						</div>
					</Panel>

					<Panel title="Programme">
						<div className="grid gap-4 sm:grid-cols-3">
							<Select label="Programme" required className="sm:col-span-2" placeholder="Select programme…" options={opt(L.programmes, "name", "programme_name")} {...field("programme")} />
							<Select label="Campus" required placeholder="Select campus…" options={opt(L.campuses, "name", "campus_name")} {...field("campus")} />
							<Select label="Study mode" placeholder="Select…" options={opt(L.study_modes, "name", "study_mode_name")} {...field("study_mode")} />
							<Select label="Intake" placeholder="Select…" options={opt(L.intakes, "name", "intake_name")} {...field("intake")} />
							<Input label="Year of study" type="number" min={1} max={8} {...field("year_of_study")} />
							<Select label="Admission year" placeholder="Select…" options={opt(L.academic_years, "name", "year_name")} {...field("admission_year")} />
							<Select label="Current term" placeholder="Select…" options={opt(L.terms, "name", "term_label")} {...field("current_term")} />
							<Select label="Fee category" options={FEE_CATEGORIES} {...field("fee_category")} />
							<Input label="Enrolment date" type="date" {...field("enrollment_date")} />
							<Input label="Expected completion" type="date" {...field("expected_completion")} />
							{editing ? <Input label="Graduation date" type="date" {...field("graduation_date")} /> : null}
						</div>
					</Panel>

					<Panel title="Next of kin">
						<div className="grid gap-4 sm:grid-cols-3">
							<Input label="Name" {...field("nok_name")} />
							<Input label="Relationship" {...field("nok_relationship")} />
							<Input label="Phone" type="tel" {...field("nok_phone")} />
						</div>
					</Panel>

					<Panel title="Church and ministry">
						<div className="grid gap-4 sm:grid-cols-2">
							<Input label="Home church" {...field("home_church")} />
							<Input label="Denomination" {...field("denomination")} />
							<Input label="Pastor" {...field("pastor_name")} />
							<Input label="Pastor's phone" type="tel" {...field("pastor_phone")} />
							<Input label="Ministry role" className="sm:col-span-2" {...field("ministry_role")} />
						</div>
					</Panel>

					{editing && ["Completed", "Alumni"].includes(profile.status) ? (
						<Panel title="Alumni details">
							<div className="grid gap-4 sm:grid-cols-2">
								<Input label="Current ministry" {...field("current_ministry")} />
								<Input label="Current position" {...field("current_position")} />
								<Checkbox
									className="sm:col-span-2"
									label="Listed in the alumni directory"
									description="The graduate agreed to appear in the alumni directory."
									checked={v.alumni_consent}
									onChange={(c) => setV((p) => ({ ...p, alumni_consent: c }))}
								/>
							</div>
						</Panel>
					) : null}
				</div>

				<aside className="min-w-0 space-y-5">
					<Panel title="Photo">
						<div className="flex flex-col items-center gap-3">
							<Avatar name={`${v.first_name} ${v.last_name}`.trim() || "?"} src={v.photo || undefined} size={96} />
							<FileDrop className="w-full" accept="image/*" hint="JPG or PNG, under 3 MB" onFile={upload} busy={uploading} value={v.photo} />
							{v.photo ? (
								<Button size="sm" variant="ghost" icon={Trash2} onClick={() => setV((p) => ({ ...p, photo: "" }))}>
									Remove photo
								</Button>
							) : null}
						</div>
					</Panel>

					{!editing ? (
						<Panel title="Record">
							<div className="space-y-4">
								<Select label="Starting status" value={status} onChange={(e) => setStatus(e.target.value)} options={NEW_STATUSES} hint="Most new records start as Admitted." />
								<Input label="Student number" placeholder="Generated automatically" {...field("student_number")} hint="Leave blank unless you are keeping a number from the old system." />
								<Checkbox label="Create a portal account" description="Lets the student sign in to the student portal with this email." checked={createUser} onChange={setCreateUser} />
							</div>
						</Panel>
					) : (
						<Panel title="Record">
							<div className="space-y-4">
								<Input label="Student number" {...field("student_number")} hint="Change only to correct a mistake. The number appears on transcripts." />
							</div>
						</Panel>
					)}
				</aside>
			</div>
		</form>
	)
}
