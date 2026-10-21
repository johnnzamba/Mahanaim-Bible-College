import { ExternalLink, FileText } from "lucide-react"
import { Empty, Modal } from "@/shared/components/ui"
import { safeUrl } from "@/shared/utils/sanitize"
import { fileName, isImage, isPdf } from "../lib"

/** In-app preview of an uploaded (private) file: images inline, PDFs in a frame. */
export function FilePreview({ file, title, onClose }) {
	const open = Boolean(file)
	const href = safeUrl(file)
	// Only same-origin uploads are framed; anything else opens in a new tab.
	const sameOrigin = Boolean(href && href.startsWith("/"))
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title={title || "Document"}
			subtitle={file ? fileName(file) : undefined}
			footer={
				href ? (
					<a href={href} target="_blank" rel="noreferrer" className="btn btn-secondary">
						<ExternalLink size={16} /> Open in new tab
					</a>
				) : null
			}
		>
			{!file ? null : !href ? (
				<Empty icon={FileText} title="This file link can't be opened" subtitle="Please re-upload the document or contact the admissions office." compact />
			) : isImage(file) ? (
				<img src={href} alt={title || fileName(file)} className="mx-auto max-h-[70vh] rounded-xl border border-line object-contain" />
			) : isPdf(file) && sameOrigin ? (
				<iframe src={href} title={title || fileName(file)} className="h-[70vh] w-full rounded-xl border border-line bg-white" />
			) : (
				<Empty icon={FileText} title="No preview for this file type" subtitle="Open it in a new tab to view or download it." compact />
			)}
		</Modal>
	)
}
