import { money } from "@/shared/utils/format"

/**
 * Money for StatCards. Phones get compact notation with a small currency code
 * ("KES 44K"), because a half-width card only fits five or six large digits.
 */
export function Amount({ value }) {
	const full = money(value)
	const n = Number(value) || 0
	const code = full.split(" ")[0]
	const short =
		Math.abs(n) >= 1000
			? new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: Math.abs(n) >= 10_000 ? 0 : 1 }).format(n)
			: full.slice(code.length + 1)
	return (
		<>
			<span className="sm:hidden" title={full}>
				<span className="mr-0.5 text-[0.6em] font-semibold text-ink-soft">{code}</span>
				{short}
			</span>
			<span className="hidden sm:inline">{full}</span>
		</>
	)
}

/** Shorter wording on phones, where StatCard labels and hints truncate. */
export function Resp({ short, children }) {
	return (
		<>
			<span className="sm:hidden">{short}</span>
			<span className="hidden sm:inline">{children}</span>
		</>
	)
}
