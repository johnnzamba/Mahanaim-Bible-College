import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Award, CheckCircle2, GraduationCap, RefreshCw, Sparkles, XCircle } from "lucide-react"
import { useAction, useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { toast } from "@/shared/components/toast"
import { Alert, Avatar, Button, ConfirmDialog, Input, PageHeader, Panel, Select, StatCard } from "@/shared/components/ui"
import { DataTable, SelectionBar } from "@/shared/components/kit"
import { date, num } from "@/shared/utils/format"
import { API, CAN, FLAT, campusName, compact, isPermissionError, NoAccess, programmeName, today, useLookups, useUrlFilters } from "../lib"

export default function Graduation() {
	const { hasRole, roles } = useSession()
	const allowed = hasRole(...CAN.staff)
	const [get, set] = useUrlFilters()
	const [selected, setSelected] = useState([])
	const [gradDate, setGradDate] = useState(today())
	const [confirm, setConfirm] = useState(false)
	const [result, setResult] = useState(null)
	const [names, setNames] = useState({})
	const invalidate = useInvalidate()

	const lookups = useLookups()
	const L = lookups.data || {}
	const filters = compact({ programme: get("programme"), campus: get("campus") })
	const q = useApi(`${API}graduation_candidates`, filters, { enabled: allowed })
	const rows = useMemo(() => q.data || [], [q.data])
	const byName = useMemo(() => Object.fromEntries(rows.map((r) => [r.name, r])), [rows])

	const graduate = useAction(`${API}graduate_students`, {
		invalidate: [`${API}graduation_candidates`, `${API}alumni_stats`, `${API}alumni_directory`, "mahanaim.api.students."],
		onSuccess: (res) => {
			setResult({ ...res, date: gradDate })
			setConfirm(false)
			setSelected([])
			if (res?.count) toast.success(`${num(res.count)} student${res.count === 1 ? "" : "s"} graduated`)
			if (res?.failed?.length) toast.error(`${num(res.failed.length)} could not be graduated`)
		},
	})

	if (!allowed || isPermissionError(q.error)) {
		return (
			<>
				<PageHeader eyebrow="Alumni" title="Graduation" back={{ to: "/admin/alumni", label: "Alumni" }} />
				<NoAccess message="Only the Registrar and the Academic Dean can graduate students." />
			</>
		)
	}

	const future = gradDate > today()
	const chosen = selected.filter((n) => byName[n])
	const byProgramme = rows.reduce((acc, r) => ((acc[r.programme] = (acc[r.programme] || 0) + 1), acc), {})
	const avgCgpa = rows.length ? rows.reduce((a, r) => a + Number(r.cgpa || 0), 0) / rows.length : 0
	const canCert = hasRole(...CAN.certificates) && canAccess(roles, "/credentials")
	const nameOf = (n) => byName[n]?.full_name || names[n] || n

	const cols = [
		{
			key: "full_name",
			label: "Student",
			render: (r) => (
				<span className="flex min-w-0 max-w-[16rem] items-center gap-3">
					<Avatar name={r.full_name} size={34} />
					<span className="min-w-0">
						<span className="block truncate font-semibold text-ink">{r.full_name}</span>
						<span className="block truncate text-xs text-ink-soft">{r.student_number || r.name}</span>
					</span>
				</span>
			),
		},
		{
			key: "programme",
			label: "Programme",
			render: (r) => (
				<div className="max-w-[14rem]">
					<div className="truncate font-medium text-ink">{programmeName(L, r.programme)}</div>
					<div className="truncate text-xs text-ink-soft">{campusName(L, r.campus)}</div>
				</div>
			),
		},
		{ key: "completion_date", label: "Completed", render: (r) => <span className="whitespace-nowrap">{r.completion_date ? date(r.completion_date) : "—"}</span>, sortValue: (r) => r.completion_date },
		{ key: "cgpa", label: "CGPA", align: "right", render: (r) => (r.cgpa != null ? Number(r.cgpa).toFixed(2) : "—"), sortValue: (r) => Number(r.cgpa || 0) },
		{ key: "credits_earned", label: "Credits", align: "right", hideOnMobile: true, render: (r) => num(r.credits_earned || 0), sortValue: (r) => Number(r.credits_earned || 0) },
	]

	return (
		<>
			<PageHeader
				eyebrow="Alumni"
				title="Graduation"
				subtitle="Move students who have completed their programme into the alumni community."
				back={{ to: "/admin/alumni", label: "Alumni" }}
				actions={
					<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(`${API}graduation_candidates`)}>
						Refresh
					</Button>
				}
			/>

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Candidates" value={num(rows.length)} icon={GraduationCap} loading={q.isLoading} hint="Status Completed" />
				<StatCard label="Programmes" value={num(Object.keys(byProgramme).length)} icon={Award} tone="gold" loading={q.isLoading} hint="With candidates" />
				<StatCard label="Average CGPA" value={rows.length ? avgCgpa.toFixed(2) : "—"} icon={Sparkles} tone="blue" loading={q.isLoading} hint="Across candidates" />
				<StatCard label="Selected" value={num(chosen.length)} icon={CheckCircle2} tone="green" hint={chosen.length ? "Ready to graduate" : "Tick students below"} />
			</div>

			{result ? <ResultPanel result={result} nameOf={nameOf} canCert={canCert} onClose={() => setResult(null)} /> : null}

			<div className="grid gap-4 lg:grid-cols-3">
				<Panel
					title="Graduation candidates"
					subtitle="Students whose status is Completed"
					className="lg:col-span-2"
					bodyClass="p-0"
				>
					<div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2">
						<Select aria-label="Programme" value={get("programme")} onChange={(e) => set({ programme: e.target.value })} placeholder="All programmes" options={(L.programmes || []).map((p) => ({ value: p.name, label: p.programme_name || p.name }))} />
						<Select aria-label="Campus" value={get("campus")} onChange={(e) => set({ campus: e.target.value })} placeholder="All campuses" options={(L.campuses || []).map((c) => ({ value: c.name, label: c.campus_name || c.name }))} />
					</div>
					<DataTable
						className={FLAT}
						cols={cols}
						rows={rows}
						query={q}
						selectable
						selected={selected}
						onSelect={setSelected}
						rowTo={(r) => `/admin/students/${encodeURIComponent(r.name)}`}
						empty={get("programme") || get("campus") ? "No completed students match these filters" : "No students are waiting to graduate"}
						emptyIcon={GraduationCap}
					/>
				</Panel>

				<div className="space-y-4">
					<Panel title="Graduation details" bodyClass="space-y-4 p-5">
						<Input type="date" label="Graduation date" required value={gradDate} max={today()} onChange={(e) => setGradDate(e.target.value)} error={future ? "The graduation date cannot be in the future." : undefined} hint="Recorded on each student and shown on the alumni directory." />
						<div className="rounded-xl bg-cream px-4 py-3 text-sm">
							<div className="font-semibold text-ink">{chosen.length ? `${num(chosen.length)} student${chosen.length === 1 ? "" : "s"} selected` : "No students selected"}</div>
							{chosen.length ? <div className="mt-1 text-xs text-ink-muted">{chosen.slice(0, 4).map(nameOf).join(", ")}{chosen.length > 4 ? ` and ${chosen.length - 4} more` : ""}</div> : null}
						</div>
						<Button className="w-full" icon={GraduationCap} disabled={!chosen.length || !gradDate || future} onClick={() => setConfirm(true)}>
							Graduate {chosen.length ? num(chosen.length) : ""} student{chosen.length === 1 ? "" : "s"}
						</Button>
					</Panel>
					<Panel title="What happens" bodyClass="p-5">
						<ul className="space-y-2 text-sm text-ink-muted">
							<li>Each student's status moves from Completed to Alumni, with the graduation date.</li>
							<li>Their sign-in gains the Alumni role, so they can keep their profile up to date.</li>
							<li>They appear in the alumni directory once they opt in from their profile.</li>
							<li>
								Certificates are issued separately
								{canCert ? (
									<>
										{" "}
										from{" "}
										<Link to="/admin/credentials/issue" className="font-semibold text-brand-700 hover:underline">
											Issue certificates
										</Link>
									</>
								) : null}
								.
							</li>
						</ul>
					</Panel>
				</div>
			</div>

			<SelectionBar count={chosen.length} onClear={() => setSelected([])}>
				<Button size="sm" icon={GraduationCap} disabled={!gradDate || future} onClick={() => setConfirm(true)}>
					Graduate on {gradDate ? date(gradDate) : "…"}
				</Button>
			</SelectionBar>

			<ConfirmDialog
				open={confirm}
				title={`Graduate ${num(chosen.length)} student${chosen.length === 1 ? "" : "s"}?`}
				message={`They become alumni with a graduation date of ${gradDate ? date(gradDate) : "today"}. This cannot be undone from this screen.`}
				confirmLabel="Graduate"
				loading={graduate.isPending}
				onClose={() => setConfirm(false)}
				onConfirm={() => {
					setNames((prev) => ({ ...prev, ...Object.fromEntries(chosen.map((n) => [n, byName[n]?.full_name])) }))
					graduate.mutate({ students: chosen, graduation_date: gradDate })
				}}
			>
				<ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-cream px-4 py-3 text-sm">
					{chosen.map((n) => (
						<li key={n} className="flex justify-between gap-2">
							<span className="truncate font-medium text-ink">{nameOf(n)}</span>
							<span className="shrink-0 text-xs text-ink-soft">{byName[n]?.student_number || n}</span>
						</li>
					))}
				</ul>
			</ConfirmDialog>
		</>
	)
}

function ResultPanel({ result, nameOf, canCert, onClose }) {
	const done = result.graduated || []
	const failed = result.failed || []
	return (
		<Panel
			title="Graduation result"
			subtitle={`Graduation date ${date(result.date)}`}
			className="mb-5"
			actions={
				<Button size="sm" variant="ghost" onClick={onClose}>
					Dismiss
				</Button>
			}
			bodyClass="space-y-3 p-5"
		>
			{done.length ? (
				<Alert tone="success" title={`${num(done.length)} graduated`}>
					<ul className="mt-1 space-y-0.5">
						{done.map((n) => (
							<li key={n}>
								<Link to={`/admin/students/${encodeURIComponent(n)}`} className="font-medium hover:underline">
									{nameOf(n)}
								</Link>
							</li>
						))}
					</ul>
					{canCert ? (
						<Link to="/admin/credentials/issue" className="mt-2 inline-block text-sm font-semibold hover:underline">
							Issue their certificates →
						</Link>
					) : null}
				</Alert>
			) : null}
			{failed.length ? (
				<Alert tone="error" title={`${num(failed.length)} not graduated`} icon={XCircle}>
					<ul className="mt-1 space-y-1">
						{failed.map((f) => (
							<li key={f.student}>
								<span className="font-semibold">{nameOf(f.student)}</span>: {f.error}
							</li>
						))}
					</ul>
				</Alert>
			) : null}
		</Panel>
	)
}
