import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { CheckCircle2, FileCheck2, Lock, MoreHorizontal, Pencil, Plus, Send, Trash2 } from "lucide-react"
import { Badge, Button, ConfirmDialog, IconButton } from "@/shared/components/ui"
import { DataTable, Toolbar } from "@/shared/components/kit"
import { useAction, useApi } from "@/shared/api/hooks"
import { dateTime } from "@/shared/utils/format"
import { AssignmentDrawer } from "../AssignmentDrawer"
import { StatusBadge } from "../bits"
import { M, P, isPast, score } from "../lib"

const FILTERS = [
	{ id: "", label: "All" },
	{ id: "Draft", label: "Drafts" },
	{ id: "Published", label: "Published" },
	{ id: "Closed", label: "Closed" },
	{ id: "Graded", label: "Graded" },
]

export function AssignmentActions({ a, onEdit, compact }) {
	const [confirm, setConfirm] = useState(null)
	const [menu, setMenu] = useState(false)
	const inval = [P.asg, P.lec, P.res]
	const publish = useAction(M.publishAssignment, { invalidate: inval, success: "Published. Students have been notified.", onSuccess: () => setConfirm(null) })
	const close = useAction(M.closeAssignment, { invalidate: inval, success: "Assignment closed", onSuccess: () => setConfirm(null) })
	const del = useAction(M.deleteAssignment, { invalidate: inval, success: "Assignment deleted", onSuccess: () => setConfirm(null) })
	const items = [
		onEdit ? { id: "edit", label: "Edit", icon: Pencil, run: onEdit } : null,
		a.status === "Draft" || a.status === "Closed" ? { id: "publish", label: a.status === "Closed" ? "Reopen" : "Publish", icon: Send, run: () => setConfirm("publish") } : null,
		a.status === "Published" ? { id: "close", label: "Close", icon: Lock, run: () => setConfirm("close") } : null,
		!a.submission_count ? { id: "delete", label: "Delete", icon: Trash2, danger: true, run: () => setConfirm("delete") } : null,
	].filter(Boolean)
	const C = {
		publish: { title: a.status === "Closed" ? "Reopen this assignment?" : "Publish this assignment?", message: a.status === "Closed" ? "Students can submit again until the due date or late cut-off." : "Every enrolled student is notified and can submit from the open date.", label: a.status === "Closed" ? "Reopen" : "Publish", run: () => publish.mutate({ name: a.name }) },
		close: { title: "Close submissions?", message: "Students can no longer submit or resubmit. You can still grade.", label: "Close", run: () => close.mutate({ name: a.name }) },
		delete: { title: "Delete this assignment?", message: `"${a.title}" will be removed permanently.`, label: "Delete", danger: true, run: () => del.mutate({ name: a.name }) },
	}[confirm]
	return (
		<div className="relative flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
			{compact ? (
				<>
					<IconButton icon={MoreHorizontal} label={`Actions for ${a.title}`} onClick={() => setMenu((x) => !x)} aria-expanded={menu} />
					{menu ? (
						<>
							<button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
							<div className="absolute right-0 top-9 z-20 min-w-[10rem] rounded-xl border border-line bg-surface p-1 shadow-lift" role="menu">
								{items.map((it) => (
									<button
										key={it.id}
										type="button"
										role="menuitem"
										onClick={() => {
											setMenu(false)
											it.run()
										}}
										className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 ${it.danger ? "text-red-600" : "text-ink"}`}
									>
										<it.icon size={14} /> {it.label}
									</button>
								))}
							</div>
						</>
					) : null}
				</>
			) : (
				items.map((it) => (
					<Button key={it.id} size="sm" variant={it.danger ? "danger-soft" : it.id === "publish" ? "primary" : "secondary"} icon={it.icon} onClick={it.run}>
						{it.label}
					</Button>
				))
			)}
			<ConfirmDialog
				open={Boolean(C)}
				onClose={() => setConfirm(null)}
				title={C?.title}
				message={C?.message}
				confirmLabel={C?.label}
				tone={C?.danger ? "danger" : "primary"}
				loading={publish.isPending || close.isPending || del.isPending}
				onConfirm={() => C?.run()}
			/>
		</div>
	)
}

export default function AssignmentsTab({ offering }) {
	const nav = useNavigate()
	const [status, setStatus] = useState("")
	const [edit, setEdit] = useState(null)
	const all = useApi(M.listAssignments, { offering })
	const rows = (all.data?.data || []).filter((a) => !status || a.status === status)
	const counts = (all.data?.data || []).reduce((m, a) => ({ ...m, [a.status]: (m[a.status] || 0) + 1 }), {})

	return (
		<div>
			<Toolbar
				chips={FILTERS.map((f) => ({ ...f, count: f.id ? counts[f.id] || 0 : all.data?.data?.length }))}
				active={status}
				onChip={setStatus}
				right={
					<Button size="sm" icon={Plus} onClick={() => setEdit({})}>
						New assignment
					</Button>
				}
			/>
			<DataTable
				query={all}
				rows={all.isSuccess ? rows : undefined}
				onRow={(a) => nav(`/lecturer/assignments/${a.name}`)}
				empty={status ? `No ${status.toLowerCase()} assignments` : "No assignments yet"}
				emptyIcon={FileCheck2}
				emptyAction={
					<Button size="sm" icon={Plus} onClick={() => setEdit({})}>
						Create an assignment
					</Button>
				}
				cols={[
					{
						key: "title",
						label: "Assignment",
						render: (a) => (
							<div className="min-w-0">
								<div className="truncate font-semibold text-ink">{a.title}</div>
								<div className="text-xs text-ink-soft">
									{a.assessment_component} · out of {score(a.max_score)} · {a.submission_type}
								</div>
							</div>
						),
					},
					{
						key: "due_date",
						label: "Due",
						render: (a) => (
							<span className={a.status === "Published" && isPast(a.due_date) ? "text-orange-700 dark:text-orange-300" : ""}>{dateTime(a.due_date)}</span>
						),
					},
					{
						key: "submission_count",
						label: "Submitted",
						align: "right",
						render: (a) => (
							<span className="tabular-nums">
								{a.submission_count}/{a.enrolled_count}
							</span>
						),
					},
					{
						key: "to_grade",
						label: "To grade",
						align: "right",
						render: (a) => (a.to_grade ? <Badge tone="gold">{a.to_grade}</Badge> : a.submission_count ? <CheckCircle2 size={16} className="ml-auto text-emerald-600" aria-label="All graded" /> : "—"),
					},
					{ key: "average_score", label: "Average", align: "right", hideOnMobile: true, render: (a) => (a.graded_count ? score(a.average_score, 1) : "—") },
					{ key: "status", label: "Status", render: (a) => <StatusBadge kind="assignment" status={a.status} /> },
					{ key: "actions", label: "", sortable: false, render: (a) => <AssignmentActions a={a} compact onEdit={() => setEdit(a)} /> },
				]}
			/>
			<AssignmentDrawer open={Boolean(edit)} onClose={() => setEdit(null)} offering={offering} assignment={edit?.name ? edit : null} />
		</div>
	)
}
