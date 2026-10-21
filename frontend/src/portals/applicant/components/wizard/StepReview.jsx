import { Pencil } from "lucide-react"
import { Alert, Badge, Button, Checkbox, KeyValueGrid } from "@/shared/components/ui"
import { date, money } from "@/shared/utils/format"

function Section({ title, step, onEdit, children }) {
	return (
		<section className="rounded-2xl border border-line p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h3 className="font-semibold text-ink">{title}</h3>
				<Button variant="ghost" size="sm" icon={Pencil} onClick={() => onEdit(step)} aria-label={`Edit ${title}`}>
					Edit
				</Button>
			</div>
			{children}
		</section>
	)
}

export const DECLARATION =
	"I declare that the information in this application is true and complete. I understand that false or incomplete information may lead to my application being rejected or my admission being cancelled, and I agree to abide by the rules and regulations of Mahanaim Bible College."

export function StepReview({ form, records, app, options, onEdit, declared, setDeclared, error }) {
	const prog = options?.programmes?.find((p) => p.name === form.programme)
	const missing = (app?.missing || []).filter((m) => m !== "Declaration")
	const docLabels = new Set((options?.required_documents || []).map((group) => [].concat(group).join(" or ")))
	const missingGroups = [
		{ title: "Details", items: missing.filter((m) => !docLabels.has(m)) },
		{ title: "Documents to upload", items: missing.filter((m) => docLabels.has(m)) },
	].filter((g) => g.items.length)
	const docs = (app?.documents || []).filter((d) => d.file)
	const feeRequired = options?.application_fee_required !== false && options?.application_fee_required !== 0
	const fee = app?.application_fee ?? prog?.application_fee
	const v = (x) => x || "—"
	return (
		<div className="space-y-4">
			{missing.length ? (
				<Alert tone="warning" title="A few things are still missing">
					<div className="mt-1 grid gap-3 sm:grid-cols-2">
						{missingGroups.map((g) => (
							<div key={g.title}>
								<div className="text-xs font-semibold uppercase tracking-wide">{g.title}</div>
								<ul className="mt-1 list-disc space-y-0.5 pl-5">
									{g.items.map((m) => (
										<li key={m}>{m}</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</Alert>
			) : (
				<Alert tone="success" title="Everything we need is here">
					Check your details below, accept the declaration and submit.
				</Alert>
			)}

			<Section title="Programme & intake" step={0} onEdit={onEdit}>
				<KeyValueGrid
					cols={2}
					items={[
						{ label: "Programme", value: prog?.programme_name || form.programme, wide: true },
						{ label: "Campus", value: v(form.campus) },
						{ label: "Study mode", value: v(form.study_mode) },
						{ label: "Intake", value: v(form.intake) },
						{ label: "Fees paid by", value: v(form.sponsorship_type) },
					]}
				/>
			</Section>
			<Section title="Personal details" step={1} onEdit={onEdit}>
				<KeyValueGrid
					cols={3}
					items={[
						{ label: "Full name", value: [form.first_name, form.middle_name, form.last_name].filter(Boolean).join(" ") },
						{ label: "Phone", value: v(form.phone) },
						{ label: "Gender", value: v(form.gender) },
						{ label: "Email", value: v(form.email), wide: true },
						{ label: "Date of birth", value: form.date_of_birth ? date(form.date_of_birth) : "—" },
						{ label: "ID / Passport", value: v(form.national_id) },
						{ label: "County", value: v(form.county) },
						{ label: "Nationality", value: v(form.nationality) },
						{ label: "Next of kin", value: form.nok_name ? `${form.nok_name}${form.nok_relationship ? ` (${form.nok_relationship})` : ""} · ${form.nok_phone || "—"}` : "—" },
					]}
				/>
			</Section>
			<Section title="Church & references" step={2} onEdit={onEdit}>
				<KeyValueGrid
					cols={3}
					items={[
						{ label: "Home church", value: v(form.home_church) },
						{ label: "Denomination", value: v(form.denomination) },
						{ label: "Year of salvation", value: v(form.year_born_again) },
						{ label: "Pastor", value: form.pastor_name ? `${form.pastor_name} · ${form.pastor_phone || "—"}` : "—" },
						{ label: "Ministry role", value: v(form.ministry_role) },
					]}
				/>
				{form.testimony ? <p className="mt-3 line-clamp-3 text-sm text-ink-muted">“{form.testimony}”</p> : null}
			</Section>
			<Section title="Academic background" step={3} onEdit={onEdit}>
				<KeyValueGrid
					cols={3}
					items={[
						{ label: "Highest qualification", value: v(form.highest_qualification) },
						{ label: "KCSE grade", value: v(form.kcse_mean_grade) },
						{ label: "KCSE year", value: v(form.kcse_year) },
					]}
				/>
				{records.filter((r) => r.institution).length ? (
					<ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
						{records
							.filter((r) => r.institution)
							.map((r, i) => (
								<li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
									<span className="font-medium text-ink">{r.institution}</span>
									<span className="text-ink-muted">{[r.qualification, r.year_completed, r.grade].filter(Boolean).join(" · ")}</span>
								</li>
							))}
					</ul>
				) : null}
			</Section>
			<Section title="Documents" step={4} onEdit={onEdit}>
				{docs.length ? (
					<ul className="flex flex-wrap gap-2">
						{docs.map((d) => (
							<li key={d.name}>
								<Badge tone="green">
									{d.document_type}
								</Badge>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-ink-soft">No documents uploaded yet.</p>
				)}
			</Section>

			{feeRequired && fee ? (
				<Alert tone="brand" title={`Application fee: ${money(fee)}`}>
					{app?.fee_status === "Paid" || app?.fee_status === "Waived"
						? "Your application fee is already settled."
						: "After you submit, you'll pay this by M-Pesa straight away. Review begins once it's paid."}
				</Alert>
			) : null}

			<div className="rounded-2xl border border-line bg-cream/50 p-4">
				<Checkbox checked={declared} onChange={setDeclared} label="Declaration" description={DECLARATION} />
				{error ? <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
			</div>
		</div>
	)
}
