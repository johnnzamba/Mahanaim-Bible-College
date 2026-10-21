import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowDown, ArrowUp, BookOpen, ExternalLink, GraduationCap, Pencil, Plus, Save, Trash2, Users, Wallet } from "lucide-react"
import {
	Alert,
	Badge,
	Button,
	Checkbox,
	Empty,
	FileDrop,
	IconButton,
	Input,
	Modal,
	PageHeader,
	Panel,
	Select,
	SkeletonRows,
	StatCard,
	Switch,
	Tabs,
	Textarea,
	ErrorState,
} from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { money, num } from "@/shared/utils/format"
import { ACAD, BASE, COURSE_TYPES, PROGRAMME_STATUS, SETUP, fmtScore, nameOptions, useAcademicRoles, useLookups } from "../lib"
import { CoursePicker } from "../components/CoursePicker"
import { Facts } from "../components/common"

const BLANK = {
	code: "",
	programme_name: "",
	level: "",
	department: "",
	status: "Active",
	is_published: 0,
	award_title: "",
	image: "",
	duration_years: 3,
	terms_per_year: 2,
	min_credits_to_graduate: "",
	min_cgpa_to_graduate: "",
	application_fee: "",
	indicative_fee_per_term: "",
	minimum_entry: "",
	overview: "",
	description: "",
	entry_requirements: "",
	career_paths: "",
	campuses: [],
	study_modes: [],
	curriculum: [],
}

let seq = 0
const key = () => `row-${++seq}`

function fromDoc(d) {
	const out = {}
	for (const k of Object.keys(BLANK)) out[k] = d[k] ?? BLANK[k]
	out.code = d.code || d.name
	out.campuses = d.campuses || []
	out.study_modes = d.study_modes || []
	out.curriculum = (d.curriculum || []).map((r) => ({ ...r, key: r.name || key() }))
	return out
}

function toPayload(f) {
	const out = {}
	for (const k of Object.keys(BLANK)) if (!["curriculum"].includes(k)) out[k] = f[k]
	for (const k of ["duration_years", "terms_per_year", "min_credits_to_graduate", "min_cgpa_to_graduate", "application_fee", "indicative_fee_per_term"])
		out[k] = f[k] === "" || f[k] == null ? 0 : Number(f[k])
	out.is_published = f.is_published ? 1 : 0
	out.curriculum = f.curriculum.map((r) => ({ course: r.course, year_of_study: Number(r.year_of_study), term_number: Number(r.term_number), course_type: r.course_type || "Core" }))
	return out
}

const strip = (f) => JSON.stringify({ ...f, curriculum: f.curriculum.map(({ key: _k, name: _n, ...r }) => r) })

function problems(f, isNew) {
	const p = []
	if (isNew && !f.code.trim()) p.push("Enter a programme code.")
	if (!f.programme_name.trim()) p.push("Enter the programme name.")
	if (!f.level) p.push("Choose the level.")
	if (!(Number(f.duration_years) > 0)) p.push("Duration must be greater than zero.")
	if (!(Number(f.terms_per_year) >= 1)) p.push("Terms per year must be at least 1.")
	const maxYear = Math.max(1, Math.ceil(Number(f.duration_years || 0) - 1e-9))
	for (const r of f.curriculum) {
		if (Number(r.year_of_study) < 1 || Number(r.year_of_study) > maxYear) p.push(`${r.course}: year of study must be between 1 and ${maxYear}.`)
		if (Number(r.term_number) < 1 || Number(r.term_number) > Number(f.terms_per_year || 1)) p.push(`${r.course}: term must be between 1 and ${f.terms_per_year}.`)
	}
	return p
}

function CurriculumRowDialog({ open, onClose, row, form, onSave }) {
	const [v, setV] = useState(null)
	useEffect(() => {
		if (open) setV(row ? { ...row } : { course: "", course_title: "", credits: 0, year_of_study: 1, term_number: 1, course_type: "Core" })
	}, [open, row])
	if (!open || !v) return null
	const years = Array.from({ length: Math.max(1, Math.ceil(Number(form.duration_years || 1))) }, (_, i) => i + 1)
	const terms = Array.from({ length: Math.max(1, Number(form.terms_per_year || 1)) }, (_, i) => i + 1)
	const used = form.curriculum.filter((r) => r.key !== row?.key).map((r) => r.course)
	return (
		<Modal
			open
			onClose={onClose}
			size="lg"
			title={row ? `Edit ${row.course}` : "Add a course to the curriculum"}
			subtitle="Courses run in the year and term set here; offerings are generated from it."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!v.course}
						onClick={() => {
							onSave(v)
							onClose()
						}}
					>
						{row ? "Update" : "Add course"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{row ? (
					<div className="rounded-xl bg-cream/70 px-4 py-3 text-sm">
						<div className="font-semibold text-ink">
							{v.course} · {v.course_title}
						</div>
						<div className="text-xs text-ink-soft">{fmtScore(v.credits)} credits</div>
					</div>
				) : (
					<>
						<CoursePicker
							autoFocus
							exclude={used}
							selected={v.course ? [v.course] : []}
							onPick={(c) => setV((cur) => ({ ...cur, course: c.name, course_title: c.course_title, credits: c.credits }))}
						/>
						{v.course ? (
							<p className="text-xs text-ink-soft">
								Selected <span className="font-semibold text-ink">{v.course} · {v.course_title}</span>
							</p>
						) : null}
					</>
				)}
				<div className="grid gap-3 sm:grid-cols-3">
					<Select label="Year of study" value={v.year_of_study} onChange={(e) => setV((cur) => ({ ...cur, year_of_study: Number(e.target.value) }))} options={years.map((y) => ({ value: y, label: `Year ${y}` }))} />
					<Select label="Term" value={v.term_number} onChange={(e) => setV((cur) => ({ ...cur, term_number: Number(e.target.value) }))} options={terms.map((t) => ({ value: t, label: `Term ${t}` }))} />
					<Select label="Type" value={v.course_type} onChange={(e) => setV((cur) => ({ ...cur, course_type: e.target.value }))} options={COURSE_TYPES} />
				</div>
			</div>
		</Modal>
	)
}

function Curriculum({ form, setForm, canEdit }) {
	const [dialog, setDialog] = useState(null)
	const rows = form.curriculum
	const years = Math.max(1, Math.ceil(Number(form.duration_years || 1)))
	const terms = Math.max(1, Number(form.terms_per_year || 1))
	const groups = useMemo(() => {
		const out = []
		const seen = new Set()
		for (let y = 1; y <= years; y++)
			for (let t = 1; t <= terms; t++) {
				out.push({ id: `${y}-${t}`, year: y, term: t, rows: rows.filter((r) => Number(r.year_of_study) === y && Number(r.term_number) === t) })
				seen.add(`${y}-${t}`)
			}
		const stray = rows.filter((r) => !seen.has(`${r.year_of_study}-${r.term_number}`))
		if (stray.length) out.push({ id: "stray", stray: true, rows: stray })
		return out
	}, [rows, years, terms])
	const total = rows.reduce((a, r) => a + Number(r.credits || 0), 0)
	const core = rows.filter((r) => (r.course_type || "Core") === "Core").length

	const update = (next) => setForm((cur) => ({ ...cur, curriculum: next }))
	const move = (row, dir) => {
		const same = rows.filter((r) => r.year_of_study === row.year_of_study && r.term_number === row.term_number)
		const i = same.indexOf(row)
		const other = same[i + dir]
		if (!other) return
		const next = [...rows]
		const a = next.indexOf(row)
		const b = next.indexOf(other)
		;[next[a], next[b]] = [next[b], next[a]]
		update(next)
	}
	const save = (v) => {
		if (dialog?.row) update(rows.map((r) => (r.key === dialog.row.key ? { ...v } : r)))
		else update([...rows, { ...v, key: key() }])
	}

	return (
		<>
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap gap-2 text-sm">
					<Badge tone="brand">{rows.length} courses</Badge>
					<Badge tone="gold">{fmtScore(total)} credits</Badge>
					<Badge tone="gray">
						{core} core · {rows.length - core} other
					</Badge>
					{Number(form.min_credits_to_graduate) > 0 ? (
						<Badge tone={total >= Number(form.min_credits_to_graduate) ? "green" : "orange"}>{num(form.min_credits_to_graduate)} needed to graduate</Badge>
					) : null}
				</div>
				{canEdit ? (
					<Button icon={Plus} onClick={() => setDialog({})}>
						Add course
					</Button>
				) : null}
			</div>
			{!rows.length ? (
				<div className="card">
					<Empty icon={BookOpen} title="No courses in this curriculum yet" subtitle="Add the courses students take in each year and term." action={canEdit ? <Button icon={Plus} size="sm" onClick={() => setDialog({})}>Add course</Button> : null} />
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-2">
					{groups.map((g) => {
						const credits = g.rows.reduce((a, r) => a + Number(r.credits || 0), 0)
						return (
							<Panel
								key={g.id}
								title={g.stray ? "Outside the programme's years and terms" : `Year ${g.year} · Term ${g.term}`}
								subtitle={g.rows.length ? `${g.rows.length} course${g.rows.length === 1 ? "" : "s"} · ${fmtScore(credits)} credits` : "No courses"}
								bodyClass="p-0"
								className={g.stray ? "border-red-300" : undefined}
								actions={
									canEdit && !g.stray ? (
										<IconButton icon={Plus} label={`Add to year ${g.year} term ${g.term}`} onClick={() => setDialog({ preset: { year_of_study: g.year, term_number: g.term } })} />
									) : null
								}
							>
								{g.rows.length ? (
									<ul className="divide-y divide-line">
										{g.rows.map((r, i) => (
											<li key={r.key} className="flex items-center gap-2 px-4 py-2.5">
												<div className="min-w-0 flex-1">
													<Link to={`${BASE}/courses/${encodeURIComponent(r.course)}`} className="block truncate text-sm font-semibold text-ink hover:text-brand-700">
														{r.course} · {r.course_title}
													</Link>
													<div className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
														<span>{fmtScore(r.credits)} credits</span>
														<Badge size="xs" tone={(r.course_type || "Core") === "Core" ? "brand" : r.course_type === "Elective" ? "blue" : "purple"}>
															{r.course_type || "Core"}
														</Badge>
													</div>
												</div>
												{canEdit ? (
													<div className="flex shrink-0 items-center">
														<IconButton icon={ArrowUp} label="Move up" disabled={i === 0 || g.stray} onClick={() => move(r, -1)} className="disabled:opacity-30" />
														<IconButton icon={ArrowDown} label="Move down" disabled={i === g.rows.length - 1 || g.stray} onClick={() => move(r, 1)} className="disabled:opacity-30" />
														<IconButton icon={Pencil} label="Change year, term or type" onClick={() => setDialog({ row: r })} />
														<IconButton icon={Trash2} label="Remove from curriculum" tone="danger" onClick={() => update(rows.filter((x) => x.key !== r.key))} />
													</div>
												) : null}
											</li>
										))}
									</ul>
								) : (
									<p className="px-4 py-4 text-xs text-ink-soft">Nothing scheduled in this term.</p>
								)}
							</Panel>
						)
					})}
				</div>
			)}
			<CurriculumRowDialog
				open={Boolean(dialog)}
				onClose={() => setDialog(null)}
				row={dialog?.row || (dialog?.preset ? { key: "__new", course: "", course_title: "", credits: 0, course_type: "Core", ...dialog.preset } : null)}
				form={form}
				onSave={(v) => {
					if (v.key === "__new") {
						const { key: _k, ...rest } = v
						update([...rows, { ...rest, key: key() }])
					} else save(v)
				}}
			/>
		</>
	)
}

export default function ProgrammeDetail() {
	const { code } = useParams()
	const isNew = !code
	const navigate = useNavigate()
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const L = lookups.data
	const q = useApi(`${ACAD}get_programme`, { code }, { enabled: !isNew })
	const [form, setForm] = useState(isNew ? BLANK : null)
	const [tab, setTab] = useState("details")
	const [touched, setTouched] = useState(false)
	const [uploading, setUploading] = useState(false)

	// Reset the form only when the server copy actually changes, not on every background refetch.
	useEffect(() => {
		if (!isNew && q.data) setForm(fromDoc(q.data))
	}, [q.data?.modified, isNew]) // eslint-disable-line react-hooks/exhaustive-deps

	const baseline = useMemo(() => (isNew ? strip(BLANK) : q.data ? strip(fromDoc(q.data)) : ""), [isNew, q.data])
	const dirty = form ? strip(form) !== baseline : false
	const issues = form ? problems(form, isNew) : []
	const canEdit = roles.admin

	const save = useAction(`${ACAD}save_programme`, {
		invalidate: [ACAD, `${SETUP}lookups`],
		success: isNew ? "Programme created" : "Programme saved",
		onSuccess: (d) => {
			setTouched(false)
			if (isNew) navigate(`${BASE}/programmes/${encodeURIComponent(d.name)}`, { replace: true })
			else setForm(fromDoc(d))
		},
	})
	const submit = () => {
		setTouched(true)
		if (issues.length) {
			toast.error(issues[0])
			return
		}
		save.mutate({ data: toPayload(form), name: isNew ? undefined : code })
	}
	const upload = async (file) => {
		setUploading(true)
		try {
			const f = await frappe.uploadFile(file, false, isNew ? {} : { doctype: "Programme", docname: code, fieldname: "image" })
			setForm((s) => ({ ...s, image: f.file_url }))
		} catch (e) {
			toast.error(e.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	if (!isNew && q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	if (!form)
		return (
			<>
				<PageHeader title="Programme" back={{ to: `${BASE}/programmes`, label: "Programmes" }} />
				<SkeletonRows rows={8} />
			</>
		)

	const set = (k) => (e) => setForm((cur) => ({ ...cur, [k]: e?.target ? e.target.value : e }))
	const toggleIn = (k, v) => setForm((cur) => ({ ...cur, [k]: form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v] }))
	const d = q.data || {}
	const credits = form.curriculum.reduce((a, r) => a + Number(r.credits || 0), 0)

	return (
		<>
			<PageHeader
				back={{ to: `${BASE}/programmes`, label: "Programmes" }}
				eyebrow={isNew ? "New programme" : `${d.code || code} · ${d.level || ""}`}
				title={isNew ? form.programme_name || "New programme" : d.programme_name}
				actions={
					canEdit ? (
						<>
							{dirty && !isNew ? (
								<Button variant="secondary" onClick={() => setForm(fromDoc(q.data))} disabled={save.isPending}>
									Discard
								</Button>
							) : null}
							<Button icon={Save} loading={save.isPending} disabled={!dirty && !isNew} onClick={submit}>
								{isNew ? "Create programme" : "Save changes"}
							</Button>
						</>
					) : null
				}
			>
				{!isNew ? (
					<Facts
						items={[
							{ label: "Status", value: <Badge status={d.status} size="xs" /> },
							d.is_published ? { label: "Listed on the website" } : { label: "Not on the website" },
							d.department && { label: "Department", value: d.department },
						]}
					/>
				) : null}
			</PageHeader>

			{!isNew ? (
				<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
					<StatCard label="Active students" icon={Users} value={num(d.student_count)} to={`/admin/students?programme=${encodeURIComponent(code)}`} />
					<StatCard label="Courses" icon={BookOpen} value={num(form.curriculum.length)} tone="purple" />
					<StatCard label="Credits" icon={GraduationCap} value={fmtScore(credits)} hint={Number(form.min_credits_to_graduate) ? `${num(form.min_credits_to_graduate)} to graduate` : null} tone="gold" />
					<StatCard label="Application fee" icon={Wallet} value={form.application_fee ? money(form.application_fee) : "—"} hint={form.indicative_fee_per_term ? `${money(form.indicative_fee_per_term)} per term` : null} tone="green" />
				</div>
			) : null}

			{touched && issues.length ? (
				<Alert tone="error" title="Please fix these before saving" className="mb-4">
					<ul className="list-disc pl-4">
						{issues.slice(0, 6).map((i) => (
							<li key={i}>{i}</li>
						))}
					</ul>
				</Alert>
			) : null}

			<Tabs
				className="mb-5"
				active={tab}
				onChange={setTab}
				tabs={[
					{ id: "details", label: "Details" },
					{ id: "curriculum", label: "Curriculum", count: form.curriculum.length },
					{ id: "entry", label: "Entry & careers" },
					{ id: "delivery", label: "Campuses & modes", count: form.campuses.length + form.study_modes.length },
				]}
			/>

			<fieldset disabled={!canEdit} className="min-w-0">
				{tab === "details" ? (
					<div className="grid gap-5 lg:grid-cols-3">
						<Panel title="Programme" className="lg:col-span-2">
							<div className="grid gap-4 sm:grid-cols-2">
								{isNew ? <Input label="Programme code" required value={form.code} onChange={(e) => setForm((cur) => ({ ...cur, code: e.target.value.toUpperCase() }))} hint="Short and permanent, e.g. DTH or BTH" /> : <Input label="Programme code" value={form.code} disabled hint="The code cannot be changed" />}
								<Input label="Programme name" required value={form.programme_name} onChange={set("programme_name")} />
								<Select label="Level" required value={form.level} onChange={set("level")} placeholder="Choose…" options={L?.options?.programme_level || []} />
								<Select label="Department" value={form.department} onChange={set("department")} placeholder="None" options={nameOptions(L?.departments, "department_name")} />
								<Input label="Award title" value={form.award_title} onChange={set("award_title")} hint="As printed on the certificate" />
								<Select label="Status" value={form.status} onChange={set("status")} options={PROGRAMME_STATUS} />
								<Input label="Duration (years)" type="number" min="0.5" step="0.5" required value={form.duration_years} onChange={set("duration_years")} />
								<Input label="Terms per year" type="number" min="1" max="4" required value={form.terms_per_year} onChange={set("terms_per_year")} />
								<Input label="Credits to graduate" type="number" min="0" value={form.min_credits_to_graduate} onChange={set("min_credits_to_graduate")} />
								<Input label="Minimum CGPA to graduate" type="number" min="0" step="0.01" value={form.min_cgpa_to_graduate} onChange={set("min_cgpa_to_graduate")} />
							</div>
							<Textarea className="mt-4" label="Overview" rows={2} value={form.overview || ""} onChange={set("overview")} hint="One or two sentences for programme cards" />
							<Textarea className="mt-4" label="Description" rows={5} value={form.description || ""} onChange={set("description")} />
						</Panel>
						<div className="space-y-5">
							<Panel title="Website">
								<Switch label="Show on the public website" description="Listed under Programmes with an Apply button" checked={Boolean(form.is_published)} onChange={(v) => setForm((cur) => ({ ...cur, is_published: v ? 1 : 0 }))} disabled={!canEdit} />
								<FileDrop className="mt-4" label="Programme image" accept="image/*" busy={uploading} value={form.image} onFile={upload} />
								{form.image ? <img src={form.image} alt="" className="mt-3 aspect-video w-full rounded-xl object-cover" /> : null}
							</Panel>
							<Panel title="Fees" icon={Wallet}>
								<div className="space-y-4">
									<Input label="Application fee" type="number" min="0" value={form.application_fee} onChange={set("application_fee")} hint="Leave blank to use the college default" />
									<Input label="Indicative fee per term" type="number" min="0" value={form.indicative_fee_per_term} onChange={set("indicative_fee_per_term")} hint="Shown to applicants; billing uses fee structures" />
								</div>
								{!isNew ? (
									<Link to={`/admin/finance/fee-structures?programme=${encodeURIComponent(code)}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
										Fee structures for this programme <ExternalLink size={14} />
									</Link>
								) : null}
							</Panel>
						</div>
					</div>
				) : null}

				{tab === "curriculum" ? <Curriculum form={form} setForm={setForm} canEdit={canEdit} /> : null}

				{tab === "entry" ? (
					<div className="grid gap-5 lg:grid-cols-2">
						<Panel title="Entry requirements">
							<Input label="Minimum entry" value={form.minimum_entry || ""} onChange={set("minimum_entry")} hint="Short summary, e.g. KCSE C (plain)" />
							<Textarea className="mt-4" label="Full entry requirements" rows={8} value={form.entry_requirements || ""} onChange={set("entry_requirements")} />
						</Panel>
						<Panel title="Career paths">
							<Textarea label="Where graduates go" rows={11} value={form.career_paths || ""} onChange={set("career_paths")} hint="Shown on the programme page" />
						</Panel>
					</div>
				) : null}

				{tab === "delivery" ? (
					<div className="grid gap-5 lg:grid-cols-2">
						<Panel title="Campuses" subtitle="Leave all unticked to offer it at every campus">
							<div className="space-y-3">
								{(L?.campuses || []).map((c) => (
									<Checkbox key={c.name} label={c.campus_name || c.name} description={c.town || (c.is_main_campus ? "Main campus" : null)} checked={form.campuses.includes(c.name)} onChange={() => toggleIn("campuses", c.name)} disabled={!canEdit} />
								))}
							</div>
						</Panel>
						<Panel title="Study modes" subtitle="Leave all unticked to allow every mode">
							<div className="space-y-3">
								{(L?.study_modes || []).map((m) => (
									<Checkbox key={m.name} label={m.study_mode_name || m.name} description={m.is_online ? "Online" : null} checked={form.study_modes.includes(m.name)} onChange={() => toggleIn("study_modes", m.name)} disabled={!canEdit} />
								))}
							</div>
						</Panel>
					</div>
				) : null}
			</fieldset>

			{canEdit && dirty ? (
				<div className="sticky bottom-4 z-30 mx-auto mt-6 flex w-fit max-w-full animate-fade-up items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lift">
					<span className="text-sm font-semibold text-ink">Unsaved changes</span>
					<Button size="sm" icon={Save} loading={save.isPending} onClick={submit}>
						{isNew ? "Create" : "Save"}
					</Button>
				</div>
			) : null}
		</>
	)
}
