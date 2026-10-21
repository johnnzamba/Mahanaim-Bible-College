import { useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, CalendarRange, ChevronDown, Mail, MessageSquareText, Scale, Send, Smartphone } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Alert, Badge, Button, Input, Textarea, Tile } from "@/shared/components/ui"
import { dateTime } from "@/shared/utils/format"
import { FORM_TABS, NUMBER_TOKEN_HELP, previewNumber } from "../schema"
import { FormSection, SettingField, useLinkSources, useSettingsForm } from "../lib"

function Section({ section, form, sources }) {
	const { values, set, errors, server } = form
	const [open, setOpen] = useState(() => !section.collapsible || section.fields.some((f) => f.type === "check" && Number(values[f.key])))
	const fields = section.fields.filter((f) => !f.when || f.when(values))
	const toggle = section.collapsible ? (
		<Button size="sm" variant="ghost" iconRight={ChevronDown} onClick={() => setOpen((o) => !o)} className={clsx(open && "[&_svg]:rotate-180")} aria-expanded={open}>
			{open ? "Hide" : "Show"}
		</Button>
	) : null
	return (
		<FormSection title={section.title} subtitle={section.subtitle} icon={section.icon} actions={toggle} cols={section.cols || 2} className={clsx(!open && "[&>div]:hidden")}>
			{fields.map((f) => (
				<SettingField key={f.key} f={f} values={values} set={set} errors={errors} stored={server} linkOptions={sources} />
			))}
			{section.preview ? <NumberPreview format={values.student_number_format} shortName={values.short_name} /> : null}
		</FormSection>
	)
}

function NumberPreview({ format, shortName }) {
	return (
		<div className="grid gap-4 sm:col-span-2 md:grid-cols-[1fr_1.2fr]">
			<div className="rounded-xl border border-gold-200 bg-cream px-4 py-3">
				<p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Numbers will look like</p>
				<p className="mt-1 break-all font-mono text-lg font-semibold text-ink">{previewNumber(format, shortName) || "—"}</p>
				<p className="mt-1 text-xs text-ink-soft">Sample for a Diploma in Theology student at Nairobi.</p>
			</div>
			<dl className="grid content-center gap-y-1.5 text-xs">
				{NUMBER_TOKEN_HELP.map(([t, d]) => (
					<div key={t} className="flex min-w-0 items-baseline gap-2">
						<dt className="shrink-0 font-mono font-semibold text-brand-700">{t}</dt>
						<dd className="truncate text-ink-soft">{d}</dd>
					</div>
				))}
			</dl>
		</div>
	)
}

function AcademicLinks() {
	return (
		<section className="card p-5">
			<h3 className="text-[15px] font-semibold text-ink">Calendar & grading live in Academics</h3>
			<p className="mt-0.5 text-xs text-ink-soft">Academic years, terms, registration windows, exam dates and grading scales are maintained by the registry.</p>
			<div className="mt-4 grid gap-3 sm:grid-cols-2">
				<Tile to="/admin/academics/calendar" icon={CalendarRange} label="Academic calendar" sub="Years, terms and key dates" tone="brand" />
				<Tile to="/admin/academics/grading" icon={Scale} label="Grading scales" sub="Grade bands and GPA points" tone="gold" />
			</div>
		</section>
	)
}

function TestSms({ enabled, provider, dirty }) {
	const [phone, setPhone] = useState("")
	const [message, setMessage] = useState("")
	const [result, setResult] = useState(null)
	const send = useAction("mahanaim.api.communication.send_test_sms", { onSuccess: (r) => setResult(r) })
	const log = result?.log
	const failed = log && /fail|error/i.test(log.status || "")
	return (
		<FormSection title="Send a test SMS" subtitle="Uses the saved gateway settings and records the message in the message log." icon={Send} cols={1}>
			{!Number(enabled) || provider === "None" ? (
				<Alert tone="warning" title="SMS sending is off">
					The message will be logged but not delivered until SMS is enabled with a provider.
				</Alert>
			) : null}
			{dirty ? <Alert tone="info">Save your changes first; the test uses the stored settings.</Alert> : null}
			<form
				className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]"
				onSubmit={(e) => {
					e.preventDefault()
					setResult(null)
					send.mutate({ phone, message: message || undefined })
				}}
			>
				<Input label="Mobile number" icon={Smartphone} inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} required />
				<Textarea label="Message (optional)" rows={2} maxLength={459} placeholder="Test message from the college." value={message} onChange={(e) => setMessage(e.target.value)} />
				<div className="sm:col-span-2">
					<Button type="submit" icon={Send} loading={send.isPending} disabled={!phone.trim()}>
						Send test
					</Button>
				</div>
			</form>
			{result ? (
				<Alert tone={failed ? "error" : "success"} title={failed ? "The gateway rejected the message" : "Test message processed"}>
					{log ? (
						<span className="flex flex-wrap items-center gap-2">
							Status <Badge status={log.status}>{log.status}</Badge>
							{log.provider_response ? <span className="break-all font-mono text-xs">{String(log.provider_response).slice(0, 240)}</span> : null}
						</span>
					) : (
						"No message log entry was returned."
					)}
				</Alert>
			) : null}
		</FormSection>
	)
}

function EmailInfo() {
	return (
		<section className="card p-5">
			<div className="flex items-start gap-3">
				<span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
					<Mail size={17} />
				</span>
				<div className="min-w-0">
					<h3 className="text-[15px] font-semibold text-ink">Email</h3>
					<p className="mt-0.5 text-xs text-ink-soft">Outgoing email uses the site's default Email Account. Message wording is managed under message templates.</p>
				</div>
			</div>
			<div className="mt-4 grid gap-3 sm:grid-cols-2">
				<Tile to="/admin/communication/templates" icon={MessageSquareText} label="Message templates" sub="SMS and email wording per event" tone="brand" />
				<Tile to="/admin/communication/messages" icon={Mail} label="Message log" sub="Delivery status and retries" tone="blue" />
			</div>
		</section>
	)
}

function SecuritySummary({ values }) {
	const mfa = Number(values.admin_mfa_required)
	const items = [
		["Staff one-time code", mfa ? "Required" : "Off", mfa ? "green" : "orange"],
		["Codes", `${values.otp_length || "—"} digits · ${values.otp_expiry_minutes || "—"} min`, "gray"],
		["Lock-out", `after ${values.otp_max_attempts || "—"} wrong tries`, "gray"],
	]
	return (
		<section className="card p-5">
			<h3 className="text-[15px] font-semibold text-ink">At a glance</h3>
			<ul className="mt-3 space-y-2 text-sm">
				{items.map(([k, v, tone]) => (
					<li key={k} className="flex items-center justify-between gap-3">
						<span className="text-ink-muted">{k}</span>
						<Badge tone={tone}>{v}</Badge>
					</li>
				))}
			</ul>
			{!mfa ? (
				<Alert tone="warning" className="mt-4">
					Staff can sign in with a password alone. One-time codes protect finance and student records if a password leaks.
				</Alert>
			) : null}
			<Link to="/admin/audit?tab=access" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
				Review sign-in activity <ArrowRight size={14} />
			</Link>
		</section>
	)
}

/** One Mahanaim Settings tab rendered from the schema, plus tab-specific helpers. */
export default function FormTab({ tab }) {
	const form = useSettingsForm()
	const sources = useLinkSources()
	const def = FORM_TABS[tab]
	const sections = def.sections.map((s) => <Section key={s.title} section={s} form={form} sources={sources} />)
	const stamp = form.server?.modified ? <p className="text-xs text-ink-soft">Last saved {dateTime(form.server.modified)}</p> : null
	if (tab === "academic")
		return (
			<div className="space-y-5">
				{sections}
				<AcademicLinks />
				{stamp}
			</div>
		)
	if (tab === "communication")
		return (
			<div className="space-y-5">
				{sections}
				<TestSms enabled={form.server?.sms_enabled} provider={form.server?.sms_provider} dirty={form.dirty.some((k) => k.startsWith("sms_"))} />
				<EmailInfo />
				{stamp}
			</div>
		)
	if (tab === "security")
		return (
			<div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
				<div className="space-y-5">{sections}</div>
				<div className="space-y-5">
					<SecuritySummary values={form.values} />
					{stamp}
				</div>
			</div>
		)
	return (
		<div className="space-y-5">
			{sections}
			{stamp}
		</div>
	)
}
