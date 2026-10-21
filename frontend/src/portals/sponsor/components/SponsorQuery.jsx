import { QueryState } from "@/shared/components/ui"
import { isNoProfile } from "../lib"
import { NoSponsorProfile } from "./NoSponsorProfile"

/** QueryState that turns "no sponsor profile" errors into the onboarding state instead of a retry box. */
export function SponsorQuery({ query, ...props }) {
	if (query.isError && isNoProfile(query.error)) return <NoSponsorProfile />
	return <QueryState query={query} {...props} />
}
