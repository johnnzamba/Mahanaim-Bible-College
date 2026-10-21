import frappe
from frappe.tests import IntegrationTestCase

from mahanaim.tests import factories as f


class TestSmoke(IntegrationTestCase):
	def test_factories_build_graph(self):
		staff = f.make_staff()
		offering = f.make_offering(lecturer=staff.name)
		student = f.make_student()
		enrolment = f.make_enrolment(student.name, offering.name)
		self.assertTrue(frappe.db.exists("Course Enrolment", enrolment.name))
		self.assertEqual(frappe.get_single("Mahanaim Settings").default_grading_scale, "MBC Standard")

	def test_session_info_guest(self):
		from mahanaim.api.session import session_info

		frappe.set_user("Guest")
		try:
			info = session_info()
			self.assertEqual(info["user"], "Guest")
		finally:
			frappe.set_user("Administrator")
