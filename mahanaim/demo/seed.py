"""Demo dataset for the Mahanaim Digital Campus.

Never runs automatically. Invoke it manually on a development or demo site:

	bench --site <site> execute mahanaim.demo.seed.run

The seed is idempotent: every record is get-or-create by a natural key (email, title, code, reference...),
so a second run only fills gaps. Each section runs in its own savepoint and each record in a nested one; a
failure is printed, written to the Error Log ("Mahanaim demo seed: ...") and the seed carries on. Dates are
computed from today, so the "current term" always contains (or follows) the day the seed runs."""

import calendar
import hashlib
import html
import traceback
from datetime import date, datetime, time, timedelta

import frappe
from frappe.utils import add_months, cint, flt, getdate, now_datetime, strip_html_tags, today

from mahanaim.demo import data as D

CAMPUS = {c["code"]: c["campus_name"] for c in D.CAMPUSES}
COUNTY = {c["code"]: c["county"] for c in D.CAMPUSES}
PROGRAMMES = {p["code"]: p for p in D.PROGRAMMES}
STAFF = {s["key"]: s for s in D.STAFF}
STUDENTS = {row[0]: row for row in D.STUDENTS}
FAILED = object()
CREDENTIAL_ROWS = [
	("College Administrator", "admin"),
	("Principal (College Administrator)", "principal"),
	("Registrar", "registrar"),
	("Finance Officer", "finance"),
	("Admissions Officer", "admissions"),
	("Academic Dean + Lecturer", "dean"),
	("Lecturer", "lecturer"),
	("Library Officer", "library"),
	("Communications Officer", "comms"),
	("Chaplain", "chaplain"),
	("Student (Grace Wanjiku)", "student"),
	("Applicant (draft application)", "applicant"),
	("Sponsor portal", "sponsor"),
	("Alumni (John Maina)", "alumni"),
]
OTHER_CHURCHES = [
	"Deliverance Church Umoja",
	"PCEA Kahawa West",
	"AIC Milimani Nakuru",
	"Redeemed Gospel Church Kayole",
	"Kenya Assemblies of God Ngong",
	"Full Gospel Churches of Kenya Eldoret",
]
MINISTRY_ROLES = [
	"Youth leader",
	"Sunday school teacher",
	"Worship leader",
	"Church elder",
	"Evangelism team",
	"Usher",
	"Women's fellowship leader",
	"Men's fellowship secretary",
]
NOK_FIRST = ["Jane", "Peter", "Mary", "James", "Lucy", "John", "Agnes", "Samuel", "Rose", "Francis"]
TOPICS = [
	"Introduction and course overview",
	"Key themes and texts",
	"Group discussion and case study",
	"Review and application",
	"Guest lecture",
]
SESSION_BLOCKS = [
	("08:00:00", "10:00:00"),
	("10:30:00", "12:30:00"),
	("14:00:00", "16:00:00"),
	("16:30:00", "18:30:00"),
]


def run():
	"""Entry point: `bench --site <site> execute mahanaim.demo.seed.run`."""
	DemoSeeder().run()


def email_for(local: str) -> str:
	return f"{local}@{D.DEMO_DOMAIN}"


def student_email(row) -> str:
	first, last, *_rest, tag = row
	return email_for(tag) if tag else f"{first}.{last}@students.{D.DEMO_DOMAIN}".lower()


class DemoSeeder:
	def __init__(self):
		self.today = getdate(today())
		self.now = now_datetime().replace(microsecond=0)
		self.stats: dict[str, dict] = {}
		self.section = "Setup"
		self.campus = dict(CAMPUS)
		self.build_calendar()

	# ------------------------------------------------------------------ framework
	def run(self):
		previous = (frappe.flags.in_demo_seed, frappe.flags.mute_emails, frappe.session.user)
		frappe.flags.in_demo_seed = True
		frappe.flags.mute_emails = True
		frappe.set_user("Administrator")
		self.resolve_campuses()
		print(
			f"Mahanaim demo seed: today {self.today}, current term {self.cur.name}, previous {self.prev.name}"
		)
		try:
			for title, fn in (
				("Calendar, campuses & settings", self.seed_foundation),
				("Courses & programmes", self.seed_academics),
				("Staff & user accounts", self.seed_staff),
				("Partner churches", self.seed_churches),
				("Course offerings", self.seed_offerings),
				("Students & alumni", self.seed_students),
				("Course enrolments", self.seed_enrolments),
				("Published results", self.seed_results),
				("Sponsors & sponsorships", self.seed_sponsors),
				("Fees, invoices & payments", self.seed_finance),
				("Semester registrations", self.seed_registrations),
				("Assignments & exams", self.seed_assessments),
				("Class sessions & attendance", self.seed_attendance),
				("Website content", self.seed_website),
				("Chapel, giving & ministries", self.seed_church_life),
				("Library", self.seed_library),
				("Announcements & notifications", self.seed_communication),
				("Programme applications", self.seed_applications),
			):
				self.run_section(title, fn)
		finally:
			frappe.flags.in_demo_seed, frappe.flags.mute_emails = previous[0], previous[1]
			frappe.set_user(previous[2] or "Administrator")
		self.print_summary()

	def run_section(self, title, fn):
		self.section = title
		self.stats[title] = {"created": 0, "existing": 0, "errors": []}
		print(f"- {title}")
		sp = self.savepoint()
		try:
			fn()
		except Exception as exc:
			self.rollback(sp)
			self.fail(title, exc)
		self.commit()

	def commit(self):
		if not frappe.flags.in_test:
			frappe.db.commit()

	def savepoint(self) -> str:
		sp = f"mbc_demo_{frappe.generate_hash(length=10)}"
		frappe.db.savepoint(sp)
		return sp

	def rollback(self, sp: str):
		try:
			frappe.db.rollback(save_point=sp)
		except Exception:
			# an inner commit released the savepoint; fall back to the last commit
			frappe.db.rollback()
		frappe.local.message_log = []

	def tick(self, key: str, n: int = 1):
		self.stats[self.section][key] += n

	def fail(self, label: str, exc: Exception):
		text = strip_html_tags(str(exc)).strip() or exc.__class__.__name__
		msg = f"{label}: {text}"[:300]
		self.stats[self.section]["errors"].append(msg)
		print(f"    ! {msg}")
		try:
			frappe.log_error(title=f"Mahanaim demo seed: {label}"[:140], message=traceback.format_exc())
		except Exception:
			pass

	def attempt(self, label: str, fn, *args, **kwargs):
		"""Run fn in a savepoint; on error roll it back, record the failure and return FAILED."""
		sp = self.savepoint()
		try:
			return fn(*args, **kwargs)
		except Exception as exc:
			self.rollback(sp)
			self.fail(label, exc)
			return FAILED

	def find(self, doctype: str, key) -> str | None:
		if isinstance(key, str):
			return key if frappe.db.exists(doctype, key) else None
		return frappe.db.get_value(doctype, key, "name")

	def ensure(self, doctype: str, key, values: dict, flags: dict | None = None, submit: bool = False):
		"""Get-or-create: returns the existing/new document name, or None when the insert failed."""
		name = self.find(doctype, key)
		if name:
			self.tick("existing")
			return name

		def insert():
			doc = frappe.get_doc({"doctype": doctype, **values})
			doc.flags.ignore_permissions = True
			for flag, value in (flags or {}).items():
				doc.flags[flag] = value
			doc.insert(ignore_permissions=True)
			if submit:
				doc.submit()
			return doc.name

		label = (
			key
			if isinstance(key, str)
			else ", ".join(f"{v}" for v in key.values() if not isinstance(v, list))
		)
		result = self.attempt(f"{doctype} {label}", insert)
		if result is FAILED:
			return None
		self.tick("created")
		return result

	def top_up_attendance(self, doctype: str, name: str | None, rows: list[dict]):
		"""Append attendance rows missing from an existing record (e.g. students created after it was seeded)."""
		if not (name and rows):
			return
		if frappe.db.count(
			f"{'Class' if doctype == 'Class Session' else 'Chapel'} Attendance",
			{"parent": name, "parenttype": doctype},
		) >= len(rows):
			return

		def save():
			doc = frappe.get_doc(doctype, name)
			have = {r.student for r in doc.attendance}
			for row in rows:
				if row["student"] not in have:
					doc.append("attendance", row)
			doc.save(ignore_permissions=True)

		if self.attempt(f"{doctype} {name} attendance", save) is not FAILED:
			self.tick("created")

	# ------------------------------------------------------------------ deterministic helpers
	@staticmethod
	def h(*parts) -> int:
		return int(hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()[:12], 16)

	def phone(self, *seed) -> str:
		return f"07{10000000 + self.h('phone', *seed) % 89999999}"

	def ref(self, prefix: str, *seed, length: int = 8) -> str:
		return f"{prefix}{hashlib.md5('|'.join(map(str, seed)).encode()).hexdigest()[:length].upper()}"

	def mpesa_ref(self, *seed) -> str:
		digest = hashlib.md5("|".join(map(str, seed)).encode()).hexdigest().upper()
		return "S" + "".join(ch if ch.isalpha() else "KLMNPQRTVWXYZ"[int(ch, 16) % 13] for ch in digest[:9])

	def past(self, d) -> date:
		return min(getdate(d), self.today)

	# ------------------------------------------------------------------ lookups (DB-backed, so sections can fail independently)
	def staff_member(self, key: str) -> str | None:
		spec = STAFF.get(key)
		return (
			frappe.db.get_value("Staff Member", {"email": email_for(spec["email"])}, "name") if spec else None
		)

	def student(self, first: str) -> str | None:
		row = STUDENTS.get(first)
		return frappe.db.get_value("Student", {"email": student_email(row)}, "name") if row else None

	def sponsor(self, key: str) -> str | None:
		spec = next((s for s in D.SPONSORS if s["key"] == key), None)
		return (
			frappe.db.get_value("Sponsor", {"sponsor_name": spec["sponsor_name"]}, "name") if spec else None
		)

	def offerings(self, term) -> dict:
		return {
			(r.campus, r.course): r.name
			for r in frappe.get_all(
				"Course Offering",
				filters={"academic_term": term.name, "section": "A"},
				fields=["name", "campus", "course"],
			)
		}

	def enrolled(self, offering: str, statuses=("Enrolled", "Completed", "Failed")) -> list[str]:
		return frappe.get_all(
			"Course Enrolment",
			filters={"course_offering": offering, "status": ["in", list(statuses)]},
			pluck="student",
			order_by="student_name asc",
		)

	def resolve_campuses(self):
		"""Campus codes are unique, so reuse a campus that already carries a demo code under another name."""
		for code in CAMPUS:
			existing = frappe.db.get_value("Campus", {"code": code}, "name")
			if existing:
				self.campus[code] = existing

	def join_term(self, group: str):
		return {"A": self.prev, "B": self.cur, "C": self.terms[self.cur_idx - 3]}[group]

	def intake_name(self, term) -> str:
		return f"{calendar.month_name[term.start.month]} {term.start.year}"

	# ------------------------------------------------------------------ calendar
	def build_calendar(self):
		t = self.today
		y0 = t.year if t.month >= 9 else t.year - 1
		self.years, self.terms = [], []
		for a in (y0 - 1, y0):
			b = a + 1
			name = f"{a}-{b}"
			self.years.append(frappe._dict(name=name, start=date(a, 9, 1), end=date(b, 8, 31)))
			spans = (
				(date(a, 9, 1), date(a, 12, 11)),
				(date(b, 1, 5), date(b, 4, 16)),
				(date(b, 5, 4), date(b, 8, 14)),
			)
			for n, (start, end) in enumerate(spans, 1):
				self.terms.append(
					frappe._dict(
						year=name,
						term_name=f"Term {n}",
						number=n,
						name=f"{name} Term {n}",
						start=start,
						end=end,
						exam_start=end - timedelta(days=11),
						exam_end=end,
					)
				)
		idx = next((i for i, x in enumerate(self.terms) if x.start <= t <= x.end), None)
		if idx is None:
			idx = next((i for i, x in enumerate(self.terms) if x.start > t), len(self.terms) - 1)
		self.cur_idx = idx
		self.cur = self.terms[idx]
		self.prev = self.terms[idx - 1]

	# ------------------------------------------------------------------ 1. foundation
	def seed_foundation(self):
		for c in D.CAMPUSES:
			self.ensure("Campus", {"code": c["code"]}, dict(c, is_active=1))
		self.resolve_campuses()
		for name, code, description in D.DEPARTMENTS:
			self.ensure(
				"Department",
				name,
				{"department_name": name, "code": code, "description": description, "is_active": 1},
			)
		for y in self.years:
			self.ensure(
				"Academic Year", y.name, {"year_name": y.name, "start_date": y.start, "end_date": y.end}
			)
		for i, term in enumerate(self.terms):
			if i == self.cur_idx:
				continue
			values = self.term_values(term, "Closed" if i < self.cur_idx else "Planned")
			if i < self.cur_idx:
				values["results_release_date"] = term.end + timedelta(days=14)
			self.ensure("Academic Term", term.name, values)
		cur = self.ensure(
			"Academic Term",
			self.cur.name,
			dict(self.term_values(self.cur, "Registration Open"), is_current=1),
		)
		if cur and not cint(frappe.db.get_value("Academic Term", cur, "is_current")):
			self.attempt("make current term", self.make_current, cur)
		for term in self.terms:
			start = term.start
			self.ensure(
				"Intake",
				self.intake_name(term),
				{
					"intake_name": self.intake_name(term),
					"academic_year": term.year,
					"start_date": start,
					"applications_open": 1 if start > self.today else 0,
					"application_open_date": min(start - timedelta(days=150), self.today),
					"application_close_date": start - timedelta(days=7),
					"capacity": 150,
				},
			)
		self.attempt("settings", self.fill_settings)

	def term_values(self, term, status: str) -> dict:
		values = {
			"academic_year": term.year,
			"term_name": term.term_name,
			"term_number": term.number,
			"status": status,
			"start_date": term.start,
			"end_date": term.end,
			"exam_start": term.exam_start,
			"exam_end": term.exam_end,
			"registration_start": term.start - timedelta(days=14),
			"registration_end": term.start + timedelta(days=14),
		}
		if status == "Registration Open":
			values["registration_end"] = min(
				term.end - timedelta(days=7),
				max(term.start + timedelta(days=21), self.today + timedelta(days=14)),
			)
		return values

	def make_current(self, name):
		doc = frappe.get_doc("Academic Term", name)
		doc.is_current = 1
		doc.status = "Registration Open"
		doc.registration_end = self.term_values(self.cur, "Registration Open")["registration_end"]
		doc.save(ignore_permissions=True)

	def fill_settings(self):
		values = {
			"email": "info@mahanaim.ac.ke",
			"phone": "0722 410 300",
			"website": "https://mahanaim.ac.ke",
			"address": D.CAMPUSES[0]["address"],
			"principal_name": "Rt. Rev. Dr. Stephen Mutua",
			"registrar_name": "Ms. Esther Achieng",
		}
		for field, value in values.items():
			if not frappe.db.get_single_value("Mahanaim Settings", field):
				frappe.db.set_single_value("Mahanaim Settings", field, value)

	# ------------------------------------------------------------------ 2. academics
	def seed_academics(self):
		for code, title, credits, dept, description in D.COURSES:
			self.ensure(
				"Course",
				code,
				{
					"course_code": code,
					"course_title": title,
					"credits": credits,
					"department": dept,
					"pass_mark": 40,
					"contact_hours": int(credits * 14),
					"is_active": 1,
					"description": f"<p>{description}</p>",
				},
			)
		for p in D.PROGRAMMES:
			self.ensure(
				"Programme",
				p["code"],
				{
					"programme_name": p["programme_name"],
					"code": p["code"],
					"level": p["level"],
					"department": p["department"],
					"status": "Active",
					"is_published": 1,
					"award_title": p["award_title"],
					"duration_years": p["duration_years"],
					"terms_per_year": 3,
					"min_cgpa_to_graduate": 2.0,
					"campuses": [{"campus": self.campus[c]} for c in p["campuses"]],
					"study_modes": [{"study_mode": m} for m in p["modes"]],
					"application_fee": 1000,
					"indicative_fee_per_term": p["fee"],
					"minimum_entry": p["minimum_entry"],
					"curriculum": [
						{"course": c, "year_of_study": y, "term_number": t, "course_type": kind}
						for y, t, c, kind in p["curriculum"]
					],
					"overview": p["overview"],
					"description": p["description"],
					"entry_requirements": p["entry_requirements"],
					"career_paths": p["career_paths"],
				},
			)

	# ------------------------------------------------------------------ 3. staff
	def make_user(
		self,
		email: str,
		first: str,
		last: str | None,
		roles,
		user_type: str = "Website User",
		password: bool = True,
	) -> str:
		roles = tuple(r for r in roles if r)
		try:
			from mahanaim.services.students import ensure_user

			name = ensure_user(email, first, last, None, roles=roles, user_type=user_type)
		except ImportError:
			name = frappe.db.get_value("User", email)
			if not name:
				user = frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": first,
						"last_name": last,
						"user_type": user_type,
						"send_welcome_email": 0,
						"enabled": 1,
					}
				)
				user.append_roles(*roles)
				user.flags.no_welcome_mail = True
				user.insert(ignore_permissions=True)
				name = user.name
			elif roles:
				frappe.get_doc("User", name).add_roles(*roles)
		if user_type == "System User" and frappe.db.get_value("User", name, "user_type") != "System User":
			frappe.db.set_value("User", name, "user_type", "System User")
		if password:
			from frappe.utils.password import update_password

			update_password(name, D.DEMO_PASSWORD)
		return name

	def seed_staff(self):
		central = {"njoroge", "ochieng", "registrar", "finance", "admissions", "library", "comms", "chaplain"}
		for s in D.STAFF:
			email = email_for(s["email"])
			roles = [*s.get("roles", []), "Lecturer" if s.get("is_lecturer") else None]
			self.attempt(
				f"user {email}", self.make_user, email, s["first_name"], s["last_name"], roles, "System User"
			)
			other = "NKR" if s["campus"] == "MNC" else "MNC"
			self.ensure(
				"Staff Member",
				{"email": email},
				{
					"salutation": s["salutation"],
					"first_name": s["first_name"],
					"last_name": s["last_name"],
					"email": email,
					"phone": self.phone("staff", email),
					"status": "Active",
					"date_joined": date(2008 + self.h(email) % 15, 1 + self.h(email, "m") % 12, 1),
					"staff_type": s.get("staff_type", "Academic"),
					"designation": s.get("designation"),
					"is_lecturer": cint(s.get("is_lecturer")),
					"department": s.get("department"),
					"campus": self.campus[s["campus"]],
					"additional_campuses": [{"campus": self.campus[other]}] if s["key"] in central else [],
					"show_on_website": 1 if s.get("seq") else 0,
					"website_sequence": s.get("seq"),
					"specialisation": s.get("specialisation"),
					"qualifications": s.get("qualifications"),
					"bio": f"<p>{s['bio']}</p>" if s.get("bio") else None,
				},
			)
		heads = {
			"Biblical Studies": "kimani",
			"Theology": "njoroge",
			"Pastoral Ministry": "mwangi",
			"Leadership": "ochieng",
		}
		for dept, key in heads.items():
			staff = self.staff_member(key)
			if staff and not frappe.db.get_value("Department", dept, "head_of_department"):
				frappe.db.set_value("Department", dept, "head_of_department", staff)
		for code, key in (("MNC", "principal"), ("NKR", "ochieng")):
			staff = self.staff_member(key)
			if staff and not frappe.db.get_value("Campus", self.campus[code], "head_of_campus"):
				frappe.db.set_value("Campus", self.campus[code], "head_of_campus", staff)

	# ------------------------------------------------------------------ 4. churches
	def seed_churches(self):
		for key, c in D.CHURCHES.items():
			values = {k: v for k, v in c.items() if k != "parent"}
			if c.get("parent"):
				values["parent_partner_church"] = D.CHURCHES[c["parent"]]["church_name"]
			values.setdefault("church_type", "Local Church")
			values.update(
				partnership_status="Active",
				partnership_since=date(2005 + self.h(key) % 15, 1 + self.h(key, "m") % 12, 1),
			)
			self.ensure("Partner Church", c["church_name"], values)

	# ------------------------------------------------------------------ 5. offerings
	def seed_offerings(self):
		for term, table, status in (
			(self.prev, D.PREVIOUS_OFFERINGS, "Completed"),
			(self.cur, D.CURRENT_OFFERINGS, "In Progress"),
		):
			for code, rows in table.items():
				campus = self.campus[code]
				for course, lecturer in rows:
					staff = self.staff_member(lecturer)
					self.ensure(
						"Course Offering",
						{"course": course, "academic_term": term.name, "campus": campus, "section": "A"},
						{
							"course": course,
							"academic_term": term.name,
							"campus": campus,
							"section": "A",
							"status": status,
							"capacity": 40,
							"start_date": term.start,
							"end_date": term.end,
							"lecturers": [{"staff_member": staff, "role": "Lead"}] if staff else [],
						},
					)

	# ------------------------------------------------------------------ 6. students
	def student_values(self, row, email: str) -> dict:
		first, last, gender, prog, campus_code, mode, group, church_key, _tag = row
		term = self.join_term(group)
		h = self.h(email)
		church = D.CHURCHES.get(church_key) if church_key else None
		age = 21 + h % 24
		return {
			"first_name": first,
			"last_name": last,
			"gender": "Female" if gender == "F" else "Male",
			"email": email,
			"phone": self.phone("student", email),
			"date_of_birth": date(self.today.year - age, 1 + h % 12, 1 + h % 28),
			"national_id": str(20000000 + h % 19999999),
			"nationality": "Kenyan",
			"county": church.get("county") if church else COUNTY[campus_code],
			"programme": prog,
			"campus": self.campus[campus_code],
			"study_mode": mode,
			"intake": self.intake_name(term),
			"admission_year": term.year,
			"year_of_study": 2 if group == "C" else 1,
			"current_term": self.cur.name,
			"enrollment_date": term.start,
			"expected_completion": add_months(term.start, int(PROGRAMMES[prog]["duration_years"] * 12)),
			"status": "Active",
			"fee_category": "Standard",
			"home_church": church["church_name"] if church else OTHER_CHURCHES[h % len(OTHER_CHURCHES)],
			"partner_church": church["church_name"] if church else None,
			"denomination": church.get("denomination") if church else "Pentecostal",
			"pastor_name": church.get("senior_pastor") if church else "Rev. Daniel Mwende",
			"pastor_phone": self.phone("pastor", church_key or h % 7),
			"ministry_role": MINISTRY_ROLES[h % len(MINISTRY_ROLES)],
			"nok_name": f"{NOK_FIRST[h % len(NOK_FIRST)]} {last}",
			"nok_relationship": "Spouse" if age > 30 else "Parent",
			"nok_phone": self.phone("nok", email),
		}

	def seed_students(self):
		for row in D.STUDENTS:
			email = student_email(row)
			name = self.ensure("Student", {"email": email}, self.student_values(row, email))
			if name and row[-1] == "student":
				self.attempt("student password", self.set_password, name)
		for i, (first, last, gender, prog, campus_code, grad_year, ministry, position) in enumerate(D.ALUMNI):
			email = email_for("alumni") if i == 0 else f"{first}.{last}@alumni.{D.DEMO_DOMAIN}".lower()
			duration = int(PROGRAMMES[prog]["duration_years"])
			start = date(grad_year - duration, 9, 1)
			name = self.ensure(
				"Student",
				{"email": email},
				{
					"first_name": first,
					"last_name": last,
					"gender": "Female" if gender == "F" else "Male",
					"email": email,
					"phone": self.phone("alumni", email),
					"nationality": "Kenyan",
					"programme": prog,
					"campus": self.campus[campus_code],
					"study_mode": "Full Time",
					"year_of_study": duration,
					"enrollment_date": start,
					"expected_completion": date(grad_year, 8, 14),
					"completion_date": date(grad_year, 8, 14),
					"graduation_date": date(grad_year, 11, 28),
					"status": "Alumni",
					"current_ministry": ministry,
					"current_position": position,
					"alumni_consent": 1,
					"home_church": ministry.split(", ")[-1],
				},
				flags={"force_status": True},
			)
			if name and i == 0:
				self.attempt("alumni password", self.set_password, name)

	def set_password(self, student: str):
		from frappe.utils.password import update_password

		user = frappe.db.get_value("Student", student, "user")
		if user:
			update_password(user, D.DEMO_PASSWORD)

	# ------------------------------------------------------------------ 7. enrolments
	def seed_enrolments(self):
		prev_offs, cur_offs = self.offerings(self.prev), self.offerings(self.cur)
		flags = {"skip_lms": True, "ignore_capacity": True}
		for row in D.STUDENTS:
			first, _last, _g, prog, campus_code, _mode, group, *_ = row
			student = self.student(first)
			if not student:
				continue
			campus = self.campus[campus_code]
			curriculum = PROGRAMMES[prog]["curriculum"]
			taken = set()
			if group in ("A", "C"):
				for _y, _t, course, _k in curriculum:
					off = prev_offs.get((campus, course))
					if off:
						self.ensure(
							"Course Enrolment",
							{"student": student, "course_offering": off},
							{
								"student": student,
								"course_offering": off,
								"status": "Enrolled",
								"enrolled_on": self.prev.start,
							},
							flags,
						)
						taken.add(course)
			order = sorted(curriculum, key=lambda r: ((r[0] != 2) if group == "C" else False, r[0], r[1]))
			picks = [c for _y, _t, c, _k in order if c not in taken and (campus, c) in cur_offs][:4]
			for course in picks:
				off = cur_offs[(campus, course)]
				self.ensure(
					"Course Enrolment",
					{"student": student, "course_offering": off},
					{
						"student": student,
						"course_offering": off,
						"status": "Enrolled",
						"enrolled_on": self.cur.start,
					},
					flags,
				)

	# ------------------------------------------------------------------ 8. results
	def score(self, student: str, course: str) -> float:
		grace = {"BIB101": 80, "BIB102": 81, "MIN105": 87, "GEN101": 75}
		if student == self.student("Grace") and course in grace:
			return grace[course]
		if student == self.student("Timothy") and course == "GEN101":
			return 34
		return 52 + self.h(student, course) % 37

	def seed_results(self):
		for off in frappe.get_all(
			"Course Offering", filters={"academic_term": self.prev.name}, fields=["name", "course", "campus"]
		):
			if not self.enrolled(off.name):
				continue
			label = f"{off.course} {off.campus}"
			if frappe.db.get_value("Mark Sheet", {"course_offering": off.name}, "status") == "Published":
				self.tick("existing")
			elif self.attempt(f"mark sheet {label}", self.publish_sheet, off) is FAILED:
				self.attempt(f"direct results {label}", self.direct_results, off)
				continue
			# students enrolled after the sheet was published (e.g. a partial earlier run) get direct results
			if self.enrolled(off.name, ("Enrolled",)):
				self.attempt(f"top-up results {label}", self.direct_results, off)
		frappe.db.set_value(
			"Course Offering",
			{"academic_term": self.prev.name, "status": ["!=", "Completed"]},
			"status",
			"Completed",
			update_modified=False,
		)

	def publish_sheet(self, off):
		from mahanaim.services import results as rs

		sheet = rs.get_or_create_mark_sheet(off.name)
		if sheet.status in ("Draft", "Returned"):
			weights = {c: flt(sheet.get(f"{c}_weight")) for c in ("cat", "assignment", "exam", "other")}
			rows = []
			for e in sheet.entries:
				pct = self.score(e.student, off.course)
				rows.append(
					{
						"student": e.student,
						**{f"{c}_score": round(pct * w / 100.0, 2) for c, w in weights.items() if w > 0},
					}
				)
			sheet = rs.apply_entry_overrides(sheet, rows)
			sheet = rs.transition(sheet, "Submitted")
		if sheet.status == "Submitted":
			sheet = rs.transition(sheet, "Approved")
		if sheet.status == "Approved":
			rs.transition(sheet, "Published")
		self.tick("created")

	def direct_results(self, off):
		from mahanaim.services.grading import grade_for

		sheet = frappe.db.get_value("Mark Sheet", {"course_offering": off.name}, "name")
		for enrolment in frappe.get_all(
			"Course Enrolment",
			filters={"course_offering": off.name, "status": "Enrolled"},
			fields=["name", "student"],
		):
			pct = self.score(enrolment.student, off.course)
			g = grade_for(pct)
			passed = pct >= 40
			self.ensure(
				"Course Result",
				{"student": enrolment.student, "course_offering": off.name},
				{
					"student": enrolment.student,
					"course_offering": off.name,
					"attempt": "First",
					"total_score": pct,
					"grade": g.get("grade"),
					"grade_points": g.get("grade_points"),
					"result_status": "Pass" if passed else "Fail",
					"is_published": 1,
					"mark_sheet": sheet,
				},
			)
			frappe.db.set_value(
				"Course Enrolment",
				enrolment.name,
				{
					"status": "Completed" if passed else "Failed",
					"final_score": pct,
					"final_grade": g.get("grade"),
					"grade_points": g.get("grade_points"),
				},
				update_modified=False,
			)

	# ------------------------------------------------------------------ 9. sponsors
	def seed_sponsors(self):
		for s in D.SPONSORS:
			portal = bool(s.get("portal"))
			email = email_for(s["email"]) if portal else s["email"]
			if portal:
				first, _, last = s["sponsor_name"].partition(" ")
				self.attempt(
					"sponsor user", self.make_user, email, first, last or None, ["Sponsor"], "Website User"
				)
			church = D.CHURCHES.get(s.get("church"), {}).get("church_name")
			name = self.ensure(
				"Sponsor",
				{"sponsor_name": s["sponsor_name"]},
				{
					"sponsor_name": s["sponsor_name"],
					"sponsor_type": s["sponsor_type"],
					"partner_church": church,
					"status": "Active",
					"email": email,
					"phone": s.get("phone"),
					"preferred_communication": s.get("preferred_communication", "Email"),
					"contact_person": s.get("contact_person"),
					"country": s.get("country", "Kenya"),
				},
				flags={} if portal else {"create_user": False},
			)
			if (
				name
				and portal
				and not frappe.db.get_value("Sponsor", name, "user")
				and frappe.db.exists("User", email)
			):
				frappe.db.set_value("Sponsor", name, "user", email)
			if name and church and not frappe.db.get_value("Partner Church", church, "sponsor"):
				frappe.db.set_value("Partner Church", church, "sponsor", name, update_modified=False)
		for key, first, coverage, amount, pct, status in D.SPONSORSHIPS:
			sponsor, student = self.sponsor(key), self.student(first)
			if not (sponsor and student):
				continue
			group = STUDENTS[first][6]
			self.ensure(
				"Sponsorship",
				{"sponsor": sponsor, "student": student, "status": ["!=", "Cancelled"]},
				{
					"sponsor": sponsor,
					"student": student,
					"status": status,
					"coverage": coverage,
					"amount": amount or None,
					"percentage": pct or None,
					"start_term": self.join_term(group).name,
					"reporting_frequency": "Termly",
					"notes": "Pending board approval for next term." if status == "Proposed" else None,
				},
			)

	# ------------------------------------------------------------------ 10. finance
	def fee_component(self, name: str, component_type: str) -> str:
		existing = frappe.db.get_value("Fee Component", name) or frappe.db.get_value(
			"Fee Component", {"component_type": component_type}, "name"
		)
		if existing:
			return existing
		return self.ensure(
			"Fee Component", name, {"component_name": name, "component_type": component_type, "is_active": 1}
		)

	def seed_finance(self):
		types = {
			"Registration": "Registration",
			"Library": "Library",
			"ICT": "ICT",
			"Examination": "Examination",
			"Student Welfare": "Welfare",
		}
		tuition = self.fee_component("Tuition", "Tuition")
		structures = {}
		for p in D.PROGRAMMES:
			items = [{"fee_component": tuition, "amount": p["fee"], "description": "Tuition"}]
			items += [
				{"fee_component": self.fee_component(n, types[n]), "amount": amt} for n, amt in D.FEE_ITEMS
			]
			structures[p["code"]] = self.ensure(
				"Fee Structure",
				{"structure_name": f"{p['code']} Standard Fees"},
				{
					"structure_name": f"{p['code']} Standard Fees",
					"programme": p["code"],
					"fee_category": "Standard",
					"is_active": 1,
					"items": items,
				},
			)
		for row in D.STUDENTS:
			first, prog, group = row[0], row[3], row[6]
			student = self.student(first)
			if not (student and structures.get(prog)):
				continue
			sponsorship = frappe.db.get_value(
				"Sponsorship",
				{"student": student, "status": "Active"},
				["sponsor", "coverage", "amount", "percentage"],
				as_dict=True,
			)
			start = self.terms.index(self.join_term(group))
			for term in self.terms[start : self.cur_idx + 1]:
				self.invoice_and_pay(student, first, structures[prog], term, sponsorship)
		from mahanaim.services import fees

		self.attempt("mark overdue invoices", fees.mark_overdue_invoices)
		try:
			from mahanaim.services.church import refresh_sponsor_totals
		except ImportError:
			refresh_sponsor_totals = None
		if refresh_sponsor_totals:
			for name in frappe.get_all("Sponsor", pluck="name"):
				self.attempt(f"sponsor totals {name}", refresh_sponsor_totals, name)

	def invoice_and_pay(self, student, first, structure, term, sponsorship):
		current = term.name == self.cur.name
		bucket = "paid"
		if current:
			bucket = (
				"partial"
				if first == "Grace"
				else (
					"paid",
					"paid",
					"paid",
					"paid",
					"partial",
					"partial",
					"partial",
					"partial",
					"unpaid",
					"unpaid",
				)[self.h(student) % 10]
			)
		due = term.start + timedelta(days=30)
		if current and bucket == "partial":
			due = max(due, self.today + timedelta(days=20))
		invoice = self.ensure(
			"Student Invoice",
			{"student": student, "academic_term": term.name, "docstatus": ["<", 2]},
			{
				"student": student,
				"fee_structure": structure,
				"academic_term": term.name,
				"posting_date": self.past(term.start),
				"due_date": due,
				"remarks": f"{term.name} fees",
			},
			flags={"mute_notification": True},
			submit=True,
		)
		if not invoice:
			return
		total = flt(frappe.db.get_value("Student Invoice", invoice, "total_amount"))
		sponsor_share = 0.0
		if sponsorship:
			if sponsorship.coverage in ("Full Fees", "Tuition Only"):
				sponsor_share = total
			elif sponsorship.coverage == "Percentage":
				sponsor_share = round(total * flt(sponsorship.percentage) / 100.0)
			else:
				sponsor_share = min(flt(sponsorship.amount), total)
		own = total - sponsor_share
		if bucket == "partial":
			own = 6000 if first == "Grace" else round(own * (30 + self.h(student, "p") % 31) / 100.0, -2)
		elif bucket == "unpaid":
			own = 0
		paid_on = self.past(term.start + timedelta(days=3 + self.h(student, term.name) % 20))
		if sponsor_share > 0:
			self.pay(
				student,
				invoice,
				sponsor_share,
				paid_on,
				"Sponsor Remittance",
				self.ref("SR-", student, term.name),
				sponsor=sponsorship.sponsor,
			)
		if own > 0:
			mode = "M-Pesa" if self.h(student, term.name, "mode") % 3 else "Bank Deposit"
			ref = (
				self.mpesa_ref(student, term.name)
				if mode == "M-Pesa"
				else self.ref("KCB", student, term.name)
			)
			self.pay(student, invoice, own, self.past(paid_on + timedelta(days=1)), mode, ref)

	def pay(self, student, invoice, amount, posting_date, mode, reference, sponsor=None):
		values = {
			"payment_for": "Student Fees",
			"student": student,
			"posting_date": posting_date,
			"mode_of_payment": mode,
			"amount": flt(amount),
			"reference_no": reference,
			"reference_date": posting_date,
			"sponsor": sponsor,
			"remarks": "Demo payment",
		}
		if mode == "M-Pesa":
			values["msisdn"] = frappe.db.get_value("Student", student, "phone")
		self.ensure(
			"Student Payment",
			{"reference_no": reference, "mode_of_payment": mode, "docstatus": ["<", 2]},
			values,
			flags={"mute_notification": True, "preferred_invoice": invoice},
			submit=True,
		)

	# ------------------------------------------------------------------ 11. registrations
	def seed_registrations(self):
		flags = {
			"ignore_registration_window": True,
			"ignore_fee_clearance": True,
			"ignore_prerequisites": True,
			"ignore_credit_limit": True,
			"ignore_capacity": True,
		}
		for row in D.STUDENTS:
			student = self.student(row[0])
			if not student:
				continue
			offs = frappe.get_all(
				"Course Enrolment",
				filters={"student": student, "academic_term": self.cur.name, "status": "Enrolled"},
				pluck="course_offering",
			)
			if not offs:
				continue
			self.ensure(
				"Semester Registration",
				{"student": student, "academic_term": self.cur.name},
				{
					"student": student,
					"academic_term": self.cur.name,
					"year_of_study": 2 if row[6] == "C" else 1,
					"status": "Approved",
					"courses": [
						{"course_offering": o, "course_type": "Core", "status": "Registered"} for o in offs
					],
				},
				flags=flags,
			)

	# ------------------------------------------------------------------ 12. assessments
	def seed_assessments(self):
		cur = self.offerings(self.cur)
		mnc = self.campus["MNC"]
		the106, bib112, min120 = cur.get((mnc, "THE106")), cur.get((mnc, "BIB112")), cur.get((mnc, "MIN120"))
		end_of = lambda d: datetime.combine(d, time(23, 59))  # noqa: E731
		if the106:
			essay = self.ensure(
				"Assignment",
				{"course_offering": the106, "title": "Doctrine of God Essay"},
				{
					"title": "Doctrine of God Essay",
					"course_offering": the106,
					"assessment_component": "Assignment",
					"status": "Published",
					"created_by_staff": self.staff_member("njoroge"),
					"instructions": "<p>In 1,500 words, discuss how the attributes of God shape Christian worship and "
					"pastoral ministry. Engage at least three scholarly sources and the key biblical texts studied in "
					"weeks 2–4.</p>",
					"open_date": self.now - timedelta(days=25),
					"due_date": end_of(self.today - timedelta(days=5)),
					"max_score": 100,
					"submission_type": "Text",
					"allow_late": 1,
				},
			)
			if essay:
				due = self.today - timedelta(days=5)
				for i, student in enumerate(self.enrolled(the106, ("Enrolled",))):
					if i == 3:
						continue  # one missing submission
					late = i == 5
					raw = 84 if student == self.student("Grace") else 58 + self.h(student, "essay") % 35
					self.ensure(
						"Assignment Submission",
						{"assignment": essay, "student": student},
						{
							"assignment": essay,
							"student": student,
							"status": "Graded",
							"submitted_on": datetime.combine(
								due + timedelta(days=1 if late else -1 - i % 3), time(20, 15)
							),
							"answer_text": "<p>The holiness and love of God are not competing attributes; together they "
							"call the church to reverent, joyful worship and compassionate ministry...</p>",
							"raw_score": raw,
							"released": 1,
							"feedback": "<p>Good engagement with Scripture. Develop the application section further.</p>",
						},
					)
		if bib112:
			study = self.ensure(
				"Assignment",
				{"course_offering": bib112, "title": "Exegetical Study — Mark 4:1–20"},
				{
					"title": "Exegetical Study — Mark 4:1–20",
					"course_offering": bib112,
					"assessment_component": "Assignment",
					"status": "Published",
					"created_by_staff": self.staff_member("kimani"),
					"instructions": "<p>Prepare an exegetical study of the Parable of the Sower (Mark 4:1–20): "
					"historical context, literary structure, key terms and a 300-word application for a Kenyan "
					"congregation.</p>",
					"open_date": self.now - timedelta(days=4),
					"due_date": end_of(self.today + timedelta(days=10)),
					"max_score": 100,
					"submission_type": "Text",
					"allow_late": 1,
				},
			)
			if study:
				grace = self.student("Grace")
				others = [s for s in self.enrolled(bib112, ("Enrolled",)) if s != grace][:3]
				for student in others:
					self.ensure(
						"Assignment Submission",
						{"assignment": study, "student": student},
						{
							"assignment": study,
							"student": student,
							"status": "Submitted",
							"submitted_on": self.now - timedelta(days=1, hours=self.h(student) % 12),
							"answer_text": "<p>Mark places the parable at the start of Jesus' teaching ministry...</p>",
						},
					)
		if min120:
			self.ensure(
				"Assignment",
				{"course_offering": min120, "title": "Ministry Reflection Journal"},
				{
					"title": "Ministry Reflection Journal",
					"course_offering": min120,
					"assessment_component": "Assignment",
					"status": "Published",
					"created_by_staff": self.staff_member("mwangi"),
					"instructions": "<p>Submit a reflective journal (800 words) on your weekend ministry placement.</p>",
					"open_date": self.now - timedelta(days=2),
					"due_date": end_of(self.today + timedelta(days=3)),
					"max_score": 50,
					"submission_type": "Text",
					"allow_late": 1,
				},
			)
		if the106:
			self.seed_cat(the106)
		if bib112:
			start = datetime.combine(max(self.cur.exam_start, self.today + timedelta(days=1)), time(9, 0))
			self.ensure(
				"Exam",
				{"course_offering": bib112, "title": "BIB112 End of Term Examination"},
				{
					"title": "BIB112 End of Term Examination",
					"exam_type": "Main Exam",
					"assessment_component": "Exam",
					"course_offering": bib112,
					"delivery_mode": "In Person",
					"status": "Scheduled",
					"created_by_staff": self.staff_member("kimani"),
					"start_datetime": start,
					"end_datetime": start + timedelta(hours=3),
					"duration_minutes": 120,
					"venue": "Main Hall",
					"pass_mark": 40,
					"require_fee_clearance": 1,
					"instructions": "<p>Answer question one and any other three. Bring your student ID card.</p>",
				},
			)

	def seed_cat(self, offering):
		staff = self.staff_member("njoroge")
		existing = {}
		for q in frappe.get_all("Question", filters={"course": "THE106"}, fields=["name", "question"]):
			existing[html.unescape(strip_html_tags(q.question or "")).strip()[:60]] = q.name
		rows = []
		for qtype, marks, text, payload in D.QUESTIONS:
			name = existing.get(text[:60])
			if name:
				self.tick("existing")
			else:
				values = {
					"course": "THE106",
					"topic": "Doctrine of God",
					"question_type": qtype,
					"marks": marks,
					"difficulty": "Medium",
					"is_active": 1,
					"created_by_staff": staff,
					"question": f"<p>{html.escape(text, quote=False)}</p>",
				}
				if "options" in payload:
					values["options"] = [{"option_text": t, "is_correct": c} for t, c in payload["options"]]
				if "pairs" in payload:
					values["matching_pairs"] = [{"prompt": p, "match": m} for p, m in payload["pairs"]]
				for field in ("correct_boolean", "accepted_answers", "marking_guide"):
					if field in payload:
						values[field] = payload[field]
				name = self.ensure("Question", {"name": "__new__"}, values)
			if name:
				rows.append({"question": name, "marks": marks})
		title = "CAT 1 — Doctrine of God"
		if frappe.db.exists("Exam", {"course_offering": offering, "title": title}) or len(rows) < len(
			D.QUESTIONS
		):
			self.ensure("Exam", {"course_offering": offering, "title": title}, {})
			return
		start = (self.now - timedelta(days=1)).replace(minute=0, second=0)
		name = self.ensure(
			"Exam",
			{"course_offering": offering, "title": title},
			{
				"title": title,
				"exam_type": "CAT",
				"assessment_component": "CAT",
				"course_offering": offering,
				"delivery_mode": "Online",
				"status": "Scheduled",
				"created_by_staff": staff,
				"start_datetime": start,
				"end_datetime": start + timedelta(days=7),
				"duration_minutes": 40,
				"pass_mark": 40,
				"max_attempts": 1,
				"shuffle_questions": 1,
				"shuffle_options": 1,
				"require_fee_clearance": 0,
				"show_answers_after_release": 1,
				"instructions": "<p>You have 40 minutes once you start. The CAT closes automatically when time is up. "
				"Do not refresh or leave the page.</p>",
				"questions": rows,
			},
		)
		if name and frappe.db.get_value("Exam", name, "status") == "Scheduled":
			self.attempt("open CAT", self.open_exam, name)

	def open_exam(self, name):
		doc = frappe.get_doc("Exam", name)
		doc.status = "Open"
		doc.save(ignore_permissions=True)

	# ------------------------------------------------------------------ 13. attendance
	def seed_attendance(self):
		cur = self.offerings(self.cur)
		grace = self.student("Grace")
		slot = 0
		for code, rows in D.CURRENT_OFFERINGS.items():
			for course, lecturer in rows:
				off = cur.get((self.campus[code], course))
				idx, slot = slot, slot + 1
				if not off:
					continue
				weekday, (start, end) = idx % 5, SESSION_BLOCKS[(idx // 5) % len(SESSION_BLOCKS)]
				days = [self.today - timedelta(days=n) for n in range(1, 29)]
				held = sorted(d for d in days if d.weekday() == weekday and d >= self.cur.start)[-3:]
				upcoming = next(
					self.today + timedelta(days=n)
					for n in range(0, 7)
					if (self.today + timedelta(days=n)).weekday() == weekday
				)
				students = self.enrolled(off, ("Enrolled",))
				staff = self.staff_member(lecturer)
				for n, d in enumerate([*held, upcoming]):
					is_held = d in held
					attendance = []
					if is_held:
						for s in students:
							roll = self.h(s, off, d) % 20
							status = (
								"Present" if roll < 16 else ("Late", "Absent", "Absent", "Excused")[roll - 16]
							)
							if s == grace:
								status = "Late" if n == 1 else "Present"
							attendance.append({"student": s, "status": status})
					name = self.ensure(
						"Class Session",
						{"course_offering": off, "session_date": d},
						{
							"course_offering": off,
							"session_date": d,
							"start_time": start,
							"end_time": end,
							"lecturer": staff,
							"venue": f"{'Room' if code == 'MNC' else 'Nakuru Room'} {idx + 1}",
							"mode": "In Person",
							"status": "Held" if is_held else "Scheduled",
							"topic": TOPICS[n % len(TOPICS)],
							"attendance": attendance,
						},
					)
					self.top_up_attendance("Class Session", name, attendance)

	# ------------------------------------------------------------------ 14. website
	def seed_website(self):
		self.attempt("website settings", self.fill_website_settings)
		for n in D.NEWS:
			published = n.get("published", 1)
			self.ensure(
				"News Post",
				{"title": n["title"]},
				{
					"title": n["title"],
					"category": n["category"],
					"author": n.get("author"),
					"published": published,
					"published_on": self.today - timedelta(days=n["days_ago"]) if published else None,
					"is_featured": n.get("is_featured", 0),
					"excerpt": n["excerpt"],
					"content": n["content"],
					"tags": n.get("tags"),
					"meta_description": n["excerpt"],
					"views": 40 + self.h(n["title"]) % 400 if published else 0,
				},
			)
		events = {}
		for e in D.EVENTS:
			start = datetime.combine(self.today + timedelta(days=e["days"]), time(9, 0))
			events[e["title"]] = self.ensure(
				"Campus Event",
				{"title": e["title"]},
				{
					"title": e["title"],
					"event_type": e["event_type"],
					"status": "Upcoming",
					"start_datetime": start,
					"end_datetime": start + timedelta(hours=e["hours"]),
					"venue": e["venue"],
					"campus": self.campus[e["campus"]],
					"is_public": 1,
					"organiser": e.get("organiser"),
					"summary": e["summary"],
					"description": e["description"],
					"registration_required": e["registration_required"],
					"capacity": e.get("capacity"),
					"fee": e.get("fee"),
					"registration_deadline": start - timedelta(days=1)
					if e["registration_required"] and e["days"] > 0
					else None,
				},
			)
		self.seed_event_registrations(events)
		try:
			from mahanaim.services.website import update_event_statuses

			self.attempt("event statuses", update_event_statuses)
		except ImportError:
			pass
		for i, (question, category, answer) in enumerate(D.FAQS, 1):
			self.ensure(
				"FAQ",
				{"question": question},
				{
					"question": question,
					"category": category,
					"answer": answer,
					"sequence": i * 10,
					"is_published": 1,
				},
			)
		for i, (person, role, prog, quote) in enumerate(D.TESTIMONIALS, 1):
			self.ensure(
				"Testimonial",
				{"person_name": person},
				{
					"person_name": person,
					"role_title": role,
					"programme": prog,
					"quote": quote,
					"sequence": i * 10,
					"is_published": 1,
				},
			)
		comms = email_for("comms") if frappe.db.exists("User", email_for("comms")) else None
		for full_name, email, phone, subject, message, status in D.ENQUIRIES:
			values = {
				"full_name": full_name,
				"email": email,
				"phone": phone,
				"subject": subject,
				"message": message,
				"status": status,
			}
			if status != "New" and comms:
				values["assigned_to"] = comms
			if status == "Responded":
				values["response"] = (
					"Thank you for your enquiry. The Pastors' Conference runs over two days and "
					"the fee is KES 1,500, covering meals and materials. Register on our events page."
				)
			self.ensure("Contact Enquiry", {"email": email}, values, flags={"skip_response_email": True})

	def fill_website_settings(self):
		doc = frappe.get_single("Campus Website Settings")
		changed = False
		for field, value in D.WEBSITE.items():
			if doc.meta.has_field(field) and not doc.get(field):
				doc.set(field, value)
				changed = True
		if changed:
			doc.save(ignore_permissions=True)
			self.tick("created")
		else:
			self.tick("existing")

	def seed_event_registrations(self, events: dict):
		people = [
			("Kevin Mutai", "Deliverance Church Umoja"),
			("Purity Wanjala", "PCEA Kahawa West"),
			("Abel Kiprono", "AIC Milimani Nakuru"),
			("Lilian Moraa", "Harvest Fellowship Kasarani"),
			("Bernard Ouma", "Grace Chapel Kitengela"),
			("Faith Mumbi", "Redeemed Gospel Church Kayole"),
			("Rev. Simon Kariuki", "ACK St. Stephen's Thika"),
			("Pastor Ann Chelangat", "KAG Eldoret"),
			("Bishop Joel Mburu", "Harvest Fellowship Churches"),
			("Rev. Mary Akoth", "Harvest Fellowship Nakuru"),
			("Pastor Isaac Wafula", "FGCK Bungoma"),
		]
		plan = {
			"Open Day": [(people[i], 1 + i % 3, "Registered", None) for i in range(6)],
			"Pastors' & Church Leaders' Conference": [
				(people[6], 1, "Confirmed", "Paid"),
				(people[7], 2, "Confirmed", "Paid"),
				(people[8], 1, "Registered", "Pending"),
				(people[9], 1, "Registered", "Pending"),
				(people[10], 1, "Confirmed", "Paid"),
			],
			"Graduation Ceremony": [(people[i], 2 + i % 3, "Attended", None) for i in range(5)],
		}
		for title, rows in plan.items():
			event = events.get(title)
			if not event:
				continue
			for (full_name, church), attendees, status, payment in rows:
				local = full_name.lower().replace("rev. ", "").replace("pastor ", "").replace("bishop ", "")
				email = f"{local.replace(' ', '.')}@example.com"
				values = {
					"campus_event": event,
					"full_name": full_name,
					"email": email,
					"phone": self.phone("rsvp", email),
					"attendees": attendees,
					"church": church,
					"status": status,
				}
				if payment:
					values["payment_status"] = payment
					if payment == "Paid":
						values["payment_reference"] = self.mpesa_ref("event", email)
				self.ensure(
					"Event Registration",
					{"campus_event": event, "email": email},
					values,
					flags={"staff_override": True, "ignore_session_user": True},
				)

	# ------------------------------------------------------------------ 15. church life
	def seed_church_life(self):
		suggested = {
			"Tithe": "500, 1000, 2000, 5000",
			"Offering": "200, 500, 1000",
			"Missions": "1000, 2500, 5000",
			"Building Fund": "1000, 5000, 10000",
			"Scholarship Fund": "2000, 5000, 10000, 25000",
			"Thanksgiving": "500, 1000, 2000",
		}
		for name, amounts in suggested.items():
			if frappe.db.exists("Giving Type", name) and not frappe.db.get_value(
				"Giving Type", name, "suggested_amounts"
			):
				frappe.db.set_value("Giving Type", name, "suggested_amounts", amounts)
		mnc = self.campus["MNC"]
		students = frappe.get_all(
			"Student", filters={"campus": mnc, "status": "Active"}, pluck="name", order_by="full_name asc"
		)
		last_wed = self.today - timedelta(days=(self.today.weekday() - 2) % 7 or 7)
		themes = [
			("Two Camps: God With Us on the Journey", "Genesis 32:1–2", "principal"),
			("Strength in Weakness", "2 Corinthians 12:7–10", "chaplain"),
			("The Shepherd's Heart", "John 10:11–18", "mwangi"),
			("Faithful Stewards", "1 Corinthians 4:1–2", "njoroge"),
			("Rebuilding the Walls", "Nehemiah 2:17–18", "chaplain"),
			("Sent Ones", "Isaiah 6:1–8", "kimani"),
		]
		latest = None
		for weeks, (theme, scripture, preacher) in enumerate(themes):
			d = last_wed - timedelta(weeks=weeks)
			h = self.h("chapel", d)
			attendance = []
			if weeks == 0:
				for s in students:
					roll = self.h(s, d) % 10
					attendance.append(
						{"student": s, "status": "Present" if roll < 8 else ("Excused", "Absent")[roll % 2]}
					)
			name = self.ensure(
				"Chapel Service",
				{"service_date": d, "campus": mnc, "service_type": "Chapel"},
				{
					"service_date": d,
					"service_type": "Chapel",
					"campus": mnc,
					"status": "Held",
					"theme": theme,
					"scripture": scripture,
					"preacher_staff": self.staff_member(preacher),
					"men": 38 + h % 15,
					"women": 44 + h % 17,
					"children": h % 5,
					"visitors": 3 + h % 8,
					"attendance": attendance,
				},
			)
			latest = latest or name
			self.top_up_attendance("Chapel Service", name, attendance)
		next_wed = last_wed + timedelta(weeks=1)
		if next_wed <= self.today:
			next_wed += timedelta(weeks=1)
		self.ensure(
			"Chapel Service",
			{"service_date": next_wed, "campus": mnc, "service_type": "Chapel"},
			{
				"service_date": next_wed,
				"service_type": "Chapel",
				"campus": mnc,
				"status": "Scheduled",
				"theme": "Faithful in Little Things",
				"scripture": "Luke 16:10",
				"preacher_staff": self.staff_member("chaplain"),
			},
		)
		self.seed_giving(latest)
		groups = [
			(
				"MBC Worship Team",
				"Worship Team",
				"mwangi",
				"Thursday",
				"16:00:00",
				[
					("Joy", "Leader"),
					("Mercy", "Member"),
					("Ruth", "Member"),
					("Collins", "Member"),
					("Hannah", "Secretary"),
				],
				"Leads worship at chapel services and college events.",
			),
			(
				"Missions & Evangelism Team",
				"Missions Team",
				"chaplain",
				"Saturday",
				"09:00:00",
				[
					("Daniel", "Leader"),
					("Grace", "Secretary"),
					("Peter", "Member"),
					("Philip", "Member"),
					("Esther", "Member"),
				],
				"Plans Missions Week and weekend outreach with partner churches.",
			),
		]
		for group_name, group_type, patron, day, at, members, description in groups:
			rows = [
				{"student": self.student(f), "role": role, "joined_on": self.cur.start}
				for f, role in members
				if self.student(f)
			]
			self.ensure(
				"Ministry Group",
				group_name,
				{
					"group_name": group_name,
					"group_type": group_type,
					"campus": mnc,
					"is_active": 1,
					"patron": self.staff_member(patron),
					"leader": rows[0]["student"] if rows else None,
					"meeting_day": day,
					"meeting_time": at,
					"description": description,
					"members": rows,
				},
			)

	def seed_giving(self, chapel_service):
		for i, (giving_type, giver_type, giver, amount, months_ago, mode) in enumerate(D.GIVING):
			if not frappe.db.exists("Giving Type", giving_type):
				continue
			posting = self.past(add_months(self.today, -months_ago) - timedelta(days=self.h("giv", i) % 6))
			values = {
				"giving_type": giving_type,
				"giver_type": giver_type,
				"posting_date": posting,
				"amount": amount,
				"mode_of_payment": mode,
				"purpose": f"{giving_type} gift",
			}
			if giver_type == "Sponsor":
				values["sponsor"] = self.sponsor(giver)
				if not values["sponsor"]:
					continue
			elif giver_type == "Partner Church":
				values["partner_church"] = D.CHURCHES[giver]["church_name"]
			elif giver:
				values["giver_name"] = giver
			if mode == "M-Pesa":
				reference = self.mpesa_ref("giving", i, giving_type)
				values["msisdn"] = self.phone("giver", i)
			elif mode == "Cash":
				reference = self.ref("CASH-", "giving", i, length=6)
				if giving_type == "Offering" and chapel_service:
					values["chapel_service"] = chapel_service
			else:
				reference = self.ref({"Bank": "EQB", "Cheque": "CHQ"}.get(mode, "REF"), "giving", i, length=7)
			values["reference_no"] = reference
			self.ensure(
				"Giving Record", {"reference_no": reference, "docstatus": ["<", 2]}, values, submit=True
			)

	# ------------------------------------------------------------------ 16. library
	def seed_library(self):
		for title, item_type, authors, subject, year, access, copies, campus, extra in D.LIBRARY_ITEMS:
			h = self.h(title)
			self.ensure(
				"Library Item",
				{"title": title},
				{
					"title": title,
					"item_type": item_type,
					"authors": authors,
					"subject": subject,
					"publication_year": year,
					"access_level": access,
					"total_copies": copies,
					"campus": self.campus.get(campus) if campus else None,
					"is_active": 1,
					"call_number": f"{subject[:3].upper()} {100 + h % 900}.{h % 90 + 10}" if copies else None,
					"location": extra.get("location")
					or (f"Shelf {chr(65 + h % 8)}{1 + h % 12}" if copies else None),
					"external_url": extra.get("external_url"),
					"description": "Read online (open access)." if extra.get("external_url") else None,
				},
			)
		for title, who, kind, issued_ago, due_in, status in D.LOANS:
			item = frappe.db.get_value("Library Item", {"title": title}, "name")
			field, borrower = (
				("student", self.student(who))
				if kind == "student"
				else ("staff_member", self.staff_member(who))
			)
			if not (item and borrower):
				continue
			issue = self.today - timedelta(days=issued_ago)
			due = self.today + timedelta(days=due_in)
			values = {
				"library_item": item,
				"borrower_type": "Student" if kind == "student" else "Staff",
				field: borrower,
				"issue_date": issue,
				"due_date": due,
				"status": status,
			}
			if status == "Returned":
				values["return_date"] = self.past(due + timedelta(days=2))
			self.ensure("Library Loan", {"library_item": item, field: borrower}, values)
		try:
			from mahanaim.services.library import mark_overdue_loans

			self.attempt("mark overdue loans", mark_overdue_loans)
		except ImportError:
			pass

	# ------------------------------------------------------------------ 17. communication
	def seed_communication(self):
		from mahanaim.services.communication import push_portal_notification, send_announcement

		cur = self.offerings(self.cur)
		posters = {"Course Offering": email_for("dean")}
		comms = email_for("comms")
		for a in D.ANNOUNCEMENTS:
			values = {
				"title": a["title"],
				"audience": a["audience"],
				"body": a["body"],
				"is_pinned": a.get("is_pinned", 0),
				"show_in_portal": 1,
				"status": "Draft",
				"send_email": 0,
				"send_sms": 0,
			}
			if a.get("offering"):
				values["course_offering"] = cur.get((self.campus["MNC"], a["offering"]))
				if not values["course_offering"]:
					continue
			if a["audience"] == "All Students":
				values["expires_on"] = self.today + timedelta(days=30)
			name = self.ensure("Announcement", {"title": a["title"]}, values)
			if not name:
				continue
			if frappe.db.get_value("Announcement", name, "status") != "Sent":
				self.attempt(f"send {a['title']}", send_announcement, name)
			poster = posters.get(a["audience"], comms)
			if frappe.db.exists("User", poster):
				frappe.db.set_value("Announcement", name, "posted_by", poster, update_modified=False)
		targets = [
			(email_for("student"), D.STUDENT_NOTIFICATIONS),
			(
				email_for("sponsor"),
				[
					(
						"Termly progress reports are ready",
						"Announcement",
						"/sponsor",
						"Progress reports for your sponsored students are now available.",
					)
				],
			),
		]
		for user, rows in targets:
			if not frappe.db.exists("User", user):
				continue
			for i, (title, category, link, message) in enumerate(rows):
				if frappe.db.exists("Portal Notification", {"user": user, "title": title}):
					self.tick("existing")
					continue
				if (
					self.attempt(
						f"notification {title}",
						push_portal_notification,
						user,
						title,
						message,
						link,
						category,
					)
					is not FAILED
				):
					self.tick("created")
					if i == 0 and len(rows) > 1:
						frappe.db.set_value(
							"Portal Notification",
							{"user": user, "title": title},
							{"is_read": 1, "read_on": self.now},
						)

	# ------------------------------------------------------------------ 18. applications
	def seed_applications(self):
		intake = frappe.db.get_value(
			"Intake",
			{"applications_open": 1, "start_date": [">", self.today]},
			"name",
			order_by="start_date asc",
		)
		reviewer = email_for("admissions") if frappe.db.exists("User", email_for("admissions")) else None
		grades = ["B-", "C+", "C", "B", "C-", "B+", "C+", "D+", "C", "B-"]
		flags = {
			"skip_submission_checks": True,
			"ignore_fee": True,
			"mute_notifications": True,
			"ignore_offer_expiry": True,
		}
		for i, (first, last, gender, prog, campus_code, mode, status, extra) in enumerate(D.APPLICATIONS):
			own = extra.get("user")
			email = email_for("applicant") if own else f"{first}.{last}@applicants.{D.DEMO_DOMAIN}".lower()
			if own:
				self.attempt(
					"applicant user", self.make_user, email, first, last, ["Applicant"], "Website User"
				)
			h = self.h(email)
			values = {
				"first_name": first,
				"last_name": last,
				"gender": "Female" if gender == "F" else "Male",
				"email": email,
				"phone": self.phone("app", email),
				"nationality": "Kenyan",
				"date_of_birth": date(self.today.year - 20 - h % 18, 1 + h % 12, 1 + h % 28),
				"national_id": str(30000000 + h % 9999999),
				"county": COUNTY[campus_code],
				"programme": prog,
				"campus": self.campus[campus_code],
				"study_mode": mode,
				"intake": intake,
				"sponsorship_type": ("Self", "Church", "Sponsor")[h % 3],
				"home_church": OTHER_CHURCHES[h % len(OTHER_CHURCHES)],
				"denomination": "Pentecostal",
				"pastor_name": "Rev. Daniel Mwende",
				"pastor_phone": self.phone("pastor-app", email),
				"ministry_role": MINISTRY_ROLES[h % len(MINISTRY_ROLES)],
				"year_born_again": self.today.year - 3 - h % 12,
				"testimony": "I gave my life to Christ at a youth camp and have served in my local church since.",
				"ministry_experience": "Serving in the youth ministry and Sunday school for the past three years.",
				"kcse_mean_grade": grades[i % len(grades)],
				"kcse_year": self.today.year - 3 - h % 10,
				"highest_qualification": "KCSE",
				"academic_records": [
					{
						"institution": f"{COUNTY[campus_code]} Secondary School",
						"qualification": "KCSE",
						"year_completed": self.today.year - 3 - h % 10,
						"grade": grades[i % len(grades)],
					}
				],
				"nok_name": f"{NOK_FIRST[h % len(NOK_FIRST)]} {last}",
				"nok_relationship": "Parent",
				"nok_phone": self.phone("app-nok", email),
				"status": status,
			}
			if own:
				values["user"] = email
			if status != "Draft":
				values["declaration_accepted"] = 1
				values["submitted_on"] = self.now - timedelta(days=12 - i)
			paid = status not in ("Draft", "Submitted") or extra.get("fee_status") == "Paid"
			if status not in ("Draft", "Submitted"):
				values["fee_status"] = "Paid"
				values["reviewer"] = reviewer
			if status == "Interview":
				values["interview_date"] = datetime.combine(
					self.today + timedelta(days=extra.get("interview_in_days", 5)), time(10, 0)
				)
			if status == "Rejected":
				values["rejection_reason"] = extra.get("rejection_reason")
			if status in ("Admitted", "Accepted", "Waitlisted", "Under Review"):
				values["review_notes"] = "Strong pastoral recommendation; documents verified."
			name = self.ensure("Programme Application", {"email": email}, values, flags=flags)
			if name and paid and not frappe.db.get_value("Programme Application", name, "fee_payment"):
				self.ensure(
					"Student Payment",
					{
						"reference_no": self.mpesa_ref("appfee", email),
						"mode_of_payment": "M-Pesa",
						"docstatus": ["<", 2],
					},
					{
						"payment_for": "Application Fee",
						"programme_application": name,
						"payer_name": f"{first} {last}",
						"posting_date": self.past(values["submitted_on"]),
						"mode_of_payment": "M-Pesa",
						"amount": frappe.db.get_value("Programme Application", name, "application_fee")
						or 1000,
						"reference_no": self.mpesa_ref("appfee", email),
						"msisdn": values["phone"],
						"remarks": "Application fee (demo)",
					},
					flags={"mute_notification": True},
					submit=True,
				)

	# ------------------------------------------------------------------ summary
	def print_summary(self):
		print("\nMahanaim demo seed: summary")
		print(f"{'Section':<34}{'created':>9}{'existing':>10}{'errors':>8}")
		errors = 0
		for title, s in self.stats.items():
			errors += len(s["errors"])
			print(f"{title:<34}{s['created']:>9}{s['existing']:>10}{len(s['errors']):>8}")
		if errors:
			print(f"\n{errors} item(s) failed; see the lines marked '!' above and the Error Log.")
		print("\nDemo credentials (password for every account below: " + D.DEMO_PASSWORD + ")")
		print(f"{'Role':<36}{'Login':<32}{'Ready':>6}")
		for label, local in CREDENTIAL_ROWS:
			email = email_for(local)
			ready = "yes" if frappe.db.get_value("User", email, "enabled") else "no"
			print(f"{label:<36}{email:<32}{ready:>6}")
