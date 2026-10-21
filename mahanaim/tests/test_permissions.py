import frappe
from frappe.tests import IntegrationTestCase

from mahanaim.services import assessments as svc
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b2 as fb


class TestLecturerRowPermissions(IntegrationTestCase):
	"""Lecturers reach only their own courses through Frappe's generic REST/Desk APIs too."""

	def setUp(self):
		fb.no_commit(self)
		self.mine = fb.make_world(students=1)
		self.other = fb.make_world(students=1)
		self.user = self.mine.lecturer.user
		self.other_assignment = fb.make_assignment(self.other.offering.name)
		self.other_submission = svc.submit(
			self.other_assignment.name, self.other.students[0].name, "Answer from another course"
		).name
		self.own_submission = svc.submit(
			fb.make_assignment(self.mine.offering.name).name, self.mine.students[0].name, "Mine"
		).name

	def can(self, doctype, ptype, doc):
		return frappe.has_permission(doctype, ptype, doc, user=self.user)

	def test_submissions_from_other_courses_are_out_of_reach(self):
		self.assertFalse(self.can("Assignment Submission", "read", self.other_submission))
		self.assertFalse(self.can("Assignment Submission", "write", self.other_submission))
		self.assertTrue(self.can("Assignment Submission", "write", self.own_submission))
		frappe.set_user(self.user)
		listed = frappe.get_list("Assignment Submission", pluck="name", limit_page_length=0)
		frappe.set_user("Administrator")
		self.assertIn(self.own_submission, listed)
		self.assertNotIn(self.other_submission, listed)

	def test_new_submission_is_checked_against_the_assignment_offering(self):
		# the controller fills course_offering from the assignment only after the permission check
		doc = frappe.new_doc("Assignment Submission")
		doc.assignment = self.other_assignment.name
		doc.student = self.other.students[0].name
		self.assertFalse(self.can("Assignment Submission", "create", doc))

	def test_questions_and_students_are_scoped_to_taught_courses(self):
		question = fb.make_question(self.other.course.name, "Short Answer")
		self.assertFalse(self.can("Question", "read", question.name))
		self.assertTrue(
			self.can("Question", "read", fb.make_question(self.mine.course.name, "Short Answer").name)
		)
		self.assertFalse(self.can("Student", "read", self.other.students[0].name))
		self.assertTrue(self.can("Student", "read", self.mine.students[0].name))

	def test_other_staff_keep_their_role_permissions(self):
		# Frappe v16 reads a None hook result as "deny", so the hooks must return True for staff.
		dean = f.make_user(
			f"dean.{frappe.generate_hash(length=8)}@example.com", roles=("Academic Dean",)
		).name
		self.assertTrue(
			frappe.has_permission("Assignment Submission", "write", self.other_submission, user=dean)
		)
		self.assertTrue(frappe.has_permission("Course Offering", "read", self.other.offering.name, user=dean))
