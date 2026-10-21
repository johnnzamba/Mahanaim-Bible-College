import { useEffect, useState } from "react"
import { Download, Plus, Share, X } from "lucide-react"

/**
 * The SW is built to /assets/mahanaim/app/sw.js but served by mahanaim.api.session.service_worker,
 * which adds Service-Worker-Allowed: / so it can control the whole site.
 */
export function registerSW() {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
	if (window.location.hostname === "localhost" && window.location.port === "8080") return // vite dev
	window.addEventListener("load", () => {
		const v = window.mahanaim_boot?.build || "1"
		navigator.serviceWorker.register(`/api/method/mahanaim.api.session.service_worker?v=${v}`, { scope: "/" }).catch(() => {})
	})
}

export function usePwaInstall() {
	const [deferred, setDeferred] = useState(null)
	const [standalone, setStandalone] = useState(false)
	const [ios, setIos] = useState(false)
	useEffect(() => {
		setStandalone(window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true)
		setIos(/iphone|ipad|ipod/i.test(navigator.userAgent))
		const onPrompt = (e) => {
			e.preventDefault()
			setDeferred(e)
		}
		const onInstalled = () => {
			setDeferred(null)
			setStandalone(true)
		}
		window.addEventListener("beforeinstallprompt", onPrompt)
		window.addEventListener("appinstalled", onInstalled)
		return () => {
			window.removeEventListener("beforeinstallprompt", onPrompt)
			window.removeEventListener("appinstalled", onInstalled)
		}
	}, [])
	const install = async () => {
		if (!deferred) return false
		deferred.prompt()
		const choice = await deferred.userChoice
		setDeferred(null)
		return choice.outcome === "accepted"
	}
	return { canInstall: Boolean(deferred), standalone, ios, install }
}

export function InstallAppButton({ className = "" }) {
	const { canInstall, standalone, ios, install } = usePwaInstall()
	const [hint, setHint] = useState(false)
	if (standalone || (!canInstall && !ios)) return null
	return (
		<>
			<button
				type="button"
				onClick={() => (canInstall ? install() : setHint(true))}
				className={`hidden h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-ink-muted hover:bg-brand-50 hover:text-ink sm:inline-flex ${className}`}
			>
				<Download size={16} /> Install app
			</button>
			{hint ? (
				<div className="fixed inset-x-3 bottom-4 z-[95] mx-auto max-w-sm animate-fade-up rounded-2xl border border-line bg-surface p-4 shadow-lift">
					<div className="flex items-start gap-3">
						<div className="flex-1 text-sm text-ink-muted">
							<div className="mb-1 font-semibold text-ink">Add to Home Screen</div>
							Tap <Share size={14} className="inline" /> Share, then <Plus size={14} className="inline" /> “Add to Home Screen”.
						</div>
						<button type="button" onClick={() => setHint(false)} aria-label="Close" className="text-ink-soft">
							<X size={16} />
						</button>
					</div>
				</div>
			) : null}
		</>
	)
}
