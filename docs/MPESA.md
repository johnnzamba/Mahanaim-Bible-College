# M-Pesa (Daraja) setup

This guide connects the Digital Campus to Safaricom's Daraja API for:
- **STK push** (Lipa na M-Pesa Online): the student taps "Pay", gets a PIN prompt, and the payment posts
  automatically.
- **C2B** (PayBill/Till): payments made from the M-Pesa menu with the student number as the account; they are
  matched and posted automatically.

Endpoints and payloads are documented in [api/mpesa.md](api/mpesa.md).

## 1. Create a Daraja app

1. Sign up at <https://developer.safaricom.co.ke> and open **My Apps → Create App**.
2. Tick the **Lipa Na M-Pesa Sandbox** and **M-Pesa Sandbox** products (C2B and Transaction Status are
   included), then create the app.
3. Copy the app's **Consumer Key** and **Consumer Secret**.
4. Open **APIs → M-Pesa Express → Simulate**, or the *Test Credentials* page, and note the sandbox values:
   - **Business shortcode:** `174379` (Lipa na M-Pesa Online test PayBill).
   - **Passkey:** the long hex "Lipa Na Mpesa Online Passkey" shown on that page.
   - **C2B test shortcode:** a `600xxx` shortcode for C2B simulations.
   - **Test MSISDN:** in the sandbox the PIN prompt goes to a real Safaricom line. Use your own `07xx…` number;
     sandbox charges are not real.

## 2. Pick the public callback URL and token

Safaricom must reach the site over **public HTTPS**.
- In production, use the campus domain (for example `https://campus.mahanaim.ac.ke`).
- In local development, use a tunnel such as `cloudflared tunnel --url http://localhost:8010` or
  `ngrok http 8010`, and use the https URL it prints.

Generate a long random callback token, for example
`python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. The app appends it to every callback URL and
rejects (HTTP 403) callbacks that don't carry it. The comparison is constant-time.

The resulting URLs:

```
STK callback      https://<host>/api/method/mahanaim.api.mpesa.stk_callback?token=<callback_token>
C2B confirmation  https://<host>/api/method/mahanaim.api.finance.paybill_confirmation?token=<callback_token>
C2B validation    https://<host>/api/method/mahanaim.api.finance.paybill_validation?token=<callback_token>
```

The C2B URLs live under `api.finance` on purpose: Daraja's RegisterURL rejects URLs that contain "mpesa" or
"safaricom". `mahanaim.api.mpesa.c2b_confirmation`/`c2b_validation` are equivalent and also work.

## 3. Fill in M-Pesa Settings

Open **Desk → M-Pesa Settings** (`/app/m-pesa-settings`) as a System Manager or College Administrator.
You can also use the admin portal's Settings screen, which uses `mahanaim.api.mpesa.mpesa_settings` and
`update_mpesa_settings` (see [api/mpesa.md](api/mpesa.md#admin-settings-screen)). That screen also shows the
callback URLs and has a **Test connection** button.

| Field | Sandbox | Production |
| --- | --- | --- |
| Enabled | ✔ | ✔ |
| Environment | Sandbox | Production |
| Transaction Type | CustomerPayBillOnline | CustomerPayBillOnline (PayBill) or CustomerBuyGoodsOnline (Till) |
| Business Shortcode | `174379` | PayBill number, or the Head Office/Store number for a Till |
| Till Number | empty | The till number (Buy Goods only) |
| Account Reference Prefix | `MBC` | `MBC` |
| Consumer Key / Consumer Secret | From your sandbox app | From the production app (after Go Live) |
| Passkey | Sandbox passkey | Passkey emailed by Safaricom at Go Live |
| Callback Base URL | Tunnel URL | `https://campus.mahanaim.ac.ke` |
| Callback Token | Random token | A different random token |
| STK Timeout Seconds | 120 | 120 |
| Auto Allocate | ✔ | ✔ (post matched payments automatically) |

Secrets are Frappe Password fields; they are never returned by the API or stored in request/response logs.

Check the configuration:
- **`mahanaim.api.mpesa.mpesa_settings_status`** (GET, finance roles) shows `configured: true` and the masked
  callback URLs.
- **`mahanaim.api.mpesa.test_connection`** (POST) fetches an OAuth token: `{"ok": true}`. The token is cached in
  Redis until shortly before it expires.

## 4. Register the C2B URLs (PayBill/Till payments)

Call `mahanaim.api.mpesa.register_c2b_urls` (POST, System Manager / College Administrator) once per shortcode:

```bash
curl -X POST https://<host>/api/method/mahanaim.api.mpesa.register_c2b_urls \
  -H "Authorization: token <api_key>:<api_secret>"
```

- It registers the confirmation and validation URLs with `ResponseType: Completed`, so Safaricom completes the
  payment even if validation is unreachable.
- In **production** a shortcode's URLs can be registered only once. To change them later (for example after
  a domain change), ask Safaricom (`apisupport@safaricom.co.ke`) to delete the registration first.
- To test in the sandbox, use the Daraja **C2B simulator** with the `600xxx` shortcode. Set `BillRefNumber` to a
  student number (for example `MBC/DBS/2026/0001`), an application name or an invoice name.

**Matching**
- Matching ignores case, `/`, `-`, spaces and dots, so `mbcdbs20260001` matches too.
- Matched payments become Student Payments (FIFO to the oldest invoices) when Auto Allocate is on.
- Unmatched payments wait in the finance office's M-Pesa transactions list (status *Unmatched*) for
  `reconcile_transaction`.

## 5. Scheduler

Make sure the scheduler is enabled: `bench --site <site> enable-scheduler`.

| Job | Frequency | Purpose |
| --- | --- | --- |
| `mahanaim.services.mpesa.expire_stale_requests` | every 5 minutes | Queries Daraja once for STK pushes still pending after `stk_timeout_seconds` + 60 s, otherwise marks them Timeout. A late success callback is still recorded |
| `mahanaim.services.fees.mark_overdue_invoices` | daily | Flags overdue invoices |
| `mahanaim.services.fees.send_fee_reminders` | daily | "Fee Reminder" notifications, at most one per `overdue_reminder_days` per student |

## 6. Simulation mode (demos and development)

Simulation mode needs M-Pesa Settings **Enabled unticked** and the site in **developer mode**
(`bench --site <site> set-config developer_mode 1`). Then:
- `initiate_payment` (and so `pay_fees`, `pay_application_fee`, and the giving and event payments) returns a fake
  `SIM-…` checkout id without calling Safaricom. The portal shows `mpesa.simulation: true`.
- Complete the request as staff or as its owner:

```bash
curl -X POST https://<host>/api/method/mahanaim.api.mpesa.simulate_callback \
  -H "Authorization: token <api_key>:<api_secret>" -d request=MPR-2026-00031 -d success=1
```

`success=0` simulates "cancelled by user" (1032). The simulated callback runs the real callback handler, so the
same Student Payment, ledger entry, receipt and notification are produced, with a `SIM…` receipt number.
Simulation is refused outside developer mode.

## 7. Going live

1. Apply for **Go Live** on the Daraja portal. Safaricom verifies the PayBill/Till ownership and emails the
   production passkey.
2. Create the production app and set **Environment = Production** plus the production key, secret, shortcode
   and passkey.
3. Set the production **Callback Base URL** and a **new** callback token.
4. Run `test_connection`, then `register_c2b_urls`.
5. Make a KES 1 STK push to a staff phone, and confirm that the Student Payment and receipt appear.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Request stays *Pending*, then becomes *Timeout* | The callback never arrived. Is the Callback Base URL public HTTPS, and is the token right? Rejected calls are logged to `logs/mahanaim.mpesa.log` as "rejected (bad token)". Use **Query status** (`query_stk_status`) to ask Daraja directly |
| "Invalid Access Token" / 401 | Wrong key or secret for the selected environment. Run `test_connection` |
| `400.002.02 Bad Request - Invalid BusinessShortCode` | Shortcode doesn't match the passkey or environment. For a Till, BusinessShortCode is the store number and PartyB is the till |
| Payment recorded with "Amount mismatch" in remarks | The customer paid a different amount from the prompt (possible on C2B or Till). The amount actually paid is what gets posted |
| C2B payment *Unmatched* | The account number typed didn't match a student number, application or invoice. Reconcile it from the finance M-Pesa page |
| Error Log "M-Pesa payment creation failed" | The transaction is kept (Matched/Unmatched) and Safaricom still got "Accepted". Fix the cause, then reconcile |

Known limitation: Daraja documents a 12-character limit for `AccountReference`, and student numbers can be
longer. Longer values have worked in the sandbox. If production rejects them, shorten the student-number format
or set a short prefix. STK payments are matched through the stored request, not the reference text.
