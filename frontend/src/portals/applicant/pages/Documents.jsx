import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, Download, Eye, FileCheck2, FileClock, FilePlus2, FileText, FileWarning, FolderOpen } from "lucide-react"
import { DataTable } from "@/shared/components/kit"
import { Alert, Empty, ErrorState, IconButton, PageHeader, Panel, Skeleton, StatCard, Tabs } from "@/shared/components/ui"
import { date } from "@/shared/utils/format"
import { safeUrl } from "@/shared/utils/sanitize"
import { CLOSED_STATUSES, DOC_UPLOAD_STATUSES, docChecklist, fileName, flaggedLabel, needsReupload } from "../lib"
import { useApplicationDetails, useMyApplications, useOptions } from "../hooks"
import { AppStatus } from "../components/AppStatus"
import { ApplicationDocuments } from "../components/ApplicationDocuments"
import { DocRemarks, DocStateBadge, ReuploadButton, remarksText } from "../components/DocState"
import { DocChecklist } from "../components/DocChecklist"
import { FilePreview } from "../components/FilePreview"
import { Resp } from "../components/Amount"

export default function Documents() {
	const list = useMyApplications()
	const options = useOptions()
	const rows = list.data?.data || []
	const details = useApplicationDetails(rows.map((r) => r.name))
	const loading = list.isLoading || options.isLoading || details.some((d) => d.isLoading)
	const failed = list.isError ? list : options.isError ? options : details.find((d) => d.isError)

	return (
		<>
			<PageHeader
				eyebrow="Admissions"
				title="My documents"
				subtitle="Everything you've uploaded for your applications, its verification status, and anything still needed."
			/>
			{loading ? (
				<DocsSkeleton />
			) : failed ? (
				<ErrorState error={failed.error} onRetry={() => (list.isError ? list.refetch() : options.isError ? options.refetch() : details.forEach((d) => d.isError && d.refetch()))} />
			) : rows.length === 0 ? (
				<div className="card">
					<Empty
						icon={FolderOpen}
						title="No documents yet"
						subtitle="Documents are uploaded as part of an application. Start one and you'll be able to upload your ID, photo and certificates."
						action={
							<Link to="/applicant/apply" className="btn btn-primary">
								<FilePlus2 size={16} /> Start an application
							</Link>
						}
					/>
				</div>
			) : (
				<DocumentsBody apps={details.map((d) => d.data).filter(Boolean)} options={options.data} />
			)}
		</>
	)
}

function DocsSkeleton() {
	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-24" />
				))}
			</div>
			<Skeleton className="h-72" />
		</div>
	)
}

function DocumentsBody({ apps, options }) {
	const [tab, setTab] = useState("apps")
	const [preview, setPreview] = useState(null)
	const open = apps.filter((a) => !CLOSED_STATUSES.includes(a.status))
	const uploadable = open.filter((a) => DOC_UPLOAD_STATUSES.includes(a.status))

	const files = useMemo(
		() =>
			apps.flatMap((a) =>
				(a.documents || [])
					.filter((d) => d.file)
					.map((d) => ({ ...d, key: `${a.name}-${d.name}`, application: a.name, programme_name: a.programme_name, app_status: a.status, uploaded: a.modified }))
			),
		[apps]
	)
	const missing = uploadable.flatMap((a) => docChecklist(a, options).missing.map((m) => ({ app: a, item: m })))
	const verified = files.filter((f) => f.verified).length
	const flagged = files.filter(needsReupload)
	const toReupload = flagged.filter((f) => DOC_UPLOAD_STATUSES.includes(f.app_status))
	const todo = missing.length + toReupload.length
	const goTo = (appName) => {
		setTab("apps")
		setTimeout(() => document.getElementById(`app-${appName}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60)
	}

	const cols = [
		{
			key: "document_type",
			label: "Document",
			render: (r) => (
				<div className="min-w-0">
					<div className="font-medium text-ink">{r.document_type}</div>
					<div className="max-w-[260px] truncate text-xs text-ink-soft">{fileName(r.file)}</div>
					<DocRemarks doc={r} className="mt-1 max-w-[320px]" closed={!DOC_UPLOAD_STATUSES.includes(r.app_status)} />
				</div>
			),
			sortValue: (r) => r.document_type,
		},
		{
			key: "application",
			label: "Application",
			render: (r) => (
				<Link to={`/applicant/application/${r.application}`} className="link text-sm" onClick={(e) => e.stopPropagation()}>
					{r.application}
				</Link>
			),
		},
		{ key: "programme_name", label: "Programme", hideOnMobile: true },
		{ key: "verified", label: "Status", render: (r) => <DocStateBadge doc={r} closed={!DOC_UPLOAD_STATUSES.includes(r.app_status)} />, sortValue: (r) => (r.verified ? 2 : needsReupload(r) ? 0 : 1) },
		{
			key: "actions",
			label: "",
			align: "right",
			sortable: false,
			render: (r) => {
				const href = safeUrl(r.file)
				return (
					<div className="flex items-center justify-end gap-1 whitespace-nowrap">
						{needsReupload(r) ? <ReuploadButton app={{ name: r.application, status: r.app_status }} doc={r} /> : null}
						<IconButton icon={Eye} label={`Preview ${r.document_type}`} onClick={() => setPreview(r)} />
						{href ? (
							<a href={href} download className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft hover:bg-cream hover:text-ink" aria-label={`Download ${r.document_type}`} title="Download">
								<Download size={16} />
							</a>
						) : null}
					</div>
				)
			},
		},
	]

	return (
		<div className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="Uploaded" value={files.length} icon={FileText} tone="brand" hint={<Resp short={`${apps.length} application${apps.length === 1 ? "" : "s"}`}>{`across ${apps.length} application${apps.length === 1 ? "" : "s"}`}</Resp>} />
				<StatCard label="Verified" value={verified} icon={FileCheck2} tone="green" hint="by admissions" />
				<StatCard label={<Resp short="Pending">Awaiting check</Resp>} hint="in review" value={files.length - verified - flagged.length} icon={FileClock} tone="blue" />
				<StatCard
					label={<Resp short="To do">Still needed</Resp>}
					value={todo}
					icon={FileWarning}
					tone={toReupload.length ? "red" : missing.length ? "orange" : "green"}
					hint={
						todo ? (
							[missing.length ? `${missing.length} missing` : null, toReupload.length ? `${toReupload.length} new cop${toReupload.length === 1 ? "y" : "ies"}` : null].filter(Boolean).join(" · ")
						) : (
							<Resp short="all done">nothing missing</Resp>
						)
					}
				/>
			</div>

			{missing.length ? (
				<Alert tone="warning" title={`${missing.length} required document${missing.length === 1 ? " is" : "s are"} missing`}>
					<ul className="mt-1 space-y-1">
						{missing.map(({ app, item }) => (
							<li key={`${app.name}-${item.key}`} className="flex flex-wrap items-center gap-x-2">
								<span className="font-medium">{item.label}</span>
								<span className="opacity-75">for {app.name}</span>
								<button type="button" onClick={() => goTo(app.name)} className="link inline-flex items-center gap-0.5 text-xs">
									Upload <ArrowRight size={12} />
								</button>
							</li>
						))}
					</ul>
				</Alert>
			) : null}
			{toReupload.length ? (
				<Alert tone="warning" icon={FileWarning} title={flaggedLabel(toReupload.length)}>
					<p>The admissions team asked for a clearer or corrected copy. Uploading a new one clears the request and your review continues.</p>
					<ul className="mt-2 divide-y divide-amber-200/70 dark:divide-amber-900/60">
						{toReupload.map((d) => {
							const why = remarksText(d)
							return (
								<li key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
									<div className="min-w-0 flex-1 basis-56">
										<div>
											<span className="font-semibold">{d.document_type}</span> <span className="opacity-75">· {d.application}</span>
										</div>
										{why ? <div className="break-words text-xs">“{why}”</div> : null}
									</div>
									<ReuploadButton app={{ name: d.application, status: d.app_status }} doc={d} />
								</li>
							)
						})}
					</ul>
				</Alert>
			) : null}

			<Tabs
				tabs={[
					{ id: "apps", label: "By application", count: apps.length },
					{ id: "files", label: "All files", count: files.length },
				]}
				active={tab}
				onChange={setTab}
			/>

			{tab === "files" ? (
				<DataTable cols={cols} rows={files} rowKey="key" empty="You haven't uploaded any documents yet" emptyIcon={FolderOpen} initialSort={{ key: "application", dir: "desc" }} />
			) : (
				<div className="space-y-5">
					{apps.map((a) => (
						<AppDocsPanel key={a.name} app={a} options={options} />
					))}
				</div>
			)}
			<FilePreview file={preview?.file} title={preview?.document_type} onClose={() => setPreview(null)} />
		</div>
	)
}

function AppDocsPanel({ app, options }) {
	const checklist = docChecklist(app, options)
	const closed = !DOC_UPLOAD_STATUSES.includes(app.status)
	return (
		<section id={`app-${app.name}`} className="scroll-mt-24">
			<Panel
				title={
					<span className="flex flex-wrap items-center gap-2 whitespace-normal">
						{app.programme_name}
						<AppStatus status={app.status} size="xs" />
					</span>
				}
				subtitle={`${app.name} · ${app.submitted_on ? `submitted ${date(app.submitted_on)}` : `started ${date(app.creation)}`}`}
				actions={
					<Link to={`/applicant/application/${app.name}`} className="btn btn-ghost btn-sm" aria-label={`View application ${app.name}`}>
						<span className="hidden sm:inline">View application</span>
						<span className="sm:hidden">View</span> <ArrowRight size={14} />
					</Link>
				}
			>
				<div className="grid gap-5 lg:grid-cols-[220px,minmax(0,1fr)]">
					<div className="rounded-2xl border border-line bg-cream/40 p-4">
						<DocChecklist checklist={checklist} compact />
						{closed ? <p className="mt-3 text-xs text-ink-soft">Uploads are closed for this application.</p> : null}
					</div>
					<div className="min-w-0">
						<ApplicationDocuments app={app} options={options} />
					</div>
				</div>
			</Panel>
		</section>
	)
}
