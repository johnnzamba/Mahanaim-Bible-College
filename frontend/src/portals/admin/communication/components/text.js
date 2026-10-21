/** Plain-text editing for HTML fields: paragraphs and line breaks round-trip; richer HTML is edited as-is. */

const SIMPLE = /^(\s*<p>([^<]|<br\s*\/?>|<a [^>]*>[^<]*<\/a>)*<\/p>\s*)*$/i

const decode = (s) =>
	s
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** HTML from the server → text for the textarea. Returns { text, html: true } when it can't be simplified. */
export function htmlToText(html) {
	const src = (html || "").trim()
	if (!src) return { text: "", html: false }
	if (!/<[a-z][\s\S]*>/i.test(src)) return { text: decode(src), html: false }
	if (!SIMPLE.test(src)) return { text: src, html: true }
	const text = src
		.replace(/<a [^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/gi, "$1")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>\s*<p>/gi, "\n\n")
		.replace(/<\/?p>/gi, "")
	return { text: decode(text).trim(), html: false }
}

/** Textarea text → HTML. Text that already contains HTML tags is sent unchanged. */
export function textToHtml(text) {
	const src = (text || "").trim()
	if (!src) return ""
	if (/<(p|div|br|ul|ol|li|h[1-6]|strong|em|b|i|a|table)\b[^>]*>/i.test(src)) return src
	return src
		.split(/\n{2,}/)
		.map((para) => `<p>${escape(para).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</p>`)
		.join("")
}
