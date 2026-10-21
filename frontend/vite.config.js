import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

// The SPA is served by Frappe from /assets/mahanaim/app/ and booted by www/mbc.html for every
// public and portal route. Entry files keep fixed names (assets/index.js / index.css) so the
// HTML never tracks a hash; scripts/copy-html.mjs stamps ?v=<md5> for cache busting.
export default defineConfig({
	plugins: [react()],
	base: "/assets/mahanaim/app/",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	build: {
		outDir: path.resolve(__dirname, "../mahanaim/public/app"),
		emptyOutDir: true,
		chunkSizeWarningLimit: 900,
		cssCodeSplit: false,
		rollupOptions: {
			input: { index: path.resolve(__dirname, "index.html") },
			output: {
				// Hashed entry: lazy chunks import it by its bare URL, so it must never carry a ?v= query
				// (the browser would evaluate the entry twice and mount two React roots).
				entryFileNames: "assets/index-[hash].js",
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: (assetInfo) => {
					const name = assetInfo.name || ""
					if (name.endsWith(".css")) return "assets/index-[hash].css"
					return "assets/[name]-[hash][extname]"
				},
				manualChunks: {
					react: ["react", "react-dom", "react-router-dom"],
					query: ["@tanstack/react-query"],
					charts: ["recharts"],
				},
			},
		},
	},
	server: {
		port: 8080,
		proxy: {
			"^/(api|assets|files|private|desk|socket.io)": {
				target: "http://127.0.0.1:8010",
				changeOrigin: true,
				ws: true,
			},
		},
	},
})
