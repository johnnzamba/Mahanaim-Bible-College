from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, add_to_date, now_datetime, random_string
from frappe.utils.password import check_password, update_password

from mahanaim.api import auth as api
from mahanaim.services import auth as otp
from mahanaim.tests import factories as f
from mahanaim.tests import factories_b1 as fb

PASSWORD = "Mbc!Campus#2026xQ"


def _email(prefix="auth"):
	return f"{prefix}.{random_string(8).lower()}@example.com"


def _wrong(code):
	return "0" * len(code) if code != "0" * len(code) else "1" * len(code)


def _with_on_login_hook(test):
	"""Wire `on_login` = enforce_staff_mfa (as hooks.py does) for one test."""
	original = frappe.get_hooks
	method = "mahanaim.services.auth.enforce_staff_mfa"

	def get_hooks(hook=None, default="_KEEP_DEFAULT_LIST", app_name=None):
		if hook is None and app_name is None:
			hooks = frappe._dict(original())
			if method not in (hooks.get("on_login") or []):
				hooks["on_login"] = [*(hooks.get("on_login") or []), method]
			return hooks
		return original(hook, default, app_name)

	patcher = patch.object(frappe, "get_hooks", get_hooks)
	patcher.start()
	test.addCleanup(patcher.stop)


class TestAuth(IntegrationTestCase):
	def setUp(self):
		fb.no_commit(self)
		fb.use_settings(
			self,
			otp_length=6,
			otp_expiry_minutes=10,
			otp_max_attempts=3,
			otp_resend_cooldown_seconds=60,
			admin_mfa_required=0,
			sms_enabled=0,
		)
		patcher = patch("mahanaim.services.auth.notify")
		self.notify = patcher.start()
		self.addCleanup(patcher.stop)

	def last_code(self):
		return self.notify.call_args.kwargs["context"]["code"]

	# ------------------------------------------------------------------ OTP lifecycle
	def test_otp_is_hashed_sent_and_single_use(self):
		email = _email()
		sent = otp.create_otp(email, "Email", "Signup")
		code = self.last_code()
		self.assertEqual(len(code), 6)
		self.assertTrue(code.isdigit())
		self.assertEqual(self.notify.call_args.args[0], "OTP Code")
		self.assertEqual(tuple(self.notify.call_args.kwargs["channels"]), ("Email",))

		row = frappe.get_doc("OTP Verification", sent.name)
		self.assertEqual(len(row.code_hash), 64)
		self.assertNotEqual(row.code_hash, code)
		self.assertEqual(row.code_hash, otp.otp_hash(email, "Signup", code))
		self.assertNotIn(code, frappe.as_json(row.as_dict()).replace(row.code_hash, ""))

		self.assertEqual(otp.verify_otp_code(email, "Signup", code).name, sent.name)
		self.assertTrue(frappe.db.get_value("OTP Verification", sent.name, "verified"))
		with self.assertRaises(otp.OTPError):
			otp.verify_otp_code(email, "Signup", code)

	def test_otp_expiry(self):
		email = _email()
		sent = otp.create_otp(email, "Email", "Signup")
		code = self.last_code()
		frappe.db.set_value(
			"OTP Verification", sent.name, "expires_on", add_to_date(now_datetime(), minutes=-1)
		)
		with self.assertRaisesRegex(otp.OTPError, "expired"):
			otp.verify_otp_code(email, "Signup", code)
		self.assertTrue(frappe.db.get_value("OTP Verification", sent.name, "consumed"))

	def test_otp_max_attempts(self):
		email = _email()
		otp.create_otp(email, "Email", "Signup")
		code = self.last_code()
		for left in (2, 1):
			with self.assertRaisesRegex(otp.OTPError, f"{left} attempt"):
				otp.verify_otp_code(email, "Signup", _wrong(code))
		with self.assertRaisesRegex(otp.OTPError, "Too many"):
			otp.verify_otp_code(email, "Signup", _wrong(code))
		# Even the right code is refused once the attempts are used up.
		with self.assertRaises(otp.OTPError):
			otp.verify_otp_code(email, "Signup", code)

	def test_resend_cooldown_and_new_code_replaces_old(self):
		email = _email()
		otp.create_otp(email, "Email", "Signup")
		first = self.last_code()
		with self.assertRaises(frappe.TooManyRequestsError):
			otp.create_otp(email, "Email", "Signup")
		self.assertGreater(otp.cooldown_remaining(email, "Signup"), 0)

		otp.clear_cooldown(email, "Signup")
		otp.create_otp(email, "Email", "Signup")
		second = self.last_code()
		self.assertEqual(frappe.db.count("OTP Verification", {"recipient": email, "consumed": 0}), 1)
		if first != second:
			with self.assertRaises(otp.OTPError):
				otp.verify_otp_code(email, "Signup", first)
		self.assertTrue(otp.verify_otp_code(email, "Signup", second))

	def test_purge_expired_otps(self):
		old = otp.create_otp(_email(), "Email", "Signup", send=False)
		fresh = otp.create_otp(_email(), "Email", "Signup", send=False)
		frappe.db.set_value(
			"OTP Verification",
			old.name,
			{"creation": add_days(now_datetime(), -2), "consumed": 1},
			update_modified=False,
		)
		otp.purge_expired_otps()
		self.assertFalse(frappe.db.exists("OTP Verification", old.name))
		self.assertTrue(frappe.db.exists("OTP Verification", fresh.name))

	# ------------------------------------------------------------------ signup
	def test_signup_applicant(self):
		fb.web_request(self)
		email, phone = _email("applicant"), fb.unique_phone()
		self.assertTrue(api.request_otp(email, "email", "signup")["sent"])
		token = api.verify_otp(email, "signup", self.last_code())["otp_token"]

		with patch("mahanaim.api.auth.notify") as welcome:
			info = api.signup_applicant("Ann", "Wanjiru", email, phone, PASSWORD, token)
		self.assertEqual(welcome.call_args.args[0], "Account Created")
		self.assertEqual(frappe.session.user, email)
		self.assertEqual(info["user"], email)
		self.assertIn("applicant", info["portals"])
		self.assertIn("Applicant", frappe.get_roles(email))
		self.assertEqual(frappe.db.get_value("User", email, "user_type"), "Website User")
		self.assertTrue(check_password(email, PASSWORD))

		# The verification token is single use.
		with self.assertRaises(otp.OTPError):
			api.signup_applicant("Ann", "Wanjiru", email, phone, PASSWORD, token)

	def test_signup_requires_the_verified_address(self):
		fb.web_request(self)
		email = _email("applicant")
		api.request_otp(email, "email", "signup")
		token = api.verify_otp(email, "signup", self.last_code())["otp_token"]
		with self.assertRaises(otp.OTPError):
			api.signup_applicant("Ann", "W", _email("other"), fb.unique_phone(), PASSWORD, token)
		with self.assertRaises(otp.OTPError):
			api.signup_applicant("Ann", "W", email, fb.unique_phone(), PASSWORD, "not-a-token")
		with self.assertRaises(frappe.ValidationError):
			api.signup_applicant("Ann", "W", email, fb.unique_phone(), "short", token)
		self.assertFalse(frappe.db.exists("User", email))

	# ------------------------------------------------------------------ sign in
	def test_staff_login_requires_mfa(self):
		fb.use_settings(self, admin_mfa_required=1)
		email = _email("registrar")
		f.make_user(email, roles=("Registrar",))
		update_password(email, PASSWORD)
		fb.web_request(self)

		result = api.login(email, PASSWORD)
		self.assertTrue(result["mfa_required"])
		self.assertTrue(result["mfa_token"])
		self.assertNotEqual(frappe.session.user, email)
		self.assertEqual(self.notify.call_args.kwargs["context"]["purpose"], "Admin MFA")
		code = self.last_code()

		with self.assertRaises(otp.OTPError):
			api.verify_mfa(result["mfa_token"], _wrong(code))
		info = api.verify_mfa(result["mfa_token"], code)
		self.assertEqual(frappe.session.user, email)
		self.assertIn("admin", info["portals"])
		with self.assertRaises(otp.OTPError):  # the MFA token cannot be replayed
			api.verify_mfa(result["mfa_token"], code)

	def test_student_login_with_phone_skips_mfa(self):
		fb.use_settings(self, admin_mfa_required=1)
		phone = fb.unique_phone()
		student = f.make_student(phone=phone)
		update_password(student.user, PASSWORD)
		fb.web_request(self)

		with self.assertRaisesRegex(frappe.AuthenticationError, "Incorrect"):
			api.login(phone, "Wrong-password-1")
		info = api.login(phone, PASSWORD)
		self.assertNotIn("mfa_required", info)
		self.assertEqual(frappe.session.user, student.user)
		self.assertIn("student", info["portals"])

	def test_login_with_otp_is_for_portal_users_only(self):
		student = f.make_student(phone=fb.unique_phone())
		fb.web_request(self)
		api.request_otp(student.email, "email", "login")
		api.login_with_otp(student.email, self.last_code())
		self.assertEqual(frappe.session.user, student.user)

		# Staff and unknown addresses get the same generic answer and nothing is sent.
		staff = _email("dean")
		f.make_user(staff, roles=("Academic Dean",))
		self.notify.reset_mock()
		known = api.request_otp(staff, "email", "login")
		unknown = api.request_otp(_email("ghost"), "email", "login")
		self.notify.assert_not_called()
		self.assertEqual(set(known), set(unknown))
		self.assertEqual(known["message"], unknown["message"])
		self.assertFalse(frappe.db.exists("OTP Verification", {"recipient": staff}))

	def test_login_resolves_numbers_server_side(self):
		phone, staff_phone = fb.unique_phone(), fb.unique_phone()
		student = f.make_student(phone=phone)
		staff = f.make_staff(email=_email("lecturer"))
		frappe.db.set_value("User", staff.user, "mobile_no", staff_phone)
		number = frappe.db.get_value("Student", student.name, "student_number")
		self.assertTrue(number and staff.staff_number)

		resolve = otp.resolve_login_user
		self.assertEqual(resolve(number), student.user)
		self.assertEqual(resolve(phone), student.user)
		self.assertEqual(resolve(staff.staff_number), staff.user)
		self.assertIsNone(resolve(staff_phone))  # phones never resolve to staff accounts
		self.assertIsNone(resolve("NO-SUCH-LOGIN-ID"))
		self.assertIsNone(resolve(""))

		for user in (student.user, staff.user):
			update_password(user, PASSWORD)
		fb.web_request(self)
		api.login(number, PASSWORD)
		self.assertEqual(frappe.session.user, student.user)
		api.login(staff.staff_number, PASSWORD)
		self.assertEqual(frappe.session.user, staff.user)
		with self.assertRaisesRegex(frappe.AuthenticationError, "Incorrect"):
			api.login(staff_phone, PASSWORD)

	def test_stock_login_cannot_bypass_staff_mfa(self):
		from frappe.auth import LoginManager
		from frappe.core.doctype.user.user import update_password as reset_with_key

		fb.use_settings(self, admin_mfa_required=1)
		email = _email("bursar")
		f.make_user(email, roles=("Finance Officer",))
		student = f.make_student(phone=fb.unique_phone())
		for user in (email, student.user):
			update_password(user, PASSWORD)
		_with_on_login_hook(self)
		fb.web_request(self)
		frappe.set_user("Guest")
		self.addCleanup(setattr, frappe.local, "form_dict", frappe._dict())

		frappe.local.form_dict = frappe._dict(cmd="login", usr=email, pwd=PASSWORD)
		with self.assertRaisesRegex(frappe.AuthenticationError, "/signin"):
			LoginManager()  # what /api/method/login and desk /login do
		self.assertEqual(frappe.session.user, "Guest")
		frappe.local.form_dict = frappe._dict(cmd="login", usr=student.user, pwd=PASSWORD)
		LoginManager()
		self.assertEqual(frappe.session.user, student.user)

		frappe.local.form_dict = frappe._dict()
		frappe.set_user("Guest")
		token = api.login(email, PASSWORD)["mfa_token"]
		api.verify_mfa(token, self.last_code())
		self.assertEqual(frappe.session.user, email)

		# A reset link changes the password and burns the key, but still no session without the code.
		frappe.set_user("Guest")
		key = frappe.get_doc("User", email)._reset_password(send_email=False).split("key=", 1)[1]
		new_password = "Fresh#Campus!2027zR"
		frappe.local.form_dict = frappe._dict(cmd=otp.PASSWORD_RESET_METHOD, key=key)
		with self.assertRaisesRegex(frappe.AuthenticationError, "password has been changed"):
			reset_with_key(new_password, key=key, logout_all_sessions=1)
		self.assertEqual(frappe.session.user, "Guest")
		self.assertTrue(check_password(email, new_password))
		self.assertFalse(frappe.db.get_value("User", email, "reset_password_key"))

		frappe.set_user("Administrator")  # impersonation is allowed
		self.assertIsNone(otp.enforce_staff_mfa(frappe._dict(user=email)))

	# ------------------------------------------------------------------ passwords
	def test_forgot_and_reset_password(self):
		student = f.make_student(phone=fb.unique_phone())
		fb.web_request(self)
		unknown = api.forgot_password(_email("ghost"))
		known = api.forgot_password(student.email)
		self.assertEqual(set(unknown), set(known))
		self.assertEqual(unknown["message"], known["message"])
		code = self.last_code()

		with self.assertRaises(frappe.ValidationError):
			api.reset_password(student.email, code, "abc")
		self.assertTrue(api.reset_password(student.email, code, PASSWORD)["ok"])
		self.assertTrue(check_password(student.user, PASSWORD))
		with self.assertRaises(otp.OTPError):
			api.reset_password(student.email, code, PASSWORD)

	def test_request_password_reset_link(self):
		with patch("mahanaim.api.auth.notify") as notify:
			self.assertEqual(api.request_password_reset(_email("ghost")), {"ok": True})
			notify.assert_not_called()
			user = f.make_user(_email("reset"))
			self.assertEqual(api.request_password_reset(user.name), {"ok": True})
		notify.assert_called_once()
		self.assertIn("/reset-password?key=", notify.call_args.kwargs["fallback"]["message"])
		self.assertTrue(frappe.db.get_value("User", user.name, "reset_password_key"))

	def test_change_password_and_phone(self):
		fb.use_settings(self, sms_enabled=1)
		student = f.make_student(phone=fb.unique_phone())
		update_password(student.user, PASSWORD)
		fb.as_user(self, student.user)

		with self.assertRaisesRegex(frappe.ValidationError, "incorrect"):
			api.change_password("Not-my-password-9", "An0ther!Strong#Pass")
		self.assertTrue(api.change_password(PASSWORD, "An0ther!Strong#Pass")["ok"])
		self.assertTrue(check_password(student.user, "An0ther!Strong#Pass"))

		new_phone = fb.unique_phone()
		api.request_otp(new_phone, "sms", "phone verification")
		self.assertEqual(tuple(self.notify.call_args.kwargs["channels"]), ("SMS",))
		token = api.verify_otp(new_phone, "phone verification", self.last_code(), "sms")["otp_token"]
		result = api.update_phone(new_phone, token)
		self.assertEqual(frappe.db.get_value("User", student.user, "mobile_no"), result["phone"])
		self.assertEqual(frappe.db.get_value("Student", student.name, "phone"), result["phone"])

	def test_guest_cannot_change_password(self):
		frappe.set_user("Guest")
		self.addCleanup(frappe.set_user, "Administrator")
		with self.assertRaises(frappe.AuthenticationError):
			api.change_password("x", "y")
