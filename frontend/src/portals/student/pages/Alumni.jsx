import { useEffect, useMemo, useState } from "react"
import { Briefcase, Church, GraduationCap, MapPin, Pencil, Save, ShieldCheck, Users } from "lucide-react"
import { useAction, useApi } from "@/shared/api/hooks"
import { Avatar, Badge, Button, Empty, Input, KeyValueGrid, Modal, PageHeader, Pagination, Panel, QueryState, Select, Skeleton, Switch } from "@/shared/components/ui"
import { SearchInput, useDebounced } from "@/shared/components/kit"
import { date } from "@/shared/utils/format"
import { Hero } from "../components/bits"
import { API, INV, plural } from "../components/lib"

const PAGE = 24

export default function Alumni() {
	const q = useApi(API.alumni, {}, { retry: false })
	const [edit, setEdit] = useState(false)
	return (
		<>
			<PageHeader eyebrow="Me" title="Alumni" subtitle="Stay connected with the Mahanaim family and fellow graduates in ministry." />
			<QueryState
				query={q}
				skeleton={<Skeleton className="h-48 rounded-2xl" />}
			>
				{(p) => (
					<div className="space-y-5">
						<Hero>
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
								<Avatar name={p.full_name} src={p.photo} size={72} className="ring-2 ring-gold-400/60" />
								<div className="min-w-0 flex-1">
									<p className="text-sm text-gold-200">{p.is_alumni ? "Alumnus / Alumna" : "Completed — graduation pending"}</p>
									<h2 className="font-serif text-2xl">{p.full_name}</h2>
									<p className="text-sm text-white/75">
										{p.programme_name} · {p.campus_name}
										{p.graduation_date ? ` · Class of ${new Date(p.graduation_date).getFullYear()}` : ""}
									</p>
								</div>
								<button type="button" className="btn bg-white/15 text-white ring-1 ring-white/30 hover:bg-white/25" onClick={() => setEdit(true)}>
									<Pencil size={15} /> Update
								</button>
							</div>
						</Hero>
						<div className="grid gap-5 lg:grid-cols-3">
							<Panel title="Where you serve" icon={Briefcase} className="lg:col-span-2">
								<KeyValueGrid
									items={[
										{ label: "Current ministry / organisation", value: p.current_ministry || "—" },
										{ label: "Position", value: p.current_position || "—" },
										{ label: "Home church", value: p.home_church || "—" },
										{ label: "County", value: p.county || "—" },
										{ label: "Phone", value: p.phone || "—" },
										{ label: "Email", value: p.email || "—" },
										{ label: "Graduated", value: p.graduation_date ? date(p.graduation_date) : "—" },
										{ label: "Student number", value: p.student_number },
									]}
								/>
							</Panel>
							<Panel title="Directory listing" icon={ShieldCheck}>
								<Badge tone={p.alumni_consent ? "green" : "gray"} dot>
									{p.alumni_consent ? "Listed in the alumni directory" : "Not listed"}
								</Badge>
								<p className="mt-2 text-sm text-ink-muted">
									{p.alumni_consent
										? "Other alumni can see your name, programme, ministry and county. Your phone and email stay private."
										: "Opt in to appear in the directory so classmates can find you."}
								</p>
							</Panel>
						</div>
						<Directory />
						<AlumniEdit open={edit} onClose={() => setEdit(false)} p={p} />
					</div>
				)}
			</QueryState>
		</>
	)
}

function AlumniEdit({ open, onClose, p }) {
	const [v, setV] = useState({})
	useEffect(() => {
		if (open) setV({ current_ministry: p.current_ministry || "", current_position: p.current_position || "", phone: p.phone || "", alumni_consent: Boolean(p.alumni_consent) })
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps
	const act = useAction(API.updateAlumni, { invalidate: [INV.alumni], success: "Alumni profile updated", onSuccess: onClose })
	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Update alumni profile"
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button icon={Save} loading={act.isPending} onClick={() => act.mutate({ data: { ...v, alumni_consent: v.alumni_consent ? 1 : 0 } })}>
						Save
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Input label="Current ministry / organisation" maxLength={140} value={v.current_ministry || ""} onChange={(e) => setV((x) => ({ ...x, current_ministry: e.target.value }))} />
				<Input label="Position" maxLength={140} placeholder="e.g. Senior Pastor, Missionary, Teacher" value={v.current_position || ""} onChange={(e) => setV((x) => ({ ...x, current_position: e.target.value }))} />
				<Input label="Phone" type="tel" inputMode="tel" value={v.phone || ""} onChange={(e) => setV((x) => ({ ...x, phone: e.target.value }))} />
				<Switch checked={v.alumni_consent} onChange={(c) => setV((x) => ({ ...x, alumni_consent: c }))} label="List me in the alumni directory" description="Shows your name, programme, ministry and county to other alumni." />
			</div>
		</Modal>
	)
}

function Directory() {
	const [search, setSearch] = useState("")
	const [year, setYear] = useState("")
	const [programme, setProgramme] = useState("")
	const [page, setPage] = useState(1)
	const s = useDebounced(search, 350)
	const args = useMemo(() => ({ search: s || undefined, year: year || undefined, programme: programme || undefined, start: (page - 1) * PAGE, page_length: PAGE }), [s, year, programme, page])
	const q = useApi(API.alumniDirectory, args, { placeholderData: (prev) => prev })
	const facets = q.data?.facets || {}
	return (
		<Panel title="Alumni directory" icon={Users} subtitle={q.data ? plural(q.data.total, "graduate") : null}>
			<div className="mb-4 grid gap-2 sm:grid-cols-[1fr,10rem,14rem]">
				<SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Name, ministry, position or county" />
				<Select aria-label="Graduation year" value={year} onChange={(e) => (setYear(e.target.value), setPage(1))} options={[{ value: "", label: "All years" }, ...(facets.years || []).map((y) => String(y))]} />
				<Select
					aria-label="Programme"
					value={programme}
					onChange={(e) => (setProgramme(e.target.value), setPage(1))}
					options={[{ value: "", label: "All programmes" }, ...(facets.programmes || []).map((p) => ({ value: p.programme, label: `${p.programme_name || p.programme} (${p.count})` }))]}
				/>
			</div>
			<QueryState
				query={q}
				isEmpty={(d) => !d.data?.length}
				skeleton={<Skeleton className="h-40 rounded-xl" />}
				empty={<Empty compact icon={GraduationCap} title="No alumni found" subtitle="Only graduates who opted in are listed." />}
			>
				{(d) => (
					<>
						<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{d.data.map((a) => (
								<div key={a.name} className="flex items-start gap-3 rounded-xl border border-line p-3">
									<Avatar name={a.full_name} src={a.photo} size={44} />
									<div className="min-w-0">
										<div className="truncate font-semibold text-ink">{a.full_name}</div>
										<div className="truncate text-xs text-ink-soft">
											{a.programme_name}
											{a.graduation_year ? ` · ${a.graduation_year}` : ""}
										</div>
										{a.current_ministry || a.current_position ? (
											<div className="mt-1 flex items-center gap-1 truncate text-xs text-ink-muted">
												<Church size={11} /> {[a.current_position, a.current_ministry].filter(Boolean).join(", ")}
											</div>
										) : null}
										{a.county ? (
											<div className="flex items-center gap-1 text-xs text-ink-soft">
												<MapPin size={11} /> {a.county}
											</div>
										) : null}
									</div>
								</div>
							))}
						</div>
						<Pagination page={page} pageSize={PAGE} total={d.total} onChange={setPage} />
					</>
				)}
			</QueryState>
		</Panel>
	)
}
