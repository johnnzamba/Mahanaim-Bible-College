import { createContext, useContext, useMemo } from "react"
import { Link, Navigate, useLocation } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldAlert } from "lucide-react"
import { frappe } from "./api/frappe"
import { PORTALS } from "./brand"
import { isSuper } from "./access"
import { Loading } from "./components/ui"

/**
 * Session = mahanaim.api.session.session_info. www/mbc.py embeds the same payload as
 * window.mahanaim_boot.session so the first paint needs no round-trip.
 */
const SessionCtx = createContext(null)
export const SESSION_KEY = ["mahanaim.api.session.session_info"]

export function SessionProvider({ children }) {
	const qc = useQueryClient()
	const boot = typeof window !== "undefined" ? window.mahanaim_boot?.session : null
	const q = useQuery({
		queryKey: SESSION_KEY,
		queryFn: () => frappe.get("mahanaim.api.session.session_info"),
		initialData: boot || undefined,
		staleTime: 60_000,
		refetchOnWindowFocus: true,
	})
	const value = useMemo(() => {
		const s = q.data || { user: "Guest", roles: [], portals: [] }
		const roles = s.roles || []
		return {
			...s,
			loading: q.isLoading,
			isGuest: !s.user || s.user === "Guest",
			roles,
			portals: s.portals || [],
			isSuper: isSuper(roles),
			hasRole: (...r) => isSuper(roles) || r.some((x) => roles.includes(x)),
			refresh: () => qc.invalidateQueries({ queryKey: SESSION_KEY }),
			reload: async () => {
				await qc.invalidateQueries({ queryKey: SESSION_KEY })
				return qc.fetchQuery({ queryKey: SESSION_KEY, queryFn: () => frappe.get("mahanaim.api.session.session_info") })
			},
		}
	}, [q.data, q.isLoading, qc])
	return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
	const v = useContext(SessionCtx)
	if (!v) throw new Error("useSession outside SessionProvider")
	return v
}

export function portalHome(session) {
	const home = session?.home
	if (home && home !== "signin" && PORTALS[home]) return PORTALS[home].path
	const first = session?.portals?.[0]
	return first ? PORTALS[first]?.path || "/" : "/"
}

/** Gate a portal: guests → /signin?next=…, signed-in users without the portal → explanation. */
export function RequirePortal({ portal, children }) {
	const session = useSession()
	const loc = useLocation()
	if (session.loading) return <Loading label="Opening your workspace…" className="min-h-screen" />
	if (session.isGuest) {
		const next = encodeURIComponent(loc.pathname + loc.search)
		return <Navigate to={`/signin?next=${next}`} replace />
	}
	if (!session.portals.includes(portal)) {
		return <NoAccess portal={portal} session={session} />
	}
	return children
}

function NoAccess({ portal, session }) {
	const label = PORTALS[portal]?.label || portal
	return (
		<div className="grid min-h-screen place-items-center bg-canvas px-4">
			<div className="card w-full max-w-md p-8 text-center">
				<span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gold-50 text-gold-700">
					<ShieldAlert size={26} />
				</span>
				<h1 className="font-serif text-xl">No access to the {label} portal</h1>
				<p className="mt-2 text-sm text-ink-muted">
					You are signed in as <span className="font-semibold text-ink">{session.full_name || session.user}</span>, which does not include this
					area.
				</p>
				<div className="mt-6 flex flex-wrap justify-center gap-2">
					{session.portals.map((p) => (
						<Link key={p} to={PORTALS[p].path} className="btn btn-primary btn-sm">
							Open {PORTALS[p].label}
						</Link>
					))}
					<Link to="/" className="btn btn-secondary btn-sm">
						Back to website
					</Link>
				</div>
			</div>
		</div>
	)
}
