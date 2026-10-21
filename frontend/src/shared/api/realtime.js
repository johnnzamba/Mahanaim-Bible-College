import { io } from "socket.io-client"

/**
 * One socket.io connection per tab to Frappe's realtime server.
 *
 * Frappe authenticates the socket from the session cookie and joins it to the `user:<email>`
 * room, so anything the backend sends with `frappe.publish_realtime(event, data, user=...)`
 * (e.g. `mbc_notification`, `mbc_payment`) arrives here. The namespace must be the site name.
 * Failure is non-fatal: every screen that listens also polls.
 */
let socket = null
const handlers = new Map()

function siteName() {
	return window.mahanaim_boot?.sitename || window.location.hostname
}

function ensureSocket() {
	if (socket) return socket
	if (!window.mahanaim_boot?.user || window.mahanaim_boot.user === "Guest") return null
	try {
		const port = window.mahanaim_boot?.socketio_port
		const origin =
			port && !window.location.port ? window.location.origin : port ? `${window.location.protocol}//${window.location.hostname}:${port}` : window.location.origin
		socket = io(`${origin}/${siteName()}`, {
			withCredentials: true,
			reconnectionAttempts: 20,
			reconnectionDelayMax: 15000,
		})
		socket.on("connect_error", () => {
			/* degrade to polling */
		})
	} catch {
		socket = null
	}
	return socket
}

export function onRealtime(event, handler) {
	const s = ensureSocket()
	if (!s) return () => {}
	if (!handlers.has(event)) {
		handlers.set(event, new Set())
		s.on(event, (payload) => {
			for (const h of handlers.get(event) || []) {
				try {
					h(payload)
				} catch (e) {
					console.error(e)
				}
			}
		})
	}
	handlers.get(event).add(handler)
	return () => handlers.get(event)?.delete(handler)
}
