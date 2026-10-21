import { useEffect, useState } from "react"
import { Button, Drawer, Input, Switch, Textarea } from "@/shared/components/ui"
import { useAction } from "@/shared/api/hooks"
import { M, P } from "./lib"

const blank = { module_title: "", week: "", description: "", is_published: 0 }

export function ModuleDrawer({ open, onClose, offering, module }) {
	const [f, setF] = useState(blank)
	const save = useAction(M.saveModule, { invalidate: [P.learn, P.lec], success: module ? "Module updated" : "Module added", onSuccess: onClose })
	useEffect(() => {
		if (open) setF(module ? { ...blank, ...module, week: module.week ?? "" } : blank)
	}, [open, module])
	const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }))
	const valid = f.module_title.trim()

	const submit = (e) => {
		e?.preventDefault()
		if (!valid) return
		save.mutate({
			data: {
				name: module?.name,
				course_offering: offering,
				module_title: f.module_title.trim(),
				week: f.week === "" ? null : Number(f.week),
				description: f.description,
				is_published: f.is_published ? 1 : 0,
			},
		})
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			title={module ? "Edit module" : "New module"}
			subtitle="Modules group your teaching content week by week."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={submit} loading={save.isPending} disabled={!valid}>
						{module ? "Save changes" : "Add module"}
					</Button>
				</>
			}
		>
			<form onSubmit={submit} className="space-y-4">
				<Input label="Title" required value={f.module_title} onChange={set("module_title")} placeholder="e.g. Week 3 · Genre and context" autoFocus />
				<Input label="Week" type="number" min={0} max={52} value={f.week} onChange={set("week")} hint="Optional. Shown to students as a label." className="max-w-[10rem]" />
				<Textarea label="Description" rows={4} value={f.description || ""} onChange={set("description")} placeholder="What students will cover in this module" />
				<Switch
					checked={Boolean(f.is_published)}
					onChange={(v) => setF((x) => ({ ...x, is_published: v ? 1 : 0 }))}
					label="Published"
					description="Students only see published modules and resources."
				/>
			</form>
		</Drawer>
	)
}
