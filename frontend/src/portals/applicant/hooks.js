import { useQueries } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { M } from "./lib"

export const useOptions = () => useApi(M.options, {}, { staleTime: 5 * 60_000 })
export const useMyApplications = () => useApi(M.list)
export const useApplication = (name, opts = {}) => useApi(M.get, { name }, { enabled: Boolean(name), ...opts })

/** Full detail for several applications at once (shares cache keys with useApplication). */
export function useApplicationDetails(names = []) {
	return useQueries({
		queries: names.map((name) => ({ queryKey: [M.get, { name }], queryFn: () => frappe.call(M.get, { name }) })),
	})
}

export function useFeeStatuses(names = []) {
	return useQueries({
		queries: names.map((application) => ({
			queryKey: [M.feeStatus, { application }],
			queryFn: () => frappe.call(M.feeStatus, { application }),
		})),
	})
}
