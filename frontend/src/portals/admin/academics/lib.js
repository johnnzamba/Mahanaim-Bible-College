import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useApi } from "@/shared/api/hooks"
import { frappe } from "@/shared/api/frappe"
import { useSession } from "@/shared/session"
import { ROLES } from "@/shared/access"

export const BASE = "/admin/academics"
export const ACAD = "mahanaim.api.academics."
export const EXAMS = "mahanaim.api.exams."
export const RESULTS = "mahanaim.api.results."
export const ASSESS = "mahanaim.api.assessments."
export const SETUP = "mahanaim.api.setup."
export const LOOKUPS = `${SETUP}lookups`
export const PAGE = 20

export const PROGRAMME_STATUS = ["Active", "Inactive", "Archived"]
export const OFFERING_STATUS = ["Planned", "Open", "In Progress", "Completed", "Cancelled"]
export const SHEET_STATUS = ["Draft", "Submitted", "Approved", "Published", "Returned"]
export const COURSE_TYPES = ["Core", "Elective", "Practicum", "Project"]
export const WEIGHT_COMPONENTS = ["CAT", "Assignment", "Exam", "Practical", "Participation", "Project"]
export const TERM_STATUS = ["Planned", "Registration Open", "In Session", "Examinations", "Closed"]
export const QUESTION_TYPES = ["Multiple Choice", "Multiple Select", "True or False", "Short Answer", "Fill in the Blank", "Essay", "Matching"]
export const DIFFICULTY = ["Easy", "Medium", "Hard"]

/** Badge tones the shared status map gets wrong for the mark sheet workflow. */
export const SHEET_TONE = { Returned: "blue", Approved: "purple", Draft: "gray", "Not Started": "gray" }
export const RESULT_COLORS = { "Not Started": "#9ca3af", Draft: "#c99a43", Submitted: "#f59e0b", Approved: "#8b5cf6", Published: "#1d4d3a", Returned: "#3b82f6" }

/** Mirrors the require_roles lists of the academics, results and setup endpoints. */
export function useAcademicRoles() {
	const s = useSession()
	return useMemo(
		() => ({
			// require_academic_admin: programmes, courses, offerings, sessions, exams, mark sheet queue
			admin: s.hasRole(ROLES.REGISTRAR, ROLES.DEAN),
			dean: s.hasRole(ROLES.DEAN),
			registrar: s.hasRole(ROLES.REGISTRAR),
			// Academic Year / Academic Term DocType write permission
			calendar: s.hasRole(ROLES.REGISTRAR),
			intake: s.hasRole(ROLES.REGISTRAR, ROLES.ADMISSIONS),
			// Grading Scale DocType write permission
			grading: s.hasRole(ROLES.REGISTRAR, ROLES.DEAN),
		}),
		[s]
	)
}

export function useLookups() {
	return useApi(LOOKUPS, {}, { staleTime: 5 * 60_000 })
}

/** Selected term lives in ?term= so filtered views are linkable; defaults to the current term. */
export function useTermParam(lookups) {
	const [params, setParams] = useSearchParams()
	const term = params.get("term") || lookups?.current_term || ""
	const setTerm = useCallback(
		(t) =>
			setParams(
				(p) => {
					const next = new URLSearchParams(p)
					if (t) next.set("term", t)
					else next.delete("term")
					return next
				},
				{ replace: true }
			),
		[setParams]
	)
	return [term, setTerm]
}

export function termOptions(lookups) {
	return (lookups?.terms || []).map((t) => ({ value: t.name, label: `${t.term_label || t.name}${t.is_current ? " (current)" : ""}` }))
}

export function nameOptions(rows = [], labelKey) {
	return rows.map((r) => ({ value: r.name, label: r[labelKey] || r.name }))
}

/**
 * Fan one read out over several records (there is no cross-offering endpoint for some lists).
 * One query, keyed by the whole set, so the cache and invalidation by method prefix keep working.
 */
export function useAcross(method, items, toArgs, options = {}) {
	const keys = items.map((i) => (typeof i === "string" ? i : i.name))
	return useQuery({
		queryKey: [method, { across: keys }],
		enabled: keys.length > 0 && options.enabled !== false,
		staleTime: options.staleTime ?? 30_000,
		queryFn: async () => {
			const settled = await Promise.allSettled(items.map((i) => frappe.call(method, toArgs(i))))
			return items.map((item, idx) => ({
				item,
				data: settled[idx].status === "fulfilled" ? settled[idx].value : null,
				error: settled[idx].status === "rejected" ? settled[idx].reason?.message : null,
			}))
		},
	})
}

export function rowsOf(data) {
	return data?.data || data?.rows || []
}

export function fmtScore(v, d = 1) {
	if (v === null || v === undefined || v === "") return "—"
	const n = Number(v)
	return Number.isFinite(n) ? n.toFixed(d).replace(/\.0+$/, "") : "—"
}

export function rate(part, whole) {
	return whole ? Math.round((Number(part || 0) * 1000) / Number(whole)) / 10 : null
}

/** Mirrors grading_scale.band_errors so problems show before saving. */
export function bandErrors(bands = []) {
	if (!bands.length) return ["Add at least one grade band."]
	const errors = []
	const seen = new Set()
	const f = (v) => Number(v || 0)
	for (const b of bands) {
		const label = b.grade || "?"
		const key = String(b.grade || "").trim().toLowerCase()
		if (!key) errors.push("Every band needs a grade.")
		else if (seen.has(key)) errors.push(`Grade ${label} is listed twice.`)
		seen.add(key)
		if (f(b.min_score) < 0 || f(b.max_score) > 100 || f(b.min_score) > f(b.max_score)) errors.push(`Band ${label}: scores must satisfy 0 ≤ min ≤ max ≤ 100.`)
		if (f(b.grade_points) < 0) errors.push(`Band ${label}: grade points cannot be negative.`)
	}
	const ordered = [...bands].sort((a, b) => f(a.min_score) - f(b.min_score))
	if (f(ordered[0].min_score) > 0) errors.push("The lowest band must start at 0.")
	if (f(ordered[ordered.length - 1].max_score) < 100) errors.push("The highest band must end at 100.")
	for (let i = 1; i < ordered.length; i++) {
		const prev = ordered[i - 1]
		const next = ordered[i]
		const gap = f(next.min_score) - f(prev.max_score)
		if (gap < 0) errors.push(`Bands ${prev.grade} and ${next.grade} overlap.`)
		else if (gap > 1) errors.push(`There is a gap between ${prev.grade} (max ${f(prev.max_score)}) and ${next.grade} (min ${f(next.min_score)}).`)
		if (f(next.grade_points) < f(prev.grade_points)) errors.push(`Grade points must not decrease as scores rise (${prev.grade} vs ${next.grade}).`)
	}
	return [...new Set(errors)]
}

/** Mirrors services/grading.band_for: the highest band whose minimum the score reaches. */
export function gradeFor(score, bands = []) {
	if (!bands.length) return null
	const s = Math.max(0, Math.min(100, Math.round(Number(score || 0) * 100) / 100))
	const desc = [...bands].sort((a, b) => Number(b.min_score || 0) - Number(a.min_score || 0))
	return desc.find((b) => s + 1e-9 >= Number(b.min_score || 0)) || desc[desc.length - 1]
}

/** Small CSV parser (quoted fields, escaped quotes, CRLF) for the question import. */
export function parseCsv(text) {
	const rows = []
	let row = []
	let cell = ""
	let quoted = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				cell += '"'
				i++
			} else if (c === '"') quoted = false
			else cell += c
		} else if (c === '"') quoted = true
		else if (c === ",") {
			row.push(cell)
			cell = ""
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++
			row.push(cell)
			rows.push(row)
			row = []
			cell = ""
		} else cell += c
	}
	if (cell !== "" || row.length) {
		row.push(cell)
		rows.push(row)
	}
	const clean = rows.filter((r) => r.some((v) => String(v).trim() !== ""))
	if (!clean.length) return []
	const head = clean[0].map((h) => h.replace(/^\ufeff/, "").trim().toLowerCase())
	return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])))
}
