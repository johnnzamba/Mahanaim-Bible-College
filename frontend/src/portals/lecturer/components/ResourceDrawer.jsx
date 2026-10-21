import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Button, Drawer, FileDrop, Input, Select, Switch, Textarea } from "@/shared/components/ui"
import { useAction } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { toast } from "@/shared/components/toast"
import { M, P, RESOURCE_TYPES, fileName, fromHtml, toHtml } from "./lib"

const ACCEPT = {
	PDF: ".pdf",
	Document: ".pdf,.doc,.docx,.odt,.rtf,.txt,.ppt,.pptx,.odp,.xls,.xlsx,.ods,.csv",
	Video: "video/*",
	Audio: "audio/*",
	Image: "image/*",
}
const HELP = {
	PDF: "Upload a PDF. Students read it in the portal.",
	Document: "Word, PowerPoint, Excel, text or CSV.",
	Video: "Upload a video file or paste a link (YouTube, Vimeo, Drive…).",
	Audio: "Upload an audio file or paste a link.",
	Image: "PNG, JPG, GIF, WebP or SVG.",
	Link: "Any web page students should visit.",
	Embed: "An https:// embed URL (e.g. https://www.youtube.com/embed/…).",
	Text: "Short reading or notes, shown inline.",
}

const blank = { title: "", resource_type: "PDF", course_module: "", file: "", url: "", embed_url: "", body: "", duration_minutes: "", downloadable: 1, is_published: 0 }

export function ResourceDrawer({ open, onClose, offering, modules = [], resource, defaultModule }) {
	const [f, setF] = useState(blank)
	const [source, setSource] = useState("file")
	const [uploading, setUploading] = useState(false)
	const save = useAction(M.saveResource, { invalidate: [P.learn, P.lec], success: resource ? "Resource updated" : "Resource added", onSuccess: onClose })

	useEffect(() => {
		if (!open) return
		if (resource) {
			setF({ ...blank, ...resource, course_module: resource.course_module || "", body: fromHtml(resource.body), duration_minutes: resource.duration_minutes || "" })
			setSource(resource.url && !resource.file ? "url" : "file")
		} else {
			setF({ ...blank, course_module: defaultModule || "" })
			setSource("file")
		}
	}, [open, resource, defaultModule])

	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
	const t = f.resource_type
	const urlOrFile = t === "Video" || t === "Audio"
	const needsFile = ["PDF", "Document", "Image"].includes(t) || (urlOrFile && source === "file")
	const needsUrl = t === "Link" || (urlOrFile && source === "url")

	const upload = async (file) => {
		setUploading(true)
		try {
			const r = await frappe.uploadFile(file, true)
			setF((x) => ({ ...x, file: r.file_url, title: x.title || file.name.replace(/\.[^.]+$/, "") }))
		} catch (e) {
			toast.error(e?.message || "Upload failed")
		} finally {
			setUploading(false)
		}
	}

	const problem = !f.title.trim()
		? "Give the resource a title."
		: needsFile && !f.file
			? "Upload a file."
			: needsUrl && !/^https?:\/\//i.test(f.url || "")
				? "Enter a link starting with http:// or https://"
				: t === "Embed" && !/^https:\/\//i.test(f.embed_url || "")
					? "Enter an embed URL starting with https://"
					: t === "Text" && !f.body.trim()
						? "Write the text content."
						: null

	const submit = (e) => {
		e?.preventDefault()
		if (problem) return toast.error(problem)
		save.mutate({
			data: {
				name: resource?.name,
				course_offering: offering,
				course_module: f.course_module || null,
				title: f.title.trim(),
				resource_type: t,
				file: needsFile ? f.file : null,
				url: needsUrl ? f.url.trim() : null,
				embed_url: t === "Embed" ? f.embed_url.trim() : null,
				body: t === "Text" ? toHtml(f.body) : null,
				duration_minutes: f.duration_minutes === "" ? 0 : Number(f.duration_minutes),
				downloadable: f.downloadable ? 1 : 0,
				is_published: f.is_published ? 1 : 0,
			},
		})
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			title={resource ? "Edit resource" : "Add resource"}
			subtitle={HELP[t]}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={submit} loading={save.isPending} disabled={uploading}>
						{resource ? "Save changes" : "Add resource"}
					</Button>
				</>
			}
		>
			<form onSubmit={submit} className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<Select label="Type" required value={t} onChange={set("resource_type")} options={RESOURCE_TYPES} />
					<Select
						label="Module"
						value={f.course_module}
						onChange={set("course_module")}
						options={[{ value: "", label: "No module (general)" }, ...modules.map((m) => ({ value: m.name, label: m.week ? `Week ${m.week} · ${m.module_title}` : m.module_title }))]}
					/>
				</div>
				<Input label="Title" required value={f.title} onChange={set("title")} placeholder="e.g. Reading: Fee & Stuart, ch. 1" />

				{urlOrFile ? (
					<div className="flex gap-1.5" role="group" aria-label="Source">
						<button type="button" className={`chip ${source === "file" ? "chip-active" : ""}`} onClick={() => setSource("file")}>
							Upload file
						</button>
						<button type="button" className={`chip ${source === "url" ? "chip-active" : ""}`} onClick={() => setSource("url")}>
							Paste link
						</button>
					</div>
				) : null}

				{needsFile ? (
					<>
						<FileDrop label="File" accept={ACCEPT[t]} onFile={upload} busy={uploading} value={f.file} hint="Stored privately; enrolled students open it through the portal." />
						{f.file ? (
							<p className="-mt-2 flex items-center gap-2 text-xs text-ink-soft">
								<span className="truncate">{fileName(f.file)}</span>
								<button type="button" className="link" onClick={() => setF((x) => ({ ...x, file: "" }))}>
									Remove
								</button>
							</p>
						) : null}
					</>
				) : null}
				{needsUrl ? <Input label="Link" required type="url" inputMode="url" value={f.url || ""} onChange={set("url")} placeholder="https://" icon={ExternalLink} /> : null}
				{t === "Embed" ? <Input label="Embed URL" required type="url" value={f.embed_url || ""} onChange={set("embed_url")} placeholder="https://www.youtube.com/embed/…" /> : null}
				{t === "Text" ? <Textarea label="Content" required rows={10} value={f.body} onChange={set("body")} hint="Blank lines start new paragraphs." /> : null}

				<div className="grid gap-4 sm:grid-cols-2">
					<Input label="Duration (minutes)" type="number" min={0} value={f.duration_minutes} onChange={set("duration_minutes")} hint="Estimated study time" />
				</div>
				<div className="space-y-3 rounded-xl border border-line p-4">
					{needsFile ? (
						<Switch checked={Boolean(f.downloadable)} onChange={(v) => setF((x) => ({ ...x, downloadable: v ? 1 : 0 }))} label="Allow download" description="Otherwise students can only view it online." />
					) : null}
					<Switch checked={Boolean(f.is_published)} onChange={(v) => setF((x) => ({ ...x, is_published: v ? 1 : 0 }))} label="Published" description="Visible to students once its module is published too." />
				</div>
			</form>
		</Drawer>
	)
}
