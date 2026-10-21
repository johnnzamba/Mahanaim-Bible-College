/* Mahanaim Digital Campus service worker — build 4046f010c6 */
const CACHE = "mbc-4046f010c6";
const SHELL = ["/assets/mahanaim/app/assets/index-BF5_Egdm.js", "/assets/mahanaim/app/assets/index-B-Ffp1ye.css", "/assets/mahanaim/images/logo.svg"];

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
	if (/^\/(api|desk|app|private|files|socket\.io|login|logout)/.test(url.pathname)) return;

	// Static build assets: cache-first (names are content-hashed).
	if (url.pathname.startsWith("/assets/mahanaim/app/assets/") || url.pathname.startsWith("/assets/mahanaim/images/")) {
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
