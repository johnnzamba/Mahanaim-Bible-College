import { useEffect, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router-dom"
import { useSiteSettings } from "@/shared/layout/PublicLayout"
import { BRAND } from "@/shared/brand"
import { plainText } from "@/shared/api/frappe"
import { parseServerDate } from "@/shared/utils/format"

export const W = "mahanaim.api.website."

export function useSite() {
	return useSiteSettings().data || {}
}

export function useInstitution() {
	const site = useSite()
	return {
		name: site.institution?.name || BRAND.full,
		short: site.institution?.short_name || BRAND.short,
		motto: site.institution?.motto || BRAND.motto,
	}
}

function upsertMeta(attr, key, value) {
	if (typeof document === "undefined") return
	let el = document.head.querySelector(`meta[${attr}="${key}"]`)
	if (!el) {
		el = document.createElement("meta")
		el.setAttribute(attr, key)
		document.head.appendChild(el)
	}
	el.setAttribute("content", value)
}

/** document.title = "<Page> · <institution>" plus description / OpenGraph tags for client-side navigation. */
export function usePageMeta(title, description) {
	const inst = useInstitution()
	const site = useSite()
	const desc = clip(plainText(description || site.meta_description || ""), 300)
	useEffect(() => {
		document.title = title ? `${title} · ${inst.name}` : `${inst.name} — ${inst.motto}`
		if (desc) {
			upsertMeta("name", "description", desc)
			upsertMeta("property", "og:description", desc)
			upsertMeta("name", "twitter:description", desc)
		}
		upsertMeta("property", "og:title", document.title)
		upsertMeta("name", "twitter:title", document.title)
		upsertMeta("property", "og:url", window.location.href)
	}, [title, desc, inst.name, inst.motto])
}

export function clip(text, n = 160) {
	const s = String(text || "").replace(/\s+/g, " ").trim()
	return s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`
}

export function isHtml(s) {
	return /<\/?[a-z][\s\S]*>/i.test(String(s || ""))
}

/** Split free text (one item per line) into a list. */
export function lines(s) {
	return String(s || "")
		.split(/\r?\n/)
		.map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim())
		.filter(Boolean)
}

/** Update several query-string params at once ("" / null removes a key); resets ?page unless given. */
export function useUpdateParams() {
	const [, setParams] = useSearchParams()
	return (patch) =>
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev)
				for (const [k, v] of Object.entries(patch)) {
					if (v === "" || v == null) next.delete(k)
					else next.set(k, String(v))
				}
				if (!("page" in patch)) next.delete("page")
				return next
			},
			{ replace: true }
		)
}

/** Query-string state: [value, setValue] bound to ?key=… (replace, keeps other params). */
export function useParamState(key, fallback = "", { resetPage = true } = {}) {
	const [params, setParams] = useSearchParams()
	const value = params.get(key) ?? fallback
	const set = (v) => {
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev)
				if (v === "" || v == null || v === fallback) next.delete(key)
				else next.set(key, String(v))
				if (resetPage && key !== "page") next.delete("page")
				return next
			},
			{ replace: true }
		)
	}
	return [value, set]
}

/** Count up to `target` once the element scrolls into view. */
export function useCountUp(target, duration = 1400) {
	const ref = useRef(null)
	const [value, setValue] = useState(0)
	useEffect(() => {
		const el = ref.current
		const n = Number(target) || 0
		if (!el || !n) {
			setValue(n)
			return undefined
		}
		const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
		if (reduce || typeof IntersectionObserver === "undefined") {
			setValue(n)
			return undefined
		}
		let raf = 0
		const io = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting) return
				io.disconnect()
				const t0 = performance.now()
				const tick = (t) => {
					const p = Math.min(1, (t - t0) / duration)
					setValue(Math.round(n * (1 - (1 - p) ** 3)))
					if (p < 1) raf = requestAnimationFrame(tick)
				}
				raf = requestAnimationFrame(tick)
			},
			{ threshold: 0.3 }
		)
		io.observe(el)
		return () => {
			io.disconnect()
			cancelAnimationFrame(raf)
		}
	}, [target, duration])
	return [ref, value]
}

/** Scroll to the element whose id matches the URL hash once `ready` becomes true. */
export function useHashScroll(ready) {
	const { hash } = useLocation()
	useEffect(() => {
		if (!ready || !hash) return undefined
		const t = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" }), 120)
		return () => clearTimeout(t)
	}, [ready, hash])
}

export function absoluteUrl(path = "") {
	if (typeof window === "undefined") return path
	return /^https?:/i.test(path) ? path : `${window.location.origin}${path.startsWith("/") ? "" : "/"}${path}`
}

const HONORIFIC = /^(rt\.?|rev\.?|revd\.?|very|most|right|the|dr\.?|prof\.?|pastor|ps\.?|bishop|bp\.?|archbishop|apostle|evangelist|elder|deacon|deaconess|fr\.?|sr\.?|mr\.?|mrs\.?|ms\.?|miss|hon\.?|ven\.?|canon|dcn\.?)$/i

/** Name without leading titles ("Rt. Rev. Stephen Mutua" → "Stephen Mutua"), so avatar initials read "SM". */
export function bareName(name = "") {
	const parts = String(name || "").trim().split(/\s+/)
	while (parts.length > 2 && HONORIFIC.test(parts[0])) parts.shift()
	if (parts.length === 2 && HONORIFIC.test(parts[0])) parts.shift()
	return parts.join(" ") || name
}

/** "254700100200" → "+254 700 100 200"; anything else is returned unchanged. */
export function prettyPhone(p) {
	const m = String(p || "")
		.replace(/[^\d]/g, "")
		.match(/^254(\d{3})(\d{3})(\d{3})$/)
	return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : p
}

/** Keep server-supplied routes inside the SPA (no external or javascript: targets). */
export function internalRoute(route, fallback = "/") {
	const r = String(route || "").trim()
	return r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/\\") ? r : fallback
}

export function signinUrl(next) {
	return next ? `/signin?next=${encodeURIComponent(next)}` : "/signin"
}

/** Levels in the order a prospective student thinks about them. */
export const LEVEL_ORDER = ["Short Course", "Certificate", "Diploma", "Higher Diploma", "Bachelor", "Postgraduate Diploma", "Masters"]
export const sortLevels = (levels = []) =>
	[...levels].sort((a, b) => {
		const ia = LEVEL_ORDER.indexOf(a)
		const ib = LEVEL_ORDER.indexOf(b)
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b))
	})

/** "2026-01-12 09:00:00" → Date (site-local). */
export function toDate(v) {
	return parseServerDate(v)
}
