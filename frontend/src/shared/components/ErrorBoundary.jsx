import { Component } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

/**
 * Catches render errors per portal so one broken screen never blanks the whole SPA.
 * A failed dynamic import (stale chunk after a deploy) triggers a single hard reload.
 */
export class ErrorBoundary extends Component {
	constructor(props) {
		super(props)
		this.state = { error: null }
	}

	static getDerivedStateFromError(error) {
		return { error }
	}

	componentDidUpdate(prev) {
		// Navigating away from a broken page clears the error without remounting healthy pages.
		if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
	}

	componentDidCatch(error) {
		const msg = String(error?.message || "")
		if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)) {
			const key = "mbc-chunk-reload"
			if (!sessionStorage.getItem(key)) {
				sessionStorage.setItem(key, "1")
				window.location.reload()
				return
			}
		}
		console.error(error)
	}

	render() {
		const { error } = this.state
		if (!error) return this.props.children
		return (
			<div className="grid min-h-[60vh] place-items-center px-4">
				<div className="card w-full max-w-md p-8 text-center">
					<span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600">
						<AlertTriangle size={26} />
					</span>
					<h1 className="font-serif text-xl text-ink">Something went wrong on this page</h1>
					<p className="mt-2 text-sm text-ink-muted">The error has been logged. Reloading usually fixes it.</p>
					<pre className="scroll-thin mt-4 max-h-32 overflow-auto rounded-lg bg-cream p-3 text-left text-[11px] text-ink-soft">{String(error?.message || error)}</pre>
					<button
						type="button"
						className="btn btn-primary mt-5"
						onClick={() => {
							sessionStorage.removeItem("mbc-chunk-reload")
							window.location.reload()
						}}
					>
						<RefreshCw size={16} /> Reload
					</button>
				</div>
			</div>
		)
	}
}
