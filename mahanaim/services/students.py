"""Student lifecycle services (owned by backend domain B1).

CONTRACT (other domains import these; keep signatures):
	ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User") -> str (User.name)
	create_student_from_application(application) -> str (Student.name)
	sync_user_profile_link(doc, method=None)  # User.on_update hook
"""

import frappe


def ensure_user(email, first_name, last_name=None, phone=None, roles=(), user_type="Website User") -> str:
	raise NotImplementedError


def create_student_from_application(application) -> str:
	raise NotImplementedError


def sync_user_profile_link(doc, method=None):
	pass
