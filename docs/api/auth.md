# Auth & OTP API (`mahanaim.api.auth`)

Call these as `POST /api/method/<dotted path>` (form or JSON body). Every guest endpoint is rate-limited per IP
(`frappe.rate_limiter`, HTTP 429 when exceeded). OTP requests also have a per-recipient resend cooldown.
Errors use the standard Frappe shape: `exc_type`, plus `_server_messages` holding a translated message.

| Error | HTTP | Meaning |
| --- | --- | --- |
| `OTPError` (a ValidationError) | 417 | Wrong, expired or used code, cooldown active, or bad token |
| `AuthenticationError` | 401 | Wrong credentials, account locked or disabled, or staff MFA required on a stock login |
| `PermissionError` | 403 | Signed in but not allowed |

**Settings** (Mahanaim Settings) used here: `otp_length` (4–8), `otp_expiry_minutes`, `otp_max_attempts`,
`otp_resend_cooldown_seconds`, `admin_mfa_required` and `sms_enabled`.

**Purposes.** `purpose` is case-insensitive and accepts aliases:
- `login`
- `signup`
- `password reset` (also `reset` or `forgot password`)
- `phone verification` (also `phone`)
- `Admin MFA` is internal only.

**Channels.** `channel` is `email` or `sms`. If you omit it, it is inferred from the recipient: an address with
`@` is email, a phone-like value is SMS.

**Storage.** Codes are stored only as an HMAC-SHA256 hash keyed with the site secret. A new code for the same
recipient and purpose invalidates the previous one.

## Sign-in flows used by the SPA

**Password**
1. `login(usr, pwd)`.
2. You get either the session info, or `{mfa_required: true, ...}` for staff.
3. For staff, call `verify_mfa(mfa_token, code)`. Use `resend_mfa(mfa_token)` to send a new code.

**Passwordless** (students and applicants)
1. `request_otp(recipient, purpose="login")`.
2. `login_with_otp(recipient, code)`.

**Forgot password**
1. `forgot_password(email)`; an email or a phone is accepted.
2. `reset_password(recipient, code, new_password)`.
3. Alternatively, the emailed link from `request_password_reset` leads to `/reset-password?key=…`.

**Signup** (applicants)
1. `request_otp(email, purpose="signup")`.
2. `verify_otp(email, "signup", code)` returns an `otp_token`.
3. `signup_applicant(..., otp_token)`.

### Staff MFA cannot be bypassed

When `admin_mfa_required` is on, staff users must use `mahanaim.api.auth.login` + `verify_mfa`. Staff users are
anyone with a staff role or Lecturer; `Administrator` is exempt.

Any other way of creating a session is refused with `AuthenticationError`: "Staff accounts must sign in at
<site>/signin and enter the security code we email you." This covers:
- Frappe's stock `/api/method/login`, including the desk `/login` page.
- Email-link login.
- Social login.
- Invitation auto-login.

The check runs in the `on_login` hook `mahanaim.services.auth.enforce_staff_mfa`.

A staff password reset through `frappe.core.doctype.user.user.update_password` (with `key`) keeps the new
password and invalidates the key. It then fails with 401: "Your password has been changed. Staff accounts must
sign in at …". The SPA should show that message and send the user to `/signin`.

`Administrator` impersonating a user is allowed.

---

## `request_otp`

`mahanaim.api.auth.request_otp`: POST, guest. Rate limit: 10 per 10 min per IP.

| Arg | Type | Notes |
| --- | --- | --- |
| `recipient` | str | Email or phone (`07…`, `+2547…`) |
| `channel` | str? | `email` or `sms`; inferred when omitted |
| `purpose` | str | Default `login` |

Behaviour by purpose:
- **login**: only for enabled student and applicant accounts. Staff use a password plus MFA.
- **password reset**: any enabled account.
- For both of these, unknown accounts get the **same** response and nothing is sent.
- **signup**: any address.
- **phone verification**: requires a signed-in user and always uses SMS.
- SMS is refused when `sms_enabled` is off.
- Requests within the cooldown raise `OTPError` ("Please wait N seconds…").

```json
{"message": {"ok": true, "sent": true, "channel": "Email", "destination": "j***@example.com",
  "expires_in": 600, "resend_in": 60,
  "message": "If the details match an account, a verification code has been sent."}}
```

## `verify_otp`

`mahanaim.api.auth.verify_otp`: POST, guest. Rate limit: 30 per 10 min.

Args: `recipient`, `purpose`, `code`, `channel?`.

- Checks the code and returns a single-use `otp_token`, valid for 10 minutes, for `signup_applicant` or
  `update_phone`.
- A wrong code counts toward `otp_max_attempts`. After that, the code is dead and a new one must be requested.

```json
{"message": {"verified": true, "otp_token": "Zx8…", "expires_in": 600, "purpose": "Signup"}}
```

## `signup_applicant`

`mahanaim.api.auth.signup_applicant`: POST, guest. Rate limit: 10 per hour.

Args: `first_name`, `last_name`, `email`, `phone`, `password`, `otp_token` (from a verified `signup` for this
email, or a verified `phone verification` for this phone).

What it does:
- Creates a Website User with the **Applicant** role and sets the password, enforcing the password policy.
- Sends "Account Created".
- **Signs the user in.**

It fails if:
- an account exists for the email;
- the phone is already linked to an account;
- the token is for another address;
- (with an SMS token only) the email belongs to an existing student, staff or sponsor record.

Returns `session_info()` (see `mahanaim.api.session.session_info`):

```json
{"message": {"user": "jane@example.com", "full_name": "Jane Wanjiku", "email": "jane@example.com",
  "phone": "+254712345678", "roles": ["Applicant"], "portals": ["applicant"], "home": "applicant",
  "student": null, "staff": null, "sponsor": null, "settings": {"…": "…"}, "csrf_token": "…"}}
```

## `login`

`mahanaim.api.auth.login`: POST, guest. Rate limit: 20 per 10 min.

| Arg | Notes |
| --- | --- |
| `usr` | Email, **student number** (`MBC/DBS/2026/0001`), **staff number**, username, or phone |
| `pwd` | Password |

- `usr` is resolved to the account **on the server**. The resolved email is never returned.
- A phone number works only for non-staff accounts (students, applicants, sponsors).
- Frappe's `LoginManager` checks the password, so brute-force lockout still applies.
- A bad identifier or password gives a generic 401: "Incorrect email/phone or password."
- An expired password gives 401 asking the user to use "Forgot password".

Response for students, applicants, sponsors, and staff when MFA is off: `session_info()`, as above.

Response for staff when `admin_mfa_required` is on (no session is created yet; a code has been emailed):

```json
{"message": {"mfa_required": true, "mfa_token": "kP2…", "channel": "Email",
  "destination": "r***@mbc.ac.ke", "expires_in": 600, "resend_in": 60}}
```

## `verify_mfa`

`mahanaim.api.auth.verify_mfa`: POST, guest. Rate limit: 20 per 10 min.

Args: `mfa_token`, `code`.

- Completes the staff sign-in and returns `session_info()`.
- The token expires after 10 minutes and cannot be replayed.
- If the token has expired you get `OTPError`: "Your sign-in session expired. Please sign in again."

## `resend_mfa`

`mahanaim.api.auth.resend_mfa`: POST, guest. Rate limit: 5 per 10 min.

Args: `mfa_token`. The cooldown applies.

```json
{"message": {"sent": true, "destination": "r***@mbc.ac.ke", "expires_in": 600, "resend_in": 60}}
```

## `login_with_otp`

`mahanaim.api.auth.login_with_otp`: POST, guest. Rate limit: 20 per 10 min.

Args: `recipient`, `code`, `channel?`.

- Passwordless sign-in for students and applicants only. Request the code with `request_otp(purpose="login")`.
- Returns `session_info()`.

## `forgot_password`

`mahanaim.api.auth.forgot_password`: POST, guest. Rate limit: 5 per 10 min.

Args: `email` (an email **or** a phone), `channel?`.

- Sends a **password reset code**.
- The response is identical whether or not the account exists (the same shape as `request_otp`).

## `reset_password`

`mahanaim.api.auth.reset_password`: POST, guest. Rate limit: 10 per 10 min.

Args: `recipient`, `code`, `new_password`.

- Checks the password length (8–128) and Frappe's password policy (`test_password_strength`).
- Sets the password, signs out all sessions and clears the login-failure counter.
- Does not sign the user in.

```json
{"message": {"ok": true, "message": "Your password has been changed. Sign in with your new password."}}
```

## `request_password_reset` (emailed link)

`mahanaim.api.auth.request_password_reset`: POST, guest. Rate limit: 5 per 10 min.

Args: `email`. Always returns `{"ok": true}`.

- For an enabled user (not Administrator), it creates a Frappe reset key and emails
  `<site>/reset-password?key=<key>` (event "Password Reset Link", email only).
- The SPA page then calls `frappe.core.doctype.user.user.update_password(new_password, key, logout_all_sessions=1)`.
  For staff with MFA on, see the note under "Staff MFA cannot be bypassed".

```json
{"message": {"ok": true}}
```

## `change_password`

`mahanaim.api.auth.change_password`: POST, signed in.

Args: `old`, `new`.

- Checks the current password and the policy, then signs out the user's other sessions.
- Fails with "Your current password is incorrect." when `old` is wrong.

```json
{"message": {"ok": true, "message": "Password changed."}}
```

## `update_phone`

`mahanaim.api.auth.update_phone`: POST, signed in.

Args: `phone`, `otp_token`. Get the token with `request_otp(phone, "sms", "phone verification")` and then
`verify_otp`.

Updates `User.mobile_no` and the linked Student or Staff Member phone. Fails if another account uses the number.

```json
{"message": {"ok": true, "phone": "+254712345678"}}
```

## Removed

`mahanaim.api.auth.resolve_login` has been **removed**: it let a guest map student or staff numbers to emails.
Send the raw identifier to `login` instead.

## Housekeeping

`mahanaim.services.auth.purge_expired_otps` runs daily. It deletes OTP rows older than a day that are expired,
verified or consumed.
