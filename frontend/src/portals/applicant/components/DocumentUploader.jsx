import { useRef, useState } from "react"
import clsx from "clsx"
import { Eye, FileCheck2, FileText, FileWarning, RefreshCw, Trash2, Upload } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { Badge, Button, ConfirmDialog, FileDrop, IconButton, ProgressBar } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { DOC_HINTS, DOC_UPLOAD_STATUSES, FILE_ACCEPT, INVALIDATE, M, MAX_FILE_MB, MULTI_DOC_TYPES, fileName, needsReupload, validateFile } from "../lib"
import { uploadWithProgress } from "../upload"
import { DocRemarks, DocStateBadge } from "./DocState"
import { FilePreview } from "./FilePreview"

/**
 * One document slot on an application: shows the uploaded file(s) with verification status and lets the
 * applicant upload, replace (single-file types) or remove (drafts only). Rows admissions flagged for a new copy
 * are highlighted with the officer's note and an "Upload new copy" action that replaces that exact row.
 */
export function DocumentUploader({ app, type, label, hint, required, satisfied, onChanged, className }) {
	const invalidate = useInvalidate()
	const replaceRef = useRef(null)
	const replaceRow = useRef(null)
	const [progress, setProgress] = useState(null)
	const [error, setError] = useState("")
	const [preview, setPreview] = useState(null)
	const [removing, setRemoving] = useState(null)
	const [busyRemove, setBusyRemove] = useState(false)

	const docs = (app?.documents || []).filter((d) => d.document_type === type && d.file)
	const multi = MULTI_DOC_TYPES.includes(type)
	const canUpload = DOC_UPLOAD_STATUSES.includes(app?.status)
	const canRemove = app?.status === "Draft"
	const uploading = progress != null

	const upload = async (file, row) => {
		const problem = validateFile(file)
		if (problem) return setError(problem)
		setError("")
		setProgress(0)
		try {
			const { file_url } = await uploadWithProgress(file, { onProgress: setProgress })
			let updated = await frappe.call(M.upload, { name: app.name, document_type: type, file_url, ...(row ? { row } : {}) })
			if (type === "Passport Photo" && updated?.status === "Draft") {
				updated = await frappe.call(M.save, { name: app.name, data: { photo: file_url } }).catch(() => updated)
			}
			toast.success(row && docs.some((d) => d.name === row && needsReupload(d)) ? `New copy of your ${label || type} uploaded — admissions will check it again` : `${label || type} uploaded`)
			invalidate(...INVALIDATE)
			onChanged?.(updated)
		} catch (err) {
			setError(err.message)
		} finally {
			setProgress(null)
		}
	}

	const remove = async () => {
		setBusyRemove(true)
		try {
			const updated = await frappe.call(M.remove, { name: app.name, row: removing.name })
			toast.success("Document removed")
			invalidate(...INVALIDATE)
			onChanged?.(updated)
			setRemoving(null)
		} catch (err) {
			toast.error(err.message)
		} finally {
			setBusyRemove(false)
		}
	}

	const pickReplacement = (d) => {
		replaceRow.current = d.name
		replaceRef.current?.click()
	}

	const has = docs.length > 0
	const flagged = docs.filter(needsReupload)
	const attention = flagged.length > 0
	const ok = (has && flagged.length < docs.length) || Boolean(satisfied)
	const showDrop = canUpload && (!has || multi)
	const StateIcon = attention ? FileWarning : ok ? FileCheck2 : required ? FileWarning : FileText

	return (
		<div className={clsx("rounded-2xl border bg-surface p-4", attention && canUpload ? "border-amber-300 dark:border-amber-800" : "border-line", className)}>
			<div className="flex items-start gap-3">
				<span
					className={clsx(
						"grid h-10 w-10 shrink-0 place-items-center rounded-xl",
						ok && !attention ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : required || attention ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-brand-50 text-brand-700"
					)}
				>
					<StateIcon size={19} aria-hidden />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="font-semibold text-ink">{label || type}</span>
						{attention ? (
							<Badge tone="red" size="xs">
								New copy needed
							</Badge>
						) : required ? (
							<Badge tone={ok ? "green" : "orange"} size="xs">
								{has ? "Done" : ok ? "Covered" : "Required"}
							</Badge>
						) : (
							<Badge tone="gray" size="xs">
								{multi ? "Optional · multiple allowed" : "Optional"}
							</Badge>
						)}
					</div>
					<p className="mt-0.5 text-xs text-ink-muted">{hint || DOC_HINTS[type]}</p>
				</div>
			</div>

			{has ? (
				<ul className="mt-3 divide-y divide-line rounded-xl border border-line">
					{docs.map((d) => {
						const isFlagged = needsReupload(d)
						return (
							<li key={d.name} className={clsx("px-3 py-2", isFlagged && "bg-amber-50/60 dark:bg-amber-950/30")}>
								<div className="flex items-center gap-1">
									<button type="button" className="link min-w-0 flex-1 truncate text-left text-sm" onClick={() => setPreview(d)} title={fileName(d.file)}>
										{fileName(d.file)}
									</button>
									<IconButton icon={Eye} label={`Preview ${fileName(d.file)}`} onClick={() => setPreview(d)} />
									{canUpload && !multi && !d.verified && !isFlagged ? (
										<IconButton icon={RefreshCw} label="Replace file" onClick={() => pickReplacement(d)} disabled={uploading} />
									) : null}
									{canRemove && !d.verified ? (
										<IconButton icon={Trash2} tone="danger" label={`Remove ${fileName(d.file)}`} onClick={() => setRemoving(d)} />
									) : null}
								</div>
								<DocStateBadge doc={d} size="xs" />
								<DocRemarks doc={d} className="mt-2" />
								{isFlagged && canUpload ? (
									<Button
										variant="gold"
										size="sm"
										icon={Upload}
										loading={uploading}
										onClick={() => pickReplacement(d)}
										className="mt-2"
										aria-label={`Upload a new copy of your ${label || type}`}
									>
										Upload new copy
									</Button>
								) : null}
							</li>
						)
					})}
				</ul>
			) : null}

			{showDrop ? (
				<FileDrop
					className="mt-3"
					accept={FILE_ACCEPT}
					busy={uploading}
					onFile={upload}
					hint={`PDF, JPG or PNG · up to ${MAX_FILE_MB} MB${multi && has ? " · add another" : ""}`}
				/>
			) : null}
			<input
				ref={replaceRef}
				type="file"
				accept={FILE_ACCEPT}
				className="hidden"
				aria-label={`Replace ${label || type}`}
				onChange={(e) => {
					const f = e.target.files?.[0]
					const row = replaceRow.current
					e.target.value = ""
					replaceRow.current = null
					if (f) upload(f, row)
				}}
			/>
			{uploading ? <ProgressBar className="mt-3" value={progress} size="sm" label="Uploading…" /> : null}
			{error ? (
				<p className="mt-2 text-xs font-medium text-red-600 dark:text-red-300" role="alert">
					{error}
				</p>
			) : null}
			{!canUpload && !has ? <p className="mt-3 text-xs text-ink-soft">Uploads are closed for this application.</p> : null}

			<FilePreview file={preview?.file} title={label || type} onClose={() => setPreview(null)} />
			<ConfirmDialog
				open={Boolean(removing)}
				title="Remove this document?"
				message={removing ? `${fileName(removing.file)} will be removed from your application.` : ""}
				confirmLabel="Remove"
				tone="danger"
				loading={busyRemove}
				onConfirm={remove}
				onClose={() => setRemoving(null)}
			/>
		</div>
	)
}
