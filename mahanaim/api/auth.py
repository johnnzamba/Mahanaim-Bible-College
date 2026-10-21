"""Authentication & OTP endpoints (M03). See docs/api/auth.md.

Guest endpoints are rate-limited per IP (frappe.rate_limiter) on top of the per-recipient OTP cooldown and
Frappe's own login-attempt trackers. Responses for login / password-reset flows never reveal whether an account
exists.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, get_url

from mahanaim.api.session import session_info
from mahanaim.api.utils import require_login
from mahanaim.services import auth as otp
from mahanaim.services.communication import notify
from mahanaim.utils import ROLE_APPLICANT, normalize_phone, setting


def _generic_sent() -> str:
	return _("If the details match an account, a verification code has been sent.")


def _sent_response(recipient: str, channel: str, message: str | None = None) -> dict:
	cfg = otp.otp_config()
	return {
		"ok": True,
		"sent": True,
		"channel": channel,
		"destination": otp.mask(recipient, channel),
		"expires_in": cfg.expiry * 60,
		"resend_in": cfg.cooldown,
		"message": message or _("A verification code has been sent."),
	}


def _silent(recipient: str, channel: str, purpose: str) -> dict:
	"""No account: behave exactly like a successful send (incl. the cooldown) without sending anything."""
	otp.enforce_cooldown(recipient, purpose)
	otp.start_cooldown(recipient, purpose)
	return _sent_response(recipient, channel, _generic_sent())


def _send_for_account(recipient, channel, purpose, allow_staff=True) -> dict:
	channel = otp.normalize_channel(channel, recipient)
	recipient = otp.normalize_recipient(recipient, channel)
	if channel == "SMS" and not cint(setting("sms_enabled", 0)):
		frappe.throw(
			_("SMS codes are not available at the moment. Please use your email address."), otp.OTPError
		)
	user = otp.user_for_recipient(recipient, channel, allow_staff=allow_staff)
	if not user:
		return _silent(recipient, channel, purpose)
	otp.create_otp(recipient, channel, purpose, user=user)
	return _sent_response(recipient, channel, _generic_sent())


# ---------------------------------------------------------------------------------- OTP
@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=10 * 60)
def request_otp(recipient: str, channel: str | None = None, purpose: str = "login"):
	"""Send a one-time code. Login / password-reset requests always get the same generic answer."""
	purpose = otp.normalize_purpose(purpose)
	if purpose == "Admin MFA":
		frappe.throw(_("Security codes for staff are sent automatically when you sign in."), otp.OTPError)
	if purpose == "Login":
		return _send_for_account(recipient, channel, purpose, allow_staff=False)
	if purpose == "Password Reset":
		return _send_for_account(recipient, channel, purpose)
	user = None
	if purpose == "Phone Verification":
		user = require_login()
		channel = "SMS"
	sent = otp.create_otp(recipient, channel, purpose, user=user)
	return _sent_response(sent.recipient, sent.channel)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=30, seconds=10 * 60)
def verify_otp(recipient: str, purpose: str, code: str, channel: str | None = None):
	"""Check a code and return a 10-minute `otp_token` for the next step (signup, phone change)."""
	purpose = otp.normalize_purpose(purpose)
	if purpose == "Admin MFA":
		frappe.throw(_("Use the sign-in screen to enter your security code."), otp.OTPError)
	row = otp.verify_otp_code(recipient, purpose, code, channel)
	token = otp.issue_token(row.recipient, row.purpose, row.channel, row.user)
	return {"verified": True, "otp_token": token, "expires_in": otp.TOKEN_TTL, "purpose": row.purpose}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=60 * 60)
def signup_applicant(first_name: str, last_name: str, email: str, phone: str, password: str, otp_token: str):
	"""Create an applicant account after the email (or phone) was verified with an OTP, then sign in."""
	from mahanaim.services.students import ensure_user, phone_owner

	token = otp.read_token(otp_token, ("Signup", "Phone Verification"))
	first_name, last_name = (first_name or "").strip(), (last_name or "").strip()
	if not first_name or not last_name:
		frappe.throw(_("Enter your first and last name."))
	email = otp.normalize_recipient(email, "Email")
	phone = normalize_phone(phone)
	if not phone:
		frappe.throw(_("Enter a valid phone number, e.g. 0712 345 678."))
	if token.channel == "Email" and token.recipient != email:
		frappe.throw(_("Please verify this email address first."), otp.OTPError)
	if token.channel == "SMS" and token.recipient != phone:
		frappe.throw(_("Please verify this phone number first."), otp.OTPError)
	if otp.user_by_email(email):
		frappe.throw(_("An account already exists for {0}. Sign in or reset your password.").format(email))
	if token.channel == "SMS":
		if phone_owner(phone):
			frappe.throw(_("This phone number is already linked to an account. Sign in instead."))
		# The email was not verified: never let it claim an existing student/staff/sponsor profile.
		from mahanaim.services.students import phone_variants

		variants = set(phone_variants(phone))
		for doctype in ("Student", "Staff Member", "Sponsor"):
			for row in frappe.get_all(doctype, filters={"email": email}, fields=["phone"]):
				if normalize_phone(row.phone) not in variants:
					frappe.throw(
						_(
							"This email belongs to an existing college record. Verify the email address instead."
						)
					)
	otp.validate_password_strength(password, (first_name, last_name, email, phone))

	user = ensure_user(email, first_name, last_name, phone, roles=(ROLE_APPLICANT,))
	otp.set_password(user, password)
	otp.consume_token(otp_token)
	notify(
		"Account Created",
		recipients=[{"user": user, "email": email, "name": f"{first_name} {last_name}"}],
		link="/applicant",
		category="Admissions",
		fallback={
			"subject": _("Welcome to the {0} Digital Campus").format(
				setting("institution_name", "Mahanaim Bible College")
			),
			"message": _(
				"Your applicant account is ready. Sign in at {0} to continue your application."
			).format(get_url("/signin")),
		},
	)
	otp.login_user(user)
	return session_info()


# ---------------------------------------------------------------------------------- sign in
@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=10 * 60)
def login(usr: str, pwd: str):
	"""Password sign-in with email, student number, staff number, username or (students/applicants) phone.

	Staff may get `{mfa_required, mfa_token, ...}` instead of a session; finish with `verify_mfa`."""
	frappe.form_dict.pop("pwd", None)
	login_manager = frappe.local.login_manager
	user = otp.resolve_login_user(usr) or (usr or "").strip()
	try:
		login_manager.authenticate(user=user, pwd=pwd)
	except frappe.AuthenticationError as e:
		if e.args and str(e.args[0]).strip():
			raise  # e.g. "temporarily locked" from the attempt tracker
		frappe.local.response.pop("message", None)
		frappe.throw(_("Incorrect email/phone or password."), frappe.AuthenticationError)
	user = login_manager.user
	if login_manager.force_user_to_reset_password():
		frappe.throw(
			_("Your password has expired. Use 'Forgot password' to set a new one."),
			frappe.AuthenticationError,
		)
	if otp.mfa_required(user):
		return otp.start_mfa(user)
	login_manager.login_as(user)
	return session_info()


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=10 * 60)
def verify_mfa(mfa_token: str, code: str):
	"""Second step for staff when Settings.admin_mfa_required is on."""
	user = otp.complete_mfa(mfa_token, code)
	otp.login_user(user)
	return session_info()


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=10 * 60)
def resend_mfa(mfa_token: str):
	return otp.resend_mfa(mfa_token)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=10 * 60)
def login_with_otp(recipient: str, code: str, channel: str | None = None):
	"""Passwordless sign-in for students and applicants (request the code with purpose="login")."""
	row = otp.verify_otp_code(recipient, "Login", code, channel)
	user = row.user or otp.user_for_recipient(row.recipient, row.channel, allow_staff=False)
	if not user or otp.is_staff_user(user):
		frappe.throw(_("The code is invalid or has expired. Please request a new code."), otp.OTPError)
	otp.login_user(user)
	return session_info()


# ---------------------------------------------------------------------------------- passwords
@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=10 * 60)
def forgot_password(email: str, channel: str | None = None):
	"""Send a password-reset code to an email (or phone). Always answers the same way."""
	return _send_for_account(email, channel, "Password Reset")


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=10 * 60)
def reset_password(recipient: str, code: str, new_password: str, channel: str | None = None):
	"""Set a new password with a password-reset code. Signs out every other session."""
	otp.validate_password_strength(new_password, (recipient,))
	row = otp.verify_otp_code(recipient, "Password Reset", code, channel)
	user = row.user or otp.user_for_recipient(row.recipient, row.channel)
	if not user:
		frappe.throw(_("The code is invalid or has expired. Please request a new code."), otp.OTPError)
	full_name = frappe.db.get_value("User", user, "full_name")
	otp.validate_password_strength(new_password, (recipient, user, full_name))
	otp.set_password(user, new_password, logout_all_sessions=True)
	from frappe.utils.password import delete_login_failed_cache

	delete_login_failed_cache(user)
	return {"ok": True, "message": _("Your password has been changed. Sign in with your new password.")}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=10 * 60)
def request_password_reset(email: str):
	"""Email a link to `{site}/reset-password?key=…`. Same answer whether or not the account exists.

	The SPA completes it with `frappe.core.doctype.user.user.update_password(new_password, key, logout_all_sessions=1)`."""
	try:
		user = otp.user_by_email(email)
		enabled = user and user != "Administrator" and cint(frappe.db.get_value("User", user, "enabled"))
		if enabled:
			doc = frappe.get_doc("User", user)
			link = doc._reset_password(send_email=False)
			key = link.split("key=", 1)[1].split("&", 1)[0]
			url = get_url(f"/reset-password?key={key}")
			hours = max(cint(frappe.get_system_settings("reset_password_link_expiry_duration")) // 3600, 0)
			expiry = _(" It expires in {0} hour(s).").format(hours) if hours else ""
			notify(
				"Password Reset Link",
				recipients=[{"user": user, "email": doc.email, "name": doc.full_name}],
				category="System",
				channels=("Email",),
				fallback={
					"subject": _("Reset your {0} password").format(
						setting("institution_name", "Mahanaim Bible College")
					),
					"message": _(
						"<p>Dear {0},</p><p>We received a request to reset your password. "
						"<a href='{1}'>Click here to choose a new password</a>.{2}</p>"
						"<p>If you did not ask for this, you can ignore this email.</p>"
					).format(frappe.utils.escape_html(doc.first_name or ""), url, expiry),
				},
			)
	except Exception:
		frappe.clear_messages()
		frappe.log_error(title="Mahanaim: password reset link failed")
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def change_password(old: str, new: str):
	"""Signed-in user changes their password (other sessions are signed out)."""
	from frappe.utils.password import check_password

	user = require_login()
	try:
		check_password(user, old)
	except frappe.AuthenticationError:
		frappe.clear_messages()
		frappe.throw(_("Your current password is incorrect."), frappe.ValidationError)
	if old == new:
		frappe.throw(_("Choose a password you have not used just now."))
	full_name = frappe.db.get_value("User", user, "full_name")
	otp.validate_password_strength(new, (user, full_name))
	otp.set_password(user, new)
	from frappe.sessions import clear_sessions

	clear_sessions(user=user, keep_current=True, force=True)
	return {"ok": True, "message": _("Password changed.")}


@frappe.whitelist(methods=["POST"])
def update_phone(phone: str, otp_token: str):
	"""Change the signed-in user's mobile number after verifying it (purpose="phone verification")."""
	from mahanaim.services.students import phone_owner

	user = require_login()
	phone = otp.normalize_recipient(phone, "SMS")
	token = otp.read_token(otp_token, ("Phone Verification",))
	if token.recipient != phone or (token.user and token.user != user):
		frappe.throw(_("Please verify this phone number first."), otp.OTPError)
	if phone_owner(phone, exclude_user=user):
		frappe.throw(_("This phone number is already linked to another account."))
	frappe.db.set_value("User", user, "mobile_no", phone)
	for doctype in ("Student", "Staff Member"):
		for name in frappe.get_all(doctype, filters={"user": user}, pluck="name"):
			frappe.db.set_value(doctype, name, "phone", phone)
	otp.consume_token(otp_token)
	return {"ok": True, "phone": phone}
