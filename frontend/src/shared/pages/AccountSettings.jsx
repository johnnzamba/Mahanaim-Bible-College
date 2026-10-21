import { useState } from "react"
import clsx from "clsx"
import { Check, KeyRound, Monitor, Moon, Palette, Smartphone, Sun, UserCircle } from "lucide-react"
import { frappe } from "../api/frappe"
import { useSession } from "../session"
import { RAILS, SCHEMES, getRail, getScheme, setRail, setScheme } from "../theme"
import { Alert, Avatar, Badge, Button, Input, PageHeader, Panel, PasswordInput } from "../components/ui"
import { OtpInput, ResendLink, useCountdown } from "../components/OtpInput"
import { toast } from "../components/toast"

const AUTH = "mahanaim.api.auth"
const SCHEME_ICON = { light: Sun, dark: Moon, system: Monitor }

/**
 * Account & security, shared by every portal and mounted at `/<portal>/account`
 * (the user menu links there). Profile summary, password change, verified phone change, appearance.
 */
export default function AccountSettings() {
	const session = useSession()
	return (
		<div className="mx-auto max-w-5xl">
			<PageHeader eyebrow="Account" title="Account & security" subtitle="Your sign-in details, password, phone number and how the portal looks." />
			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
				<div className="space-y-5">
					<ProfileCard session={session} />
					<AppearancePanel />
				</div>
				<div className="space-y-5">
					<PasswordPanel />
					<PhonePanel session={session} />
				</div>
			</div>
		</div>
	)
}

function ProfileCard({ session }) {
	const rows = [
		session.student?.student_number && ["Student number", session.student.student_number],
		session.student?.programme_name && ["Programme", session.student.programme_name],
		session.staff?.designation && ["Designation", session.staff.designation],
		session.sponsor?.sponsor_name && ["Sponsor account", session.sponsor.sponsor_name],
		["Email", session.email],
		["Phone", session.phone || "Not set"],
	].filter(Boolean)
	return (
		<Panel title="Profile" icon={UserCircle}>
			<div className="flex items-center gap-3">
				<Avatar name={session.full_name} src={session.image} size={56} />
				<div className="min-w-0">
					<div className="truncate font-semibold text-ink">{session.full_name}</div>
					<div className="mt-1 flex flex-wrap gap-1">
						{(session.roles || []).map((r) => (
							<Badge key={r} tone="gray" size="xs">
								{r}
							</Badge>
						))}
					</div>
				</div>
			</div>
			<dl className="mt-4 divide-y divide-line text-sm">
				{rows.map(([k, v]) => (
					<div key={k} className="flex justify-between gap-4 py-2">
						<dt className="shrink-0 text-ink-soft">{k}</dt>
						<dd className="truncate text-right font-medium text-ink">{v}</dd>
					</div>
				))}
			</dl>
			<p className="mt-3 text-xs text-ink-soft">To correct your name or email, contact the college office.</p>
		</Panel>
	)
}

function PasswordPanel() {
	const [form, setForm] = useState({ old: "", next: "", confirm: "" })
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
	const submit = async (e) => {
		e.preventDefault()
		if (form.next !== form.confirm) return setError("The two new passwords don't match.")
		setBusy(true)
		setError("")
		try {
			const r = await frappe.call(`${AUTH}.change_password`, { old: form.old, new: form.next })
			toast.success(r?.message || "Password changed.")
			setForm({ old: "", next: "", confirm: "" })
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}
	return (
		<Panel title="Password" subtitle="Changing it signs you out on your other devices." icon={KeyRound}>
			<form onSubmit={submit} className="space-y-3.5">
				{error ? <Alert tone="error">{error}</Alert> : null}
				<PasswordInput label="Current password" autoComplete="current-password" value={form.old} onChange={set("old")} required />
				<div className="grid gap-3.5 sm:grid-cols-2">
					<PasswordInput label="New password" autoComplete="new-password" value={form.next} onChange={set("next")} required hint="At least 8 characters." />
					<PasswordInput label="Confirm new password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required />
				</div>
				<div className="flex justify-end">
					<Button type="submit" loading={busy} disabled={!form.old || !form.next}>
						Change password
					</Button>
				</div>
			</form>
		</Panel>
	)
}

function PhonePanel({ session }) {
	const smsEnabled = session.settings?.sms_enabled
	const [phone, setPhone] = useState("")
	const [sent, setSent] = useState(null)
	const [code, setCode] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const [left, restart] = useCountdown(0)

	const send = async (e) => {
		e?.preventDefault()
		setBusy(true)
		setError("")
		try {
			const r = await frappe.call(`${AUTH}.request_otp`, { recipient: phone.trim(), purpose: "Phone Verification", channel: "SMS" })
			setSent(r)
			setCode("")
			restart(r?.resend_in || 60)
		} catch (err) {
			setError(err.message)
		} finally {
			setBusy(false)
		}
	}
	const confirm = async (value = code) => {
		if (value.length < 6) return
		setBusy(true)
		setError("")
		try {
			const v = await frappe.call(`${AUTH}.verify_otp`, { recipient: phone.trim(), purpose: "Phone Verification", code: value, channel: "SMS" })
			const r = await frappe.call(`${AUTH}.update_phone`, { phone: phone.trim(), otp_token: v.otp_token })
			toast.success(`Phone number updated to ${r?.phone || phone}.`)
			setSent(null)
			setPhone("")
			await session.reload()
		} catch (err) {
			setError(err.message)
			setCode("")
		} finally {
			setBusy(false)
		}
	}

	return (
		<Panel title="Phone number" subtitle="Used for SMS alerts, M-Pesa prompts and signing in with a code." icon={Smartphone}>
			<div className="mb-3 flex items-center justify-between rounded-xl bg-cream/60 px-3 py-2 text-sm">
				<span className="text-ink-soft">Current</span>
				<span className="font-semibold text-ink">{session.phone || "Not set"}</span>
			</div>
			{!smsEnabled ? (
				<Alert tone="info">SMS verification isn't switched on yet. Ask the college office to update your number.</Alert>
			) : !sent ? (
				<form onSubmit={send} className="space-y-3.5">
					{error ? <Alert tone="error">{error}</Alert> : null}
					<Input label="New phone number" type="tel" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} required />
					<div className="flex justify-end">
						<Button type="submit" loading={busy} disabled={!phone.trim()}>
							Send verification code
						</Button>
					</div>
				</form>
			) : (
				<form
					onSubmit={(e) => {
						e.preventDefault()
						confirm()
					}}
					className="space-y-3.5"
				>
					<p className="text-sm text-ink-muted">Enter the 6-digit code sent to {sent.destination || phone}.</p>
					{error ? <Alert tone="error">{error}</Alert> : null}
					<OtpInput value={code} onChange={setCode} onComplete={confirm} autoFocus disabled={busy} />
					<div className="flex flex-wrap items-center justify-between gap-3">
						<ResendLink left={left} onResend={send} busy={busy} />
						<div className="flex gap-2">
							<Button variant="ghost" onClick={() => setSent(null)}>
								Cancel
							</Button>
							<Button type="submit" loading={busy} disabled={code.length < 6}>
								Confirm
							</Button>
						</div>
					</div>
				</form>
			)}
		</Panel>
	)
}

function AppearancePanel() {
	const [scheme, setS] = useState(getScheme())
	const [rail, setR] = useState(getRail())
	return (
		<Panel title="Appearance" subtitle="Saved on this device." icon={Palette}>
			<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Mode</div>
			<div className="mb-4 grid grid-cols-3 gap-2">
				{SCHEMES.map((s) => {
					const Icon = SCHEME_ICON[s.id] || Monitor
					return (
						<button
							key={s.id}
							type="button"
							aria-pressed={scheme === s.id}
							onClick={() => {
								setScheme(s.id)
								setS(s.id)
							}}
							className={clsx(
								"flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition",
								scheme === s.id ? "border-brand-700 bg-brand-50 text-brand-700" : "border-line text-ink-muted hover:border-brand-300"
							)}
						>
							<Icon size={16} />
							{s.label}
						</button>
					)
				})}
			</div>
			<div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">Sidebar</div>
			<div className="space-y-1.5">
				{RAILS.map((r) => (
					<button
						key={r.id}
						type="button"
						aria-pressed={rail === r.id}
						onClick={() => {
							setRail(r.id)
							setR(r.id)
						}}
						className={clsx(
							"flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition",
							rail === r.id ? "border-brand-700 bg-brand-50" : "border-line hover:border-brand-300"
						)}
					>
						<span className="h-6 w-6 shrink-0 rounded-md border border-line" style={{ background: r.swatch }} />
						<span className="min-w-0 flex-1">
							<span className="block font-medium text-ink">{r.label}</span>
							<span className="block truncate text-xs text-ink-soft">{r.hint}</span>
						</span>
						{rail === r.id ? <Check size={16} className="shrink-0 text-brand-700" /> : null}
					</button>
				))}
			</div>
		</Panel>
	)
}
