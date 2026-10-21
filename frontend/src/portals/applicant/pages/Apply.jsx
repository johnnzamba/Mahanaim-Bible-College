import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import clsx from "clsx"
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, CloudOff, LayoutDashboard, Save, Send, Smartphone } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { Alert, Button, ErrorState, PageHeader, Panel, Skeleton, Spinner } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { useSession } from "@/shared/session"
import { date, money } from "@/shared/utils/format"
import { INVALIDATE, M, WIZARD_STEPS, docChecklist, since } from "../lib"
import { useApplication, useMyApplications, useOptions } from "../hooks"
import { AppStatus } from "../components/AppStatus"
import { DocChecklist } from "../components/DocChecklist"
import { JourneyTrack } from "../components/JourneyTrack"
import { PayFeeDialog } from "../components/PayFeeDialog"
import { years } from "../components/ProgrammeCard"
import { EMPTY_RECORD, toForm, toPayload, toRecords, validateStep } from "../components/wizard/fields"
import { StepProgramme } from "../components/wizard/StepProgramme"
import { StepPersonal } from "../components/wizard/StepPersonal"
import { StepChurch } from "../components/wizard/StepChurch"
import { StepAcademic } from "../components/wizard/StepAcademic"
import { StepDocuments } from "../components/wizard/StepDocuments"
import { StepReview } from "../components/wizard/StepReview"

const STEP_META = [
	{ title: "Programme & intake", text: "Choose what, where and when you'd like to study." },
	{ title: "Personal details", text: "Tell us about yourself and who we can contact in an emergency." },
	{ title: "Church & references", text: "Your faith, home church and pastor's reference." },
	{ title: "Academic background", text: "Your highest qualification and the schools you've attended." },
	{ title: "Documents", text: "Upload your ID, passport photo, certificates and recommendation." },
	{ title: "Review & submit", text: "Check everything, accept the declaration and submit." },
]
const LAST = WIZARD_STEPS.length - 1

export default function Apply() {
	const [params, setParams] = useSearchParams()
	const appName = params.get("application")
	const [created, setCreated] = useState(null)
	const [nonce, setNonce] = useState(0)
	const options = useOptions()

	// Navigating to a fresh /applicant/apply after creating a draft here starts a new wizard.
	useEffect(() => {
		if (!appName && created) {
			setCreated(null)
			setNonce((n) => n + 1)
		}
	}, [appName, created])

	const onCreated = useCallback(
		(name, step) => {
			setCreated(name)
			setParams({ application: name, step: String(step) }, { replace: true })
		},
		[setParams]
	)

	const key = appName && appName !== created ? appName : `new-${nonce}`
	return (
		<>
			{options.isLoading ? (
				<WizardSkeleton />
			) : options.isError ? (
				<ErrorState error={options.error} onRetry={() => options.refetch()} />
			) : (
				<WizardLoader key={key} name={appName && appName !== created ? appName : null} options={options.data} onCreated={onCreated} />
			)}
		</>
	)
}

function WizardSkeleton() {
	return (
		<div className="space-y-5">
			<Skeleton className="h-16 w-2/3" />
			<Skeleton className="h-10" />
			<Skeleton className="h-96" />
		</div>
	)
}

/** Loads a draft once (a snapshot), so later cache updates never unmount a wizard in progress. */
function WizardLoader({ name, options, onCreated }) {
	const q = useApplication(name)
	const snap = useRef(null)
	if (name && !snap.current) {
		if (q.isLoading) return <WizardSkeleton />
		if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't open this application" />
		snap.current = q.data
	}
	const initial = name ? snap.current : null
	if (initial && initial.status !== "Draft") return <NotEditable app={initial} />
	return <Wizard initial={initial} options={options} onCreated={onCreated} />
}

function NotEditable({ app }) {
	return (
		<>
			<PageHeader title="Application already submitted" back={{ to: "/applicant", label: "Dashboard" }} />
			<Alert
				tone="info"
				title={`${app.name} · ${app.programme_name}`}
				action={
					<Link to={`/applicant/application/${app.name}`} className="btn btn-primary btn-sm">
						View application
					</Link>
				}
			>
				This application is <AppStatus status={app.status} size="xs" /> and can no longer be edited. You can still upload documents from its page while it's being reviewed.
			</Alert>
		</>
	)
}

function prefill(session, options, programmeParam) {
	const parts = String(session.full_name || "").trim().split(/\s+/).filter(Boolean)
	const code = String(programmeParam || "").toLowerCase()
	const prog = code ? (options?.programmes || []).find((p) => String(p.name).toLowerCase() === code || String(p.code || "").toLowerCase() === code) : null
	const intakes = options?.intakes || []
	return toForm({
		first_name: parts[0] || "",
		middle_name: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
		last_name: parts.length > 1 ? parts[parts.length - 1] : "",
		email: session.email || session.user,
		phone: session.phone || "",
		programme: prog?.name || "",
		campus: prog?.campuses?.length === 1 ? prog.campuses[0] : "",
		study_mode: prog?.study_modes?.length === 1 ? prog.study_modes[0] : "",
		intake: intakes.length === 1 ? intakes[0].name : "",
	})
}

function resumeStep(app, options) {
	const f = toForm(app)
	const r = toRecords(app.academic_records)
	for (let s = 0; s < 4; s++) if (Object.keys(validateStep(s, f, r, options)).length) return s
	return docChecklist(app, options).missing.length ? 4 : LAST
}

function Wizard({ initial, options, onCreated }) {
	const session = useSession()
	const navigate = useNavigate()
	const qc = useQueryClient()
	const invalidate = useInvalidate()
	const [params, setParams] = useSearchParams()
	const list = useMyApplications()

	const [name, setName] = useState(initial?.name || null)
	const [server, setServer] = useState(initial)
	const [form, setForm] = useState(() => (initial ? toForm(initial) : prefill(session, options, params.get("programme"))))
	const [records, setRecordsState] = useState(() => (initial?.academic_records?.length ? toRecords(initial.academic_records) : [{ ...EMPTY_RECORD }]))
	const [step, setStep] = useState(() => {
		if (!initial) return 0
		const asked = Number(params.get("step"))
		return Number.isInteger(asked) && asked >= 0 && asked <= LAST && params.get("step") !== null ? asked : resumeStep(initial, options)
	})
	const [errors, setErrors] = useState({})
	const [dirty, setDirty] = useState(false)
	const [saving, setSaving] = useState(false)
	const [savedAt, setSavedAt] = useState(initial?.modified || null)
	const [saveError, setSaveError] = useState("")
	const [docError, setDocError] = useState("")
	const [declared, setDeclared] = useState(false)
	const [declError, setDeclError] = useState("")
	const [submitting, setSubmitting] = useState(false)
	const [submitError, setSubmitError] = useState("")
	const [submitted, setSubmitted] = useState(null)
	const [paying, setPaying] = useState(false)
	const [paid, setPaid] = useState(false)

	const live = useRef({})
	live.current = { form, records, name, server, step }
	const version = useRef(0)
	const savedVersion = useRef(0)
	const chain = useRef(Promise.resolve())

	const markDirty = () => {
		version.current += 1
		setDirty(true)
	}
	const set = useCallback((field, value) => {
		setForm((f) => ({ ...f, [field]: value }))
		version.current += 1
		setDirty(true)
		setErrors((e) => {
			if (!e[field]) return e
			const n = { ...e }
			delete n[field]
			return n
		})
	}, [])
	const setRecords = (fn) => {
		setRecordsState(fn)
		markDirty()
	}

	/** Serialised save: creates the draft on first call, then updates it. Resolves to the server doc. */
	const persist = useCallback(
		({ force = false } = {}) => {
			const run = async () => {
				const { form: f, records: r, name: n, server: s, step: st } = live.current
				if (!force && n && version.current === savedVersion.current) return s
				const at = version.current
				setSaving(true)
				setSaveError("")
				try {
					const data = toPayload(f, r)
					const res = await frappe.call(M.save, n ? { name: n, data } : { data })
					savedVersion.current = at
					if (version.current === at) setDirty(false)
					setServer(res)
					setSavedAt(new Date())
					qc.setQueryData([M.get, { name: res.name }], res)
					invalidate(M.list)
					if (!n) {
						live.current.name = res.name
						setName(res.name)
						onCreated?.(res.name, Math.min(st + 1, LAST))
					}
					return res
				} catch (err) {
					setSaveError(err.message)
					throw err
				} finally {
					setSaving(false)
				}
			}
			chain.current = chain.current.then(run, run)
			return chain.current
		},
		[qc, invalidate, onCreated]
	)

	// Quiet autosave a few seconds after typing stops (only once the draft exists).
	useEffect(() => {
		if (!dirty || !name || submitted) return undefined
		const t = setTimeout(() => persist().catch(() => {}), 5000)
		return () => clearTimeout(t)
	}, [form, records, dirty, name, submitted, persist])

	// Flush unsaved edits when leaving the page.
	useEffect(
		() => () => {
			if (live.current.name && version.current !== savedVersion.current) persist().catch(() => {})
		},
		[] // eslint-disable-line react-hooks/exhaustive-deps
	)

	const go = (i) => {
		setStep(i)
		setErrors({})
		setDocError("")
		window.scrollTo({ top: 0, behavior: "smooth" })
		if (live.current.name) {
			setParams(
				(p) => {
					const n = new URLSearchParams(p)
					n.set("application", live.current.name)
					n.set("step", String(i))
					n.delete("programme")
					return n
				},
				{ replace: true }
			)
		}
	}

	const focusFirstError = () =>
		setTimeout(() => {
			const el = document.querySelector("main .border-red-400")
			el?.focus?.()
			el?.scrollIntoView?.({ block: "center", behavior: "smooth" })
		}, 30)

	const next = async () => {
		const e = validateStep(step, form, records, options)
		if (Object.keys(e).length) {
			setErrors(e)
			focusFirstError()
			return
		}
		if (step === 4) {
			const cl = docChecklist(server, options)
			if (cl.missing.length) {
				setDocError(`Please upload: ${cl.missing.map((m) => m.label).join(", ")}.`)
				return
			}
		}
		try {
			await persist({ force: !name })
		} catch {
			return
		}
		go(Math.min(step + 1, LAST))
	}

	const back = () => {
		persist().catch(() => {})
		go(Math.max(step - 1, 0))
	}

	const jump = (i) => {
		if (i === step) return
		if (name) persist().catch(() => {})
		go(i)
	}

	const saveAndExit = async () => {
		if (!name) {
			const e = validateStep(0, form, records, options)
			if (Object.keys(e).length) {
				setStep(0)
				setErrors(e)
				return
			}
		}
		try {
			await persist({ force: !name })
			toast.success("Draft saved — you can continue any time")
			navigate("/applicant")
		} catch {
			/* error shown in the indicator */
		}
	}

	const submit = async () => {
		if (!declared) {
			setDeclError("Please accept the declaration to submit your application.")
			return
		}
		setSubmitting(true)
		setSubmitError("")
		try {
			await persist()
			const res = await frappe.call(M.submit, { name, declaration_accepted: 1 })
			qc.setQueryData([M.get, { name }], res)
			invalidate(...INVALIDATE)
			setSubmitted(res)
			window.scrollTo({ top: 0, behavior: "smooth" })
			if (res.awaiting_fee) setPaying(true)
		} catch (err) {
			setSubmitError(err.message)
		} finally {
			setSubmitting(false)
		}
	}

	const prog = options.programmes?.find((p) => p.name === form.programme)
	const existingDraft = !name
		? (list.data?.data || []).find((a) => a.status === "Draft" && a.programme === form.programme && (!form.intake || !a.intake || a.intake === form.intake))
		: null
	const missingForSubmit = (server?.missing || []).filter((m) => m !== "Declaration")

	if (submitted) {
		return <Submitted app={submitted} paying={paying} setPaying={setPaying} paid={paid} setPaid={setPaid} />
	}

	const meta = STEP_META[step]
	return (
		<>
			<PageHeader
				eyebrow={name ? `Draft ${name}` : "New application"}
				title={initial ? "Continue your application" : "Apply to Mahanaim"}
				subtitle={prog ? `${prog.programme_name}${form.intake ? ` · ${form.intake}` : ""}` : "It takes about 20 minutes. Your progress is saved as you go."}
				back={{ to: "/applicant", label: "Dashboard" }}
				actions={<SaveIndicator saving={saving} error={saveError} dirty={dirty} savedAt={savedAt} hasDraft={Boolean(name)} />}
			/>
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),300px]">
				<div className="card min-w-0 overflow-hidden">
					<div className="border-b border-line px-4 pt-4 sm:px-6">
						<JourneyTrack
							caption={false}
							onStep={jump}
							steps={WIZARD_STEPS.map((l, i) => ({ key: l, short: l, label: l, status: i < step ? "done" : i === step ? "current" : "pending" }))}
						/>
						<div className="py-4">
							<div className="text-xs font-semibold text-gold-700">
								Step {step + 1} of {WIZARD_STEPS.length}
							</div>
							<h2 className="font-serif text-xl text-ink">{meta.title}</h2>
							<p className="text-sm text-ink-muted">{meta.text}</p>
						</div>
					</div>
					<form
						noValidate
						onSubmit={(e) => {
							e.preventDefault()
							if (step < LAST) next()
						}}
						className="px-4 py-5 sm:px-6"
					>
						{saveError && !saving ? (
							<Alert tone="error" title="We couldn't save your application" className="mb-5">
								{saveError}
							</Alert>
						) : null}
						{existingDraft && step === 0 ? (
							<Alert
								tone="info"
								className="mb-5"
								title="You already have a draft for this programme"
								action={
									<Link to={`/applicant/apply?application=${existingDraft.name}`} className="btn btn-secondary btn-sm">
										Continue {existingDraft.name}
									</Link>
								}
							>
								Pick up where you left off instead of starting again.
							</Alert>
						) : null}
						{step === 0 ? <StepProgramme form={form} set={set} errors={errors} options={options} /> : null}
						{step === 1 ? <StepPersonal form={form} set={set} errors={errors} /> : null}
						{step === 2 ? <StepChurch form={form} set={set} errors={errors} /> : null}
						{step === 3 ? <StepAcademic form={form} set={set} errors={errors} records={records} setRecords={setRecords} /> : null}
						{step === 4 ? (
							<StepDocuments
								app={server}
								options={options}
								error={docError}
								onChanged={(doc) => {
									if (doc?.name) {
										setServer(doc)
										qc.setQueryData([M.get, { name: doc.name }], doc)
										setDocError("")
									}
								}}
							/>
						) : null}
						{step === LAST ? (
							<StepReview
								form={form}
								records={records}
								app={server}
								options={options}
								onEdit={jump}
								declared={declared}
								setDeclared={(v) => {
									setDeclared(v)
									setDeclError("")
								}}
								error={declError}
							/>
						) : null}
						{submitError ? (
							<Alert tone="error" title="Your application wasn't submitted" className="mt-5">
								{submitError}
							</Alert>
						) : null}
						{Object.keys(errors).length ? (
							<p className="mt-5 flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-300" role="alert">
								<CircleAlert size={16} aria-hidden /> Please fix the highlighted fields to continue.
							</p>
						) : null}

						<div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
							{step > 0 ? (
								<Button variant="secondary" icon={ArrowLeft} onClick={back}>
									Back
								</Button>
							) : null}
							<Button variant="ghost" icon={Save} onClick={saveAndExit} disabled={saving || submitting} className="hidden sm:inline-flex">
								Save & finish later
							</Button>
							<span className="flex-1" />
							{step < LAST ? (
								<Button type="submit" iconRight={ArrowRight} loading={saving && !name}>
									{step === 0 && !name ? "Save & continue" : "Continue"}
								</Button>
							) : (
								<Button variant="gold" icon={Send} onClick={submit} loading={submitting} disabled={missingForSubmit.length > 0}>
									Submit application
								</Button>
							)}
							<Button variant="ghost" size="sm" icon={Save} onClick={saveAndExit} disabled={saving || submitting} className="basis-full justify-center sm:hidden">
								Save & finish later
							</Button>
						</div>
					</form>
				</div>
				<aside className="hidden space-y-5 lg:block" aria-label="Application summary">
					<SummaryPanel form={form} prog={prog} server={server} options={options} />
				</aside>
			</div>
		</>
	)
}

function SaveIndicator({ saving, error, dirty, savedAt, hasDraft }) {
	if (saving)
		return (
			<span className="inline-flex items-center gap-2 text-sm text-ink-muted" aria-live="polite">
				<Spinner size={14} /> Saving…
			</span>
		)
	if (error)
		return (
			<span className="inline-flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-300" aria-live="polite">
				<CloudOff size={15} /> Not saved
			</span>
		)
	if (!hasDraft) return <span className="text-sm text-ink-soft">Not saved yet</span>
	if (dirty) return <span className="text-sm text-ink-soft" aria-live="polite">Unsaved changes</span>
	return (
		<span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300" aria-live="polite">
			<Check size={15} strokeWidth={3} /> Saved{savedAt ? ` · ${since(savedAt)}` : ""}
		</span>
	)
}

function SummaryPanel({ form, prog, server, options }) {
	const checklist = server ? docChecklist(server, options) : null
	return (
		<>
			<Panel title="Your application">
				{prog ? (
					<dl className="space-y-2.5 text-sm">
						<div>
							<dt className="text-xs text-ink-soft">Programme</dt>
							<dd className="font-semibold text-ink">{prog.programme_name}</dd>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<dt className="text-xs text-ink-soft">Duration</dt>
								<dd className="text-ink">{years(prog.duration_years)}</dd>
							</div>
							<div>
								<dt className="text-xs text-ink-soft">Application fee</dt>
								<dd className="text-ink">{money(server?.application_fee ?? prog.application_fee)}</dd>
							</div>
						</div>
						{form.campus ? (
							<div>
								<dt className="text-xs text-ink-soft">Campus · mode</dt>
								<dd className="text-ink">{[form.campus, form.study_mode].filter(Boolean).join(" · ")}</dd>
							</div>
						) : null}
						{form.intake ? (
							<div>
								<dt className="text-xs text-ink-soft">Intake</dt>
								<dd className="text-ink">{form.intake}</dd>
							</div>
						) : null}
					</dl>
				) : (
					<p className="text-sm text-ink-soft">Choose a programme to see its details here.</p>
				)}
			</Panel>
			{checklist ? (
				<Panel title="Documents">
					<DocChecklist checklist={checklist} compact />
				</Panel>
			) : null}
			<div className="rounded-2xl border border-line bg-cream/50 p-4 text-xs text-ink-muted">
				<div className="mb-1 font-semibold text-ink">Good to know</div>
				Your answers save automatically. You can leave at any time and continue from the dashboard.
			</div>
		</>
	)
}

function Submitted({ app, paying, setPaying, paid, setPaid }) {
	const needsFee = app.awaiting_fee && !paid
	return (
		<div className="mx-auto w-full max-w-2xl space-y-5 py-4">
			<div className="card overflow-hidden text-center">
				<div className="hero-wash relative px-6 py-8 text-white">
					<span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15">
						<CheckCircle2 size={34} aria-hidden />
					</span>
					<h1 className="mt-4 font-serif text-2xl text-white">Application submitted</h1>
					<p className="mt-1 text-sm text-white/80">Thank you, {app.first_name}. We've emailed you a confirmation.</p>
				</div>
				<div className="space-y-4 p-6">
					<div>
						<div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Your application number</div>
						<div className="mt-1 font-mono text-2xl font-bold text-ink">{app.name}</div>
						<div className="mt-1 text-sm text-ink-muted">
							{app.programme_name}
							{app.intake ? ` · ${app.intake}` : ""} · submitted {date(app.submitted_on)}
						</div>
					</div>
					{needsFee ? (
						<Alert
							tone="warning"
							title={`Pay your application fee of ${money(app.application_fee)}`}
							action={
								<Button variant="gold" icon={Smartphone} onClick={() => setPaying(true)}>
									Pay now
								</Button>
							}
							className="text-left"
						>
							Review starts as soon as the fee is paid.
						</Alert>
					) : (
						<Alert tone="success" title={paid ? "Payment received — thank you!" : "You're all set"} className="text-left">
							The admissions team will review your application. We'll notify you at every step.
						</Alert>
					)}
					<div className="flex flex-col justify-center gap-2 sm:flex-row">
						<Link to={`/applicant/application/${app.name}`} className={clsx("btn", needsFee ? "btn-secondary" : "btn-primary")}>
							Track my application <ArrowRight size={16} />
						</Link>
						<Link to="/applicant" className="btn btn-ghost">
							<LayoutDashboard size={16} /> Dashboard
						</Link>
					</div>
				</div>
			</div>
			<PayFeeDialog app={app} open={paying} onClose={() => setPaying(false)} onPaid={() => setPaid(true)} />
		</div>
	)
}
