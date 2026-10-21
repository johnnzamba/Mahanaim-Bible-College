import { Alert } from "@/shared/components/ui"
import { DEFAULT_REQUIRED_DOCS, docChecklist } from "../../lib"
import { DocChecklist } from "../DocChecklist"
import { DocumentUploader } from "../DocumentUploader"

const LABELS = {
	"National ID": "National ID or passport",
	"Passport Photo": "Passport photo",
	"KCSE Certificate": "KCSE certificate (or equivalent)",
	"Academic Certificate": "Academic certificates",
	"Recommendation Letter": "Recommendation letters",
	"Birth Certificate": "Birth certificate",
	Other: "Other supporting documents",
}

/** Slots for every document type: required groups first, then supporting documents. */
export function documentSlots(options) {
	const groups = options?.required_documents?.length ? options.required_documents : DEFAULT_REQUIRED_DOCS
	const all = options?.document_types?.length ? options.document_types : ["National ID", "Passport Photo", "KCSE Certificate", "Academic Certificate", "Recommendation Letter", "Birth Certificate", "Other"]
	const primary = groups.map((g) => g[0])
	const required = groups.map((g) => ({
		type: g[0],
		group: g,
		label: LABELS[g[0]] || g[0],
		hint: g.length > 1 ? `No ${g[0]}? Upload ${g.slice(1).join(" or ")} under supporting documents instead.` : undefined,
	}))
	const order = ["Academic Certificate", "Recommendation Letter", "Birth Certificate", "Other"]
	const supporting = all
		.filter((t) => !primary.includes(t))
		.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
		.map((t) => ({ type: t, label: LABELS[t] || t, recommended: t === "Recommendation Letter" }))
	return { required, supporting }
}

export function StepDocuments({ app, options, onChanged, error }) {
	if (!app) return null
	const checklist = docChecklist(app, options)
	const { required, supporting } = documentSlots(options)
	const haveTypes = new Set((app.documents || []).filter((d) => d.file).map((d) => d.document_type))
	if (app.photo) haveTypes.add("Passport Photo")
	return (
		<div className="space-y-6">
			<div className="grid gap-4 rounded-2xl border border-line bg-cream/40 p-4 sm:grid-cols-[1fr,1.2fr] sm:items-center">
				<DocChecklist checklist={checklist} compact />
				<p className="text-sm text-ink-muted">
					Upload clear scans or phone photos. Files are stored privately and only the admissions team can see them. You can come back and add
					documents later — they're saved as soon as they upload.
				</p>
			</div>
			{error ? <Alert tone="error" title="Some required documents are missing">{error}</Alert> : null}
			<section>
				<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Required</h3>
				<div className="grid gap-3 lg:grid-cols-2">
					{required.map((s) => (
						<DocumentUploader
							key={s.type}
							app={app}
							type={s.type}
							label={s.label}
							hint={s.hint}
							required
							satisfied={s.group.some((t) => haveTypes.has(t))}
							onChanged={onChanged}
						/>
					))}
				</div>
			</section>
			<section>
				<h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">Supporting documents</h3>
				<div className="grid gap-3 lg:grid-cols-2">
					{supporting.map((s) => (
						<DocumentUploader
							key={s.type}
							app={app}
							type={s.type}
							label={s.recommended ? `${s.label} (recommended)` : s.label}
							onChanged={onChanged}
						/>
					))}
				</div>
			</section>
		</div>
	)
}
