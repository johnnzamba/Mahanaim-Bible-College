import { useEffect, useState } from "react"
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from "lucide-react"
import clsx from "clsx"

/**
 * Global toasts without a context provider: `toast.success("Saved")` from anywhere
 * (including non-React modules such as api/hooks.js). <Toaster/> is mounted once in App.
 */
const listeners = new Set()
let seq = 0

function push(kind, message, opts = {}) {
	const t = { id: ++seq, kind, message: String(message || ""), title: opts.title, duration: opts.duration ?? (kind === "error" ? 6500 : 3800) }
	listeners.forEach((l) => l(t))
	return t.id
}

export const toast = {
	success: (m, o) => push("success", m, o),
	error: (m, o) => push("error", m, o),
	info: (m, o) => push("info", m, o),
	warning: (m, o) => push("warning", m, o),
}

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }
const TONES = {
	success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
	error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
	info: "border-brand-200 bg-surface text-ink",
	warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
}

export function Toaster() {
	const [items, setItems] = useState([])
	useEffect(() => {
		const l = (t) => {
			setItems((xs) => [...xs.slice(-3), t])
			setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.duration)
		}
		listeners.add(l)
		return () => listeners.delete(l)
	}, [])
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 sm:items-end">
			{items.map((t) => {
				const Icon = ICONS[t.kind]
				return (
					<div
						key={t.id}
						role={t.kind === "error" ? "alert" : "status"}
						className={clsx(
							"pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-soft",
							TONES[t.kind]
						)}
					>
						<Icon size={18} className="mt-0.5 shrink-0" />
						<div className="min-w-0 flex-1">
							{t.title ? <div className="font-semibold">{t.title}</div> : null}
							<div className="whitespace-pre-line break-words">{t.message}</div>
						</div>
						<button
							type="button"
							aria-label="Dismiss"
							className="opacity-60 hover:opacity-100"
							onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
						>
							<X size={16} />
						</button>
					</div>
				)
			})}
		</div>
	)
}
