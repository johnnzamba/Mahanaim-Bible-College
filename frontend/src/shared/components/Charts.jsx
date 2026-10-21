import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts"

/** Brand-consistent recharts wrappers. Data: [{ [xKey]: label, [series.key]: number }] */
export const PALETTE = ["#1d4d3a", "#c99a43", "#589878", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6", "#f59e0b"]

const axis = { fontSize: 11, fill: "rgb(var(--ink-soft))" }
const grid = "rgb(var(--line))"

function TooltipBox({ active, payload, label, format }) {
	if (!active || !payload?.length) return null
	return (
		<div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-soft">
			{label != null ? <div className="mb-1 font-semibold text-ink">{label}</div> : null}
			{payload.map((p) => (
				<div key={p.dataKey || p.name} className="flex items-center gap-2 text-ink-muted">
					<span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
					<span>{p.name}</span>
					<span className="ml-auto pl-3 font-semibold text-ink">{format ? format(p.value) : Number(p.value || 0).toLocaleString()}</span>
				</div>
			))}
		</div>
	)
}

export function TrendChart({ data = [], xKey = "label", series = [{ key: "value", label: "Value" }], height = 240, format, area = true }) {
	const Chart = area ? AreaChart : LineChart
	return (
		<ResponsiveContainer width="100%" height={height}>
			<Chart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
				<defs>
					{series.map((s, i) => (
						<linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={s.color || PALETTE[i]} stopOpacity={0.28} />
							<stop offset="100%" stopColor={s.color || PALETTE[i]} stopOpacity={0} />
						</linearGradient>
					))}
				</defs>
				<CartesianGrid stroke={grid} vertical={false} />
				<XAxis dataKey={xKey} tick={axis} axisLine={false} tickLine={false} />
				<YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
				<Tooltip content={<TooltipBox format={format} />} />
				{series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
				{series.map((s, i) =>
					area ? (
						<Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color || PALETTE[i]} strokeWidth={2.2} fill={`url(#g-${s.key})`} />
					) : (
						<Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color || PALETTE[i]} strokeWidth={2.2} dot={false} />
					)
				)}
			</Chart>
		</ResponsiveContainer>
	)
}

export function BarsChart({ data = [], xKey = "label", series = [{ key: "value", label: "Value" }], height = 240, format, stacked, horizontal }) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: horizontal ? 8 : -12, bottom: 0 }}>
				<CartesianGrid stroke={grid} vertical={Boolean(horizontal)} horizontal={!horizontal} />
				{horizontal ? (
					<>
						<XAxis type="number" tick={axis} axisLine={false} tickLine={false} />
						<YAxis type="category" dataKey={xKey} tick={axis} axisLine={false} tickLine={false} width={110} />
					</>
				) : (
					<>
						<XAxis dataKey={xKey} tick={axis} axisLine={false} tickLine={false} />
						<YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
					</>
				)}
				<Tooltip cursor={{ fill: "rgb(var(--brand-50))" }} content={<TooltipBox format={format} />} />
				{series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
				{series.map((s, i) => (
					<Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || PALETTE[i]} radius={stacked ? 0 : [6, 6, 0, 0]} stackId={stacked ? "a" : undefined} maxBarSize={38} />
				))}
			</BarChart>
		</ResponsiveContainer>
	)
}

/** data: [{ label, value, color? }] */
export function DonutChart({ data = [], height = 220, format, center, centerLabel }) {
	const total = data.reduce((a, d) => a + Number(d.value || 0), 0)
	return (
		<div className="relative" style={{ height }}>
			<ResponsiveContainer width="100%" height="100%">
				<PieChart>
					<Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
						{data.map((d, i) => (
							<Cell key={d.label} fill={d.color || PALETTE[i % PALETTE.length]} />
						))}
					</Pie>
					<Tooltip content={<TooltipBox format={format} />} />
				</PieChart>
			</ResponsiveContainer>
			<div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
				<div>
					<div className="text-xl font-bold text-ink">{center ?? (format ? format(total) : total.toLocaleString())}</div>
					{centerLabel ? <div className="text-[11px] uppercase tracking-wide text-ink-soft">{centerLabel}</div> : null}
				</div>
			</div>
		</div>
	)
}

export function Legendary({ data = [], format }) {
	return (
		<ul className="space-y-1.5 text-sm">
			{data.map((d, i) => (
				<li key={d.label} className="flex items-center gap-2">
					<span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color || PALETTE[i % PALETTE.length] }} />
					<span className="truncate text-ink-muted">{d.label}</span>
					<span className="ml-auto font-semibold text-ink">{format ? format(d.value) : Number(d.value || 0).toLocaleString()}</span>
				</li>
			))}
		</ul>
	)
}
