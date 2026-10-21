/**
 * Thin Frappe REST client used by every portal.
 *
 * - All business calls go through `frappe.call("mahanaim.api.<module>.<fn>", args)`; the
 *   server returns `{ message }` and we unwrap it.
 * - CSRF comes from the token www/mbc.html injects (`window.csrf_token`), falling back to the
 *   desk global or the cookie during `vite dev`.
 * - Server errors are flattened to readable text (Frappe sends HTML in `_server_messages`).
 */

export class ApiError extends Error {
	constructor(message, { status, exc_type, data } = {}) {
		super(message)
		this.name = "ApiError"
		this.status = status
		this.exc_type = exc_type
		this.data = data
	}
}

export function getCSRFToken() {
	const injected = typeof window !== "undefined" ? window.csrf_token : null
	if (injected && !String(injected).includes("{{")) return injected
	if (typeof window !== "undefined" && window.frappe?.csrf_token) return window.frappe.csrf_token
	const m = typeof document !== "undefined" ? document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/) : null
	return m ? decodeURIComponent(m[1]) : "fetch"
}

export function plainText(html) {
	if (html == null) return ""
	const s = String(html)
	if (!/[<&]/.test(s)) return s
	if (typeof document === "undefined") return s.replace(/<[^>]+>/g, "")
	const el = document.createElement("div")
	el.innerHTML = s
	return (el.textContent || el.innerText || "").trim()
}

function parseServerMessages(body) {
	try {
		const msgs = JSON.parse(body._server_messages || "[]")
		const texts = msgs
			.map((m) => {
				try {
					const o = typeof m === "string" ? JSON.parse(m) : m
					return plainText(o.message || o)
				} catch {
					return plainText(m)
				}
			})
			.filter(Boolean)
		return texts.join("\n")
	} catch {
		return ""
	}
}

let reloading = false
function handleExpired(status, body) {
	const expired =
		status === 401 ||
		(status === 403 && body?.exc_type === "CSRFTokenError") ||
		body?.session_expired
	if (expired && !reloading && !body?.message) {
		reloading = true
		// One reload re-issues a fresh session + CSRF token; the AuthGate then routes to /signin.
		setTimeout(() => window.location.reload(), 50)
	}
}

async function request(url, { method = "GET", body, headers = {}, raw = false, signal } = {}) {
	const opts = {
		method,
		credentials: "include",
		signal,
		headers: {
			Accept: "application/json",
			"X-Frappe-CSRF-Token": getCSRFToken(),
			...headers,
		},
	}
	if (body instanceof FormData) {
		opts.body = body
	} else if (body !== undefined) {
		opts.headers["Content-Type"] = "application/json"
		opts.body = JSON.stringify(body)
	}
	const res = await fetch(url, opts)
	if (raw) return res
	let data = null
	const text = await res.text()
	try {
		data = text ? JSON.parse(text) : {}
	} catch {
		data = { message: text }
	}
	if (!res.ok || data.exc_type || data.exception) {
		handleExpired(res.status, data)
		const msg =
			parseServerMessages(data) ||
			plainText(data.exception?.split(":").slice(1).join(":")) ||
			plainText(data.message) ||
			(res.status === 403
				? "You do not have permission to do that."
				: res.status === 404
					? "Not found."
					: res.status >= 500
						? "The server hit a problem. Please try again."
						: `Request failed (${res.status})`)
		throw new ApiError(msg.trim(), { status: res.status, exc_type: data.exc_type, data })
	}
	return data
}

const clean = (args = {}) => {
	const out = {}
	for (const [k, v] of Object.entries(args)) {
		if (v === undefined) continue
		out[k] = v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v
	}
	return out
}

export const frappe = {
	/** POST /api/method/<method>; returns `message`. Objects/arrays are JSON-encoded. */
	async call(method, args = {}, opts = {}) {
		const data = await request(`/api/method/${method}`, { method: "POST", body: clean(args), ...opts })
		return data.message
	},

	/** GET /api/method/<method>?args (cacheable reads, guest pages). */
	async get(method, args = {}, opts = {}) {
		const qs = new URLSearchParams(clean(args)).toString()
		const data = await request(`/api/method/${method}${qs ? `?${qs}` : ""}`, opts)
		return data.message
	},

	/** URL for file-returning endpoints (PDF downloads, CSV exports). */
	downloadUrl(method, args = {}) {
		const qs = new URLSearchParams(clean(args)).toString()
		return `/api/method/${method}${qs ? `?${qs}` : ""}`
	},

	async login(usr, pwd) {
		return request("/api/method/login", { method: "POST", body: { usr, pwd } })
	},

	async logout() {
		try {
			await request("/api/method/logout", { method: "POST" })
		} finally {
			try {
				localStorage.removeItem("mbc-session-cache")
			} catch {
				/* ignore */
			}
		}
	},

	async getLoggedUser() {
		return this.get("frappe.auth.get_logged_user")
	},

	/**
	 * Upload via Frappe's upload_file. Returns the File doc ({ file_url, name, ... }).
	 * meta: { doctype, docname, fieldname, folder }
	 */
	async uploadFile(file, isPrivate = true, meta = {}) {
		const fd = new FormData()
		fd.append("file", file, file.name)
		fd.append("is_private", isPrivate ? "1" : "0")
		if (meta.doctype) fd.append("doctype", meta.doctype)
		if (meta.docname) fd.append("docname", meta.docname)
		if (meta.fieldname) fd.append("fieldname", meta.fieldname)
		fd.append("folder", meta.folder || "Home/Attachments")
		const data = await request("/api/method/upload_file", { method: "POST", body: fd })
		return data.message
	},
}

export default frappe
