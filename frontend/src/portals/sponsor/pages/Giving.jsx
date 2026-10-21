import { useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"
import { BarChart3, CalendarHeart, GraduationCap, HandHeart, PieChart, Sigma } from "lucide-react"
import { BarsChart, DonutChart, Legendary } from "@/shared/components/Charts"
import { ExportButton, Toolbar, useDebounced } from "@/shared/components/kit"
import { Empty, PageHeader, Panel, Select, Skeleton, StatCard } from "@/shared/components/ui"
import { money } from "@/shared/utils/format"
import { CHART_COLORS, byType, byYear, contributionText, isNoProfile, thisYear } from "../lib"
import { useContributions } from "../hooks"
import { CONTRIBUTION_CSV, ContributionsTable } from "../components/ContributionsTable"
import { GivePanel } from "../components/GivePanel"
import { NoSponsorProfile } from "../components/NoSponsorProfile"
import { Amount, Resp } from "../components/Amount"

const TYPES = [
	{ id: "all", label: "All" },
	{ id: "Fee Payment", label: "Fee payments" },
	{ id: "Sponsor Credit", label: "Sponsorship credits" },
	{ id: "Giving", label: "Gifts" },
]
const compact = (v) => money(v, { compact: true })

export default function Giving() {
	const q = useContributions()
	const { hash } = useLocation()
	const [search, setSearch] = useState("")
	const [type, setType] = useState("all")
	const [year, setYear] = useState("")
	const term = useDebounced(search, 200).trim().toLowerCase()
	const items = useMemo(() => q.data?.data || [], [q.data])
	const totals = q.data?.totals
	const years = useMemo(() => [...new Set(items.map((c) => String(c.date).slice(0, 4)))].sort().reverse(), [items])

	useEffect(() => {
		if (hash !== "#give") return
		const t = setTimeout(() => document.getElementById("give")?.scrollIntoView({ behavior: "smooth", block: "start" }), 200)
		return () => clearTimeout(t)
	}, [hash])

	const rows = useMemo(
		() =>
			items.filter((c) => {
				if (type !== "all" && c.type !== type) return false
				if (year && !String(c.date).startsWith(year)) return false
				if (!term) return true
				return [contributionText(c), c.name, c.reference, c.mode].some((v) => String(v || "").toLowerCase().includes(term))
			}),
		[items, type, year, term]
	)

	if (q.isError && isNoProfile(q.error)) return <NoSponsorProfile />

	const yearTotal = items.filter((c) => String(c.date).startsWith(thisYear())).reduce((s, c) => s + Number(c.amount || 0), 0)
	const perYear = byYear(items)
	const perType = byType(items)

	return (
		<>
			<PageHeader eyebrow="Partnership" title="Giving & contributions" subtitle="Every fee payment and gift you've made, with receipts — and a simple way to give again." />

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard label="All-time" value={<Amount value={totals?.all} />} icon={Sigma} tone="brand" loading={q.isLoading} hint={q.data ? <Resp short={`${items.length} record${items.length === 1 ? "" : "s"}`}>{`${items.length} contribution${items.length === 1 ? "" : "s"}`}</Resp> : null} />
				<StatCard label={<Resp short="This year">{`This year (${thisYear()})`}</Resp>} value={<Amount value={yearTotal} />} icon={CalendarHeart} tone="green" loading={q.isLoading} />
				<StatCard label={<Resp short="Fees paid">Student fees</Resp>} value={<Amount value={totals?.fees} />} icon={GraduationCap} tone="blue" loading={q.isLoading} hint={<Resp short="for students">payments & credits</Resp>} />
				<StatCard label="Gifts" value={<Amount value={totals?.giving} />} icon={HandHeart} tone="gold" loading={q.isLoading} hint={<Resp short="offerings">offerings & projects</Resp>} />
			</div>

			<div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr),380px]">
				<div className="min-w-0 space-y-5">
					<Panel title="Contributions by year" icon={BarChart3}>
						{q.isLoading ? (
							<Skeleton className="h-[220px]" />
						) : perYear.length ? (
							<BarsChart
								data={perYear}
								xKey="year"
								stacked
								height={220}
								format={(v) => money(v)}
								series={[
									{ key: "fees", label: "Student fees", color: CHART_COLORS[0] },
									{ key: "giving", label: "Gifts", color: CHART_COLORS[1] },
								]}
							/>
						) : (
							<Empty compact icon={BarChart3} title="Nothing to chart yet" />
						)}
					</Panel>
					<Panel title="Where your giving goes" icon={PieChart}>
						{q.isLoading ? (
							<Skeleton className="h-[180px]" />
						) : perType.length ? (
							<div className="grid items-center gap-5 sm:grid-cols-[200px,1fr]">
								<DonutChart data={perType} height={180} format={(v) => money(v)} center={compact(totals?.all || 0)} centerLabel="Total" />
								<Legendary data={perType} format={(v) => money(v)} />
							</div>
						) : (
							<Empty compact icon={PieChart} title="No contributions yet" />
						)}
					</Panel>
				</div>
				<GivePanel id="give" />
			</div>

			<section>
				<div className="mb-3 flex items-end justify-between gap-3">
					<h2 className="font-serif text-xl text-ink">History</h2>
				</div>
				<Toolbar
					search={search}
					onSearch={setSearch}
					placeholder="Search student, type or reference"
					chips={TYPES.map((t) => ({ ...t, count: q.data ? (t.id === "all" ? items.length : items.filter((c) => c.type === t.id).length) : undefined }))}
					active={type}
					onChip={setType}
					right={
						<>
							<Select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)} className="w-32" options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: y, label: y }))]} />
							<ExportButton filename={`contributions-${year || "all"}`} cols={CONTRIBUTION_CSV} rows={rows} label="CSV" />
						</>
					}
				/>
				<ContributionsTable rows={q.data ? rows : undefined} query={q} pageSize={15} empty={items.length ? "No contributions match your filters" : "No contributions recorded yet"} />
			</section>
		</>
	)
}
