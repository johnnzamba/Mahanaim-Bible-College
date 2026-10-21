# Alumni API (`mahanaim.api.alumni`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Covers SOW 7.2 M19: the alumni directory, alumni self-service and graduation.

**Guards**
- **guest**: `allow_guest=True`. Anyone, including anonymous visitors.
- **guest · rate-limited**: as guest, plus a per-IP `rate_limit` (HTTP 429 when exceeded). Public forms also carry a
  honeypot argument `website` that must stay empty; when filled, the call quietly returns `{"ok": true}` and saves nothing.
- **login**: any signed-in user (`require_login`).
- **staff**: any staff role (`require_staff`).
- **roles: …**: `require_roles(...)`. System Manager, College Administrator and Administrator always pass.
- **alumni**: signed in and linked to a Student whose status is Alumni (or Completed).

**Rules**
- The directory only lists Alumni with `alumni_consent = 1` and returns public-safe fields only: name, photo,
  programme, campus, graduation date, current ministry/position, county and home church. There is no email, phone
  or student number.
- Alumni may update only `current_ministry`, `current_position`, `phone` and `alumni_consent`.
- `graduate_students(students, graduation_date)` moves **Completed** students to **Alumni**: it loads each Student
  with `frappe.get_doc`, sets the status and `graduation_date`, saves (B1's controller validates the transition) and
  adds the Alumni role to the linked user. Other statuses are skipped and reported per student.

## Endpoints

### `alumni_directory`
- **Path:** `mahanaim.api.alumni.alumni_directory`
- **Method:** GET
- **Guard:** login

Args: `search` (default `None`), `programme` (default `None`), `year` (default `None`), `campus` (default `None`), `start` (default `0`), `page_length` (default `24`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "STU-2026-00046",
        "full_name": "Francis Njoroge",
        "photo": null,
        "programme": "DPM",
        "programme_name": "Diploma in Pastoral Ministry",
        "campus": "Main Campus Nairobi",
        "graduation_date": "2025-12-12",
        "current_ministry": "Grace Chapel Kitengela",
        "current_position": "Associate Pastor",
        "county": null,
        "home_church": "Nairobi Pentecostal Church",
        "campus_name": "Main Campus Nairobi",
        "graduation_year": 2025
      },
      {
        "name": "STU-2026-00016",
        "full_name": "Paul Ouma",
        "photo": null,
        "programme": "CTH",
        "programme_name": "Certificate in Theology",
        "campus": "Main Campus Nairobi",
        "graduation_date": "2024-11-28",
        "current_ministry": "Youth Pastor, Grace Chapel Kitengela",
        "current_position": "Youth Pastor",
        "county": null,
        "home_church": "Grace Chapel Kitengela",
        "campus_name": "Main Campus Nairobi",
        "graduation_year": 2024
      }
    ],
    "total": 4,
    "facets": {
      "years": [2025, 2024],
      "programmes": [
        {"programme": "DPM", "programme_name": "Diploma in Pastoral Ministry", "count": 2},
        {"programme": "CTH", "programme_name": "Certificate in Theology", "count": 1}
      ]
    }
  }
}
```

### `my_alumni_profile`
- **Path:** `mahanaim.api.alumni.my_alumni_profile`
- **Method:** GET
- **Guard:** alumni

Args: None.

```json
{
  "message": {
    "name": "STU-2026-00038",
    "full_name": "John Maina",
    "photo": null,
    "programme": "DBS",
    "programme_name": "Diploma in Biblical Studies",
    "campus": "Main Campus Nairobi",
    "graduation_date": "2023-11-28",
    "current_ministry": "Senior Pastor, Harvest Fellowship Thika",
    "current_position": "Senior Pastor",
    "county": null,
    "home_church": "Harvest Fellowship Thika",
    "student_number": "MBC/DBS/2021/0001",
    "email": "alumni@mahanaim.demo",
    "phone": "254770263419",
    "alumni_consent": 1,
    "status": "Alumni",
    "completion_date": "2023-08-14",
    "partner_church": null,
    "campus_name": "Main Campus Nairobi",
    "is_alumni": true
  }
}
```

### `update_my_alumni_profile`
- **Path:** `mahanaim.api.alumni.update_my_alumni_profile`
- **Method:** POST
- **Guard:** alumni

Args: `data` (required).

Example args: `{"data": {"current_position": "Senior Pastor", "alumni_consent": 1}}`

```json
{
  "message": {
    "name": "STU-2026-00038",
    "full_name": "John Maina",
    "photo": null,
    "programme": "DBS",
    "programme_name": "Diploma in Biblical Studies",
    "campus": "Main Campus Nairobi",
    "graduation_date": "2023-11-28",
    "current_ministry": "Senior Pastor, Harvest Fellowship Thika",
    "current_position": "Senior Pastor",
    "county": null,
    "home_church": "Harvest Fellowship Thika",
    "student_number": "MBC/DBS/2021/0001",
    "email": "alumni@mahanaim.demo",
    "phone": "254770263419",
    "alumni_consent": 1,
    "status": "Alumni",
    "completion_date": "2023-08-14",
    "partner_church": null,
    "campus_name": "Main Campus Nairobi",
    "is_alumni": true
  }
}
```

### `graduate_students`
- **Path:** `mahanaim.api.alumni.graduate_students`
- **Method:** POST
- **Guard:** roles: Registrar, Academic Dean

Move Completed students to Alumni (B1's Student controller validates the transition) and grant the role.

Args: `students` (required), `graduation_date` (default `None`).

Example args: `{"students": ["STU-2026-00017"], "graduation_date": "2026-10-22"}`

```json
{
  "message": {
    "graduated": [],
    "failed": [{"student": "STU-2026-00017", "error": "Grace Wanjiku is Active, not Completed."}],
    "count": 0
  }
}
```

### `graduation_candidates`
- **Path:** `mahanaim.api.alumni.graduation_candidates`
- **Method:** GET
- **Guard:** roles: Registrar, Academic Dean

Args: `programme` (default `None`), `campus` (default `None`).

```json
{
  "message": [
    {
      "name": "STU-2026-00045",
      "full_name": "Eunice Akinyi",
      "student_number": "MBC/CTH/2026/0005",
      "programme": "CTH",
      "campus": "Nakuru Campus",
      "completion_date": "2026-10-02",
      "cgpa": 3.4,
      "credits_earned": 36.0
    }
  ]
}
```

### `alumni_stats`
- **Path:** `mahanaim.api.alumni.alumni_stats`
- **Method:** GET
- **Guard:** roles: Registrar, Academic Dean

Args: None.

```json
{
  "message": {
    "total": 4,
    "with_consent": 4,
    "consent_pct": 100.0,
    "in_ministry": 4,
    "in_ministry_pct": 100.0,
    "awaiting_graduation": 1,
    "by_year": [{"year": 2022, "count": 1}, {"year": 2023, "count": 1}],
    "by_programme": [
      {"programme": "DPM", "programme_name": "Diploma in Pastoral Ministry", "count": 2},
      {"programme": "CTH", "programme_name": "Certificate in Theology", "count": 1}
    ],
    "by_campus": [{"campus": "Main Campus Nairobi", "count": 4}]
  }
}
```
