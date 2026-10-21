import { useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import clsx from "clsx"
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff, FlaskConical, KeyRound, Link2, Plug, RefreshCw, RotateCcw, Settings2, Smartphone, Webhook, XCircle } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useApi } from "@/shared/api/hooks"
import { toast } from "@/shared/components/toast"
import { Alert, Badge, Button, ConfirmDialog, ErrorState, Input, Select, SkeletonRows, Tabs } from "@/shared/components/ui"
import { ago, dateTime, num, parseServerDate } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { LMS, MP, CopyButton, FormSection, SaveBar, SecretInput, ToggleRow, errText, useDraft, useUnloadGuard } from "../lib"

const since = (v) => {
	if (!v) return "never"
	const t = (parseServerDate(v)?.getTime() ?? NaN)
	return Number.isNaN(t) || t > Date.now() ? dateTime(v) : ago(v)
}

function StatusTile({ label, value, tone = "gray", icon: Icon, sub }) {
	const tones = { green: "text-emerald-600", red: "text-red-600", orange: "text-amber-600", gray: "text-ink-soft", blue: "text-sky-600" }
	return (
		<div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3">
			<p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
			<p className="mt-1 flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
				{Icon ? <Icon size={15} className={clsx("shrink-0", tones[tone])} /> : null}
				<span className="truncate">{value}</span>
			</p>
			{sub ? <p className="mt-0.5 truncate text-xs text-ink-soft">{sub}</p> : null}
		</div>
	)
}

const CALLBACKS = [
	["stk_callback", "STK push callback", "Set automatically on every STK request."],
	["c2b_validation", "C2B validation URL", "Register with Safaricom for Paybill payments."],
	["c2b_confirmation", "C2B confirmation URL", "Register with Safaricom for Paybill payments."],
]

/* ─────────────────────────────── M-Pesa ─────────────────────────────── */

function MpesaSettings() {
	const qc = useQueryClient()
	const [reveal, setReveal] = useState(false)
	const args = { reveal: reveal ? 1 : 0 }
	const q = useApi(`${MP}mpesa_settings`, args, { staleTime: 30_000, placeholderData: (prev) => prev })
	const server = q.data
	const form = useDraft(server)
	const v = form.values
	const info = server?.info || {}
	const [confirm, setConfirm] = useState(null)
	const [testResult, setTestResult] = useState(null)
	const [registerResult, setRegisterResult] = useState(null)
	useUnloadGuard(form.isDirty)

	const store = (data) => {
		qc.setQueryData([`${MP}mpesa_settings`, args], data)
		qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && (x.queryKey[0].startsWith(MP) || x.queryKey[0].startsWith("mahanaim.api.finance.")) && !(x.queryKey[0] === `${MP}mpesa_settings` && x.queryKey[1]?.reveal === args.reveal) })
	}
	const save = useAction(`${MP}update_mpesa_settings`, {
		success: "M-Pesa settings saved",
		onSuccess: (data) => {
			store(data)
			form.reset()
		},
	})
	const regenerate = useAction(`${MP}update_mpesa_settings`, {
		success: "New callback token issued. Re-register the C2B URLs with Safaricom.",
		onSuccess: (data) => {
			store(data)
			setConfirm(null)
		},
	})
	const test = useAction(`${MP}test_mpesa_connection`, { onSuccess: setTestResult, error: false, onError: (e) => setTestResult({ ok: false, message: errText(e) }) })
	const register = useAction(`${MP}register_c2b_urls`, {
		error: false,
		onSuccess: (r) => {
			setRegisterResult(r)
			setConfirm(null)
		},
		onError: (e) => {
			setRegisterResult({ ok: false, error: errText(e) })
			setConfirm(null)
		},
	})

	if (q.isLoading)
		return (
			<div className="card p-5">
				<SkeletonRows rows={8} />
			</div>
		)
	if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} className="card" />

	const pw = new Set(server.password_fields || [])
	const fieldErr = {}
	if (Number(v.enabled) && !String(v.business_shortcode || "").trim()) fieldErr.business_shortcode = "Required to take payments."
	if (v.transaction_type === "CustomerBuyGoodsOnline" && Number(v.enabled) && !String(v.till_number || "").trim()) fieldErr.till_number = "Buy Goods needs a till number."
	if (v.callback_base_url && !/^https?:\/\/[^\s/]+/i.test(String(v.callback_base_url).trim())) fieldErr.callback_base_url = "Use a full URL such as https://campus.mahanaim.ac.ke"
	if (v.stk_timeout_seconds !== "" && v.stk_timeout_seconds != null && (Number(v.stk_timeout_seconds) < 30 || Number(v.stk_timeout_seconds) > 600)) fieldErr.stk_timeout_seconds = "Between 30 and 600 seconds."
	const doSave = () => {
		if (Object.keys(fieldErr).length) return toast.error("Fix the highlighted fields first.")
		const data = form.changes()
		for (const k of Object.keys(data)) if (pw.has(k) && !String(data[k] || "").trim()) delete data[k]
		save.mutate({ data })
	}
	const setSecret = (k, x) => form.set(k, x === "" ? server[k] : x)
	const secretValue = (k) => (pw.has(k) && /^\*+$/.test(String(v[k] ?? "")) ? "" : v[k])
	const urls = info.callback_urls || {}
	const masked = info.callback_urls_masked !== false && !reveal
	const fetchUrl = async (key) => {
		const r = await frappe.call(`${MP}mpesa_settings`, { reveal: 1 })
		return r?.info?.callback_urls?.[key]
	}
	const tokenMissing = !info.has_callback_token

	return (
		<div className="space-y-5 pb-4">
			{info.simulation ? (
				<Alert tone="warning" icon={FlaskConical} title="Simulation mode is on">
					STK pushes and Paybill payments are simulated on this server; nothing reaches Safaricom and no money moves. Turn it off in the site configuration before going live.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatusTile label="Status" value={info.enabled ? "Enabled" : "Disabled"} icon={info.enabled ? CheckCircle2 : XCircle} tone={info.enabled ? "green" : "red"} sub={info.simulation ? "Simulation" : "Live calls"} />
				<StatusTile label="Environment" value={info.environment || v.environment || "—"} icon={Plug} tone={info.environment === "Production" ? "green" : "blue"} sub={info.base_url} />
				<StatusTile label="Configuration" value={info.configured ? "Complete" : `${(info.missing || []).length} missing`} icon={info.configured ? CheckCircle2 : AlertTriangle} tone={info.configured ? "green" : "orange"} sub={info.configured ? "Credentials stored" : (info.missing || []).join(", ")} />
				<StatusTile label="Last transaction" value={since(info.last_transaction_on)} icon={Smartphone} tone="gray" sub={info.last_transaction_on ? dateTime(info.last_transaction_on) : "No payments yet"} />
			</div>

			{(info.warnings || []).length ? (
				<Alert tone="info" title="Before going live">
					<ul className="list-disc space-y-0.5 pl-4">
						{info.warnings.map((w) => (
							<li key={w}>{w}</li>
						))}
					</ul>
				</Alert>
			) : null}

			<FormSection title="Account" subtitle="Your Daraja app and Paybill or Till details." icon={Smartphone}>
				<ToggleRow label="Accept M-Pesa payments" description="STK push from the student and applicant portals, and Paybill confirmations." checked={v.enabled} onChange={(x) => form.set("enabled", x)} />
				<Select label="Environment" value={v.environment || "Sandbox"} onChange={(e) => form.set("environment", e.target.value)} options={["Sandbox", "Production"]} hint={v.environment === "Production" ? "Real money. Use production credentials." : "Safaricom's test environment."} />
				<Select
					label="Transaction type"
					value={v.transaction_type || "CustomerPayBillOnline"}
					onChange={(e) => form.set("transaction_type", e.target.value)}
					options={[
						{ value: "CustomerPayBillOnline", label: "Paybill (CustomerPayBillOnline)" },
						{ value: "CustomerBuyGoodsOnline", label: "Buy Goods / Till (CustomerBuyGoodsOnline)" },
					]}
				/>
				<Input label="Business shortcode" hint="Paybill or head-office number." inputMode="numeric" value={v.business_shortcode || ""} onChange={(e) => form.set("business_shortcode", e.target.value.trim())} error={fieldErr.business_shortcode} />
				{v.transaction_type === "CustomerBuyGoodsOnline" ? <Input label="Till number" inputMode="numeric" value={v.till_number || ""} onChange={(e) => form.set("till_number", e.target.value.trim())} error={fieldErr.till_number} /> : null}
				<Input label="Account reference prefix" hint="Shown on the customer's M-Pesa prompt, e.g. MBC." value={v.account_reference_prefix || ""} onChange={(e) => form.set("account_reference_prefix", e.target.value)} maxLength={12} />
			</FormSection>

			<FormSection title="Credentials" subtitle="From the Daraja portal. Stored encrypted and never shown again." icon={KeyRound}>
				<SecretInput label="Consumer key" stored={info.has_consumer_key} value={secretValue("consumer_key")} onChange={(x) => setSecret("consumer_key", x)} />
				<SecretInput label="Consumer secret" stored={info.has_consumer_secret} value={secretValue("consumer_secret")} onChange={(x) => setSecret("consumer_secret", x)} />
				<SecretInput label="Passkey" stored={info.has_passkey} value={secretValue("passkey")} onChange={(x) => setSecret("passkey", x)} hint="Lipa na M-Pesa Online passkey." />
				<div className="flex flex-col justify-end gap-2 sm:items-start">
					<Button variant="secondary" icon={Plug} loading={test.isPending} onClick={() => (setTestResult(null), test.mutate())} disabled={form.isDirty}>
						Test connection
					</Button>
					<p className="text-xs text-ink-soft">{form.isDirty ? "Save your changes before testing." : "Requests an OAuth token with the stored credentials."}</p>
				</div>
				{testResult ? (
					<Alert tone={testResult.ok ? "success" : "error"} className="sm:col-span-2" title={testResult.ok ? "Connection works" : "Connection failed"}>
						{testResult.message || (testResult.ok ? "Safaricom accepted the credentials." : "No details returned.")}
						{testResult.environment ? <span className="ml-1 opacity-75">({testResult.environment}{testResult.simulation ? ", simulated" : ""})</span> : null}
					</Alert>
				) : null}
			</FormSection>

			<FormSection
				title="Callbacks"
				subtitle="Where Safaricom sends payment results. The token in each URL proves the call is genuine."
				icon={Webhook}
				actions={
					<Button size="sm" variant="ghost" icon={reveal ? EyeOff : Eye} onClick={() => setReveal((r) => !r)} loading={reveal && q.isFetching}>
						{reveal ? "Hide token" : "Show"}
					</Button>
				}
			>
				<Input label="Callback base URL" placeholder="https://campus.mahanaim.ac.ke" inputMode="url" value={v.callback_base_url || ""} onChange={(e) => form.set("callback_base_url", e.target.value)} error={fieldErr.callback_base_url} hint="Public HTTPS address of this site. Leave blank to use the site URL." className="sm:col-span-2" />
				<div className="space-y-3 sm:col-span-2">
					{CALLBACKS.map(([key, label, hint]) => (
						<div key={key} className="rounded-xl border border-line bg-cream/40 p-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="text-sm font-semibold text-ink">{label}</span>
								<CopyButton getText={() => (masked ? fetchUrl(key) : urls[key])} />
							</div>
							<p className="mt-1.5 break-all font-mono text-xs text-ink-muted">{urls[key] || "—"}</p>
							<p className="mt-1 text-[11px] text-ink-soft">{hint}</p>
						</div>
					))}
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 sm:col-span-2">
					<div className="min-w-0">
						<p className="flex items-center gap-2 text-sm font-semibold text-ink">
							Callback token {tokenMissing ? <Badge tone="orange">Not issued</Badge> : <Badge tone="green">Issued</Badge>}
						</p>
						<p className="text-xs text-ink-soft">{tokenMissing ? "Issue a token so callbacks can be verified." : "Regenerate if a URL may have leaked."}</p>
					</div>
					<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setConfirm("token")} disabled={form.isDirty}>
						{tokenMissing ? "Issue token" : "Regenerate token"}
					</Button>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 sm:col-span-2">
					<div className="min-w-0">
						<p className="text-sm font-semibold text-ink">Register C2B URLs with Safaricom</p>
						<p className="text-xs text-ink-soft">{info.enabled ? "Needed once per shortcode, and again after the token or base URL changes." : "Enable M-Pesa and save before registering."}</p>
					</div>
					<Button size="sm" icon={Link2} onClick={() => setConfirm("register")} disabled={!info.enabled || form.isDirty}>
						Register URLs
					</Button>
				</div>
				{registerResult ? (
					<Alert tone={registerResult.ok ? "success" : "error"} className="sm:col-span-2" title={registerResult.ok ? "URLs registered" : "Registration failed"}>
						{registerResult.error ||
							registerResult.response?.ResponseDescription ||
							registerResult.response?.errorMessage ||
							(registerResult.ok ? "Safaricom accepted the URLs." : "Safaricom did not accept the request.")}
					</Alert>
				) : null}
			</FormSection>

			<FormSection title="Behaviour" icon={Settings2}>
				<Input label="STK timeout (seconds)" type="number" min={30} max={600} value={v.stk_timeout_seconds ?? ""} onChange={(e) => form.set("stk_timeout_seconds", e.target.value === "" ? "" : Number(e.target.value))} error={fieldErr.stk_timeout_seconds} hint="How long a payment prompt waits before it is marked timed out." />
				<div className="hidden sm:block" />
				<ToggleRow label="Allocate payments automatically" description="Apply confirmed payments to the oldest open invoices." checked={v.auto_allocate} onChange={(x) => form.set("auto_allocate", x)} />
				<ToggleRow label="SMS receipt" description="Text the payer a receipt when a payment is confirmed." checked={v.sms_receipt} onChange={(x) => form.set("sms_receipt", x)} className="sm:col-span-1" />
				<ToggleRow label="Email receipt" description="Email the student a PDF receipt." checked={v.email_receipt} onChange={(x) => form.set("email_receipt", x)} className="sm:col-span-1" />
			</FormSection>

			<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-soft">
				<span>{server.modified ? `Last saved ${dateTime(server.modified)}` : null}</span>
				<Link to="/admin/finance/mpesa" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
					M-Pesa requests and transactions <ArrowRight size={13} />
				</Link>
			</div>

			<SaveBar show={form.isDirty} count={form.dirty.length} saving={save.isPending} onSave={doSave} onDiscard={form.reset} />
			<ConfirmDialog
				open={confirm === "token"}
				title={tokenMissing ? "Issue a callback token?" : "Regenerate the callback token?"}
				message={
					tokenMissing
						? "A secret token is added to every callback URL. Register the C2B URLs with Safaricom afterwards."
						: "The current token stops working immediately. Paybill confirmations will be rejected until you register the new C2B URLs with Safaricom."
				}
				confirmLabel={tokenMissing ? "Issue token" : "Regenerate"}
				tone={tokenMissing ? "primary" : "danger"}
				loading={regenerate.isPending}
				onConfirm={() => regenerate.mutate({ data: { regenerate_callback_token: 1 } })}
				onClose={() => setConfirm(null)}
			/>
			<ConfirmDialog
				open={confirm === "register"}
				title="Register C2B URLs?"
				message={`Safaricom will send Paybill payments for shortcode ${v.transaction_type === "CustomerBuyGoodsOnline" ? v.till_number || "—" : v.business_shortcode || "—"} to this site's validation and confirmation URLs.`}
				confirmLabel="Register"
				loading={register.isPending}
				onConfirm={() => (setRegisterResult(null), register.mutate())}
				onClose={() => setConfirm(null)}
			/>
		</div>
	)
}

/* ─────────────────────────────── LMS bridge ─────────────────────────────── */

const BRIDGE_TOGGLES = [
	["auto_create_courses", "Create LMS courses automatically", "Each course offering gets a matching LMS course."],
	["auto_enrol_students", "Enrol students automatically", "Registered students are enrolled in their courses' LMS counterparts."],
	["publish_on_create", "Publish new courses", "Otherwise new LMS courses stay as drafts for the lecturer."],
	["remove_enrolment_on_drop", "Remove enrolment on drop", "Students who drop a course lose LMS access to it."],
]

function LmsBridge() {
	const qc = useQueryClient()
	const q = useApi(`${LMS}bridge_status`, {}, { staleTime: 30_000 })
	const st = q.data
	const server = st ? { enabled: st.enabled ? 1 : 0, ...st.settings } : null
	const form = useDraft(server)
	const v = form.values
	const [term, setTerm] = useState("")
	const [offering, setOffering] = useState("")
	const [syncResult, setSyncResult] = useState(null)
	const [confirm, setConfirm] = useState(false)
	useUnloadGuard(form.isDirty)
	const lookups = useApi("mahanaim.api.setup.lookups", {}, { staleTime: 5 * 60_000 })
	const offerings = useApi("mahanaim.api.academics.list_offerings", { term: term || lookups.data?.current_term || undefined, page_length: 200 }, { enabled: Boolean(lookups.data), staleTime: 60_000, retry: false })
	const offeringList = Array.isArray(offerings.data) ? offerings.data : offerings.data?.data || offerings.data?.rows || []

	const save = useAction(`${LMS}save_bridge_settings`, {
		success: "LMS bridge settings saved",
		onSuccess: (data) => {
			qc.setQueryData([`${LMS}bridge_status`, {}], data)
			form.reset()
		},
	})
	const full = useAction(`${LMS}full_sync`, {
		success: (r) => (r?.installed === false ? "Sync queued; it will skip until the LMS app is installed" : "Full sync queued in the background"),
		onSuccess: () => setConfirm(false),
		invalidate: [`${LMS}bridge_status`],
	})
	const retry = useAction(`${LMS}retry_failed`, {
		success: (r) => (r?.retried ? `Retried ${num(r.retried)}: ${num(r.synced)} synced, ${num(r.failed)} still failing` : "Nothing to retry"),
		invalidate: [`${LMS}bridge_status`],
	})
	const one = useAction(`${LMS}sync_offering_now`, { onSuccess: setSyncResult, invalidate: [`${LMS}bridge_status`] })

	if (q.isLoading)
		return (
			<div className="card p-5">
				<SkeletonRows rows={6} />
			</div>
		)
	if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} className="card" />

	const lmsHref = safeUrl(syncResult?.lms_url)
	const total = (st.synced || 0) + (st.failed || 0) + (st.not_synced || 0) + (st.not_installed || 0)
	return (
		<div className="space-y-5 pb-4">
			{!st.installed ? (
				<Alert tone="info" title="The Frappe LMS app isn't installed on this site">
					Settings can be prepared now; courses and enrolments start syncing once the LMS app is installed and the bridge is enabled.
				</Alert>
			) : !st.enabled ? (
				<Alert tone="warning" title="The bridge is switched off">
					Course offerings and enrolments are not being sent to the LMS.
				</Alert>
			) : null}

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatusTile label="Bridge" value={st.active ? "Active" : st.enabled ? "Enabled" : "Off"} icon={st.active ? CheckCircle2 : XCircle} tone={st.active ? "green" : st.enabled ? "orange" : "red"} sub={st.installed ? "LMS app installed" : "LMS app not installed"} />
				<StatusTile label="Courses synced" value={`${num(st.synced)} of ${num(total)}`} icon={BookOpen} tone="blue" sub={`${num(st.not_synced)} waiting`} />
				<StatusTile label="Failed" value={num(st.failed)} icon={st.failed ? AlertTriangle : CheckCircle2} tone={st.failed ? "red" : "green"} sub={st.failed ? "Retry below" : "No errors"} />
				<StatusTile label="Last full sync" value={since(st.last_full_sync)} icon={RefreshCw} sub={`${num(st.enrolments_synced)} enrolments synced`} />
			</div>

			<FormSection title="Bridge settings" subtitle="How the campus system keeps the LMS in step with course offerings and registrations." icon={Plug}>
				<ToggleRow label="Enable the LMS bridge" description="Send course offerings and enrolments to Frappe LMS." checked={v.enabled} onChange={(x) => form.set("enabled", x)} />
				{BRIDGE_TOGGLES.map(([k, label, hint]) => (
					<ToggleRow key={k} label={label} description={hint} checked={v[k]} onChange={(x) => form.set(k, x)} className="sm:col-span-1" />
				))}
				<p className="text-xs text-ink-soft sm:col-span-2">
					LMS access requires {num(st.lms_fee_clearance_percent)}% of fees paid. Change it under{" "}
					<Link to="/admin/settings/finance" className="font-semibold text-brand-700 hover:underline">
						Finance settings
					</Link>
					.
				</p>
			</FormSection>

			<FormSection title="Synchronise" subtitle="Runs in the background; large terms can take a few minutes." icon={RefreshCw}>
				<Select
					label="Term for full sync"
					value={term}
					onChange={(e) => setTerm(e.target.value)}
					placeholder="All terms"
					options={(lookups.data?.terms || []).map((t) => ({ value: t.name, label: t.is_current ? `${t.term_label || t.name} (current)` : t.term_label || t.name }))}
				/>
				<div className="flex flex-wrap items-end gap-2">
					<Button icon={RefreshCw} onClick={() => setConfirm(true)} loading={full.isPending}>
						Run full sync
					</Button>
					<Button variant="secondary" icon={RotateCcw} onClick={() => retry.mutate()} loading={retry.isPending} disabled={!st.failed}>
						Retry failed{st.failed ? ` (${num(st.failed)})` : ""}
					</Button>
				</div>
				<Select
					label="Sync one course offering now"
					value={offering}
					onChange={(e) => (setOffering(e.target.value), setSyncResult(null))}
					placeholder={offerings.isLoading ? "Loading offerings…" : "Choose an offering"}
					options={offeringList.map((o) => ({ value: o.name, label: [o.course_title || o.course, o.campus, o.lms_sync_status].filter(Boolean).join(" · ") || o.name }))}
				/>
				<div className="flex items-end">
					<Button variant="secondary" icon={RefreshCw} onClick={() => one.mutate({ offering })} loading={one.isPending} disabled={!offering}>
						Sync now
					</Button>
				</div>
				{syncResult ? (
					<Alert tone={syncResult.ok ? "success" : "warning"} className="sm:col-span-2" title={syncResult.ok ? "Offering synced" : `Not synced${syncResult.lms_sync_status ? ` (${syncResult.lms_sync_status})` : ""}`}>
						{syncResult.lms_sync_error || (syncResult.ok ? `LMS course ${syncResult.lms_course}` : "The LMS app may not be installed or the bridge is off.")}
						{lmsHref ? (
							<a href={lmsHref} target="_blank" rel="noreferrer" className="ml-2 font-semibold underline">
								Open in LMS
							</a>
						) : null}
					</Alert>
				) : null}
			</FormSection>

			<SaveBar show={form.isDirty} count={form.dirty.length} saving={save.isPending} onSave={() => save.mutate({ data: form.changes() })} onDiscard={form.reset} />
			<ConfirmDialog
				open={confirm}
				title="Run a full LMS sync?"
				message={`Every course offering${term ? ` in ${term}` : ""} and its enrolments will be pushed to the LMS. Existing LMS courses are updated, not duplicated.`}
				confirmLabel="Start sync"
				loading={full.isPending}
				onConfirm={() => full.mutate({ term: term || undefined })}
				onClose={() => setConfirm(false)}
			/>
		</div>
	)
}

/** /admin/settings/integrations — M-Pesa and the LMS bridge (?tab=lms). */
export default function Integrations() {
	const [params, setParams] = useSearchParams()
	const tab = params.get("tab") === "lms" ? "lms" : "mpesa"
	return (
		<div className="space-y-4">
			<Tabs
				className="overflow-y-hidden"
				tabs={[
					{ id: "mpesa", label: "M-Pesa (Daraja)" },
					{ id: "lms", label: "LMS bridge" },
				]}
				active={tab}
				onChange={(t) => setParams(t === "lms" ? { tab: "lms" } : {}, { replace: true })}
			/>
			{tab === "lms" ? <LmsBridge /> : <MpesaSettings />}
		</div>
	)
}
