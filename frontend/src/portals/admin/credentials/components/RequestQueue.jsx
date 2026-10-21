import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle2, FileText, Inbox, XCircle } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { useSession } from "@/shared/session"
import { canAccess } from "@/shared/access"
import { Avatar, Badge, Button, ConfirmDialog, Empty, ErrorState, Panel, SkeletonRows, Textarea } from "@/shared/components/ui"
import { ago, date } from "@/shared/utils/format"
import { API, CAN, DocStatus, STU } from "../lib"
import GenerateTranscript from "./GenerateTranscript"

const OPEN = ["Pending", "Under Review", "Approved"]

/**
 * Open "Transcript Request" student requests. Approving one (decide_request) makes the backend create a linked
 * Draft transcript; issuing that draft does not close the request, so Approved rows with an issued transcript
 * offer "Mark completed".
 */
export default function RequestQueue() {
	const { hasRole, roles } = useSession()
	const canDecide = hasRole(...CAN.decide)
	const canWrite = hasRole(...CAN.write)
	const canOpenRequest = canAccess(roles, "/students")
	const [act, setAct] = useState(null)
	const [notes, setNotes] = useState("")
	const [touched, setTouched] = useState(false)
	const [gen, setGen] = useState(null)

	const q = useApi(`${STU}list_requests`, { request_type: "Transcript Request", status: OPEN, page_length: 50 })
	const tq = useApi(`${API}list_transcripts`, { page_length: 200 }, { enabled: Boolean(q.data?.total) })
	const byRequest = useMemo(() => {
		const m = {}
		for (const t of tq.data?.data || []) if (t.request && !m[t.request]) m[t.request] = t
		return m
	}, [tq.data])

	const decide = useAction(`${STU}decide_request`, {
		invalidate: [STU, API],
		success: (r, v) =>
			v.decision === "Approved" ? `${r.name} approved; a draft transcript has been prepared` : `${r.name} ${v.decision === "Completed" ? "marked completed" : v.decision.toLowerCase()}`,
		onSuccess: () => setAct(null),
	})

	const open = (row, decision) => {
		setNotes("")
		setTouched(false)
		setAct({ row, decision })
	}
	const confirm = () => {
		setTouched(true)
		if (act.decision === "Rejected" && notes.trim().length < 5) return
		decide.mutate({ name: act.row.name, decision: act.decision, notes: notes.trim() || undefined })
	}

	const rows = q.data?.data || []
	const counts = q.data?.counts_by_status || {}

	return (
		<Panel
			title="Transcript requests"
			subtitle={q.data ? `${counts.Pending || 0} new · ${counts["Under Review"] || 0} in review · ${counts.Approved || 0} approved` : "From the student portal"}
			icon={Inbox}
			bodyClass="p-0"
		>
			{q.isLoading ? (
				<div className="p-4">
					<SkeletonRows rows={3} />
				</div>
			) : q.isError ? (
				<div className="p-4">
					<ErrorState error={q.error} onRetry={() => q.refetch()} />
				</div>
			) : !rows.length ? (
				<Empty compact icon={CheckCircle2} title="No open transcript requests" subtitle="New requests from students appear here." />
			) : (
				<ul className="divide-y divide-line">
					{rows.map((r) => {
						const t = byRequest[r.name]
						const pending = r.status === "Pending" || r.status === "Under Review"
						return (
							<li key={r.name} className="flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center">
								<div className="flex min-w-0 flex-1 items-start gap-3">
									<Avatar name={r.student_name} size={36} />
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-semibold text-ink">{r.student_name}</span>
											<Badge status={r.status} size="xs" />
										</div>
										<div className="text-xs text-ink-soft">
											{[r.document_type || "Transcript", r.copies ? `${r.copies} cop${Number(r.copies) === 1 ? "y" : "ies"}` : null, r.delivery_method].filter(Boolean).join(" · ")}
										</div>
										<div className="mt-0.5 text-xs text-ink-soft">
											{canOpenRequest ? (
												<Link className="font-semibold text-brand-700 hover:underline" to={`/admin/students/requests/${encodeURIComponent(r.name)}`}>
													{r.name}
												</Link>
											) : (
												r.name
											)}{" "}
											· {r.student} · raised {ago(r.creation)}
											{r.decision_date ? ` · decided ${date(r.decision_date)}` : ""}
										</div>
										{r.reason ? <p className="mt-1 line-clamp-2 text-xs text-ink-muted">“{r.reason}”</p> : null}
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2 lg:justify-end">
									{t ? (
										<Link to={`/admin/credentials/transcripts/${encodeURIComponent(t.name)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:border-brand-300">
											<FileText size={13} /> {t.name} <DocStatus status={t.status} size="xs" />
										</Link>
									) : null}
									{pending && canDecide ? (
										<>
											<Button size="sm" icon={CheckCircle2} onClick={() => open(r, "Approved")}>
												Approve
											</Button>
											<Button size="sm" variant="danger-soft" icon={XCircle} onClick={() => open(r, "Rejected")}>
												Reject
											</Button>
										</>
									) : null}
									{r.status === "Approved" && !t && canWrite && !tq.isLoading ? (
										<Button size="sm" variant="secondary" icon={FileText} onClick={() => setGen(r)}>
											Generate draft
										</Button>
									) : null}
									{r.status === "Approved" && t?.status === "Issued" && canDecide ? (
										<Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => open(r, "Completed")}>
											Mark completed
										</Button>
									) : null}
								</div>
							</li>
						)
					})}
				</ul>
			)}

			<ConfirmDialog
				open={Boolean(act)}
				onClose={() => setAct(null)}
				loading={decide.isPending}
				tone={act?.decision === "Rejected" ? "danger" : "primary"}
				title={act ? `${act.decision === "Approved" ? "Approve" : act.decision === "Rejected" ? "Reject" : "Complete"} ${act.row.name}?` : ""}
				confirmLabel={act?.decision === "Approved" ? "Approve" : act?.decision === "Rejected" ? "Reject request" : "Mark completed"}
				message={
					act?.decision === "Approved"
						? `A draft ${String(act.row.document_type || "official transcript").toLowerCase()} is created for ${act.row.student_name}. Check it and issue it from the transcript page.`
						: act?.decision === "Rejected"
							? `${act?.row.student_name} is notified with your reason.`
							: act
								? `The transcript has been issued. Completing the request tells ${act.row.student_name} it is ready (${act.row.delivery_method || "collection"}).`
								: ""
				}
				onConfirm={confirm}
			>
				<Textarea
					className="mt-3"
					label={act?.decision === "Rejected" ? "Reason" : "Note to the student"}
					required={act?.decision === "Rejected"}
					rows={3}
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					error={touched && act?.decision === "Rejected" && notes.trim().length < 5 ? "Give the student a reason." : undefined}
				/>
			</ConfirmDialog>
			<GenerateTranscript open={Boolean(gen)} request={gen} onClose={() => setGen(null)} />
		</Panel>
	)
}
