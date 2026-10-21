import DOMPurify from "dompurify"

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
		node.setAttribute("rel", "noopener noreferrer")
	}
})

/**
 * Strip scripts, event handlers and javascript: URLs from server HTML before it
 * is injected. Frappe only sanitises some field types on save, so the SPA never
 * trusts stored HTML (student answers, enquiry text and message logs included).
 */
export function sanitizeHtml(html) {
	if (!html) return ""
	return DOMPurify.sanitize(String(html), {
		USE_PROFILES: { html: true },
		ADD_ATTR: ["target"],
		FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
	})
}

const SAFE_URL = /^(https?:|mailto:|tel:|\/(?!\/)|#|\?)/i
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i

/**
 * Return `url` only if it is http(s), mailto, tel or same-origin relative, so a
 * stored "javascript:..." link can never run when clicked. Bare domains
 * ("www.church.org") become https links. Use for every href built from server
 * data (meeting links, resource URLs, partner websites).
 */
export function safeUrl(url) {
	if (!url) return undefined
	const s = String(url).trim()
	if (SAFE_URL.test(s)) return s
	return BARE_DOMAIN.test(s) ? `https://${s}` : undefined
}
