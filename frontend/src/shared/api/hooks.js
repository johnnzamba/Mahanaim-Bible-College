import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { frappe } from "./frappe"
import { toast } from "../components/toast"

/**
 * useApi("mahanaim.api.student.my_dashboard", { term }) — a cached read.
 * Key = [method, args] so identical calls dedupe across screens.
 */
export function useApi(method, args = {}, options = {}) {
	const { enabled = true, guest = false, ...rest } = options
	return useQuery({
		queryKey: [method, args],
		queryFn: () => (guest ? frappe.get(method, args) : frappe.call(method, args)),
		enabled: Boolean(method) && enabled,
		...rest,
	})
}

/**
 * useAction("mahanaim.api.finance.record_payment", { invalidate: ["mahanaim.api.finance."], success: "Saved" })
 * `invalidate` entries are method-name prefixes; every cached query whose method starts with one
 * is refetched after success.
 */
export function useAction(method, { invalidate = [], success, error: showError = true, onSuccess, onError } = {}) {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (args) => frappe.call(method, args || {}),
		onSuccess: (data, vars, ctx) => {
			if (invalidate.length) {
				qc.invalidateQueries({
					predicate: (q) => typeof q.queryKey[0] === "string" && invalidate.some((p) => q.queryKey[0].startsWith(p)),
				})
			}
			if (success) toast.success(typeof success === "function" ? success(data, vars) : success)
			onSuccess?.(data, vars, ctx)
		},
		onError: (err, vars, ctx) => {
			if (showError) toast.error(err?.message || "Something went wrong")
			onError?.(err, vars, ctx)
		},
	})
}

export function useInvalidate() {
	const qc = useQueryClient()
	return (...prefixes) =>
		qc.invalidateQueries({
			predicate: (q) => typeof q.queryKey[0] === "string" && prefixes.some((p) => q.queryKey[0].startsWith(p)),
		})
}
