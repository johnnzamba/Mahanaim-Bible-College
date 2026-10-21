import { useQueries } from "@tanstack/react-query"
import { frappe } from "@/shared/api/frappe"
import { useApi } from "@/shared/api/hooks"
import { M } from "./lib"

const quiet = { retry: (n, err) => err?.exc_type !== "PermissionError" && n < 2 }

export const useProfile = () => useApi(M.profile, {}, quiet)
export const useStudents = () => useApi(M.students, {}, quiet)
export const useProgress = (student) => useApi(M.progress, { student }, { enabled: Boolean(student), ...quiet })
export const useContributions = () => useApi(M.contributions, {}, quiet)
export const useReport = () => useApi(M.report, {}, quiet)
// giving_options is GET-only on the server, so fetch it with guest:true (frappe.get).
export const useGivingOptions = () => useApi(M.givingOptions, {}, { guest: true, staleTime: 10 * 60_000 })

/** student_progress for several students (shares cache keys with useProgress). */
export function useProgresses(students = []) {
	return useQueries({
		queries: students.map((student) => ({
			queryKey: [M.progress, { student }],
			queryFn: () => frappe.call(M.progress, { student }),
			staleTime: 60_000,
			...quiet,
		})),
	})
}
