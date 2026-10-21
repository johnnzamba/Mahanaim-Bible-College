import { useRef, useState } from "react"
import { Link } from "react-router-dom"
import clsx from "clsx"
import { ArrowRight, FileWarning, MessageSquareWarning, Upload } from "lucide-react"
import { frappe, plainText } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { Alert, Badge, Button } from "@/shared/components/ui"
import { toast } from "@/shared/components/toast"
import { DOC_UPLOAD_STATUSES, FILE_ACCEPT, INVALIDATE, M, docState, flaggedCount, flaggedLabel, needsReupload, validateFile } from "../lib"
import { uploadWithProgress } from "../upload"

const STATES = {
	verified: { tone: "green", label: "Verified" },
	flagged: { tone: "red", label: "New copy needed" },
	pending: { tone: "gray", label: "Awaiting check" },
	closed: { tone: "gray", label: "Not verified" },
}

/** Verified (green) · New copy needed (red) · Awaiting check (neutral). `closed`: uploads are no longer possible. */
export function DocStateBadge({ doc, size, closed }) {
	const state = docState(doc)
	const s = STATES[closed && state !== "verified" ? "closed" : state]
	return (
		<Badge tone={s.tone} size={size} dot>
			{s.label}
		</Badge>
	)
}

export const remarksText = (doc) => plainText(doc?.remarks).trim()

/** "1 to re-upload" pill for application lists (only while uploads are open). */
export function FlaggedBadge({ app, size = "xs" }) {
	const n = flaggedCount(app)
	if (!n || !DOC_UPLOAD_STATUSES.includes(app?.status)) return null
	return (
		<Badge tone="red" size={size}>
			{n} to re-upload
		</Badge>
	)
}

/** The admissions officer's note on a document, always rendered as plain text. */
export function DocRemarks({ doc, className, closed }) {
	const text = remarksText(doc)
	if (!text) return null
	const flagged = needsReupload(doc) && !closed
	return (
		<p
			className={clsx(
				"flex items-start gap-1.5 text-xs",
				flagged ? "rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100" : "text-ink-muted",
				className
			)}
		>
			<MessageSquareWarning size={14} className="mt-px shrink-0" aria-hidden />
			<span className="min-w-0 break-words">
				<span className="font-semibold">{flagged ? "Admissions: " : "Note: "}</span>
				{text}
			</span>
		</p>
	)
}

/** Replace one flagged document row with a new file (passes `row`, so the officer's flag is cleared). */
export function ReuploadButton({ app, doc, label = "Upload new copy", size = "sm", variant = "gold", className, onChanged }) {
	const invalidate = useInvalidate()
	const input = useRef(null)
	const [progress, setProgress] = useState(null)
	if (!DOC_UPLOAD_STATUSES.includes(app?.status)) return null

	const upload = async (file) => {
		const problem = validateFile(file)
		if (problem) return toast.error(problem)
		setProgress(0)
		try {
			const { file_url } = await uploadWithProgress(file, { onProgress: setProgress })
			const updated = await frappe.call(M.upload, { name: app.name, document_type: doc.document_type, file_url, row: doc.name })
			toast.success(`New copy of your ${doc.document_type} uploaded`)
			invalidate(...INVALIDATE)
			onChanged?.(updated)
		} catch (err) {
			toast.error(err.message)
		} finally {
			setProgress(null)
		}
	}

	return (
		<>
			<Button
				variant={variant}
				size={size}
				icon={Upload}
				loading={progress != null}
				onClick={() => input.current?.click()}
				className={className}
				aria-label={`Upload a new copy of your ${doc.document_type}`}
			>
				{progress != null ? `Uploading ${progress}%` : label}
			</Button>
			<input
				ref={input}
				type="file"
				accept={FILE_ACCEPT}
				className="hidden"
				tabIndex={-1}
				aria-hidden
				onChange={(e) => {
					const f = e.target.files?.[0]
					e.target.value = ""
					if (f) upload(f)
				}}
			/>
		</>
	)
}

/**
 * Attention banner when admissions asked for new copies of documents. Shown only while uploads are open.
 * `to` links to the documents section; `onOpen` is used instead when already on that page.
 */
export function FlaggedDocsAlert({ app, to, onOpen, withProgramme, className }) {
	const n = flaggedCount(app)
	if (!n || !DOC_UPLOAD_STATUSES.includes(app?.status)) return null
	const flagged = (app.documents || []).filter(needsReupload)
	const ctaClass = "btn btn-gold btn-sm mt-3"
	const cta = (
		<>
			<Upload size={14} aria-hidden /> Upload new {n === 1 ? "copy" : "copies"} <ArrowRight size={14} aria-hidden />
		</>
	)
	return (
		<Alert tone="warning" icon={FileWarning} className={className} title={flaggedLabel(n)}>
			<p>
				The admissions team asked for a clearer or corrected copy
				{withProgramme ? (
					<>
						{" "}
						for <span className="font-semibold">{app.programme_name || app.name}</span> ({app.name})
					</>
				) : null}
				. Your review continues once it's in.
			</p>
			{flagged.length ? (
				<ul className="mt-2 space-y-1">
					{flagged.map((d) => {
						const why = remarksText(d)
						return (
							<li key={d.name} className="break-words">
								<span className="font-semibold">{d.document_type}</span>
								{why ? <span> — {why}</span> : null}
							</li>
						)
					})}
				</ul>
			) : null}
			{onOpen ? (
				<button type="button" className={ctaClass} onClick={onOpen}>
					{cta}
				</button>
			) : to ? (
				<Link to={to} className={ctaClass}>
					{cta}
				</Link>
			) : null}
		</Alert>
	)
}
