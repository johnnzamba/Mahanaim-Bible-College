import { Mail, Phone } from "lucide-react"
import { Divider, Input, Select, Textarea } from "@/shared/components/ui"
import { COUNTIES, GENDERS, MARITAL, RELATIONSHIPS } from "./fields"

export function StepPersonal({ form, set, errors }) {
	const bind = (f) => ({ value: form[f] ?? "", onChange: (e) => set(f, e.target.value), error: errors[f] })
	return (
		<div className="space-y-5">
			<div className="grid gap-4 sm:grid-cols-3">
				<Input label="First name" required autoComplete="given-name" {...bind("first_name")} />
				<Input label="Middle name" autoComplete="additional-name" {...bind("middle_name")} />
				<Input label="Last name" required autoComplete="family-name" {...bind("last_name")} />
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Email" icon={Mail} value={form.email} readOnly disabled hint="Your account email. Change it in Account settings." />
				<Input label="Phone" required icon={Phone} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" {...bind("phone")} />
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<Select label="Gender" required placeholder="Select" options={GENDERS} {...bind("gender")} />
				<Input label="Date of birth" required type="date" max={new Date().toISOString().slice(0, 10)} {...bind("date_of_birth")} />
				<Select label="Marital status" placeholder="Select" options={MARITAL} {...bind("marital_status")} />
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<Input label="National ID / Passport no." required inputMode="text" {...bind("national_id")} />
				<Input label="Nationality" {...bind("nationality")} />
				<Input label="County of residence" required list="mbc-counties" placeholder="e.g. Nairobi" {...bind("county")} />
				<datalist id="mbc-counties">
					{COUNTIES.map((c) => (
						<option key={c} value={c} />
					))}
				</datalist>
			</div>
			<Textarea label="Postal address" rows={2} placeholder="P.O. Box 123-00100, Nairobi" {...bind("postal_address")} />
			<Textarea
				label="Disability or special needs (optional)"
				rows={2}
				hint="Tell us about anything we should prepare for. This does not affect your application."
				{...bind("disability")}
			/>
			<Divider label="Next of kin" />
			<div className="grid gap-4 sm:grid-cols-3">
				<Input label="Full name" required {...bind("nok_name")} />
				<Input label="Relationship" list="mbc-relationships" placeholder="e.g. Parent" {...bind("nok_relationship")} />
				<datalist id="mbc-relationships">
					{RELATIONSHIPS.map((c) => (
						<option key={c} value={c} />
					))}
				</datalist>
				<Input label="Phone" required type="tel" inputMode="tel" placeholder="0722 000 000" {...bind("nok_phone")} />
			</div>
		</div>
	)
}
