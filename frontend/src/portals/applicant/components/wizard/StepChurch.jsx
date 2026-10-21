import { Phone } from "lucide-react"
import { Divider, Input, Textarea } from "@/shared/components/ui"

export function StepChurch({ form, set, errors }) {
	const bind = (f) => ({ value: form[f] ?? "", onChange: (e) => set(f, e.target.value), error: errors[f] })
	return (
		<div className="space-y-5">
			<p className="text-sm text-ink-muted">
				Mahanaim trains men and women for Christian ministry, so we ask every applicant about their faith and home church. Your
				pastor may be contacted as a reference.
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Home church" required placeholder="e.g. Deliverance Church Kiambu" {...bind("home_church")} />
				<Input label="Denomination" placeholder="e.g. Pentecostal, Anglican, Baptist" {...bind("denomination")} />
				<Input label="Year of salvation" type="number" inputMode="numeric" min="1920" max={new Date().getFullYear()} placeholder="e.g. 2012" {...bind("year_born_again")} />
				<Input label="Current ministry role" placeholder="e.g. Youth leader, Sunday school teacher" {...bind("ministry_role")} />
			</div>
			<Divider label="Pastor's reference" />
			<div className="grid gap-4 sm:grid-cols-2">
				<Input label="Senior pastor's name" required placeholder="e.g. Rev. Peter Kamau" {...bind("pastor_name")} />
				<Input label="Pastor's phone" required icon={Phone} type="tel" inputMode="tel" placeholder="0733 000 000" {...bind("pastor_phone")} />
			</div>
			<Divider label="Your story" />
			<Textarea label="Brief Christian testimony" rows={4} placeholder="How did you come to faith in Christ?" hint="A few sentences is enough." {...bind("testimony")} />
			<Textarea
				label="Ministry experience & calling"
				rows={4}
				placeholder="Tell us about your ministry so far and why you want to study at Mahanaim."
				{...bind("ministry_experience")}
			/>
		</div>
	)
}
