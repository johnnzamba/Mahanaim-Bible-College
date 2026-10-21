/**
 * Every capitalised identifier a .jsx file uses must be imported or defined in it.
 *
 * Vite does not check this. An icon named in a nav array but never imported
 * builds cleanly and then throws ReferenceError the moment the module is
 * imported, which blanks the whole portal rather than one screen. That is
 * how an icon named only in a module-level nav array blanks a portal: the
 * array throws before anything renders.
 *
 * Runs as part of `npm run build`, and on its own with `npm run check`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const files = []
;(function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) walk(full)
		else if (full.endsWith(".jsx")) files.push(full)
	}
})(new URL("../src", import.meta.url).pathname)

// Globals a browser module may legitimately reference without importing.
const GLOBAL = new Set([
	"Array", "Boolean", "Date", "Error", "Intl", "JSON", "Map", "Math", "Number",
	"Object", "Promise", "Set", "String", "RegExp", "Symbol", "URL", "URLSearchParams",
	"WeakMap", "WeakSet", "Infinity", "NaN", "Blob", "File", "FileReader", "FormData",
	"Image", "Notification", "Audio", "Worker", "AbortController", "Response", "Request",
	"Headers", "TextEncoder", "TextDecoder", "Intent", "React", "MutationObserver",
	"ResizeObserver", "IntersectionObserver", "CustomEvent", "Event", "DataTransfer",
	"BigInt", "Proxy", "Reflect", "Uint8Array", "ArrayBuffer", "Function",
])

let bad = 0
for (const file of files) {
	const src = readFileSync(file, "utf8")

	const declared = new Set()
	// import { A, B as C } from "x"  /  import D from "x"  /  import * as E from "x"
	// The binding list cannot contain a quote. Without that a side-effect
	// import like `import "./x.css"` is swallowed together with the line after
	// it, and whatever that line imported is reported as undefined.
	for (const m of src.matchAll(/import\s+([^;'"]+?)\s+from\s+["'][^"']+["']/g)) {
		for (const part of m[1].replace(/[{}]/g, ",").split(",")) {
			const name = part.trim().split(/\s+as\s+/).pop().trim().replace(/^\*\s*/, "")
			if (name) declared.add(name)
		}
	}
	for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:function|class)\s+([A-Z]\w*)/g))
		declared.add(m[1])
	for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Z]\w*)/g))
		declared.add(m[1])

	// Destructured props and bindings. `function X({ icon: Icon })` declares
	// Icon, and is written exactly like the `icon: Inbox` in a nav array that
	// this check exists to catch, so only these three positions are scanned
	// rather than every brace in the file.
	for (const re of [
		/function\s+\w*\s*\(([\s\S]*?)\)\s*\{/g,
		/\(([^()]*)\)\s*=>/g,
		/(?:const|let|var)\s*\{([\s\S]*?)\}\s*=/g,
		/(?:const|let|var)\s*\[([\s\S]*?)\]\s*=/g,
	]) {
		for (const m of src.matchAll(re)) {
			for (const n of m[1].matchAll(/(?::\s*|^|[,{[\s])([A-Z]\w*)/g)) declared.add(n[1])
		}
	}

	const used = new Map()
	// <Component ...>  and  icon: Component  and  Icon={Component}
	for (const re of [/<([A-Z]\w*)[\s/>]/g, /\bicon:\s*([A-Z]\w*)/g, /=\{([A-Z]\w*)\}/g]) {
		for (const m of src.matchAll(re)) {
			if (!used.has(m[1])) used.set(m[1], src.slice(0, m.index).split("\n").length)
		}
	}

	for (const [name, line] of used) {
		if (declared.has(name) || GLOBAL.has(name)) continue
		console.error(`${file}:${line}  ${name} is used but never imported or defined`)
		bad++
	}
}

if (bad) {
	console.error(`\n${bad} undefined reference${bad === 1 ? "" : "s"}. These build fine and throw at runtime.`)
	process.exit(1)
}
console.log(`checked ${files.length} files, no undefined references`)
