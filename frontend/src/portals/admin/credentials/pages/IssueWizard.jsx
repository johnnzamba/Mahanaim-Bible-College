import { useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, Award, BadgeCheck, CheckCircle2, CircleSlash, Clock, GraduationCap, Wallet, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { Alert, AvatarCell, Badge, Button, Input, PageHeader, Panel, Select, StatCard, Switch } from "@/shared/components/ui"
import { DataTable, SelectionBar, Stepper, Toolbar } from "@/shared/components/kit"
import { money, num } from "@/shared/utils/format"
import { API, CAN, FLAT, NoAccess, isPermissionError, today, useLookups } from "../lib"

const STEPS = ["Programme", "Choose graduates", "Confirm", "Done"]

/** Fee balance is the only reason left, so a Registrar override makes the row issuable. */
const feeOnly = (r) => !r.eligible && !r.fee_cleared && r.reasons?.length === 1
const issuable = (r, override) => r.eligible || (override && feeOnly(r))

/** /admin/credentials/issue — programme → eligible_graduates → issue_certificates */
export default function IssueWizard() {
	const { hasRole } = useSession()
	const canRead = hasRole(...CAN.read)
	const canWrite = hasRole(...CAN.write)
	const canOverride = hasRole(...CAN.override)
	const [params, setParams] = useSearchParams()
	const programme = params.get("programme") || ""
	const intake = params.get("intake") || ""
	const [step, setStep] = useState(programme ? 1 : 0)
	const [show, setShow] = useState("all")
	const [override, setOverride] = useState(false)
	const [selected, setSelected] = useState([])
	const [gradDate, setGradDate] = useState("")
	const [result, setResult] = useState(null)
	const L = useLookups().data || {}

	const setParam = (patch) =>
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev)
				for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k)
				return next
			},
			{ replace: true }
		)

	const q = useApi(`${API}eligible_graduates`, { programme, intake: intake || undefined, include_ineligible: 1 }, { enabled: canRead && Boolean(programme) && step >= 1 })
	const rows = useMemo(() => q.data?.data || [], [q.data])
	const byName = useMemo(() => Object.fromEntries(rows.map((r) => [r.student, r])), [rows])

	const issue = useAction(`${API}issue_certificates`, {
		invalidate: [API, "mahanaim.api.students.", "mahanaim.api.alumni."],
		success: (r) => (r.queued ? `Issuing ${num(r.count)} certificates in the background` : `${num(r.issued_count)} certificate${r.issued_count === 1 ? "" : "s"} issued`),
		onSuccess: (r) => {
			setResult(r)
			setSelected([])
			setStep(3)
		},
	})

	if (!canRead || isPermissionError(q.error)) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Issue certificates" back={{ to: "/admin/credentials", label: "Credentials" }} />
				<NoAccess message="Certificates are issued by the registrar." />
			</>
		)
	}

	const prog = (L.programmes || []).find((p) => p.name === programme)
	const chosen = selected.filter((n) => byName[n] && issuable(byName[n], override))
	const counts = {
		eligible: rows.filter((r) => r.eligible).length,
		fee: rows.filter(feeOnly).length,
		issued: rows.filter((r) => r.reasons?.some((x) => /already been issued/i.test(x))).length,
	}
	const blocked = rows.length - counts.eligible
	const visible = show === "eligible" ? rows.filter((r) => issuable(r, override)) : show === "blocked" ? rows.filter((r) => !issuable(r, override)) : rows

	const cols = [
		{ key: "student_name", label: "Student", render: (r) => <AvatarCell name={r.student_name} sub={[r.student_number, r.intake].filter(Boolean).join(" · ")} /> },
		{ key: "status", label: "Status", hideOnMobile: true, render: (r) => <Badge status={r.status} size="xs" /> },
		{
			key: "cgpa",
			label: "Record",
			sortValue: (r) => Number(r.cgpa || 0),
			render: (r) => (
				<div className="whitespace-nowrap">
					<div className="font-semibold tabular-nums text-ink">CGPA {Number(r.cgpa || 0).toFixed(2)}</div>
					<div className="text-xs text-ink-soft">{[`${num(r.credits_earned || 0)} credits`, r.classification].filter(Boolean).join(" · ")}</div>
				</div>
			),
		},
		{
			key: "balance",
			label: "Fees",
			hideOnMobile: true,
			sortValue: (r) => Number(r.balance || 0),
			render: (r) => (r.fee_cleared ? <span className="text-xs font-semibold text-green-700">Cleared</span> : <span className="whitespace-nowrap text-xs font-semibold text-red-600">{money(r.balance)} owed</span>),
		},
		{
			key: "eligible",
			label: "Eligibility",
			render: (r) =>
				r.eligible ? (
					<Badge status="Eligible" tone="green" size="xs" />
				) : (
					<div className="max-w-[22rem] space-y-1 whitespace-normal break-words">
						<Badge status={override && feeOnly(r) ? "Issuable with override" : "Not eligible"} tone={override && feeOnly(r) ? "orange" : "red"} size="xs" />
						<ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
							{(r.reasons || []).map((x) => (
								<li key={x}>{x}</li>
							))}
						</ul>
					</div>
				),
		},
	]

	const future = gradDate && gradDate > today()

	return (
		<>
			<PageHeader
				eyebrow="Credentials"
				title="Issue certificates"
				subtitle="Check who has met the programme requirements and cleared fees, then issue their certificates in one batch."
				back={{ to: "/admin/credentials?tab=certificates", label: "Certificates" }}
			/>

			<Stepper className="mb-5" steps={STEPS} current={step} onStep={step < 3 ? (i) => setStep(i) : undefined} />

			{!canWrite ? (
				<Alert tone="info" className="mb-4">
					You can review eligibility here; only the Registrar can issue certificates.
				</Alert>
			) : null}

			{step === 0 ? (
				<Panel title="Which programme?" icon={GraduationCap}>
					<div className="grid gap-4 sm:grid-cols-2">
						<Select
							label="Programme"
							required
							value={programme}
							onChange={(e) => {
								setSelected([])
								setParam({ programme: e.target.value })
							}}
							placeholder="Choose a programme"
							options={(L.programmes || []).map((p) => ({ value: p.name, label: `${p.programme_name}${p.level ? ` (${p.level})` : ""}` }))}
						/>
						<Select
							label="Intake"
							hint="Optional: limit to one cohort"
							value={intake}
							onChange={(e) => {
								setSelected([])
								setParam({ intake: e.target.value })
							}}
							placeholder="All intakes"
							options={(L.intakes || []).map((i) => ({ value: i.name, label: i.intake_name || i.name }))}
						/>
					</div>
					<ul className="mt-5 space-y-1.5 text-sm text-ink-muted">
						<li>• Students who are Completed or Alumni only need cleared fees and no failed core course.</li>
						<li>• Others must also have passed every curriculum course and reached the programme's minimum CGPA.</li>
						<li>• A student can hold only one issued certificate per programme.</li>
					</ul>
					<div className="mt-5 flex justify-end">
						<Button iconRight={ArrowRight} disabled={!programme} onClick={() => setStep(1)}>
							Check eligibility
						</Button>
					</div>
				</Panel>
			) : null}

			{step === 1 ? (
				<>
					<div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
						<StatCard label="Candidates" value={num(rows.length)} loading={q.isLoading} icon={GraduationCap} hint={prog?.programme_name || programme} />
						<StatCard label="Eligible" value={num(counts.eligible)} loading={q.isLoading} icon={CheckCircle2} tone="green" hint="Ready to issue" />
						<StatCard label="Fees outstanding" value={num(counts.fee)} loading={q.isLoading} icon={Wallet} tone="orange" hint="Blocked by balance only" />
						<StatCard label="Not eligible" value={num(blocked - counts.fee)} loading={q.isLoading} icon={CircleSlash} tone="red" hint={counts.issued ? `${num(counts.issued)} already hold one` : "Requirements not met"} />
					</div>

					{canOverride && counts.fee ? (
						<div className="mb-4 rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 dark:border-orange-900 dark:bg-orange-950/30">
							<Switch
								checked={override}
								onChange={(v) => {
									setOverride(v)
									if (!v) setSelected((s) => s.filter((n) => byName[n]?.eligible))
								}}
								label="Override the fee clearance check"
								description={`Lets you issue to the ${num(counts.fee)} student${counts.fee === 1 ? "" : "s"} whose only blocker is an outstanding balance. The override and your name are recorded on each certificate.`}
							/>
						</div>
					) : null}

					<Toolbar
						chips={[
							{ id: "all", label: "All", count: rows.length },
							{ id: "eligible", label: "Can issue", count: rows.filter((r) => issuable(r, override)).length },
							{ id: "blocked", label: "Blocked", count: rows.filter((r) => !issuable(r, override)).length },
						]}
						active={show}
						onChip={setShow}
						right={
							<span className="text-xs text-ink-soft">
								{prog?.programme_name || programme}
								{intake ? ` · ${intake}` : ""}
							</span>
						}
					/>

					<Panel bodyClass="p-0">
						<DataTable
							className={FLAT}
							cols={cols}
							rows={visible}
							query={q}
							rowKey={(r) => r.student}
							selectable={canWrite}
							selected={selected}
							onSelect={(arr) => setSelected(arr.filter((n) => byName[n] && issuable(byName[n], override)))}
							empty="No students in this programme are at or near graduation"
							emptyIcon={GraduationCap}
						/>
					</Panel>

					<div className="mt-4 flex items-center justify-between gap-3">
						<Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(0)}>
							Programme
						</Button>
						{canWrite ? (
							<Button iconRight={ArrowRight} disabled={!chosen.length} onClick={() => setStep(2)}>
								Continue with {num(chosen.length)}
							</Button>
						) : null}
					</div>

					<SelectionBar count={chosen.length} onClear={() => setSelected([])}>
						<Button size="sm" iconRight={ArrowRight} onClick={() => setStep(2)} disabled={!canWrite}>
							Continue
						</Button>
					</SelectionBar>
				</>
			) : null}

			{step === 2 ? (
				<div className="grid gap-5 lg:grid-cols-3">
					<Panel title={`Issue ${num(chosen.length)} certificate${chosen.length === 1 ? "" : "s"}`} subtitle={prog?.programme_name} icon={Award} className="lg:col-span-2" bodyClass="p-0">
						<ul className="divide-y divide-line">
							{chosen.map((n) => {
								const r = byName[n]
								return (
									<li key={n} className="flex items-center justify-between gap-3 px-5 py-2.5">
										<AvatarCell name={r.student_name} sub={[r.student_number, r.award_title].filter(Boolean).join(" · ")} size={32} />
										<div className="shrink-0 text-right text-xs">
											<div className="font-semibold tabular-nums text-ink">{Number(r.cgpa || 0).toFixed(2)}</div>
											<div className="text-ink-soft">{r.classification}</div>
											{!r.fee_cleared ? <div className="font-semibold text-orange-600">Fee override</div> : null}
										</div>
									</li>
								)
							})}
						</ul>
					</Panel>
					<Panel title="Details" icon={BadgeCheck}>
						<div className="space-y-4">
							<Input
								label="Graduation date"
								type="date"
								max={today()}
								value={gradDate}
								onChange={(e) => setGradDate(e.target.value)}
								hint="Leave empty to use each student's recorded graduation date"
								error={future ? "The graduation date cannot be in the future." : undefined}
							/>
							{override && chosen.some((n) => !byName[n]?.fee_cleared) ? <Alert tone="warning">The fee check is overridden for students with a balance. This is recorded on their certificates.</Alert> : null}
							<p className="text-sm text-ink-muted">Each certificate gets a serial number and a verification code, and the student is notified. Batches over 20 run in the background.</p>
							<div className="flex flex-col gap-2">
								<Button
									icon={Award}
									loading={issue.isPending}
									disabled={!chosen.length || future}
									onClick={() => issue.mutate({ students: chosen, graduation_date: gradDate || undefined, override_fee_check: override ? 1 : 0 })}
								>
									Issue {num(chosen.length)} certificate{chosen.length === 1 ? "" : "s"}
								</Button>
								<Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(1)} disabled={issue.isPending}>
									Back to the list
								</Button>
							</div>
						</div>
					</Panel>
				</div>
			) : null}

			{step === 3 && result ? (
				<ResultPanel
					result={result}
					nameOf={(s) => byName[s]?.student_name || s}
					onAgain={() => {
						setResult(null)
						setStep(1)
					}}
				/>
			) : null}
		</>
	)
}

function ResultPanel({ result, nameOf, onAgain }) {
	if (result.queued) {
		return (
			<Panel title="Issuing in the background" icon={Clock}>
				<p className="text-sm text-ink-muted">
					{num(result.count)} certificates are being issued as a background job{result.job ? ` (${result.job})` : ""}. They appear in the certificates list as they are created; refresh in a minute.
				</p>
				<div className="mt-4 flex gap-2">
					<Link to="/admin/credentials?tab=certificates" className="btn btn-primary btn-sm">
						Open certificates
					</Link>
					<Button size="sm" variant="secondary" onClick={onAgain}>
						Issue more
					</Button>
				</div>
			</Panel>
		)
	}
	return (
		<div className="grid gap-5 lg:grid-cols-2">
			<Panel title={`${num(result.issued_count)} issued`} icon={CheckCircle2} bodyClass="p-0">
				{result.issued?.length ? (
					<ul className="divide-y divide-line">
						{result.issued.map((i) => (
							<li key={i.certificate}>
								<Link to={`/admin/credentials/certificates/${encodeURIComponent(i.certificate)}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-cream">
									<span className="font-semibold text-ink">{nameOf(i.student)}</span>
									<span className="font-mono text-xs text-brand-700">{i.serial || i.certificate}</span>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<p className="px-5 py-4 text-sm text-ink-soft">No certificates were issued.</p>
				)}
			</Panel>
			<Panel title={`${num(result.skipped_count)} skipped`} icon={XCircle} bodyClass={result.skipped?.length ? "p-0" : undefined}>
				{result.skipped?.length ? (
					<ul className="divide-y divide-line">
						{result.skipped.map((s) => (
							<li key={s.student} className="px-5 py-2.5 text-sm">
								<div className="font-semibold text-ink">{nameOf(s.student)}</div>
								<div className="text-xs text-red-600">{s.reason}</div>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-ink-soft">Every selected student received a certificate.</p>
				)}
			</Panel>
			<div className="flex gap-2 lg:col-span-2">
				<Link to="/admin/credentials?tab=certificates" className="btn btn-primary btn-sm">
					All certificates
				</Link>
				<Button size="sm" variant="secondary" onClick={onAgain}>
					Back to the list
				</Button>
			</div>
		</div>
	)
}

