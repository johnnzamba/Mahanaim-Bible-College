import { useState } from "react"
import { Eye, FileText, Plus } from "lucide-react"
import { Badge, Button } from "@/shared/components/ui"
import { DOC_UPLOAD_STATUSES, fileName } from "../lib"
import { DocumentUploader } from "./DocumentUploader"
import { FilePreview } from "./FilePreview"
import { documentSlots } from "./wizard/StepDocuments"

/**
 * Every document slot of one application. While uploads are open, required slots and any supporting types
 * already used are shown as uploaders; other supporting types sit behind "Add another". Otherwise a read-only list.
 */
export function ApplicationDocuments({ app, options, onChanged }) {
	const [more, setMore] = useState(false)
	const docs = (app.documents || []).filter((d) => d.file)
	if (!DOC_UPLOAD_STATUSES.includes(app.status)) return <DocumentList docs={docs} />
	const { required, supporting } = documentSlots(options)
	const have = new Set(docs.map((d) => d.document_type))
	if (app.photo) have.add("Passport Photo")
	const shown = supporting.filter((s) => have.has(s.type) || s.recommended)
	const extra = supporting.filter((s) => !have.has(s.type) && !s.recommended)
	return (
		<div className="grid gap-3 xl:grid-cols-2">
			{required.map((s) => (
				<DocumentUploader
					key={s.type}
					app={app}
					type={s.type}
					label={s.label}
					hint={s.hint}
					required
					satisfied={s.group.some((t) => have.has(t))}
					onChanged={onChanged}
				/>
			))}
			{shown.map((s) => (
				<DocumentUploader key={s.type} app={app} type={s.type} label={s.recommended ? `${s.label} (recommended)` : s.label} onChanged={onChanged} />
			))}
			{more
				? extra.map((s) => <DocumentUploader key={s.type} app={app} type={s.type} label={s.label} onChanged={onChanged} />)
				: extra.length ? (
						<button
							type="button"
							onClick={() => setMore(true)}
							className="flex min-h-[96px] items-center justify-center gap-2 rounded-2xl border border-dashed border-line p-4 text-sm font-semibold text-brand-700 transition hover:bg-cream/60"
						>
							<Plus size={16} aria-hidden /> Add another supporting document
						</button>
					) : null}
		</div>
	)
}

export function VerificationBadge({ doc }) {
	if (doc.verified) return <Badge tone="green" dot>Verified</Badge>
	if (doc.remarks) return <Badge tone="red" dot>Needs attention</Badge>
	return <Badge tone="orange" dot>Awaiting verification</Badge>
}

export function DocumentList({ docs }) {
	const [preview, setPreview] = useState(null)
	if (!docs.length) return <p className="text-sm text-ink-soft">No documents were uploaded with this application.</p>
	return (
		<>
			<ul className="divide-y divide-line rounded-xl border border-line">
				{docs.map((d) => (
					<li key={d.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
						<FileText size={18} className="shrink-0 text-ink-soft" aria-hidden />
						<div className="min-w-0 flex-1">
							<div className="text-sm font-semibold text-ink">{d.document_type}</div>
							<div className="truncate text-xs text-ink-soft">{fileName(d.file)}</div>
							{d.remarks ? <div className="mt-0.5 text-xs text-red-600 dark:text-red-300">{d.remarks}</div> : null}
						</div>
						{d.verified ? <Badge tone="green" dot>Verified</Badge> : <Badge tone="gray" dot>Not verified</Badge>}
						<Button variant="ghost" size="sm" icon={Eye} onClick={() => setPreview(d)}>
							View
						</Button>
					</li>
				))}
			</ul>
			<FilePreview file={preview?.file} title={preview?.document_type} onClose={() => setPreview(null)} />
		</>
	)
}
