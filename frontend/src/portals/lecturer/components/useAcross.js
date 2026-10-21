import { useQuery } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useMyOfferings } from "./lib"

/**
 * Call a per-offering list endpoint for every offering I teach and merge the `data` rows.
 * The key starts with the method name so useAction/useInvalidate prefixes refresh it.
 * Returns { data: { data: rows, offerings, failed: [offering] } } like a single list call.
 */
export function useAcross(method, args = {}, { term = "", enabled = true, refetchInterval } = {}) {
	const offerings = useMyOfferings(term)
	const list = offerings.data?.data || []
	const names = list.map((o) => o.name)
	const q = useQuery({
		queryKey: [method, { across: names, ...args }],
		enabled: enabled && offerings.isSuccess,
		refetchInterval,
		queryFn: async () => {
			const res = await Promise.all(
				names.map((offering) =>
					frappe
						.call(method, { offering, ...args })
						.then((r) => ({ offering, r }))
						.catch((error) => ({ offering, error }))
				)
			)
			const rows = []
			const failed = []
			for (const x of res) {
				if (x.error) failed.push(x.offering)
				else for (const d of x.r?.data || []) rows.push({ ...d, course_offering: d.course_offering || x.offering })
			}
			if (failed.length && !rows.length && failed.length === names.length) throw res.find((x) => x.error).error
			return { data: rows, offerings: list, failed }
		},
	})
	return {
		...q,
		isLoading: offerings.isLoading || q.isLoading,
		isError: offerings.isError || q.isError,
		error: offerings.error || q.error,
		refetch: () => (offerings.isError ? offerings.refetch() : q.refetch()),
		offerings: list,
	}
}
