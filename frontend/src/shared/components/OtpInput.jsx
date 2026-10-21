import { useEffect, useRef, useState } from "react"
import clsx from "clsx"

/**
 * One-time-code entry: `length` single-digit boxes that behave like one field. Typing advances,
 * Backspace goes back, and pasting or SMS autofill (`autocomplete="one-time-code"`) fills every box.
 * `onComplete(code)` fires once all digits are present.
 */
export function OtpInput({ value = "", onChange, length = 6, autoFocus, disabled, onComplete, error, label = "Verification code" }) {
	const refs = useRef([])
	const digits = Array.from({ length }, (_, i) => value[i] || "")

	const set = (next) => {
		const clean = next.replace(/\D/g, "").slice(0, length)
		onChange?.(clean)
		if (clean.length === length) onComplete?.(clean)
		return clean
	}

	const onInput = (i, raw) => {
		const typed = raw.replace(/\D/g, "")
		if (!typed) return
		if (typed.length > 1) {
			const clean = set(typed)
			refs.current[Math.min(clean.length, length - 1)]?.focus()
			return
		}
		const arr = digits.slice()
		arr[i] = typed
		set(arr.join(""))
		refs.current[i + 1]?.focus()
	}

	const onKeyDown = (i, e) => {
		if (e.key === "Backspace") {
			e.preventDefault()
			const arr = digits.slice()
			if (arr[i]) arr[i] = ""
			else if (i > 0) {
				arr[i - 1] = ""
				refs.current[i - 1]?.focus()
			}
			onChange?.(arr.join("").replace(/\D/g, ""))
		} else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus()
		else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus()
	}

	useEffect(() => {
		if (autoFocus) refs.current[0]?.focus()
	}, [autoFocus])

	return (
		<div role="group" aria-label={label}>
			<div className="flex justify-between gap-2">
				{digits.map((d, i) => (
					<input
						key={i}
						ref={(el) => (refs.current[i] = el)}
						value={d}
						inputMode="numeric"
						autoComplete={i === 0 ? "one-time-code" : "off"}
						aria-label={`${label} digit ${i + 1}`}
						disabled={disabled}
						maxLength={length}
						onChange={(e) => onInput(i, e.target.value)}
						onKeyDown={(e) => onKeyDown(i, e)}
						onFocus={(e) => e.target.select()}
						onPaste={(e) => {
							e.preventDefault()
							const clean = set(e.clipboardData.getData("text"))
							refs.current[Math.min(clean.length, length - 1)]?.focus()
						}}
						className={clsx(
							"input h-12 w-full min-w-0 px-0 text-center text-lg font-semibold tabular-nums",
							error && "border-red-400",
							d && "border-brand-600"
						)}
					/>
				))}
			</div>
			{error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : null}
		</div>
	)
}

/** Seconds remaining before a code may be re-sent. `restart(n)` after each successful send. */
export function useCountdown(initial = 0) {
	const [left, setLeft] = useState(initial)
	useEffect(() => {
		if (left <= 0) return undefined
		const t = setTimeout(() => setLeft((s) => s - 1), 1000)
		return () => clearTimeout(t)
	}, [left])
	return [left, (n) => setLeft(Math.max(0, Number(n) || 0))]
}

export function ResendLink({ left, onResend, busy, className }) {
	return (
		<p className={clsx("text-sm text-ink-muted", className)}>
			Didn't get it?{" "}
			{left > 0 ? (
				<span className="tabular-nums">Resend in {left}s</span>
			) : (
				<button type="button" onClick={onResend} disabled={busy} className="font-semibold text-brand-700 hover:underline disabled:opacity-60 dark:text-brand-600">
					{busy ? "Sending…" : "Send a new code"}
				</button>
			)}
		</p>
	)
}
