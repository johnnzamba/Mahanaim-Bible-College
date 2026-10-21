"""OTP / authentication services (owned by backend domain B1).

OTP codes are never stored in clear text: `OTP Verification.code_hash` is an HMAC-SHA256 of
`recipient|purpose|code` keyed with the site encryption key. Failed attempts are counted in Redis as well as on
the row, because a failed verification raises (and the request transaction is rolled back).

Verification tokens (returned by `verify_otp`) and MFA tokens live in `frappe.cache` with a short TTL.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import string

import frappe
from frappe import _
from frappe.utils import add_days, add_to_date, cint, get_datetime, now_datetime, today

from mahanaim.services.communication import notify
from mahanaim.utils import ROLE_LECTURER, is_staff, normalize_phone, setting, user_roles

TOKEN_TTL = 600  # seconds a verified-OTP token stays usable (signup, phone change)
MFA_TTL = 600

PURPOSES = ("Signup", "Login", "Password Reset", "Phone Verification", "Admin MFA")
_PURPOSE_ALIASES = {
	"signup": "Signup",
	"sign up": "Signup",
	"register": "Signup",
	"login": "Login",
	"log in": "Login",
	"signin": "Login",
	"sign in": "Login",
	"password reset": "Password Reset",
	"reset password": "Password Reset",
	"forgot password": "Password Reset",
	"reset": "Password Reset",
	"phone verification": "Phone Verification",
	"verify phone": "Phone Verification",
	"phone": "Phone Verification",
	"mfa": "Admin MFA",
	"admin mfa": "Admin MFA",
}


class OTPError(frappe.ValidationError):
	pass


# ---------------------------------------------------------------------------------- normalisation
def otp_config() -> frappe._dict:
	return frappe._dict(
		length=min(max(cint(setting("otp_length", 6)), 4), 8),
		expiry=max(cint(setting("otp_expiry_minutes", 10)), 1),
		max_attempts=max(cint(setting("otp_max_attempts", 5)), 1),
		cooldown=max(cint(setting("otp_resend_cooldown_seconds", 60)), 0),
	)


def normalize_purpose(purpose: str | None) -> str:
	if purpose in PURPOSES:
		return purpose
	key = " ".join((purpose or "").replace("_", " ").replace("-", " ").lower().split())
	if key in _PURPOSE_ALIASES:
		return _PURPOSE_ALIASES[key]
	frappe.throw(_("Unknown verification purpose."), OTPError)


def normalize_channel(channel: str | None, recipient: str | None = None) -> str:
	key = (channel or "").strip().lower()
	if key in ("email", "e-mail", "mail"):
		return "Email"
	if key in ("sms", "phone", "mobile", "text"):
		return "SMS"
	if not key:
		return "Email" if "@" in (recipient or "") else "SMS"
	frappe.throw(_("Codes can be sent by email or SMS only."), OTPError)


def normalize_recipient(recipient: str | None, channel: str) -> str:
	recipient = (recipient or "").strip()
	if channel == "Email":
		recipient = recipient.lower()
		if not recipient or not frappe.utils.validate_email_address(recipient):
			frappe.throw(_("Enter a valid email address."), OTPError)
		return recipient
	phone = normalize_phone(recipient)
	if not phone or not 9 <= len(phone) <= 15:
		frappe.throw(_("Enter a valid phone number, e.g. 0712 345 678."), OTPError)
	return phone


def looks_like_phone(value: str | None) -> bool:
	value = (value or "").strip()
	if not value or "@" in value:
		return False
	return len("".join(c for c in value if c.isdigit())) >= 9 and all(
		c.isdigit() or c in "+ -()" for c in value
	)


def mask_email(email: str | None) -> str:
	if not email or "@" not in email:
		return ""
	local, domain = email.split("@", 1)
	return f"{local[:2]}{'*' * max(len(local) - 2, 3)}@{domain}"


def mask_phone(phone: str | None) -> str:
	phone = normalize_phone(phone) or ""
	if len(phone) < 7:
		return "*" * len(phone)
	return f"+{phone[:4]}{'*' * (len(phone) - 7)}{phone[-3:]}"


def mask(recipient: str, channel: str) -> str:
	return mask_email(recipient) if channel == "Email" else mask_phone(recipient)


# ---------------------------------------------------------------------------------- hashing / cache keys
def otp_hash(recipient: str, purpose: str, code: str) -> str:
	from frappe.utils.password import get_encryption_key

	message = f"{recipient}|{purpose}|{(code or '').strip()}".encode()
	return hmac.new(get_encryption_key().encode(), message, hashlib.sha256).hexdigest()


def is_hashed(value: str | None) -> bool:
	return bool(value) and len(value) == 64 and all(c in string.hexdigits for c in value)


def _cooldown_key(recipient: str, purpose: str) -> str:
	return f"mbc:otp:cooldown:{purpose}:{recipient}"


def _attempts_key(otp_name: str) -> str:
	return f"mbc:otp:attempts:{otp_name}"


def _token_key(token: str) -> str:
	return f"mbc:otp:token:{token}"


def _mfa_key(token: str) -> str:
	return f"mbc:mfa:{token}"


def _commit():
	"""Persist security counters even though the caller is about to raise (skipped in tests)."""
	if not (frappe.in_test or frappe.flags.in_test):
		frappe.db.commit()  # nosemgrep


def cooldown_remaining(recipient: str, purpose: str) -> int:
	until = frappe.cache.get_value(_cooldown_key(recipient, purpose), use_local_cache=False)
	if not until:
		return 0
	return max(int(float(until) - now_datetime().timestamp() + 0.999), 0)


def start_cooldown(recipient: str, purpose: str, seconds: int | None = None):
	seconds = otp_config().cooldown if seconds is None else seconds
	if seconds <= 0:
		return
	until = now_datetime().timestamp() + seconds
	frappe.cache.set_value(_cooldown_key(recipient, purpose), until, expires_in_sec=seconds)


def clear_cooldown(recipient: str, purpose: str):
	frappe.cache.delete_value(_cooldown_key(recipient, purpose))


def enforce_cooldown(recipient: str, purpose: str):
	wait = cooldown_remaining(recipient, purpose)
	if wait:
		frappe.throw(
			_("Please wait {0} seconds before requesting another code.").format(wait),
			frappe.TooManyRequestsError,
		)


# ---------------------------------------------------------------------------------- OTP lifecycle
def create_otp(
	recipient: str,
	channel: str | None,
	purpose: str,
	user: str | None = None,
	send: bool = True,
	check_cooldown: bool = True,
) -> frappe._dict:
	"""Create (and send) a fresh OTP. Earlier unused codes for the same recipient + purpose are invalidated."""
	cfg = otp_config()
	purpose = normalize_purpose(purpose)
	channel = normalize_channel(channel, recipient)
	recipient = normalize_recipient(recipient, channel)
	if channel == "SMS" and not cint(setting("sms_enabled", 0)):
		frappe.throw(_("SMS codes are not available at the moment. Please use your email address."), OTPError)
	if check_cooldown:
		enforce_cooldown(recipient, purpose)
	start_cooldown(recipient, purpose, cfg.cooldown)

	otp = frappe.qb.DocType("OTP Verification")
	(
		frappe.qb.update(otp)
		.set(otp.consumed, 1)
		.where((otp.recipient == recipient) & (otp.purpose == purpose) & (otp.consumed == 0))
		.run()
	)
	code = "".join(secrets.choice(string.digits) for _ in range(cfg.length))
	doc = frappe.get_doc(
		{
			"doctype": "OTP Verification",
			"recipient": recipient,
			"channel": channel,
			"purpose": purpose,
			"user": user,
			"code_hash": otp_hash(recipient, purpose, code),
			"expires_on": add_to_date(now_datetime(), minutes=cfg.expiry),
			"attempts": 0,
			"max_attempts": cfg.max_attempts,
			"ip_address": getattr(frappe.local, "request_ip", None),
		}
	)
	doc.insert(ignore_permissions=True)
	if send:
		send_otp(recipient, channel, purpose, code, cfg.expiry, user)
	return frappe._dict(
		name=doc.name,
		channel=channel,
		recipient=recipient,
		destination=mask(recipient, channel),
		expires_in=cfg.expiry * 60,
		resend_in=cfg.cooldown,
	)


def send_otp(recipient: str, channel: str, purpose: str, code: str, minutes: int, user: str | None = None):
	target = {"user": user, "name": frappe.db.get_value("User", user, "full_name") if user else None}
	target["email" if channel == "Email" else "phone"] = recipient
	college = setting("institution_name", "Mahanaim Bible College")
	notify(
		"OTP Code",
		recipients=[target],
		context={"code": code, "minutes": minutes, "purpose": purpose},
		category="System",
		channels=(channel,),
		fallback={
			"subject": _("Your {0} verification code: {1}").format(college, code),
			"message": _(
				"<p>Your verification code is <b>{0}</b>. It expires in {1} minutes.</p>"
				"<p>If you did not request it, ignore this message.</p>"
			).format(code, minutes),
			"sms": _("{0} is your {1} verification code. Expires in {2} min.").format(
				code, setting("short_name", "MBC"), minutes
			),
			"send_sms": 1,
		},
	)


def _attempts(row) -> int:
	cached = frappe.cache.get(frappe.cache.make_key(_attempts_key(row.name)))
	if isinstance(cached, bytes):
		cached = cached.decode()
	return max(cint(row.attempts), cint(cached))


def _record_failure(row, cfg_expiry: int) -> int:
	key = frappe.cache.make_key(_attempts_key(row.name))
	count = cint(frappe.cache.incrby(key, 1))
	frappe.cache.expire(key, (cfg_expiry + 5) * 60)
	count = max(count, cint(row.attempts) + 1)
	values = {"attempts": count}
	if count >= cint(row.max_attempts):
		values["consumed"] = 1
	frappe.db.set_value("OTP Verification", row.name, values, update_modified=False)
	_commit()
	return count


def verify_otp_code(recipient: str, purpose: str, code: str, channel: str | None = None) -> frappe._dict:
	"""Check `code` against the latest active OTP; marks it verified + consumed. Raises OTPError on failure."""
	cfg = otp_config()
	purpose = normalize_purpose(purpose)
	channel = normalize_channel(channel, recipient)
	recipient = normalize_recipient(recipient, channel)
	invalid = _("The code is invalid or has expired. Please request a new code.")
	rows = frappe.get_all(
		"OTP Verification",
		filters={"recipient": recipient, "purpose": purpose, "consumed": 0, "verified": 0},
		fields=[
			"name",
			"code_hash",
			"expires_on",
			"attempts",
			"max_attempts",
			"user",
			"channel",
			"recipient",
			"purpose",
		],
		order_by="creation desc",
		limit=1,
	)
	if not rows:
		frappe.throw(invalid, OTPError)
	row = rows[0]
	if get_datetime(row.expires_on) < now_datetime():
		frappe.db.set_value("OTP Verification", row.name, "consumed", 1, update_modified=False)
		_commit()
		frappe.throw(_("This code has expired. Please request a new code."), OTPError)
	max_attempts = cint(row.max_attempts) or cfg.max_attempts
	if _attempts(row) >= max_attempts:
		frappe.db.set_value("OTP Verification", row.name, "consumed", 1, update_modified=False)
		_commit()
		frappe.throw(_("Too many incorrect attempts. Please request a new code."), OTPError)

	code = "".join((code or "").split())
	if not code or not hmac.compare_digest(row.code_hash or "", otp_hash(recipient, purpose, code)):
		row.max_attempts = max_attempts
		used = _record_failure(row, cfg.expiry)
		left = max_attempts - used
		if left <= 0:
			frappe.throw(_("Too many incorrect attempts. Please request a new code."), OTPError)
		frappe.throw(_("Incorrect code. {0} attempt(s) left.").format(left), OTPError)

	frappe.db.set_value(
		"OTP Verification",
		row.name,
		{"verified": 1, "verified_on": now_datetime(), "consumed": 1, "attempts": _attempts(row)},
		update_modified=False,
	)
	clear_cooldown(recipient, purpose)
	return row


# ---------------------------------------------------------------------------------- tokens
def issue_token(recipient: str, purpose: str, channel: str, user: str | None = None, **extra) -> str:
	token = secrets.token_urlsafe(32)
	frappe.cache.set_value(
		_token_key(token),
		{"recipient": recipient, "purpose": purpose, "channel": channel, "user": user, **extra},
		expires_in_sec=TOKEN_TTL,
	)
	return token


def read_token(
	token: str | None, purposes: tuple[str, ...] | None = None, consume: bool = False
) -> frappe._dict:
	data = frappe.cache.get_value(_token_key(token), use_local_cache=False) if token else None
	if not data or (purposes and data.get("purpose") not in purposes):
		frappe.throw(_("Your verification has expired. Please verify again."), OTPError)
	if consume:
		frappe.cache.delete_value(_token_key(token))
	return frappe._dict(data)


def consume_token(token: str):
	if token:
		frappe.cache.delete_value(_token_key(token))


# ---------------------------------------------------------------------------------- users
def is_staff_user(user: str | None) -> bool:
	if not user or user == "Guest":
		return False
	return is_staff(user) or ROLE_LECTURER in user_roles(user)


def user_by_phone(phone: str | None) -> str | None:
	"""Portal user (student / applicant) that owns `phone`: User.mobile_no, then Student, then Application."""
	from mahanaim.services.students import phone_variants

	variants = phone_variants(phone)
	if not variants:
		return None
	user = frappe.db.get_value("User", {"mobile_no": ["in", variants], "enabled": 1}, "name")
	if not user:
		user = frappe.db.get_value("Student", {"phone": ["in", variants], "user": ["is", "set"]}, "user")
	if not user:
		rows = frappe.get_all(
			"Programme Application",
			filters={"phone": ["in", variants], "user": ["is", "set"]},
			pluck="user",
			order_by="creation desc",
			limit=1,
		)
		user = rows[0] if rows else None
	return user


def user_by_email(email: str | None) -> str | None:
	email = (email or "").strip().lower()
	if not email:
		return None
	return frappe.db.get_value("User", email, "name") or frappe.db.get_value("User", {"email": email}, "name")


def resolve_login_user(identifier: str | None) -> str | None:
	"""Map what the person typed to a User: email, student number, staff number, phone or username.

	Phones only work for portal users (students / applicants). Server-side only: never expose the result to guests."""
	identifier = (identifier or "").strip()
	if not identifier:
		return None
	if "@" in identifier:
		return user_by_email(identifier)
	user = frappe.db.get_value("Student", {"student_number": identifier, "user": ["is", "set"]}, "user")
	if not user:
		user = frappe.db.get_value(
			"Staff Member", {"staff_number": identifier, "user": ["is", "set"]}, "user"
		)
	if user:
		return user
	if looks_like_phone(identifier):
		user = user_by_phone(identifier)
		return None if is_staff_user(user) else user
	return frappe.db.get_value("User", identifier, "name") or frappe.db.get_value(
		"User", {"username": identifier}, "name"
	)


def user_for_recipient(recipient: str, channel: str, allow_staff: bool = True) -> str | None:
	user = user_by_email(recipient) if channel == "Email" else user_by_phone(recipient)
	if not user or user in ("Guest",):
		return None
	if not cint(frappe.db.get_value("User", user, "enabled")):
		return None
	if not allow_staff and is_staff_user(user):
		return None
	return user


def mfa_required(user: str) -> bool:
	"""Staff (and lecturers) must confirm an emailed code when Settings.admin_mfa_required is ticked.

	`Administrator` is exempt: it has no real mailbox and signs in through desk (`/login`)."""
	if user in ("Administrator", "Guest"):
		return False
	return bool(cint(setting("admin_mfa_required", 0))) and is_staff_user(user)


def start_mfa(user: str) -> dict:
	email = frappe.db.get_value("User", user, "email")
	if not email:
		frappe.throw(_("Your account has no email address for the security code. Contact the administrator."))
	otp = create_otp(email, "Email", "Admin MFA", user=user, check_cooldown=False)
	token = secrets.token_urlsafe(32)
	frappe.cache.set_value(
		_mfa_key(token), {"user": user, "recipient": otp.recipient}, expires_in_sec=MFA_TTL
	)
	return {
		"mfa_required": True,
		"mfa_token": token,
		"channel": "Email",
		"destination": otp.destination,
		"expires_in": otp.expires_in,
		"resend_in": otp.resend_in,
	}


def read_mfa(token: str | None) -> frappe._dict:
	data = frappe.cache.get_value(_mfa_key(token), use_local_cache=False) if token else None
	if not data:
		frappe.throw(_("Your sign-in session expired. Please sign in again."), OTPError)
	return frappe._dict(data)


def complete_mfa(token: str, code: str) -> str:
	data = read_mfa(token)
	row = verify_otp_code(data.recipient, "Admin MFA", code, channel="Email")
	if row.user and row.user != data.user:
		frappe.throw(_("The code is invalid or has expired. Please request a new code."), OTPError)
	frappe.cache.delete_value(_mfa_key(token))
	frappe.flags.mahanaim_mfa_user = data.user  # lets enforce_staff_mfa allow this request's login_as
	return data.user


def resend_mfa(token: str) -> dict:
	data = read_mfa(token)
	otp = create_otp(data.recipient, "Email", "Admin MFA", user=data.user)
	return {
		"sent": True,
		"destination": otp.destination,
		"expires_in": otp.expires_in,
		"resend_in": otp.resend_in,
	}


def login_user(user: str):
	"""Create a session for `user` (post_login: IP / hour restrictions, cookies)."""
	if not cint(frappe.db.get_value("User", user, "enabled")):
		frappe.throw(_("This account is disabled. Contact the college office."), frappe.AuthenticationError)
	login_manager = getattr(frappe.local, "login_manager", None)
	if login_manager is None:
		from frappe.auth import LoginManager

		login_manager = frappe.local.login_manager = LoginManager()
	login_manager.login_as(user)


PASSWORD_RESET_METHOD = "frappe.core.doctype.user.user.update_password"


def _current_method() -> str:
	cmd = frappe.form_dict.get("cmd") or ""
	if not cmd and getattr(frappe.local, "request", None):
		path = frappe.local.request.path or ""
		cmd = path.rsplit("/method/", 1)[1] if "/method/" in path else path
	return cmd


def enforce_staff_mfa(login_manager=None):
	"""`on_login` hook: with Settings.admin_mfa_required, staff only get a session via mahanaim.api.auth.login +
	verify_mfa. Blocks Frappe's stock `/api/method/login` (desk `/login`), email-link and social sign-in."""
	user = getattr(login_manager, "user", None)
	verified = frappe.flags.pop("mahanaim_mfa_user", None)  # one-shot, set by complete_mfa
	if not user or user == verified or not mfa_required(user):
		return
	if frappe.session.get("user") == "Administrator":  # Administrator impersonating a staff user
		return
	signin = frappe.utils.get_url("/signin")
	message = _("Staff accounts must sign in at {0} and enter the security code we email you.").format(signin)
	if _current_method() == PASSWORD_RESET_METHOD and frappe.form_dict.get("key"):
		# Keep the new password (and burn the key) but do not open a session without the second factor.
		frappe.db.set_value(
			"User",
			user,
			{"reset_password_key": "", "last_password_reset_date": today()},
			update_modified=False,
		)
		frappe.db.commit()  # nosemgrep: the error below rolls the request back
		message = _("Your password has been changed. {0}").format(message)
	frappe.throw(message, frappe.AuthenticationError, title=_("Two-step verification required"))


# ---------------------------------------------------------------------------------- passwords
def validate_password_strength(password: str | None, user_inputs=()):
	password = password or ""
	if len(password) < 8:
		frappe.throw(_("Password must be at least 8 characters long."))
	if len(password) > 128:
		frappe.throw(_("Password must be at most 128 characters long."))
	if not cint(frappe.get_system_settings("enable_password_policy")):
		return
	from frappe.utils.password_strength import test_password_strength

	min_score = cint(frappe.get_system_settings("minimum_password_score")) or 2
	result = test_password_strength(password, user_inputs=[i for i in user_inputs if i])
	if cint(result.get("score")) >= min_score:
		return
	feedback = result.get("feedback") or {}
	parts = [_("Choose a stronger password.")]
	if feedback.get("warning"):
		parts.append(str(feedback["warning"]))
	parts.extend(str(s) for s in (feedback.get("suggestions") or [])[:2])
	frappe.throw(" ".join(parts), title=_("Weak password"))


def set_password(user: str, password: str, logout_all_sessions: bool = False):
	from frappe.utils.password import update_password

	update_password(user, password, logout_all_sessions=logout_all_sessions)
	frappe.db.set_value("User", user, "last_password_reset_date", today(), update_modified=False)


# ---------------------------------------------------------------------------------- housekeeping
def purge_expired_otps():
	"""Daily: delete OTP rows older than a day that are expired, verified or consumed."""
	cutoff = add_days(now_datetime(), -1)
	otp = frappe.qb.DocType("OTP Verification")
	(
		frappe.qb.from_(otp)
		.delete()
		.where(
			(otp.creation < cutoff)
			& ((otp.expires_on < now_datetime()) | (otp.consumed == 1) | (otp.verified == 1))
		)
		.run()
	)
