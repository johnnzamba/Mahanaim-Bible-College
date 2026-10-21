import { Plus, School, Trash2 } from "lucide-react"
import { Button, Divider, IconButton, Input, Select } from "@/shared/components/ui"
import { EMPTY_RECORD, KCSE_GRADES, QUALIFICATIONS } from "./fields"

export function StepAcademic({ form, set, errors, records, setRecords }) {
	const bind = (f) => ({ value: form[f] ?? "", onChange: (e) => set(f, e.target.value), error: errors[f] })
	const update = (i, k, v) => setRecords((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
	const remove = (i) => setRecords((rows) => rows.filter((_, j) => j !== i))
	const add = () => setRecords((rows) => [...rows, { ...EMPTY_RECORD }])
	return (
		<div className="space-y-5">
			<div className="grid gap-4 sm:grid-cols-3">
				<Input label="Highest qualification" required list="mbc-qualifications" placeholder="e.g. KCSE, Diploma" {...bind("highest_qualification")} />
				<datalist id="mbc-qualifications">
					{QUALIFICATIONS.map((q) => (
						<option key={q} value={q} />
					))}
				</datalist>
				<Select label="KCSE mean grade" placeholder="Select" options={KCSE_GRADES} {...bind("kcse_mean_grade")} />
				<Input label="KCSE year" type="number" inputMode="numeric" min="1960" max={new Date().getFullYear()} placeholder="e.g. 2016" {...bind("kcse_year")} />
			</div>

			<Divider label="Schools & colleges attended" />
			<p className="-mt-2 text-sm text-ink-muted">List your secondary school and any colleges or universities, most recent first.</p>
			{records.length ? (
				<ol className="space-y-3">
					{records.map((r, i) => (
						<li key={i} className="rounded-2xl border border-line bg-surface p-4">
							<div className="mb-3 flex items-center justify-between gap-2">
								<span className="flex items-center gap-2 text-sm font-semibold text-ink">
									<School size={16} className="text-gold-700" aria-hidden /> Record {i + 1}
								</span>
								<IconButton icon={Trash2} tone="danger" label={`Remove record ${i + 1}`} onClick={() => remove(i)} />
							</div>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
								<Input
									label="Institution"
									required
									className="lg:col-span-2"
									value={r.institution}
									onChange={(e) => update(i, "institution", e.target.value)}
									error={errors[`records.${i}.institution`]}
									placeholder="e.g. Kiambu High School"
								/>
								<Input
									label="Qualification"
									required
									list="mbc-qualifications"
									value={r.qualification}
									onChange={(e) => update(i, "qualification", e.target.value)}
									error={errors[`records.${i}.qualification`]}
									placeholder="e.g. KCSE"
								/>
								<div className="grid grid-cols-2 gap-3">
									<Input
										label="Year"
										type="number"
										inputMode="numeric"
										value={r.year_completed}
										onChange={(e) => update(i, "year_completed", e.target.value)}
										error={errors[`records.${i}.year_completed`]}
									/>
									<Input label="Grade" value={r.grade} onChange={(e) => update(i, "grade", e.target.value)} placeholder="e.g. C+" />
								</div>
							</div>
						</li>
					))}
				</ol>
			) : (
				<p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-soft">No schools added yet.</p>
			)}
			<Button variant="secondary" icon={Plus} onClick={add}>
				Add {records.length ? "another" : "a"} school or college
			</Button>
		</div>
	)
}
