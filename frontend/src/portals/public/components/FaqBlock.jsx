import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { useApi } from "@/shared/api/hooks"
import { Html, Skeleton } from "@/shared/components/ui"
import { DEFAULT_FAQS } from "../content"
import { W, isHtml } from "../lib"
import { Accordion } from "./Blocks"

export function faqContent(answer) {
	return isHtml(answer) ? <Html html={answer} className="text-sm" /> : <p className="whitespace-pre-line">{answer}</p>
}

/** Accordion of FAQ rows; each row is deep-linkable through its `anchor` (#hash opens it). */
export function FaqBlockAccordion({ rows, openId, multiple, className }) {
	return (
		<Accordion
			className={className}
			defaultOpen={openId}
			multiple={multiple}
			items={rows.map((f, i) => ({
				id: f.anchor || f.name || `${f.category}-${i}`,
				anchor: f.anchor,
				title: f.question,
				content: faqContent(f.answer),
			}))}
		/>
	)
}

const STOP = new Set("a an and any are at be can do does for i if in is it me my of on or the there to what will with you your".split(" "))
const words = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w)))
const similar = (a, b) => {
	const inter = [...a].filter((w) => b.has(w)).length
	const contained = Math.min(a.size, b.size) >= 2 && inter === Math.min(a.size, b.size)
	return contained || inter / (a.size + b.size - inter || 1) >= 0.6
}

/** CMS FAQs first; while the CMS holds fewer than `min`, built-in answers fill the gap, skipping questions the CMS already covers. */
export function mergeFaqs(cms = [], defaults = [], min = 4) {
	if (cms.length >= min) return cms
	const asked = cms.map((f) => words(f.question))
	return [...cms, ...defaults.filter((f) => !asked.some((w) => similar(w, words(f.question))))]
}

/** FAQs for one category from the CMS, topped up with built-in answers while the CMS is sparse. */
export function FaqBlock({ category, limit = 8, className }) {
	const q = useApi(`${W}faqs`, category ? { category } : {}, { guest: true })
	if (q.isLoading)
		return (
			<div className={className}>
				<div className="space-y-2">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton key={i} className="h-14 rounded-xl" />
					))}
				</div>
			</div>
		)
	const rows = mergeFaqs(
		q.data?.data || [],
		DEFAULT_FAQS.filter((f) => !category || f.category === category)
	)
	return (
		<div className={className}>
			<Accordion
				items={rows.slice(0, limit).map((f, i) => ({
					id: f.name || `${f.category}-${i}`,
					title: f.question,
					content: faqContent(f.answer),
				}))}
			/>
			<Link to={category ? `/faq?category=${encodeURIComponent(category)}` : "/faq"} className="link mt-4 inline-flex items-center gap-1 text-sm">
				More questions and answers <ArrowRight size={14} />
			</Link>
		</div>
	)
}
