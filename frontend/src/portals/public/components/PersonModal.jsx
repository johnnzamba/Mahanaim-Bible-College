import { BadgeCheck } from "lucide-react"
import { Avatar, Html, Modal } from "@/shared/components/ui"
import { bareName, isHtml } from "../lib"

export function PersonModal({ person, onClose }) {
	const name = person?.full_name || person?.name
	return (
		<Modal open={Boolean(person)} onClose={onClose} title={name || ""} subtitle={[person?.designation, person?.department].filter(Boolean).join(" · ")} size="lg">
			{person ? (
				<div className="grid gap-6 sm:grid-cols-[140px_minmax(0,1fr)]">
					<Avatar name={bareName(name)} src={person.photo} size={140} className="mx-auto rounded-2xl" />
					<div className="min-w-0 space-y-4">
						{person.specialisation ? (
							<div>
								<div className="label">Specialisation</div>
								<p className="text-sm text-ink">{person.specialisation}</p>
							</div>
						) : null}
						{person.qualifications?.length ? (
							<div>
								<div className="label">Qualifications</div>
								<ul className="space-y-1 text-sm text-ink">
									{person.qualifications.map((q, i) => (
										<li key={i} className="flex gap-2">
											<BadgeCheck size={16} className="mt-0.5 shrink-0 text-gold-600" />
											{typeof q === "string" ? q : [q.qualification || q.title, q.institution, q.year].filter(Boolean).join(", ")}
										</li>
									))}
								</ul>
							</div>
						) : null}
						{person.bio ? (
							isHtml(person.bio) ? (
								<Html html={person.bio} />
							) : (
								<p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{person.bio}</p>
							)
						) : (
							<p className="text-sm text-ink-soft">A full profile will be published soon.</p>
						)}
					</div>
				</div>
			) : null}
		</Modal>
	)
}
