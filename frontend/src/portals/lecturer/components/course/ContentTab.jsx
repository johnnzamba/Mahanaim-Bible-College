import { useState } from "react"
import {
	ArrowDown,
	ArrowUp,
	Eye,
	EyeOff,
	File,
	FileText,
	FolderPlus,
	Headphones,
	Image as ImageIcon,
	Layers,
	Link2,
	MonitorPlay,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	Video,
} from "lucide-react"
import { Alert, Badge, Button, Card, ConfirmDialog, Empty, IconButton, QueryState, SkeletonRows, Switch } from "@/shared/components/ui"
import { useAction, useApi } from "@/shared/api/hooks"
import { ModuleDrawer } from "../ModuleDrawer"
import { ResourceDrawer } from "../ResourceDrawer"
import { safeUrl } from "@/shared/utils/sanitize"
import { M, P } from "../lib"

const ICON = { PDF: FileText, Document: File, Video, Audio: Headphones, Image: ImageIcon, Link: Link2, Embed: MonitorPlay, Text: FileText }

function swap(list, i, dir) {
	const next = [...list]
	const j = i + dir
	if (j < 0 || j >= next.length) return null
	;[next[i], next[j]] = [next[j], next[i]]
	return next.map((x) => x.name)
}

function ResourceRow({ r, i, list, onEdit, onDelete, onMove, onPublish, busy }) {
	const Icon = ICON[r.resource_type] || File
	const href = safeUrl(r.download_url || r.url || r.embed_url)
	return (
		<li className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
			<span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cream text-gold-700">
				<Icon size={16} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-x-2">
					{href ? (
						<a href={href} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-ink hover:underline">
							{r.title}
						</a>
					) : (
						<span className="truncate text-sm font-semibold text-ink">{r.title}</span>
					)}
				</div>
				<div className="text-xs text-ink-soft">
					{r.resource_type}
					{r.duration_minutes ? ` · ${r.duration_minutes} min` : ""}
					{r.file && !r.downloadable ? " · view only" : ""}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				<button
					type="button"
					onClick={onPublish}
					disabled={busy}
					aria-label={r.is_published ? `Unpublish ${r.title}` : `Publish ${r.title}`}
					title={r.is_published ? "Published · click to hide" : "Hidden · click to publish"}
					className="mr-1"
				>
					<Badge tone={r.is_published ? "green" : "gray"} size="xs">
						{r.is_published ? <Eye size={11} /> : <EyeOff size={11} />}
						<span className="hidden sm:inline">{r.is_published ? "Published" : "Hidden"}</span>
					</Badge>
				</button>
				<IconButton icon={ArrowUp} label="Move up" disabled={busy || i === 0} onClick={() => onMove(swap(list, i, -1))} className="hidden sm:inline-grid" />
				<IconButton icon={ArrowDown} label="Move down" disabled={busy || i === list.length - 1} onClick={() => onMove(swap(list, i, 1))} className="hidden sm:inline-grid" />
				<IconButton icon={Pencil} label={`Edit ${r.title}`} onClick={onEdit} />
				<IconButton icon={Trash2} label={`Delete ${r.title}`} tone="danger" onClick={onDelete} />
			</div>
		</li>
	)
}

export default function ContentTab({ offering, data: overview }) {
	const q = useApi(M.listModules, { offering })
	const [moduleEdit, setModuleEdit] = useState(null)
	const [resourceEdit, setResourceEdit] = useState(null)
	const [confirm, setConfirm] = useState(null)

	const inval = [P.learn, P.lec]
	const reorderModules = useAction(M.reorderModules, { invalidate: inval })
	const reorderResources = useAction(M.reorderResources, { invalidate: inval })
	const publish = useAction(M.publishToggle, { invalidate: inval })
	const delModule = useAction(M.deleteModule, { invalidate: inval, success: "Module deleted", onSuccess: () => setConfirm(null) })
	const delResource = useAction(M.deleteResource, { invalidate: inval, success: "Resource deleted", onSuccess: () => setConfirm(null) })
	const busy = reorderModules.isPending || reorderResources.isPending || publish.isPending

	const modules = q.data?.modules || []
	const loose = q.data?.resources || []
	const lms = overview?.offering

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<p className="text-sm text-ink-muted">Organise teaching material into modules. Students only see what is published.</p>
				<div className="flex gap-2 sm:ml-auto">
					<Button size="sm" variant="secondary" icon={FolderPlus} onClick={() => setModuleEdit({})}>
						New module
					</Button>
					<Button size="sm" icon={Plus} onClick={() => setResourceEdit({ defaultModule: modules[0]?.name || "" })}>
						Add resource
					</Button>
				</div>
			</div>

			{lms?.lms_course || (lms?.lms_sync_status && lms.lms_sync_status !== "Not Synced") ? (
				<Alert
					tone={lms.lms_sync_status === "Failed" ? "error" : "info"}
					icon={RefreshCw}
					title={`Frappe LMS: ${lms.lms_sync_status}`}
					action={
						safeUrl(lms.lms_url) ? (
							<a href={safeUrl(lms.lms_url)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
								Open in LMS
							</a>
						) : null
					}
				>
					{lms.lms_sync_error || (lms.lms_last_synced ? `Last synced ${lms.lms_last_synced.slice(0, 16)}` : "This course is mirrored to the LMS.")}
				</Alert>
			) : null}

			<QueryState
				query={q}
				skeleton={
					<Card className="p-5">
						<SkeletonRows rows={5} />
					</Card>
				}
			>
				{() =>
					!modules.length && !loose.length ? (
						<Card>
							<Empty
								icon={Layers}
								title="No content yet"
								subtitle="Start with a module for week 1, then add readings, videos and links."
								action={
									<Button icon={FolderPlus} onClick={() => setModuleEdit({})}>
										Create the first module
									</Button>
								}
							/>
						</Card>
					) : (
						<div className="space-y-4">
							{modules.map((m, i) => (
								<Card key={m.name} className="overflow-hidden">
									<div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
										<div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700">
											{m.week ? `W${m.week}` : i + 1}
										</div>
										<div className="min-w-0 flex-1">
											<h3 className="font-semibold text-ink">{m.module_title}</h3>
											{m.description ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{m.description}</p> : null}
											<p className="mt-0.5 text-xs text-ink-soft">
												{m.resources.length} resource{m.resources.length === 1 ? "" : "s"} · {m.resources.filter((r) => r.is_published).length} published
											</p>
										</div>
										<div className="flex items-center gap-1">
											<Switch
												checked={Boolean(m.is_published)}
												onChange={(v) => publish.mutate({ name: m.name, kind: "module", is_published: v ? 1 : 0 })}
												disabled={busy}
												label={<span className="text-xs text-ink-muted">{m.is_published ? "Published" : "Hidden"}</span>}
												className="mr-2"
											/>
											<IconButton icon={ArrowUp} label={`Move ${m.module_title} up`} disabled={busy || i === 0} onClick={() => reorderModules.mutate({ offering, order: swap(modules, i, -1) })} />
											<IconButton
												icon={ArrowDown}
												label={`Move ${m.module_title} down`}
												disabled={busy || i === modules.length - 1}
												onClick={() => reorderModules.mutate({ offering, order: swap(modules, i, 1) })}
											/>
											<IconButton icon={Pencil} label={`Edit ${m.module_title}`} onClick={() => setModuleEdit(m)} />
											<IconButton icon={Trash2} label={`Delete ${m.module_title}`} tone="danger" onClick={() => setConfirm({ kind: "module", item: m })} />
										</div>
									</div>
									{m.resources.length ? (
										<ul className="divide-y divide-line">
											{m.resources.map((r, j) => (
												<ResourceRow
													key={r.name}
													r={r}
													i={j}
													list={m.resources}
													busy={busy}
													onEdit={() => setResourceEdit({ resource: { ...r, course_module: m.name } })}
													onDelete={() => setConfirm({ kind: "resource", item: r })}
													onMove={(order) => reorderResources.mutate({ offering, module: m.name, order })}
													onPublish={() => publish.mutate({ name: r.name, kind: "resource", is_published: r.is_published ? 0 : 1 })}
												/>
											))}
										</ul>
									) : null}
									<div className="px-4 py-2 sm:px-5">
										<Button size="sm" variant="ghost" icon={Plus} onClick={() => setResourceEdit({ defaultModule: m.name })}>
											Add to this module
										</Button>
									</div>
								</Card>
							))}
							{loose.length ? (
								<Card className="overflow-hidden">
									<div className="border-b border-line px-5 py-3.5">
										<h3 className="font-semibold text-ink">General resources</h3>
										<p className="text-xs text-ink-soft">Not in a module</p>
									</div>
									<ul className="divide-y divide-line">
										{loose.map((r, j) => (
											<ResourceRow
												key={r.name}
												r={r}
												i={j}
												list={loose}
												busy={busy}
												onEdit={() => setResourceEdit({ resource: r })}
												onDelete={() => setConfirm({ kind: "resource", item: r })}
												onMove={(order) => reorderResources.mutate({ offering, order })}
												onPublish={() => publish.mutate({ name: r.name, kind: "resource", is_published: r.is_published ? 0 : 1 })}
											/>
										))}
									</ul>
								</Card>
							) : null}
						</div>
					)
				}
			</QueryState>

			<ModuleDrawer open={Boolean(moduleEdit)} onClose={() => setModuleEdit(null)} offering={offering} module={moduleEdit?.name ? moduleEdit : null} />
			<ResourceDrawer
				open={Boolean(resourceEdit)}
				onClose={() => setResourceEdit(null)}
				offering={offering}
				modules={modules}
				resource={resourceEdit?.resource || null}
				defaultModule={resourceEdit?.defaultModule}
			/>
			<ConfirmDialog
				open={Boolean(confirm)}
				onClose={() => setConfirm(null)}
				tone="danger"
				title={confirm?.kind === "module" ? "Delete this module?" : "Delete this resource?"}
				message={
					confirm?.kind === "module"
						? `"${confirm.item.module_title}" will be removed. Its resources move to General resources.`
						: `"${confirm?.item?.title}" will be removed for every student.`
				}
				confirmLabel="Delete"
				loading={delModule.isPending || delResource.isPending}
				onConfirm={() => (confirm.kind === "module" ? delModule.mutate({ name: confirm.item.name }) : delResource.mutate({ name: confirm.item.name }))}
			/>
		</div>
	)
}
