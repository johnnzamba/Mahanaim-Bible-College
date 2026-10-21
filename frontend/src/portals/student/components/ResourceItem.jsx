import { useState } from "react"
import clsx from "clsx"
import { CheckCircle2, ChevronDown, Circle, Download, ExternalLink, Loader2 } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useAction, useInvalidate } from "@/shared/api/hooks"
import { Badge, Button, Html } from "@/shared/components/ui"
import { API, INV, httpsUrl, safeUrl } from "./lib"
import { IconChip, resourceIcon } from "./bits"

const TONES = { PDF: "red", Document: "blue", Video: "purple", Audio: "orange", Image: "gold", Link: "blue", Embed: "purple", Text: "brand" }

/** One learning resource: expandable viewer + mark-complete. */
export function ResourceItem({ resource: r, defaultOpen = false }) {
	const [open, setOpen] = useState(defaultOpen)
	const invalidate = useInvalidate()
	const status = r.progress?.status
	const done = status === "Completed"
	const mark = useAction(API.markResource, { invalidate: [INV.learning], success: "Marked as complete" })
	const Icon = resourceIcon(r.resource_type)
	const dl = safeUrl(r.download_url)
	const link = safeUrl(r.url)
	const href = dl || link || httpsUrl(r.embed_url)

	const touch = () => {
		if (status) return
		frappe
			.call(API.markResource, { resource: r.name, progress: 50 })
			.then(() => invalidate(INV.learning))
			.catch(() => {})
	}
	const toggle = () => {
		setOpen((o) => !o)
		if (!open) touch()
	}

	return (
		<li className={clsx("rounded-xl border transition", open ? "border-brand-200 bg-surface shadow-soft" : "border-line bg-surface")}>
			<div className="flex items-center gap-3 p-3">
				<button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
					<IconChip icon={Icon} tone={TONES[r.resource_type] || "brand"} size={36} />
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
						<span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
							<span>{r.resource_type}</span>
							{Number(r.duration_minutes) ? <span>· {r.duration_minutes} min</span> : null}
							{status === "In Progress" ? <span className="font-semibold text-amber-600">· In progress</span> : null}
						</span>
					</span>
					<ChevronDown size={16} className={clsx("shrink-0 text-ink-soft transition", open && "rotate-180")} />
				</button>
				<button
					type="button"
					onClick={() => !done && mark.mutate({ resource: r.name, progress: 100 })}
					disabled={done || mark.isPending}
					aria-label={done ? `${r.title} completed` : `Mark ${r.title} complete`}
					title={done ? "Completed" : "Mark complete"}
					className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-full transition", done ? "text-emerald-600" : "text-ink-soft hover:bg-brand-50 hover:text-brand-700")}
				>
					{mark.isPending ? <Loader2 size={18} className="animate-spin" /> : done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
				</button>
			</div>
			{open ? (
				<div className="border-t border-line px-3 pb-3 pt-3 sm:px-4">
					<Viewer r={r} />
					<div className="mt-3 flex flex-wrap items-center gap-2">
						{dl && (Number(r.downloadable) || ["PDF", "Document"].includes(r.resource_type)) ? (
							<a href={dl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
								<Download size={14} /> {r.resource_type === "PDF" ? "Open PDF" : "Download"}
							</a>
						) : null}
						{link && r.resource_type !== "Text" ? (
							<a href={link} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
								<ExternalLink size={14} /> Open {r.resource_type === "Link" ? "link" : "in new tab"}
							</a>
						) : null}
						<span className="flex-1" />
						{done ? (
							<Badge tone="green" dot>Completed</Badge>
						) : (
							<Button size="sm" variant="primary" icon={CheckCircle2} loading={mark.isPending} onClick={() => mark.mutate({ resource: r.name, progress: 100 })}>
								Mark complete
							</Button>
						)}
					</div>
					{!href && r.resource_type !== "Text" && !r.body ? <p className="mt-2 text-xs text-ink-soft">This resource has no file or link yet.</p> : null}
				</div>
			) : null}
		</li>
	)
}

function Viewer({ r }) {
	const t = r.resource_type
	const embed = httpsUrl(r.embed_url)
	const media = safeUrl(r.download_url) || safeUrl(r.url)
	if (r.body && (t === "Text" || !(embed || r.file || r.url))) return <Html html={r.body} className="text-sm" />
	if ((t === "Video" || t === "Embed") && embed)
		return (
			<div className="aspect-video w-full overflow-hidden rounded-xl bg-brand-900">
				<iframe
					src={embed}
					title={r.title}
					sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
					className="h-full w-full"
					allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
					allowFullScreen
					loading="lazy"
				/>
			</div>
		)
	if (t === "Video" && safeUrl(r.download_url))
		return (
			<video controls preload="metadata" className="w-full rounded-xl bg-brand-900" src={safeUrl(r.download_url)}>
				<track kind="captions" />
			</video>
		)
	if (t === "Audio" && media)
		return (
			<audio controls preload="metadata" className="w-full" src={media}>
				<track kind="captions" />
			</audio>
		)
	if (t === "Image" && media) return <img src={media} alt={r.title} className="max-h-[420px] rounded-xl object-contain" />
	if (r.body) return <Html html={r.body} className="text-sm" />
	if (t === "Link") return <p className="text-sm text-ink-muted">This resource opens on an external website.</p>
	if (t === "PDF" || t === "Document") return <p className="text-sm text-ink-muted">Open the file to read it, or download it for offline study.</p>
	return null
}
