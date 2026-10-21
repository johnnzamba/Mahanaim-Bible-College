/**
 * Post-build: turn Vite's output into what Frappe serves.
 *
 * 1. mahanaim/www/mbc.html — the Jinja shell for every SPA route. The entry script and stylesheet
 *    are content-hashed by Vite; their names are read from Vite's own index.html.
 * 2. Web app manifests — one per portal so "Install app" opens straight into that portal.
 * 3. sw.js — network-first service worker (never caches /api/), served with
 *    Service-Worker-Allowed: / by mahanaim.api.session.service_worker so it controls the site.
 */
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, "../../mahanaim/public/app")
const www = path.resolve(__dirname, "../../mahanaim/www")
const BASE = "/assets/mahanaim/app"

const viteHtml = fs.readFileSync(path.join(appDir, "index.html"), "utf8")
const pick = (re, what) => {
	const m = viteHtml.match(re)
	if (!m) throw new Error(`copy-html: could not find the ${what} in Vite's index.html`)
	return m[1].replace(/^.*\/assets\//, "assets/")
}
const ENTRY_JS = pick(/<script[^>]+src="([^"]+\.js)"/, "entry script")
const ENTRY_CSS = pick(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/, "stylesheet")
const PRELOADS = [...viteHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) =>
	m[1].replace(/^.*\/assets\//, "assets/"),
)
const build = crypto.createHash("md5").update(ENTRY_JS + ENTRY_CSS).digest("hex").slice(0, 10)

// ── Manifests ──────────────────────────────────────────────────────────────
const PORTALS = {
	site: { name: "Mahanaim Bible College", short: "Mahanaim", start: "/", scope: "/" },
	student: { name: "MBC Student Portal", short: "MBC Student", start: "/student", scope: "/" },
	lecturer: { name: "MBC Lecturer Portal", short: "MBC Lecturer", start: "/lecturer", scope: "/" },
	admin: { name: "MBC Administration", short: "MBC Admin", start: "/admin", scope: "/" },
	applicant: { name: "MBC Admissions", short: "MBC Apply", start: "/applicant", scope: "/" },
	sponsor: { name: "MBC Sponsor Portal", short: "MBC Sponsor", start: "/sponsor", scope: "/" },
}

for (const [key, p] of Object.entries(PORTALS)) {
	const manifest = {
		name: p.name,
		short_name: p.short,
		id: p.start,
		start_url: p.start,
		scope: p.scope,
		display: "standalone",
		orientation: "portrait-primary",
		background_color: "#f8f6f0",
		theme_color: "#14372a",
		description: "Mahanaim Bible College Digital Campus",
		icons: [
			{ src: "/assets/mahanaim/images/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/assets/mahanaim/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "/assets/mahanaim/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
		shortcuts:
			key === "student"
				? [
						{ name: "My courses", url: "/student/courses" },
						{ name: "Fees", url: "/student/fees" },
						{ name: "Results", url: "/student/results" },
					]
				: undefined,
	}
	fs.writeFileSync(path.join(appDir, `${key}.webmanifest`), JSON.stringify(manifest, null, 2))
}

// ── Service worker ─────────────────────────────────────────────────────────
const sw = `/* Mahanaim Digital Campus service worker — build ${build} */
const CACHE = "mbc-${build}";
const SHELL = ["${BASE}/${ENTRY_JS}", "${BASE}/${ENTRY_CSS}", "/assets/mahanaim/images/logo.svg"];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("mbc-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", (e) => {
	const req = e.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;
	// Never cache data, auth, desk or files.
	if (/^\\/(api|desk|app|private|files|socket\\.io|login|logout)/.test(url.pathname)) return;

	// Static build assets: cache-first (names are content-hashed).
	if (url.pathname.startsWith("${BASE}/assets/") || url.pathname.startsWith("/assets/mahanaim/images/")) {
		e.respondWith(
			caches.match(req).then((hit) => hit || fetch(req).then((res) => {
				if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
				return res;
			}))
		);
		return;
	}

	// Navigations: network-first, fall back to the last good shell for offline use.
	if (req.mode === "navigate") {
		e.respondWith(
			fetch(req).then((res) => {
				if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/__shell", copy)); }
				return res;
			}).catch(() => caches.match("/__shell").then((hit) => hit || new Response("<h1>You are offline</h1><p>Reconnect to continue.</p>", { headers: { "Content-Type": "text/html" } })))
		);
	}
});

self.addEventListener("push", (e) => {
	let data = {};
	try { data = e.data ? e.data.json() : {}; } catch { data = { title: "Mahanaim", body: e.data && e.data.text() }; }
	e.waitUntil(self.registration.showNotification(data.title || "Mahanaim Bible College", {
		body: data.body || data.message || "",
		icon: "/assets/mahanaim/images/icon-192.png",
		badge: "/assets/mahanaim/images/icon-192.png",
		data: { url: data.link || data.url || "/" },
	}));
});

self.addEventListener("notificationclick", (e) => {
	e.notification.close();
	const url = (e.notification.data && e.notification.data.url) || "/";
	e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
		for (const w of wins) { if ("focus" in w) { w.navigate(url); return w.focus(); } }
		return self.clients.openWindow(url);
	}));
});
`
fs.writeFileSync(path.join(appDir, "sw.js"), sw)

// ── Jinja shell ────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<!-- Generated by frontend/scripts/copy-html.mjs — do not edit by hand. -->
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
	<title>{{ meta_title | e }}</title>
	<meta name="description" content="{{ meta_description | e }}" />
	{% if canonical_url %}<link rel="canonical" href="{{ canonical_url | e }}" />{% endif %}
	{% if noindex %}<meta name="robots" content="noindex, nofollow" />{% endif %}
	<meta property="og:site_name" content="{{ site_name | e }}" />
	<meta property="og:type" content="{{ (og_type or 'website') | e }}" />
	<meta property="og:title" content="{{ meta_title | e }}" />
	<meta property="og:description" content="{{ meta_description | e }}" />
	{% if canonical_url %}<meta property="og:url" content="{{ canonical_url | e }}" />{% endif %}
	{% if meta_image %}<meta property="og:image" content="{{ meta_image | e }}" /><meta name="twitter:image" content="{{ meta_image | e }}" />{% endif %}
	<meta name="twitter:card" content="{{ ('summary_large_image' if meta_image else 'summary') | e }}" />
	<meta name="theme-color" content="#14372a" />
	<link rel="icon" type="image/png" href="/assets/mahanaim/images/favicon.png" />
	<link rel="icon" type="image/svg+xml" href="/assets/mahanaim/images/logo.svg" />
	<link rel="apple-touch-icon" sizes="192x192" href="/assets/mahanaim/images/icon-192.png" />
	<link rel="manifest" href="${BASE}/{{ (manifest or 'site') | e }}.webmanifest?v=${build}" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="{{ (app_title or 'Mahanaim') | e }}" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" />
	<link rel="stylesheet" href="${BASE}/${ENTRY_CSS}" />
${PRELOADS.map((p) => `	<link rel="modulepreload" crossorigin href="${BASE}/${p}" />`).join("\n")}
	{% if structured_data %}<script type="application/ld+json">{{ structured_data | tojson }}</script>{% endif %}
	<script>
		window.csrf_token = {{ csrf_token | tojson }};
		window.mahanaim_boot = {{ boot | tojson }};
		window.mahanaim_boot.build = "${build}";
		(function () {
			try {
				var t = localStorage.getItem("mbc-theme") || "light";
				if (t === "system") t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
				// Keep in step with shared/theme.js: the public website is light-only.
				if (!/^\\/(applicant|student|lecturer|admin|sponsor|signin|forgot-password|reset-password)(\\/|$)/.test(location.pathname)) t = "light";
				document.documentElement.dataset.theme = t;
				if (t === "dark") document.documentElement.classList.add("dark");
				document.documentElement.dataset.rail = localStorage.getItem("mbc-rail") || "forest";
			} catch (e) {}
		})();
	</script>
</head>
<body>
	<div id="root"></div>
	<noscript>
		<div style="max-width:640px;margin:4rem auto;padding:0 1rem;font-family:Georgia,serif">
			<h1>{{ site_name | e }}</h1>
			<p>{{ meta_description | e }}</p>
			<p>Please enable JavaScript to use the Digital Campus.</p>
		</div>
	</noscript>
	<script type="module" crossorigin src="${BASE}/${ENTRY_JS}"></script>
</body>
</html>
`
fs.mkdirSync(www, { recursive: true })
fs.writeFileSync(path.join(www, "mbc.html"), html)

// Vite's own index.html is not served (Frappe serves www/mbc.html) — remove to avoid confusion.
try {
	fs.unlinkSync(path.join(appDir, "index.html"))
} catch {
	/* already gone */
}

console.log(`copy-html: www/mbc.html (${ENTRY_JS}, ${ENTRY_CSS}, ${PRELOADS.length} preloads), ${Object.keys(PORTALS).length} manifests, sw.js (build ${build})`)
