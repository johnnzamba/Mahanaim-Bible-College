import { useMemo } from "react"
import { useApi } from "@/shared/api/hooks"
import { ACAD, EXAMS, rowsOf, useAcross } from "../lib"

/** Offerings of a term (up to the 200 the API pages at once). */
export function useTermOfferings(term, extra = {}) {
	return useApi(`${ACAD}list_offerings`, { term, page_length: 200, ...extra }, { enabled: Boolean(term) })
}

/**
 * There is no cross-offering exam list, so read list_exams for each live offering of the term.
 * Rows carry their offering so the UI can show course and campus.
 */
export function useTermExams(term) {
	const offerings = useTermOfferings(term)
	const live = useMemo(() => rowsOf(offerings.data).filter((o) => o.status !== "Cancelled"), [offerings.data])
	const across = useAcross(`${EXAMS}list_exams`, live, (o) => ({ offering: o.name }), { enabled: Boolean(term) })
	const exams = useMemo(
		() =>
			(across.data || []).flatMap(({ item, data }) =>
				rowsOf(data).map((e) => ({ ...e, offering: item.name, course: item.course, campus: item.campus, course_title: e.course_title || item.course_title }))
			),
		[across.data]
	)
	const failed = (across.data || []).filter((r) => r.error).length
	return {
		exams,
		offerings: live,
		failed,
		truncated: (offerings.data?.total || 0) > rowsOf(offerings.data).length,
		isLoading: offerings.isLoading || (live.length > 0 && across.isLoading),
		isError: offerings.isError || across.isError,
		error: offerings.error || across.error,
		refetch: () => {
			offerings.refetch()
			across.refetch()
		},
	}
}
