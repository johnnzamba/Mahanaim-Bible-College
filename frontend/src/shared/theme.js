/**
 * Per-browser appearance: colour scheme (light / dark / system) and portal rail skin.
 * Applied to <html data-theme data-rail> before first paint (see main.jsx).
 */
export const THEME_KEY = "mbc-theme"
export const RAIL_KEY = "mbc-rail"

export const RAILS = [
	{ id: "forest", label: "Forest", hint: "Deep green rail, gold accents", swatch: "#14372a" },
	{ id: "parchment", label: "Parchment", hint: "Light rail on cream", swatch: "#fffdf8" },
	{ id: "ink", label: "Ink", hint: "Near-black rail", swatch: "#0f1a15" },
]

export const SCHEMES = [
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
	{ id: "system", label: "System" },
]

function read(key, fallback) {
	try {
		return localStorage.getItem(key) || fallback
	} catch {
		return fallback
	}
}

function write(key, value) {
	try {
		localStorage.setItem(key, value)
	} catch {
		/* private mode */
	}
}

// The public website is designed light-only (dark hero bands, photography); portals honour the preference.
const PORTAL_PATH = /^\/(applicant|student|lecturer|admin|sponsor|signin|forgot-password|reset-password)(\/|$)/
let forced = null

export function resolvedScheme(scheme = read(THEME_KEY, "light")) {
	if (forced) return forced
	if (scheme === "system") {
		return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
	}
	return scheme
}

export function applyTheme() {
	const root = document.documentElement
	const scheme = resolvedScheme()
	root.dataset.theme = scheme
	root.classList.toggle("dark", scheme === "dark")
	root.dataset.rail = read(RAIL_KEY, "forest")
	const meta = document.querySelector('meta[name="theme-color"]')
	if (meta) meta.setAttribute("content", scheme === "dark" ? "#0a120e" : "#14372a")
}

/** Pin the scheme while a surface is mounted; returns the release function (for effects). */
export function forceScheme(scheme) {
	forced = scheme
	applyTheme()
	return () => {
		forced = null
		applyTheme()
	}
}

export function initTheme() {
	if (!PORTAL_PATH.test(window.location.pathname)) forced = "light"
	applyTheme()
	window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
		if (read(THEME_KEY, "light") === "system") applyTheme()
	})
}

export function getScheme() {
	return read(THEME_KEY, "light")
}

export function setScheme(id) {
	write(THEME_KEY, id)
	applyTheme()
}

export function getRail() {
	return read(RAIL_KEY, "forest")
}

export function setRail(id) {
	write(RAIL_KEY, id)
	applyTheme()
}
