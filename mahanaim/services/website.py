"""Public website / CMS services (owned by backend domain B4)."""

import frappe


def update_event_statuses():
	pass


def route_meta(path: str) -> dict:
	"""CONTRACT (B4): SEO/OpenGraph meta for a public SPA path, e.g. /programmes/DBS -> programme title."""
	return {}
