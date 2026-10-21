import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { BookOpen, CalendarRange, FileQuestion, GraduationCap, Layers, Plus, Save, Trash2, X } from "lucide-react"
import { Alert, Badge, Button, Empty, ErrorState, IconButton, Input, PageHeader, Panel, ProgressBar, Select, SkeletonRows, StatCard, Switch, Tabs, Textarea } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { num } from "@/shared/utils/format"
import { ACAD, BASE, SETUP, WEIGHT_COMPONENTS, fmtScore, nameOptions, rowsOf, useAcademicRoles, useLookups } from "../lib"
import { CoursePicker } from "../components/CoursePicker"
import { Facts, ResultBadge } from "../components/common"

const BLANK = {
	course_code: "",
	course_title: "",
	department: "",
	credits: 3,
	contact_hours: "",
	pass_mark: 40,
	is_active: 1,
	description: "",
	learning_outcomes: "",
	prerequisites: [],
	assessment_weights: [],
}

function fromDoc(d) {
	const out = {}
	for (const k of Object.keys(BLANK)) out[k] = d[k] ?? BLANK[k]
	out.course_code = d.course_code || d.name
	out.prerequisites = (d.prerequisites || []).map((p) => ({ prerequisite: p.prerequisite, prerequisite_title: p.prerequisite_title }))
	out.assessment_weights = (d.assessment_weights || []).map((w) => ({ component: w.component, weight: w.weight, label: w.label || "" }))
	return out
}

function toPayload(f) {
	return {
		...f,
		credits: Number(f.credits || 0),
		contact_hours: f.contact_hours === "" ? 0 : Number(f.contact_hours),
		pass_mark: Number(f.pass_mark || 0),
		is_active: f.is_active ? 1 : 0,
		prerequisites: f.prerequisites.map((p) => p.prerequisite),
		assessment_weights: f.assessment_weights.map((w) => ({ component: w.component, weight: Number(w.weight || 0), label: w.label || "" })),
	}
}

function problems(f, isNew) {
	const p = []
	if (isNew && !f.course_code.trim()) p.push("Enter a course code.")
	if (!f.course_title.trim()) p.push("Enter the course title.")
	if (!(Number(f.credits) > 0)) p.push("Credits must be greater than zero.")
	if (Number(f.pass_mark) < 0 || Number(f.pass_mark) > 100) p.push("Pass mark must be between 0 and 100.")
	const w = f.assessment_weights
	if (w.length) {
		const comps = w.map((r) => r.component)
		if (new Set(comps).size !== comps.length) p.push("Each assessment component can appear only once.")
		if (w.some((r) => !(Number(r.weight) > 0) || Number(r.weight) > 100)) p.push("Every weight must be between 0 and 100.")
		const total = w.reduce((a, r) => a + Number(r.weight || 0), 0)
		if (Math.abs(total - 100) > 0.01) p.push(`Assessment weights must total 100% (currently ${fmtScore(total, 2)}%).`)
	}
	return p
}

function WeightsEditor({ rows, onChange, canEdit }) {
	const total = rows.reduce((a, r) => a + Number(r.weight || 0), 0)
	const unused = WEIGHT_COMPONENTS.filter((c) => !rows.some((r) => r.component === c))
	const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
	const ok = !rows.length || Math.abs(total - 100) < 0.01
	return (
		<>
			{rows.length ? (
				<div className="space-y-2">
					{rows.map((r, i) => (
						<div key={i} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 sm:grid-cols-[10rem_1fr_6rem_auto]">
							<Select aria-label="Component" value={r.component} onChange={(e) => set(i, "component", e.target.value)} options={[r.component, ...unused]} />
							<Input aria-label="Label" placeholder="Label (optional)" value={r.label} onChange={(e) => set(i, "label", e.target.value)} className="order-last col-span-3 sm:order-none sm:col-span-1" />
							<Input aria-label="Weight %" type="number" min="1" max="100" value={r.weight} onChange={(e) => set(i, "weight", e.target.value)} />
							{canEdit ? <IconButton icon={X} label="Remove component" tone="danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} /> : <span />}
						</div>
					))}
				</div>
			) : (
				<p className="rounded-xl bg-cream/70 px-4 py-3 text-sm text-ink-muted">No course-level weights. Offerings fall back to the college defaults unless they set their own.</p>
			)}
			<div className="mt-4">
				<ProgressBar value={Math.min(total, 100)} tone={ok ? "green" : total > 100 ? "red" : "orange"} label={`Total ${fmtScore(total, 2)}% of 100%`} />
			</div>
			{canEdit ? (
				<div className="mt-4 flex flex-wrap gap-2">
					{unused.map((c) => (
						<Button key={c} size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...rows, { component: c, weight: Math.max(0, 100 - total) || "", label: "" }])}>
							{c}
						</Button>
					))}
					{!rows.length ? (
						<Button
							size="sm"
							variant="ghost"
							onClick={() =>
								onChange([
									{ component: "CAT", weight: 20, label: "" },
									{ component: "Assignment", weight: 10, label: "" },
									{ component: "Exam", weight: 70, label: "" },
								])
							}
						>
							Use 20 / 10 / 70
						</Button>
					) : null}
				</div>
			) : null}
		</>
	)
}

export default function CourseDetail() {
	const { code } = useParams()
	const isNew = !code
	const navigate = useNavigate()
	const roles = useAcademicRoles()
	const lookups = useLookups()
	const q = useApi(`${ACAD}get_course`, { code }, { enabled: !isNew })
	const offerings = useApi(`${ACAD}list_offerings`, { search: code, page_length: 200 }, { enabled: !isNew })
	const [form, setForm] = useState(isNew ? BLANK : null)
	const [tab, setTab] = useState("details")
	const [touched, setTouched] = useState(false)

	useEffect(() => {
		if (!isNew && q.data) setForm(fromDoc(q.data))
	}, [q.data?.modified, isNew]) // eslint-disable-line react-hooks/exhaustive-deps

	const baseline = useMemo(() => JSON.stringify(isNew ? BLANK : q.data ? fromDoc(q.data) : {}), [isNew, q.data])
	const dirty = form ? JSON.stringify(form) !== baseline : false
	const issues = form ? problems(form, isNew) : []
	const canEdit = roles.admin
	const mine = rowsOf(offerings.data).filter((o) => o.course === code)

	const save = useAction(`${ACAD}save_course`, {
		invalidate: [ACAD, `${SETUP}lookups`],
		success: isNew ? "Course created" : "Course saved",
		onSuccess: (d) => {
			setTouched(false)
			if (isNew) navigate(`${BASE}/courses/${encodeURIComponent(d.name)}`, { replace: true })
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

	if (!isNew && q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
	if (!form)
		return (
			<>
				<PageHeader title="Course" back={{ to: `${BASE}/courses`, label: "Courses" }} />
				<SkeletonRows rows={8} />
			</>
		)

	const d = q.data || {}
	const set = (k) => (e) => setForm((cur) => ({ ...cur, [k]: e?.target ? e.target.value : e }))
	const prereqCodes = form.prerequisites.map((p) => p.prerequisite)
	const togglePrereq = (c) =>
		setForm({
			...form,
			prerequisites: prereqCodes.includes(c.name) ? form.prerequisites.filter((p) => p.prerequisite !== c.name) : [...form.prerequisites, { prerequisite: c.name, prerequisite_title: c.course_title }],
		})

	const offeringCols = [
		{ key: "academic_term", label: "Term", sortValue: (r) => r.academic_term },
		{ key: "campus", label: "Campus", render: (r) => `${r.campus}${r.study_mode ? ` · ${r.study_mode}` : ""}` },
		{ key: "section", label: "Section", hideOnMobile: true },
		{ key: "lecturers", label: "Lecturers", hideOnMobile: true, render: (r) => (r.lecturers?.length ? r.lecturers.map((l) => l.staff_name).join(", ") : <span className="text-orange-600">Unassigned</span>) },
		{ key: "enrolled_count", label: "Enrolled", align: "right", render: (r) => `${num(r.enrolled_count)}${r.capacity ? ` / ${num(r.capacity)}` : ""}` },
		{ key: "status", label: "Status", render: (r) => <Badge status={r.status} size="xs" /> },
		{ key: "results_status", label: "Results", hideOnMobile: true, render: (r) => <ResultBadge status={r.results_status} /> },
	]

	return (
		<>
			<PageHeader
				back={{ to: `${BASE}/courses`, label: "Courses" }}
				eyebrow={isNew ? "New course" : d.course_code}
				title={isNew ? form.course_title || "New course" : d.course_title}
				actions={
					<>
						{!isNew ? (
							<Link to={`${BASE}/question-bank?course=${encodeURIComponent(code)}`} className="btn btn-secondary">
								<FileQuestion size={16} /> Question bank
							</Link>
						) : null}
						{canEdit ? (
							<>
								{dirty && !isNew ? (
									<Button variant="secondary" onClick={() => setForm(fromDoc(q.data))} disabled={save.isPending}>
										Discard
									</Button>
								) : null}
								<Button icon={Save} loading={save.isPending} disabled={!dirty && !isNew} onClick={submit}>
									{isNew ? "Create course" : "Save changes"}
								</Button>
							</>
						) : null}
					</>
				}
			>
				{!isNew ? (
					<Facts
						items={[
							{ label: "Status", value: <Badge tone={d.is_active ? "green" : "gray"} size="xs">{d.is_active ? "Active" : "Inactive"}</Badge> },
							d.department && { label: "Department", value: d.department },
						]}
					/>
				) : null}
			</PageHeader>

			{!isNew ? (
				<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
					<StatCard label="Credits" icon={GraduationCap} value={fmtScore(d.credits)} hint={d.contact_hours ? `${num(d.contact_hours)} contact hours` : null} tone="gold" />
					<StatCard label="Pass mark" icon={BookOpen} value={`${fmtScore(d.pass_mark)}%`} tone="green" />
					<StatCard label="In programmes" icon={Layers} value={num(d.programmes?.length)} tone="purple" />
					<StatCard label="Offerings" icon={CalendarRange} value={num(d.offering_count)} tone="blue" />
				</div>
			) : null}

			{touched && issues.length ? (
				<Alert tone="error" title="Please fix these before saving" className="mb-4">
					<ul className="list-disc pl-4">
						{issues.map((i) => (
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
					{ id: "rules", label: "Prerequisites & weights", count: form.prerequisites.length || undefined },
					...(isNew
						? []
						: [
								{ id: "offerings", label: "Offerings", count: mine.length },
								{ id: "programmes", label: "Programmes", count: d.programmes?.length || 0 },
							]),
				]}
			/>

			<fieldset disabled={!canEdit} className="min-w-0">
				{tab === "details" ? (
					<div className="grid gap-5 lg:grid-cols-3">
						<Panel title="Course" className="lg:col-span-2">
							<div className="grid gap-4 sm:grid-cols-2">
								{isNew ? (
									<Input label="Course code" required value={form.course_code} onChange={(e) => setForm((cur) => ({ ...cur, course_code: e.target.value.toUpperCase() }))} hint="Permanent, e.g. BTH101" />
								) : (
									<Input label="Course code" value={form.course_code} disabled hint="The code cannot be changed" />
								)}
								<Input label="Course title" required value={form.course_title} onChange={set("course_title")} />
								<Select label="Department" value={form.department || ""} onChange={set("department")} placeholder="None" options={nameOptions(lookups.data?.departments, "department_name")} />
								<Input label="Credits" type="number" min="0.5" step="0.5" required value={form.credits} onChange={set("credits")} />
								<Input label="Contact hours" type="number" min="0" value={form.contact_hours || ""} onChange={set("contact_hours")} />
								<Input label="Pass mark (%)" type="number" min="0" max="100" value={form.pass_mark} onChange={set("pass_mark")} hint="Students below this fail the course" />
							</div>
							<Textarea className="mt-4" label="Description" rows={4} value={form.description || ""} onChange={set("description")} />
							<Textarea className="mt-4" label="Learning outcomes" rows={5} value={form.learning_outcomes || ""} onChange={set("learning_outcomes")} hint="One outcome per line" />
						</Panel>
						<div className="space-y-5">
							<Panel title="Availability">
								<Switch label="Active" description="Inactive courses are skipped when offerings are generated" checked={Boolean(form.is_active)} onChange={(v) => setForm((cur) => ({ ...cur, is_active: v ? 1 : 0 }))} disabled={!canEdit} />
							</Panel>
							{!isNew ? (
								<Panel title="Teaching material" icon={FileQuestion}>
									<p className="text-sm text-ink-muted">Exam questions for this course live in its question bank and are shared by every offering.</p>
									<Link to={`${BASE}/question-bank?course=${encodeURIComponent(code)}`} className="mt-3 inline-flex text-sm font-semibold text-brand-700 hover:underline">
										Open the question bank →
									</Link>
								</Panel>
							) : null}
						</div>
					</div>
				) : null}

				{tab === "rules" ? (
					<div className="grid gap-5 lg:grid-cols-2">
						<Panel title="Prerequisites" subtitle="Students must pass these before registering">
							{form.prerequisites.length ? (
								<ul className="mb-4 divide-y divide-line rounded-xl border border-line">
									{form.prerequisites.map((p) => (
										<li key={p.prerequisite} className="flex items-center gap-2 px-3 py-2">
											<Link to={`${BASE}/courses/${encodeURIComponent(p.prerequisite)}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink hover:text-brand-700">
												{p.prerequisite} · {p.prerequisite_title}
											</Link>
											{canEdit ? <IconButton icon={Trash2} tone="danger" label={`Remove ${p.prerequisite}`} onClick={() => togglePrereq({ name: p.prerequisite })} /> : null}
										</li>
									))}
								</ul>
							) : (
								<p className="mb-4 text-sm text-ink-soft">No prerequisites.</p>
							)}
							{canEdit ? (
								<>
									<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Add a prerequisite</p>
									<CoursePicker selected={prereqCodes} exclude={[code || form.course_code]} onPick={togglePrereq} maxHeight={240} />
								</>
							) : null}
						</Panel>
						<Panel title="Assessment weights" subtitle="How CATs, assignments and the exam add up to 100%">
							<WeightsEditor rows={form.assessment_weights} onChange={(rows) => setForm((cur) => ({ ...cur, assessment_weights: rows }))} canEdit={canEdit} />
						</Panel>
					</div>
				) : null}
			</fieldset>

			{tab === "offerings" ? (
				<>
					<div className="mb-3 flex justify-end">
						<Link to={`${BASE}/offerings?q=${encodeURIComponent(code)}`} className="text-sm font-semibold text-brand-700 hover:underline">
							See in the offerings list →
						</Link>
					</div>
					<DataTable query={offerings} rows={offerings.isLoading || offerings.isError ? undefined : mine} cols={offeringCols} rowTo={(r) => `${BASE}/offerings/${encodeURIComponent(r.name)}`} empty="This course has not been offered yet" emptyIcon={CalendarRange} />
				</>
			) : null}

			{tab === "programmes" ? (
				d.programmes?.length ? (
					<div className="card divide-y divide-line">
						{d.programmes.map((p) => (
							<Link key={p.programme} to={`${BASE}/programmes/${encodeURIComponent(p.programme)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream/50">
								<span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700">
									<GraduationCap size={18} />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block font-semibold text-ink">{(lookups.data?.programmes || []).find((x) => x.name === p.programme)?.programme_name || p.programme}</span>
									<span className="block text-xs text-ink-soft">
										{p.programme} · Year {p.year_of_study}, term {p.term_number}
									</span>
								</span>
								<Badge size="xs" tone={p.course_type === "Core" ? "brand" : "blue"}>
									{p.course_type || "Core"}
								</Badge>
							</Link>
						))}
					</div>
				) : (
					<div className="card">
						<Empty icon={Layers} title="Not part of any programme" subtitle="Add it to a programme's curriculum to have offerings generated." />
					</div>
				)
			) : null}

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
