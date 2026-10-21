import { useState } from "react"
import { Award, Download, ExternalLink, FilePlus2, FileText, GraduationCap, Printer, QrCode, ScrollText, ShieldCheck } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Badge, Button, Empty, PageHeader, Panel, QueryState, Skeleton } from "@/shared/components/ui"
import { DataTable } from "@/shared/components/kit"
import { date, num } from "@/shared/utils/format"
import { CopyButton, IconChip } from "../components/bits"
import { TranscriptRequestModal } from "../components/TranscriptRequestModal"
import { API, credentialPdf, credentialPrint, safeUrl } from "../components/lib"

const verifyHref = (row) => safeUrl(row.verification_url) || `/verify/${encodeURIComponent(row.verification_code)}`

export default function Documents() {
	const q = useApi(API.documents)
	const [requesting, setRequesting] = useState(false)
	return (
		<>
			<PageHeader
				eyebrow="Academics"
				title="Transcripts & certificates"
				subtitle="Your issued academic documents. Anyone can confirm they're genuine with the verification code."
				actions={
					<Button icon={FilePlus2} onClick={() => setRequesting(true)}>
						Request transcript
					</Button>
				}
			/>
			<QueryState
				query={q}
				skeleton={
					<div className="grid gap-4 md:grid-cols-2">
						<Skeleton className="h-48 rounded-2xl" />
						<Skeleton className="h-48 rounded-2xl" />
					</div>
				}
			>
				{(d) => (
					<div className="space-y-6">
						<section>
							<h2 className="mb-3 flex items-center gap-2 font-serif text-lg text-ink">
								<Award size={18} className="text-gold-600" /> Certificates
							</h2>
							{d.certificates.length ? (
								<div className="grid gap-4 md:grid-cols-2">
									{d.certificates.map((c) => (
										<DocCard
											key={c.name}
											doctype="Certificate"
											row={c}
											icon={GraduationCap}
											title={c.award_title}
											lines={[c.classification, c.graduation_date ? `Graduated ${date(c.graduation_date)}` : null, c.certificate_serial ? `Serial ${c.certificate_serial}` : null]}
										/>
									))}
								</div>
							) : (
								<div className="card">
									<Empty compact icon={GraduationCap} title="No certificates yet" subtitle="Your award certificate appears here after graduation." />
								</div>
							)}
						</section>
						<section>
							<h2 className="mb-3 flex items-center gap-2 font-serif text-lg text-ink">
								<ScrollText size={18} className="text-gold-600" /> Transcripts
							</h2>
							{d.transcripts.length ? (
								<div className="grid gap-4 md:grid-cols-2">
									{d.transcripts.map((t) => (
										<DocCard
											key={t.name}
											doctype="Transcript"
											row={t}
											icon={ScrollText}
											title={`${t.transcript_type} transcript`}
											lines={[t.as_of_term ? `As of ${t.as_of_term}` : null, `CGPA ${num(t.cgpa, 2)} · ${num(t.total_credits)} credits`, t.classification]}
										/>
									))}
								</div>
							) : (
								<div className="card">
									<Empty
										compact
										icon={ScrollText}
										title="No transcripts issued yet"
										subtitle="Request an official transcript and it will appear here once the Registrar issues it."
										action={
											<Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => setRequesting(true)}>
												Request transcript
											</Button>
										}
									/>
								</div>
							)}
						</section>
						<Panel title="Transcript requests" icon={FileText} bodyClass="p-0">
							<DataTable
								className="rounded-none border-0 shadow-none"
								rows={d.requests}
								empty="You haven't requested a transcript"
								cols={[
									{ key: "document_type", label: "Type", render: (r) => <span className="font-semibold text-ink">{r.document_type || "Transcript"}</span> },
									{ key: "creation", label: "Requested", render: (r) => date(r.creation) },
									{ key: "copies", label: "Copies", align: "right", render: (r) => r.copies || 1 },
									{ key: "delivery_method", label: "Delivery", render: (r) => r.delivery_method || "—", hideOnMobile: true },
									{
										key: "status",
										label: "Status",
										render: (r) => (
											<span className="flex flex-col items-start gap-0.5">
												<Badge status={r.status} dot />
												{r.review_notes ? <span className="text-[11px] text-ink-soft">{r.review_notes}</span> : null}
											</span>
										),
									},
								]}
							/>
						</Panel>
						<div className="flex items-start gap-3 rounded-2xl border border-dashed border-line p-4 text-sm text-ink-muted">
							<ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
							<p>
								Employers and other institutions can confirm any document at <b className="text-ink">{window.location.host}/verify</b> using the verification code printed on it. Only the
								document's key details are shown to them.
							</p>
						</div>
					</div>
				)}
			</QueryState>
			<TranscriptRequestModal open={requesting} onClose={() => setRequesting(false)} />
		</>
	)
}

function DocCard({ doctype, row, icon, title, lines }) {
	return (
		<article className="card relative overflow-hidden">
			<div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-400 via-gold-500 to-gold-400" aria-hidden />
			<div className="flex gap-4 p-5">
				<IconChip icon={icon} tone="gold" size={48} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="font-semibold text-ink">{title}</h3>
						<Badge tone="green" size="xs" dot>
							Issued
						</Badge>
					</div>
					<p className="text-xs text-ink-soft">
						{row.name} · issued {date(row.issue_date)}
					</p>
					<ul className="mt-2 space-y-0.5 text-sm text-ink-muted">
						{lines.filter(Boolean).map((l) => (
							<li key={l}>{l}</li>
						))}
					</ul>
				</div>
			</div>
			{row.verification_code ? (
				<div className="mx-5 flex flex-wrap items-center gap-2 rounded-xl bg-cream px-3 py-2">
					<QrCode size={15} className="text-ink-soft" />
					<span className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Verification</span>
					<code className="font-mono text-sm font-bold text-ink">{row.verification_code}</code>
					<CopyButton text={row.verification_code} className="ml-auto" />
				</div>
			) : null}
			<div className="flex flex-wrap gap-2 p-5 pt-4">
				<a className="btn btn-secondary btn-sm" href={credentialPrint(doctype, row.name)} target="_blank" rel="noreferrer">
					<Printer size={14} /> Print view
				</a>
				<a className="btn btn-secondary btn-sm" href={credentialPdf(doctype, row.name)} target="_blank" rel="noreferrer">
					<Download size={14} /> PDF
				</a>
				{row.verification_code ? (
					<a className="btn btn-ghost btn-sm" href={verifyHref(row)} target="_blank" rel="noreferrer">
						<ExternalLink size={14} /> Verify page
					</a>
				) : null}
			</div>
		</article>
	)
}
