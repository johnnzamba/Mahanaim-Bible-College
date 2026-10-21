import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { Award, Ban, ExternalLink, RefreshCw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react"
import { useApi, useInvalidate } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { Alert, Avatar, Badge, Button, ErrorState, KeyValueGrid, PageHeader, Panel, SkeletonRows } from "@/shared/components/ui"
import { DownloadLink } from "@/shared/components/kit"
import { date, dateTime, num } from "@/shared/utils/format"
import { API, CAN, DocStatus, NoAccess, PrintPreview, isPermissionError, kv, pdfUrl, printUrl } from "../lib"
import { RevokeDialog } from "../components/Dialogs"

/** /admin/credentials/certificates/:name */
export default function CertificateDetail() {
	const { name } = useParams()
	const { hasRole, roles } = useSession()
	const allowed = hasRole(...CAN.read)
	const canWrite = hasRole(...CAN.write)
	const [revokeOpen, setRevokeOpen] = useState(false)
	const invalidate = useInvalidate()

	const q = useApi(`${API}get_certificate`, { name }, { enabled: allowed })
	const c = q.data || {}
	const others = useApi(`${API}list_transcripts`, { student: c.student, page_length: 10 }, { enabled: Boolean(c.student) })

	const back = { to: "/admin/credentials?tab=certificates", label: "Certificates" }
	if (!allowed || isPermissionError(q.error)) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Certificate" back={back} />
				<NoAccess message="Certificates are managed by the registrar; the academic dean and auditors can view them." />
			</>
		)
	}
	if (q.isLoading || q.isError) {
		return (
			<>
				<PageHeader eyebrow="Credentials" title="Certificate" back={back} />
				{q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				) : (
					<Panel>
						<SkeletonRows rows={8} />
					</Panel>
				)}
			</>
		)
	}

	const canStudent = hasRole(...CAN.student360) && canAccess(roles, "/students")

	return (
		<>
			<PageHeader
				eyebrow={`Credentials · ${c.certificate_serial || c.name}`}
				back={back}
				title={
					<span className="flex flex-wrap items-center gap-2">
						{c.award_title || "Certificate"} <DocStatus status={c.status} />
					</span>
				}
				subtitle={[c.student_name, c.student_number, c.classification].filter(Boolean).join(" · ")}
				actions={
					<>
						<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => invalidate(API)}>
							Reload
						</Button>
						<a href={printUrl("Certificate", c.name)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
							<ExternalLink size={14} /> Print view
						</a>
						<DownloadLink href={pdfUrl("Certificate", c.name)}>PDF</DownloadLink>
						{canWrite && c.status === "Issued" ? (
							<Button size="sm" variant="danger-soft" icon={Ban} onClick={() => setRevokeOpen(true)}>
								Revoke
							</Button>
						) : null}
					</>
				}
			/>

			{c.status === "Revoked" ? (
				<Alert tone="error" icon={ShieldAlert} title="Revoked" className="mb-4">
					{c.revoked_reason || "No reason recorded."} Verification checks for {c.verification_code || "this code"} now report it as revoked.
				</Alert>
			) : null}

			<div className="grid gap-5 lg:grid-cols-3">
				<div className="min-w-0 lg:col-span-2">
					<PrintPreview doctype="Certificate" name={c.name} title={`Certificate ${c.certificate_serial || c.name}`} landscape />
				</div>
				<div className="min-w-0 space-y-4">
					<Panel title="Graduate" icon={Award}>
						<div className="flex items-center gap-3">
							<Avatar name={c.student_name} size={44} />
							<div className="min-w-0">
								{canStudent ? (
									<Link to={`/admin/students/${encodeURIComponent(c.student)}`} className="font-semibold text-brand-700 hover:underline">
										{c.student_name}
									</Link>
								) : (
									<div className="font-semibold text-ink">{c.student_name}</div>
								)}
								<div className="text-xs text-ink-soft">{[c.student_number, c.programme].filter(Boolean).join(" · ")}</div>
							</div>
						</div>
					</Panel>

					<Panel title="Details" icon={ShieldCheck}>
						<KeyValueGrid
							items={kv([
								{ label: "Serial", value: c.certificate_serial ? <span className="font-mono">{c.certificate_serial}</span> : null },
								{ label: "Verification code", value: c.verification_code ? <span className="font-mono">{c.verification_code}</span> : null },
								{ label: "Classification", value: c.classification },
								{ label: "CGPA", value: c.cgpa != null ? Number(c.cgpa).toFixed(2) : null },
								{ label: "Completed", value: c.completion_date ? date(c.completion_date) : null },
								{ label: "Graduated", value: c.graduation_date ? date(c.graduation_date) : null },
								{ label: "Issued on", value: c.issue_date ? date(c.issue_date) : null },
								{ label: "Times verified", value: num(c.verification_count || 0) },
								{ label: "Fee check", value: c.override_fee_check ? <Badge status="Overridden" tone="orange" size="xs" /> : "Cleared" },
								{ label: "Issued by", value: c.issued_by, wide: true },
								{ label: "Eligibility notes", value: c.eligibility_notes ? <span className="whitespace-pre-line text-ink-muted">{c.eligibility_notes}</span> : null, wide: true },
								c.status === "Revoked" ? { label: "Revoked because", value: c.revoked_reason, wide: true } : null,
								{ label: "Created", value: dateTime(c.creation), wide: true },
							])}
						/>
					</Panel>

					<Panel title="Transcripts" icon={ScrollText} bodyClass="p-0">
						{others.isLoading ? (
							<div className="p-4">
								<SkeletonRows rows={2} />
							</div>
						) : (others.data?.data || []).length ? (
							<ul className="divide-y divide-line">
								{others.data.data.map((t) => (
									<li key={t.name}>
										<Link to={`/admin/credentials/transcripts/${encodeURIComponent(t.name)}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-cream">
											<span className="min-w-0">
												<span className="block font-semibold text-ink">{t.transcript_type}</span>
												<span className="block text-xs text-ink-soft">
													{t.name} · {t.issue_date ? `issued ${date(t.issue_date)}` : `created ${date(t.creation)}`}
												</span>
											</span>
											<DocStatus status={t.status} size="xs" />
										</Link>
									</li>
								))}
							</ul>
						) : (
							<p className="px-5 py-4 text-sm text-ink-soft">No transcripts for this graduate yet.</p>
						)}
					</Panel>
				</div>
			</div>

			<RevokeDialog open={revokeOpen} doctype="Certificate" name={c.name} label={c.certificate_serial || c.name} onClose={() => setRevokeOpen(false)} />
		</>
	)
}
