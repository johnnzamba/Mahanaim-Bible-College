import { useMemo, useState } from "react"
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import clsx from "clsx"
import { Database, GraduationCap, MessageSquare, Palette, Plug, ShieldCheck, UserPlus, Wallet } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { toast } from "@/shared/components/toast"
import { Alert, Button, ErrorState, PageHeader, SkeletonRows } from "@/shared/components/ui"
import { ALL_FIELDS, TAB_OF } from "./schema"
import { NoAccess, S, SaveBar, SettingsContext, useDraft, useUnloadGuard, validateSettings } from "./lib"
import FormTab from "./pages/FormTab"
import MasterData from "./pages/MasterData"
import Integrations from "./pages/Integrations"

const SECTIONS = [
	{ path: "general", label: "General & branding", icon: Palette, blurb: "Institution name, logo, contact details and the names and signatures printed on documents.", form: true },
	{ path: "academic", label: "Academic", icon: GraduationCap, blurb: "Current term, grading scale and credit limits.", form: true },
	{ path: "admissions", label: "Admissions", icon: UserPlus, blurb: "Student numbering, application fee and offers.", form: true },
	{ path: "finance", label: "Finance", icon: Wallet, blurb: "Billing terms, fee clearance thresholds and optional ERPNext posting.", form: true },
	{ path: "communication", label: "Communication", icon: MessageSquare, blurb: "SMS gateway, test messages and email.", form: true },
	{ path: "security", label: "Security", icon: ShieldCheck, blurb: "Staff sign-in protection and one-time password rules.", form: true },
	{ path: "master-data", label: "Master data", icon: Database, blurb: "Campuses, departments and study modes." },
	{ path: "integrations", label: "Integrations", icon: Plug, blurb: "M-Pesa (Safaricom Daraja) and the Frappe LMS bridge." },
]

const pick = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)))

function SectionNav({ dirtyTabs }) {
	return (
		<nav aria-label="Settings sections" className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0 lg:pb-0">
			{SECTIONS.map((s) => (
				<NavLink
					key={s.path}
					to={`/admin/settings/${s.path}`}
					className={({ isActive }) =>
						clsx(
							"flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition lg:py-2.5",
							isActive ? "bg-brand-700 text-white shadow-soft" : "border border-line bg-surface text-ink-muted hover:bg-cream hover:text-ink lg:border-transparent lg:bg-transparent"
						)
					}
				>
					<s.icon size={16} className="shrink-0" />
					<span className="flex-1">{s.label}</span>
					{dirtyTabs.has(s.path) ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" /> : null}
				</NavLink>
			))}
		</nav>
	)
}

/** /admin/settings/* — campus-wide configuration for the College Administrator and System Managers. */
export default function SettingsArea() {
	const session = useSession()
	if (!session.isSuper) return <NoAccess />
	return <SettingsWorkspace />
}

function SettingsWorkspace() {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const { pathname } = useLocation()
	const q = useApi(`${S}get_settings`, {}, { staleTime: 60_000 })
	const form = useDraft(q.data)
	const [attempted, setAttempted] = useState(false)
	useUnloadGuard(form.isDirty)

	const allErrors = useMemo(() => validateSettings(form.values, ALL_FIELDS), [form.values])
	const errors = attempted ? allErrors : pick(allErrors, form.dirty)
	const dirtyTabs = useMemo(() => new Set(form.dirty.map((k) => TAB_OF[k]).filter(Boolean)), [form.dirty])
	const current = SECTIONS.find((s) => pathname.startsWith(`/admin/settings/${s.path}`)) || SECTIONS[0]

	const save = useAction(`${S}update_settings`, {
		success: "Settings saved",
		invalidate: ["mahanaim.api.dashboard.", `${S}lookups`],
		onSuccess: (data) => {
			qc.setQueryData([`${S}get_settings`, {}], data)
			form.reset()
			setAttempted(false)
		},
	})
	const doSave = () => {
		setAttempted(true)
		const bad = Object.keys(allErrors)
		if (bad.length) {
			const tab = TAB_OF[bad[0]]
			toast.error(`Fix ${bad.length === 1 ? "1 field" : `${bad.length} fields`} before saving.`)
			if (tab && tab !== current.path) navigate(`/admin/settings/${tab}`)
			return
		}
		save.mutate({ data: form.changes() })
	}

	const ctx = { ...form, server: q.data, errors }
	const body = q.isLoading ? (
		<div className="card p-5">
			<SkeletonRows rows={8} />
		</div>
	) : q.isError ? (
		<ErrorState error={q.error} onRetry={q.refetch} className="card" />
	) : null
	const formRoute = (path) => body || <FormTab tab={path} />

	return (
		<SettingsContext.Provider value={ctx}>
			<PageHeader title="Settings" eyebrow="System" subtitle="Campus-wide configuration. Changes apply to every portal as soon as they are saved." />
			<div className="grid gap-5 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-8">
				<SectionNav dirtyTabs={dirtyTabs} />
				<div className="min-w-0 pb-16">
					<div className="mb-4">
						<h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
							<current.icon size={18} className="text-brand-700" /> {current.label}
						</h2>
						<p className="text-sm text-ink-soft">{current.blurb}</p>
					</div>
					{form.isDirty && !current.form ? (
						<Alert
							tone="warning"
							className="mb-4"
							title="Unsaved settings"
							action={
								<Button size="sm" variant="secondary" onClick={() => navigate(`/admin/settings/${[...dirtyTabs][0] || "general"}`)}>
									Review
								</Button>
							}
						>
							You changed {form.dirty.length} setting{form.dirty.length === 1 ? "" : "s"} that {form.dirty.length === 1 ? "hasn't" : "haven't"} been saved yet.
						</Alert>
					) : null}
					<Routes>
						<Route index element={<Navigate to="/admin/settings/general" replace />} />
						{SECTIONS.filter((s) => s.form).map((s) => (
							<Route key={s.path} path={s.path} element={formRoute(s.path)} />
						))}
						<Route path="master-data" element={<MasterData />} />
						<Route path="integrations" element={<Integrations />} />
						<Route path="mpesa" element={<Navigate to="/admin/settings/integrations" replace />} />
						<Route path="lms" element={<Navigate to="/admin/settings/integrations?tab=lms" replace />} />
						<Route path="*" element={<Navigate to="/admin/settings/general" replace />} />
					</Routes>
				</div>
			</div>
			<SaveBar show={form.isDirty && current.form} count={form.dirty.length} saving={save.isPending} onSave={doSave} onDiscard={() => (form.reset(), setAttempted(false))} />
		</SettingsContext.Provider>
	)
}
