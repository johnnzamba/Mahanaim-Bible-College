import { getCSRFToken, plainText } from "@/shared/api/frappe"

function serverMessage(body) {
	try {
		const msgs = JSON.parse(body?._server_messages || "[]")
		const text = msgs
			.map((m) => {
				try {
					const o = typeof m === "string" ? JSON.parse(m) : m
					return plainText(o.message || o)
				} catch {
					return plainText(m)
				}
			})
			.filter(Boolean)
			.join("\n")
		if (text) return text
	} catch {
		/* fall through */
	}
	return plainText(body?.message || body?.exception || "")
}

// Frappe validates some files on upload and only returns the exception type.
const EXC_MESSAGES = {
	PdfReadError: "This PDF couldn't be read — it may be damaged or password-protected. Save or scan it again, or upload a photo instead.",
	FileTypeNotAllowed: "This file type isn't allowed. Upload a PDF or an image (JPG, PNG).",
	MaxFileSizeReachedError: "This file is too large. Upload a file under 10 MB.",
}

/**
 * Upload a private file to /api/method/upload_file with byte-level progress
 * (the shared client uses fetch, which cannot report upload progress).
 * Resolves to `{ file_url, name }`.
 */
export function uploadWithProgress(file, { onProgress, isPrivate = true } = {}) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open("POST", "/api/method/upload_file")
		xhr.withCredentials = true
		xhr.setRequestHeader("Accept", "application/json")
		xhr.setRequestHeader("X-Frappe-CSRF-Token", getCSRFToken())
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)))
		}
		xhr.onload = () => {
			let body = {}
			try {
				body = JSON.parse(xhr.responseText || "{}")
			} catch {
				/* non-JSON error page */
			}
			if (xhr.status >= 200 && xhr.status < 300 && body.message?.file_url) {
				onProgress?.(100)
				resolve(body.message)
			} else {
				reject(new Error(serverMessage(body) || EXC_MESSAGES[body.exc_type] || `Upload failed (${xhr.status}). Please try again.`))
			}
		}
		xhr.onerror = () => reject(new Error("Network error — check your connection and try again."))
		const fd = new FormData()
		fd.append("file", file, file.name)
		fd.append("is_private", isPrivate ? "1" : "0")
		fd.append("folder", "Home/Attachments")
		xhr.send(fd)
	})
}
