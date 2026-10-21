import { useState } from "react"
import { Download, Expand, FileText } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Button, Modal, Panel, QueryState, Skeleton } from "@/shared/components/ui"
import { M, letterPdfUrl } from "../lib"

function LetterFrame({ html, title, className = "h-[560px]" }) {
	// sandbox="" — the letter is server-rendered HTML; no scripts, forms or navigation inside the frame.
	return <iframe title={title} sandbox="" srcDoc={html} className={`w-full rounded-xl border border-line bg-white ${className}`} />
}

/** The admission letter, rendered inline in a sandboxed frame with PDF download. */
export function AdmissionLetter({ app }) {
	const [full, setFull] = useState(false)
	const q = useApi(M.letter, { name: app.name, format: "html" }, { staleTime: 60_000 })
	const pdf = letterPdfUrl(app.name)
	const actions = (
		<div className="flex flex-wrap gap-2">
			<Button variant="ghost" size="sm" icon={Expand} onClick={() => setFull(true)} disabled={!q.data?.html} aria-label="Full screen">
				<span className="hidden sm:inline">Full screen</span>
			</Button>
			<a href={pdf} className="btn btn-secondary btn-sm" download aria-label="Download PDF">
				<Download size={14} /> <span className="hidden sm:inline">Download</span> PDF
			</a>
		</div>
	)
	return (
		<Panel title="Admission letter" subtitle="Your official offer letter" icon={FileText} actions={actions}>
			<QueryState query={q} skeleton={<Skeleton className="h-[420px] w-full" />} isEmpty={(d) => !d?.html} empty={<p className="text-sm text-ink-muted">The letter is not available yet.</p>}>
				{(d) => <LetterFrame html={d.html} title={`Admission letter ${app.name}`} />}
			</QueryState>
			<Modal
				open={full}
				onClose={() => setFull(false)}
				size="full"
				title="Admission letter"
				subtitle={app.name}
				footer={
					<a href={pdf} className="btn btn-primary" download>
						<Download size={16} /> Download PDF
					</a>
				}
			>
				{q.data?.html ? <LetterFrame html={q.data.html} title={`Admission letter ${app.name} (full screen)`} className="h-[75vh]" /> : null}
			</Modal>
		</Panel>
	)
}
