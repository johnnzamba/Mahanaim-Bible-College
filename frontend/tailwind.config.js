/** @type {import('tailwindcss').Config} */
// Colours are CSS variables (space-separated RGB channels) so themes (light / dark / high-contrast)
// re-skin the whole SPA without a rebuild while Tailwind keeps generating /opacity variants.
const scale = (name) =>
	Object.fromEntries(
		[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`])
	)

export default {
	content: ["./index.html", "./src/**/*.{js,jsx}"],
	darkMode: ["class", '[data-theme="dark"]'],
	theme: {
		extend: {
			colors: {
				brand: { DEFAULT: "rgb(var(--brand-700) / <alpha-value>)", ...scale("brand") },
				gold: { DEFAULT: "rgb(var(--gold-500) / <alpha-value>)", ...scale("gold") },
				canvas: "rgb(var(--canvas) / <alpha-value>)",
				surface: "rgb(var(--surface) / <alpha-value>)",
				cream: "rgb(var(--cream) / <alpha-value>)",
				line: "rgb(var(--line) / <alpha-value>)",
				ink: {
					DEFAULT: "rgb(var(--ink) / <alpha-value>)",
					muted: "rgb(var(--ink-muted) / <alpha-value>)",
					soft: "rgb(var(--ink-soft) / <alpha-value>)",
				},
			},
			fontFamily: {
				sans: ['"DM Sans"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
				serif: ['"Libre Baskerville"', "Georgia", "Cambria", "serif"],
				mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
			},
			boxShadow: {
				card: "0 1px 2px rgba(20,55,42,.05), 0 6px 18px -8px rgba(20,55,42,.16)",
				soft: "0 2px 4px rgba(20,55,42,.05), 0 14px 32px -14px rgba(20,55,42,.22)",
				lift: "0 2px 4px rgba(20,55,42,.04), 0 22px 48px -18px rgba(20,55,42,.30)",
			},
			borderRadius: {
				xl2: "1rem",
				"4xl": "2rem",
			},
			keyframes: {
				"fade-up": { "0%": { opacity: 0, transform: "translateY(8px)" }, "100%": { opacity: 1, transform: "none" } },
				shimmer: { "100%": { transform: "translateX(100%)" } },
			},
			animation: {
				"fade-up": "fade-up .35s ease-out both",
				shimmer: "shimmer 1.4s infinite",
			},
		},
	},
	plugins: [],
}
