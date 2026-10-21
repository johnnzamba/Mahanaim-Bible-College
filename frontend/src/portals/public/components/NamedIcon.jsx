import {
	Award,
	BookOpen,
	CalendarDays,
	Church,
	Clock,
	Flame,
	Globe,
	GraduationCap,
	Hourglass,
	Laptop,
	School,
	ScrollText,
	Smartphone,
	Sparkles,
} from "lucide-react"

const ICONS = { Award, BookOpen, CalendarDays, Church, Clock, Flame, Globe, GraduationCap, Hourglass, Laptop, School, ScrollText, Smartphone }

/** Icon by name, for the static content tables in content.js. */
export function NamedIcon({ name, ...props }) {
	const Cmp = ICONS[name] || Sparkles
	return <Cmp {...props} />
}
