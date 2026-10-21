import { CalendarDays, Clock, GraduationCap, Laptop, Wallet } from "lucide-react"
import { Alert, Field, RadioCards, Select } from "@/shared/components/ui"
import { date, money } from "@/shared/utils/format"
import { years } from "../ProgrammeCard"
import { SPONSORSHIP } from "./fields"

export function StepProgramme({ form, set, errors, options }) {
	const programmes = options?.programmes || []
	const prog = programmes.find((p) => p.name === form.programme)
	const campuses = prog?.campuses?.length ? prog.campuses : (options?.campuses || []).map((c) => c.name)
	const modes = prog?.study_modes?.length ? prog.study_modes : (options?.study_modes || []).map((m) => m.name)
	const intakes = options?.intakes || []
	const intake = intakes.find((i) => i.name === form.intake)

	const pickProgramme = (code) => {
		const p = programmes.find((x) => x.name === code)
		set("programme", code)
		if (p?.campuses?.length && !p.campuses.includes(form.campus)) set("campus", p.campuses.length === 1 ? p.campuses[0] : "")
		if (p?.study_modes?.length && !p.study_modes.includes(form.study_mode)) set("study_mode", p.study_modes.length === 1 ? p.study_modes[0] : "")
	}

	return (
		<div className="space-y-6">
			<Field label="Programme" required error={errors.programme}>
				{programmes.length > 8 ? (
					<Select
						value={form.programme}
						onChange={(e) => pickProgramme(e.target.value)}
						placeholder="Choose a programme"
						options={programmes.map((p) => ({ value: p.name, label: `${p.programme_name} (${p.level || p.code})` }))}
						aria-label="Programme"
					/>
				) : (
					<RadioCards
						cols={programmes.length > 2 ? 3 : 2}
						value={form.programme}
						onChange={pickProgramme}
						options={programmes.map((p) => ({
							value: p.name,
							label: p.programme_name,
							description: `${p.level || p.code} · ${years(p.duration_years)} · Fee ${money(p.application_fee)}`,
							icon: GraduationCap,
						}))}
					/>
				)}
			</Field>

			{prog ? (
				<div className="grid gap-3 rounded-2xl border border-line bg-cream/50 p-4 text-sm sm:grid-cols-3">
					<div className="flex items-start gap-2.5">
						<Clock size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden />
						<div>
							<div className="text-xs text-ink-soft">Duration</div>
							<div className="font-semibold text-ink">{years(prog.duration_years)}</div>
						</div>
					</div>
					<div className="flex items-start gap-2.5">
						<Wallet size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden />
						<div>
							<div className="text-xs text-ink-soft">Application fee</div>
							<div className="font-semibold text-ink">{options?.application_fee_required === false || options?.application_fee_required === 0 ? "Not required" : money(prog.application_fee)}</div>
						</div>
					</div>
					<div className="flex items-start gap-2.5">
						<GraduationCap size={17} className="mt-0.5 shrink-0 text-gold-700" aria-hidden />
						<div>
							<div className="text-xs text-ink-soft">Minimum entry</div>
							<div className="font-semibold text-ink">{prog.minimum_entry || "See admissions office"}</div>
						</div>
					</div>
				</div>
			) : null}

			<div className="grid gap-4 sm:grid-cols-2">
				<Select
					label="Campus"
					required
					value={form.campus}
					onChange={(e) => set("campus", e.target.value)}
					placeholder={prog ? "Choose a campus" : "Choose a programme first"}
					options={campuses}
					error={errors.campus}
					disabled={!prog}
				/>
				<Select
					label="Intake"
					required={intakes.length > 0}
					value={form.intake}
					onChange={(e) => set("intake", e.target.value)}
					placeholder={intakes.length ? "Choose an intake" : "No intakes are open"}
					options={intakes.map((i) => ({ value: i.name, label: `${i.intake_name}${i.start_date ? ` — starts ${date(i.start_date)}` : ""}` }))}
					error={errors.intake}
					hint={intake?.application_close_date ? `Applications close ${date(intake.application_close_date)}` : undefined}
				/>
			</div>

			<Field label="Study mode" required error={errors.study_mode}>
				{prog ? (
					<RadioCards
						cols={modes.length >= 3 ? 3 : 2}
						value={form.study_mode}
						onChange={(v) => set("study_mode", v)}
						options={modes.map((m) => ({ value: m, label: m, icon: /online|distance/i.test(m) ? Laptop : CalendarDays }))}
					/>
				) : (
					<p className="text-sm text-ink-soft">Choose a programme to see its study modes.</p>
				)}
			</Field>

			<Select
				label="Who will pay your fees?"
				value={form.sponsorship_type}
				onChange={(e) => set("sponsorship_type", e.target.value)}
				options={SPONSORSHIP}
				hint="This helps us connect you with the finance and sponsorship office."
				className="sm:max-w-sm"
			/>
			{!programmes.length ? <Alert tone="warning">No programmes are open for applications right now.</Alert> : null}
		</div>
	)
}
