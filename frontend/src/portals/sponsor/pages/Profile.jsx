import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { Building2, Church, HandCoins, KeyRound, Mail, MessageCircle, MessageSquare, Phone, RotateCcw, Save, ShieldCheck, Users } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Alert, Avatar, Badge, Button, Input, InfoRow, PageHeader, Panel, RadioCards, Skeleton, Textarea } from "@/shared/components/ui"
import { money, normalisePhone } from "@/shared/utils/format"
import { useProfile } from "../hooks"
import { COMMUNICATION, INVALIDATE, M } from "../lib"
import { SponsorQuery } from "../components/SponsorQuery"

const CHANNEL = {
	Email: { icon: Mail, description: "Statements and updates by email" },
	SMS: { icon: MessageSquare, description: "Short text alerts to your phone" },
	WhatsApp: { icon: MessageCircle, description: "Messages on WhatsApp" },
	Phone: { icon: Phone, description: "A call from our partnerships office" },
}
const TYPE_ICON = { Church, Organisation: Building2, Foundation: Building2 }
const FIELDS = ["contact_person", "phone", "country", "address", "preferred_communication"]

const pick = (p) => Object.fromEntries(FIELDS.map((k) => [k, p?.[k] || ""]))

export default function Profile() {
	const q = useProfile()
	return (
		<>
			<PageHeader eyebrow="Account" title="Sponsor profile" subtitle="How we know you and how you'd like to hear from us." />
			<SponsorQuery
				query={q}
				skeleton={
					<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
						<Skeleton className="h-[460px]" />
						<Skeleton className="h-[320px]" />
					</div>
				}
			>
				{(d) => <ProfileBody p={d.profile} summary={d.summary} />}
			</SponsorQuery>
		</>
	)
}

function ProfileBody({ p, summary }) {
	const [form, setForm] = useState(() => pick(p))
	const [errors, setErrors] = useState({})
	const base = useMemo(() => pick(p), [p])
	useEffect(() => setForm(base), [base])
	const dirty = FIELDS.some((k) => (form[k] || "") !== (base[k] || ""))
	const save = useAction(M.updateProfile, { invalidate: INVALIDATE, success: "Profile updated" })
	const set = (k) => (e) => {
		const v = e?.target ? e.target.value : e
		setForm((f) => ({ ...f, [k]: v }))
		if (errors[k]) setErrors((x) => ({ ...x, [k]: null }))
	}
	const TypeIcon = TYPE_ICON[p.sponsor_type] || Users

	const submit = (e) => {
		e.preventDefault()
		const errs = {}
		const digits = String(form.phone || "").replace(/\D/g, "")
		if (form.phone && (digits.length < 9 || digits.length > 15)) errs.phone = "Enter a valid phone number, e.g. 0712 345 678"
		if (["SMS", "WhatsApp", "Phone"].includes(form.preferred_communication) && !form.phone) errs.phone = `Add a phone number to receive ${form.preferred_communication} messages`
		if (form.contact_person.length > 140) errs.contact_person = "Keep this under 140 characters"
		setErrors(errs)
		if (Object.values(errs).some(Boolean)) return
		const data = {}
		for (const k of FIELDS) {
			let v = (form[k] || "").trim()
			if (k === "phone" && v) v = normalisePhone(v)
			if (v !== (base[k] || "")) data[k] = v
		}
		if (!Object.keys(data).length) return
		save.mutate({ data })
	}

	return (
		<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),340px]">
			<form onSubmit={submit} className="min-w-0 space-y-5" noValidate>
				<Panel title="Contact details" subtitle="Used for statements, receipts and student updates." icon={Users}>
					<div className="grid gap-4 sm:grid-cols-2">
						<Input label="Contact person" value={form.contact_person} onChange={set("contact_person")} error={errors.contact_person} placeholder="e.g. Rev. Jane Doe" autoComplete="name" />
						<Input
							label="Phone"
							type="tel"
							inputMode="tel"
							value={form.phone}
							onChange={set("phone")}
							error={errors.phone}
							hint="Also pre-fills M-Pesa payments"
							placeholder="0712 345 678"
							autoComplete="tel"
							icon={Phone}
						/>
						<Input label="Country" value={form.country} onChange={set("country")} placeholder="Kenya" autoComplete="country-name" />
						<Input label="Email" value={p.email || ""} disabled hint="Your sign-in email — change it under Account settings" icon={Mail} />
						<Textarea label="Postal / physical address" value={form.address} onChange={set("address")} rows={3} className="sm:col-span-2" placeholder={"P.O. Box 123\nNairobi"} />
					</div>
				</Panel>
				<Panel title="Communication preference" subtitle="How should we reach you first?" icon={MessageCircle}>
					<RadioCards
						value={form.preferred_communication}
						onChange={set("preferred_communication")}
						options={COMMUNICATION.map((c) => ({ value: c, label: c, ...CHANNEL[c] }))}
					/>
				</Panel>
				<div
					className={clsx(
						"z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-sm backdrop-blur",
						dirty && "sticky bottom-20 lg:bottom-4"
					)}
				>
					<span className="mr-auto text-sm text-ink-soft" aria-live="polite">
						{dirty ? "You have unsaved changes" : "All changes saved"}
					</span>
					<Button
						type="button"
						variant="ghost"
						icon={RotateCcw}
						disabled={!dirty || save.isPending}
						onClick={() => {
							setForm(base)
							setErrors({})
						}}
					>
						Reset
					</Button>
					<Button type="submit" icon={Save} loading={save.isPending} disabled={!dirty}>
						Save changes
					</Button>
				</div>
			</form>

			<aside className="space-y-5">
				<Panel>
					<div className="flex items-center gap-3">
						<Avatar name={p.sponsor_name} size={52} ring />
						<div className="min-w-0">
							<div className="truncate font-serif text-lg text-ink">{p.sponsor_name}</div>
							<div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
								<TypeIcon size={13} /> {p.sponsor_type}
								<Badge size="xs" status={p.status} />
							</div>
						</div>
					</div>
					<div className="mt-4 divide-y divide-line">
						<InfoRow label="Sponsor ID" value={<span className="font-mono">{p.name}</span>} />
						<InfoRow label="Partner church" value={p.partner_church_name || p.partner_church || "—"} />
						<InfoRow label="Students sponsored" value={summary?.students ?? p.active_sponsorships ?? 0} />
						<InfoRow label="Total committed" value={money(p.total_committed)} />
						<InfoRow label="Total disbursed" value={money(p.total_disbursed)} />
					</div>
					<p className="mt-3 text-xs text-ink-soft">To change your organisation name, type or partner church, please contact the partnerships office.</p>
				</Panel>
				<Panel title="Sign-in & security" icon={ShieldCheck}>
					<p className="text-sm text-ink-muted">Change your password, email or notification settings from your account page.</p>
					<Link to="/sponsor/account" className="btn btn-secondary btn-sm mt-3">
						<KeyRound size={14} /> Account settings
					</Link>
				</Panel>
				<Alert tone="brand" icon={HandCoins} title="Thank you for partnering with us">
					Your support keeps students in class. <Link to="/sponsor/giving#give" className="link">Give again</Link>
				</Alert>
			</aside>
		</div>
	)
}
