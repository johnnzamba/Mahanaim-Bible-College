# Public Website & CMS API (`mahanaim.api.website`)

Calls go to `/api/method/<dotted path>`. Reads use GET and writes use POST. JSON arguments (`data`, `rows`, `names`,
`filters`, `recipients`, `students`) may be sent as objects/lists or as JSON strings. Responses are wrapped in
`{"message": ...}`. A missing record raises `DoesNotExistError` (404), a failed guard raises `PermissionError` (403)
and validation failures raise `ValidationError` (417) with a translated message. Examples were captured from the
demo dataset (`docs/DEMO.md`); long lists are trimmed.

Covers the public website (SOW 6.6 / M04) and the staff CMS. Public reads are cached in Redis
(`frappe.cache`, 5 minutes for home/programmes/settings). The cache is cleared by the News Post, Campus Event, FAQ,
Testimonial and Campus Website Settings controllers on save/delete, and by `services.website.clear_website_cache`
(wire it to Programme, Staff Member, Campus and Intake `on_update`/`on_trash`).

**Guards**
- **guest**: `allow_guest=True`. Anyone, including anonymous visitors.
- **guest · rate-limited**: as guest, plus a per-IP `rate_limit` (HTTP 429 when exceeded). Public forms also carry a
  honeypot argument `website` that must stay empty; when filled, the call quietly returns `{"ok": true}` and saves nothing.
- **login**: any signed-in user (`require_login`).
- **staff**: any staff role (`require_staff`).
- **roles: …**: `require_roles(...)`. System Manager, College Administrator and Administrator always pass.

**Pinned contracts**
- `site_settings()` (shell header/footer) returns `{institution, contact {phone, email, address, map_url},
  social {facebook, youtube, instagram, x, whatsapp}, nav [...], footer_links [...], announcement_bar {text, link} | null}`.
  Extra keys (`hero`, `meta`, `footer_text`, …) may be present and can be ignored.
- `mahanaim.services.website.route_meta(path)` (Python, not whitelisted) returns `{title, description, image}` for
  `/`, `/programmes/<code>`, `/news/<route>`, `/events/<route>`, the static pages (`/about`, `/academics`,
  `/programmes`, `/admissions`, `/apply`, `/fees`, `/e-library`, `/news`, `/events`, `/faculty`, `/contact`, `/faq`,
  `/verify`, `/signin`) and portal roots (`/student`, `/lecturer`, `/applicant`, `/sponsor`, `/admin`). Unknown paths
  fall back to the site defaults. It never raises.

## Rules enforced by the controllers

- **News Post**
  - `route` is a unique slug built from the title (`-2`, `-3`, … on clashes); a hand-edited route is slugified.
  - Publishing sets `published_on` to today when empty. Only `published = 1` posts with `published_on ≤ today` are
    public.
  - The content is required.
- **Campus Event**
  - `route` is a unique slug from the title. `start_datetime < end_datetime`. The registration deadline must not be
    after the end. `capacity` and `fee` cannot be negative.
  - `registration_count` (seats held by Registered/Confirmed/Attended registrations) is kept in sync by Event
    Registration.
  - `services.website.update_event_statuses()` (daily cron) moves events through `Upcoming → Ongoing → Completed` by
    their dates. An event with registrations cannot be deleted; cancel it instead.
  - Cancelling an event notifies everyone Registered/Confirmed/Waitlisted ("Event Cancelled").
- **Event Registration**
  - Status machine: `Registered → Confirmed | Attended | Cancelled | Waitlisted`,
    `Confirmed → Attended | Cancelled | Registered`, `Waitlisted → Registered | Confirmed | Cancelled`,
    `Attended → Confirmed`, `Cancelled → Registered`.
  - Registration must be open (not Draft/Cancelled/Completed, and before the deadline). `attendees` is 1–20.
  - One active registration per email per event (`DuplicateEntryError`).
  - Capacity: a new registration that does not fit is saved as **Waitlisted**. Other changes that would exceed the
    capacity are rejected.
  - Signed-in callers are linked (`user`, and `student` when the user is a student). Checking in sets `checked_in_on`.
  - Paid events (`fee > 0`) store `amount`/`payment_status`. The API starts an M-Pesa STK push through
    `services.mpesa.initiate_payment(..., purpose="Event Fee")`.
  - On insert the registrant gets "Event Registration", or "Event Waitlist" when waitlisted.
- **Contact Enquiry**
  - Status machine: `New → In Progress | Responded | Closed`, `In Progress → Responded | Closed | New`,
    `Responded → Closed | In Progress`, `Closed → In Progress`.
  - `Responded` requires a response. `assigned_to` must be an active user, who gets an in-app notification.
  - New enquiries notify Communications Officer users (in-app plus the "Contact Enquiry" template, with a plain
    email fallback).
- **FAQ / Testimonial**: listed by `sequence`, then newest. Testimonial quotes are limited to 600 characters.
- **Campus Website Settings**: links must be `https://…` or a site path starting with `/`. Stats cannot be negative.

## Endpoints

### `site_settings`
- **Path:** `mahanaim.api.website.site_settings`
- **Method:** GET
- **Guard:** guest

Header/footer payload for every public page (contract pinned by the lead).

Args: None.

```json
{
  "message": {
    "institution": {
      "name": "Mahanaim Bible College",
      "short_name": "MBC",
      "motto": "Equipping servants for the harvest",
      "logo": null,
      "currency": "KES"
    },
    "contact": {
      "phone": "0722 410 300",
      "email": "info@mahanaim.ac.ke",
      "address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
      "map_url": "https://maps.google.com/maps?q=Kasarani%20Nairobi&output=embed",
      "office_hours": "Mon–Fri 8:00am – 5:00pm\nSat 9:00am – 1:00pm",
      "whatsapp": "254722410300"
    },
    "social": {
      "facebook": "https://facebook.com/mahanaimbiblecollege",
      "youtube": "https://youtube.com/@mahanaimbiblecollege",
      "instagram": "https://instagram.com/mahanaimbiblecollege",
      "x": "https://x.com/mahanaimbc",
      "whatsapp": "https://wa.me/254722410300"
    },
    "nav": [
      {
        "label": "About",
        "to": "/about",
        "children": [{"to": "/about", "label": "Our story", "desc": "History, vision, mission and statement of faith"}]
      },
      {
        "label": "Academics",
        "to": "/academics",
        "children": [{"to": "/programmes", "label": "Programmes", "desc": "Certificate, diploma and degree pathways"}]
      }
    ],
    "footer_links": [
      {"title": "Study", "links": [{"label": "Programmes", "to": "/programmes"}]},
      {"title": "College", "links": [{"label": "About us", "to": "/about"}]}
    ],
    "footer_text": "Equipping servants for the Kingdom since 1999.",
    "announcement_bar": {"text": "Applications for the January intake are open — apply online today.", "link": "/apply"},
    "meta_description": "Mahanaim Bible College — diploma and certificate programmes in Biblical Studies, Pastor…",
    "cta": {"label": "Apply for the next intake", "to": "/apply"}
  }
}
```

### `home`
- **Path:** `mahanaim.api.website.home`
- **Method:** GET
- **Guard:** guest

Args: None.

```json
{
  "message": {
    "hero": {
      "eyebrow": "Raising servant leaders since 1998",
      "title": "Equipping men and women for faithful Christian ministry",
      "subtitle": "Accredited theological training rooted in Scripture, shaped by prayer and practised in …",
      "image": null,
      "video_url": null,
      "cta_label": "Apply for the next intake",
      "cta_link": "/apply"
    },
    "stats": [
      {"key": "students", "label": "Students trained", "value": 1200},
      {"key": "graduates", "label": "Graduates in ministry", "value": 4800}
    ],
    "about": {
      "summary": "Mahanaim Bible College trains pastors, evangelists, missionaries and lay leaders for th…",
      "mission": "To equip Christian workers with sound biblical knowledge, godly character and practical…",
      "vision": "A Spirit-filled, biblically grounded generation of leaders transforming communities for…",
      "values": ["Scripture", "Prayer"]
    },
    "programmes": [
      {
        "code": "BTH",
        "name": "Bachelor of Theology",
        "level": "Bachelor",
        "duration_years": 4.0,
        "duration": "4 years",
        "terms_per_year": 3,
        "study_modes": ["Full Time"],
        "campuses": ["Nairobi Main Campus"],
        "short_description": "Bachelor of Theology: rigorous biblical training for pastoral ministry and Christian le…",
        "image": null,
        "award_title": "Bachelor of Theology",
        "application_fee": 1500.0,
        "indicative_fee_per_term": 28000.0,
        "department": null,
        "minimum_entry": "KCSE C+ (plus) or a diploma in theology",
        "route": "/programmes/BTH"
      },
      {
        "code": "CBS",
        "name": "Certificate in Biblical Studies",
        "level": "Certificate",
        "duration_years": 1.0,
        "duration": "1 year",
        "terms_per_year": 3,
        "study_modes": ["Full Time"],
        "campuses": ["Nairobi Main Campus"],
        "short_description": "Certificate in Biblical Studies: rigorous biblical training for pastoral ministry and C…",
        "image": null,
        "award_title": "Certificate in Biblical Studies",
        "application_fee": 500.0,
        "indicative_fee_per_term": 15000.0,
        "department": null,
        "minimum_entry": "KCSE D+ or equivalent",
        "route": "/programmes/CBS"
      }
    ],
    "news": [
      {
        "name": "NEWS-00001",
        "title": "September Intake Welcomes 140 New Students",
        "route": "september-intake-welcomes-140-new-students",
        "url": "/news/september-intake-welcomes-140-new-students",
        "category": "News",
        "author": "Communications Office",
        "published_on": "2026-09-07",
        "cover_image": null,
        "excerpt": "Our largest intake yet joins Main Campus and the Nakuru Extension for the new academic …",
        "is_featured": 1,
        "tags": ["intake"]
      },
      {
        "name": "NEWS-00005",
        "title": "Applications Open for the January Intake",
        "route": "applications-open-for-the-january-intake",
        "url": "/news/applications-open-for-the-january-intake",
        "category": "Announcement",
        "author": "Admissions Office",
        "published_on": "2026-10-19",
        "cover_image": null,
        "excerpt": "Apply online for diploma and certificate programmes starting in January. Early applican…",
        "is_featured": 0,
        "tags": ["admissions"]
      }
    ],
    "events": [
      {
        "name": "EVT-2026-00001",
        "title": "Open Day",
        "route": "open-day",
        "url": "/events/open-day",
        "event_type": "Open Day",
        "status": "Upcoming",
        "start_datetime": "2026-11-09 09:00:00",
        "end_datetime": "2026-11-09 15:00:00",
        "venue": "Main Campus Chapel",
        "campus": "Main Campus Nairobi",
        "cover_image": null,
        "summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
        "organiser": "Admissions Office",
        "livestream_url": null,
        "registration_required": 1,
        "fee": 0.0,
        "capacity": 200,
        "seats_left": 188
      },
      {
        "name": "EVT-2026-00002",
        "title": "Pastors' & Church Leaders' Conference",
        "route": "pastors-and-church-leaders-conference",
        "url": "/events/pastors-and-church-leaders-conference",
        "event_type": "Conference",
        "status": "Upcoming",
        "start_datetime": "2026-12-01 09:00:00",
        "end_datetime": "2026-12-02 15:00:00",
        "venue": "Main Campus Auditorium",
        "campus": "Main Campus Nairobi",
        "cover_image": null,
        "summary": "Two days of teaching and fellowship on the theme 'Shepherds after God's Heart'.",
        "organiser": "Office of the Principal",
        "livestream_url": null,
        "registration_required": 1,
        "fee": 1500.0,
        "capacity": 300,
        "seats_left": 294
      }
    ],
    "testimonials": [
      {
        "name": "c9thfce6bg",
        "person_name": "Rev. John Maina",
        "role_title": "Senior Pastor, Harvest Fellowship Thika",
        "programme": "DBS",
        "programme_name": "Diploma in Biblical Studies",
        "photo": null,
        "quote": "Mahanaim gave me more than knowledge — it shaped my character and my love for God's Wor…"
      },
      {
        "name": "c9tq960kef",
        "person_name": "Martha Adhiambo",
        "role_title": "School Chaplain",
        "programme": "DPM",
        "programme_name": "Diploma in Pastoral Ministry",
        "photo": null,
        "quote": "The pastoral care and counselling training prepared me to walk with students through gr…"
      }
    ],
    "principal": {
      "name": "Rt. Rev. Stephen Mutua",
      "title": "Principal",
      "photo": null,
      "excerpt": "Welcome to Mahanaim Bible College. Our name recalls the place where Jacob discovered th…"
    },
    "admissions": {
      "intro": "We admit students in January, May and September. Applications are completed online and …",
      "steps": ["Create an account and verify your email", "Choose a programme, campus and study mode"],
      "intakes": [
        {
          "name": "January 2027",
          "academic_year": "2026-2027",
          "start_date": "2027-01-05",
          "application_close_date": "2026-12-29"
        },
        {
          "name": "January 2027 Intake",
          "academic_year": null,
          "start_date": "2027-01-11",
          "application_close_date": "2026-12-15"
        }
      ]
    }
  }
}
```

### `about`
- **Path:** `mahanaim.api.website.about`
- **Method:** GET
- **Guard:** guest

Args: None.

```json
{
  "message": {
    "summary": "Mahanaim Bible College trains pastors, evangelists, missionaries and lay leaders for th…",
    "mission": "To equip Christian workers with sound biblical knowledge, godly character and practical…",
    "vision": "A Spirit-filled, biblically grounded generation of leaders transforming communities for…",
    "values": ["Scripture", "Prayer"],
    "body": "<p>Mahanaim Bible College is a Christ-centred training institution that has equipped pa…",
    "statement_of_faith": "<ul><li>We believe the Bible is the inspired, infallible and authoritative Word of God.…",
    "history": "<p>The college began in 1999 as an evening Bible school in a church hall in Kasarani wi…",
    "principal": {
      "name": "Rt. Rev. Stephen Mutua",
      "title": "Principal",
      "photo": null,
      "message": "<p>Welcome to Mahanaim Bible College. Our name recalls the place where Jacob discovered…"
    },
    "leadership": [
      {
        "name": "STF-00006",
        "full_name": "Rt. Rev. Stephen Mutua",
        "designation": "Principal",
        "photo": null,
        "department": "Theology",
        "specialisation": "Pastoral Theology",
        "qualifications": ["DMin, MDiv"],
        "bio": "<p>Bishop Mutua has served as Principal since 2019.</p>",
        "is_lecturer": 0
      },
      {
        "name": "STF-00008",
        "full_name": "Rev. Miriam Njoroge",
        "designation": "Academic Dean",
        "photo": null,
        "department": "Theology",
        "specialisation": "Systematic Theology",
        "qualifications": ["DTh (Systematic Theology), MA (Theology)"],
        "bio": "<p>Rev. Njoroge leads the academic team and teaches Systematic Theology.</p>",
        "is_lecturer": 1
      }
    ],
    "campuses": [
      {
        "name": "Main Campus Nairobi",
        "code": "MNC",
        "is_main_campus": 1,
        "town": "Kasarani",
        "county": "Nairobi",
        "address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
        "phone": "254722410300",
        "email": "info@mahanaim.ac.ke",
        "map_url": "https://maps.google.com/?q=Kasarani+Nairobi",
        "image": null
      },
      {
        "name": "Nairobi Main Campus",
        "code": "NRB",
        "is_main_campus": 1,
        "town": "Nairobi",
        "county": "Nairobi",
        "address": null,
        "phone": "254700100200",
        "email": "info@mahanaim.ac.ke",
        "map_url": null,
        "image": null
      }
    ],
    "stats": {"students": 1200, "graduates": 4800, "churches": 350, "years": 27}
  }
}
```

### `faculty`
- **Path:** `mahanaim.api.website.faculty`
- **Method:** GET
- **Guard:** guest

Faculty & leadership page: everyone flagged show_on_website, grouped by department.

Args: None.

```json
{
  "message": {
    "data": [
      {
        "name": "STF-00006",
        "full_name": "Rt. Rev. Stephen Mutua",
        "designation": "Principal",
        "photo": null,
        "department": "Theology",
        "specialisation": "Pastoral Theology",
        "qualifications": ["DMin, MDiv"],
        "bio": "<p>Bishop Mutua has served as Principal since 2019.</p>",
        "is_lecturer": 0
      },
      {
        "name": "STF-00008",
        "full_name": "Rev. Miriam Njoroge",
        "designation": "Academic Dean",
        "photo": null,
        "department": "Theology",
        "specialisation": "Systematic Theology",
        "qualifications": ["DTh (Systematic Theology), MA (Theology)"],
        "bio": "<p>Rev. Njoroge leads the academic team and teaches Systematic Theology.</p>",
        "is_lecturer": 1
      }
    ],
    "departments": ["Biblical Studies", "Leadership"]
  }
}
```

### `programmes`
- **Path:** `mahanaim.api.website.programmes`
- **Method:** GET
- **Guard:** guest

Args: `level` (default `None`), `search` (default `None`), `study_mode` (default `None`), `campus` (default `None`).

Example args: `{"level": "Diploma"}`

```json
{
  "message": {
    "data": [
      {
        "code": "DBS",
        "name": "Diploma in Biblical Studies",
        "level": "Diploma",
        "duration_years": 2.0,
        "duration": "2 years",
        "terms_per_year": 3,
        "study_modes": ["Full Time"],
        "campuses": ["Main Campus Nairobi"],
        "short_description": "A grounded programme in scripture, theology, ministry leadership and Christian formation.",
        "image": null,
        "award_title": "Diploma in Biblical Studies",
        "application_fee": 1000.0,
        "indicative_fee_per_term": 42000.0,
        "department": "Biblical Studies",
        "minimum_entry": "KCSE C- (minus) or equivalent",
        "route": "/programmes/DBS"
      },
      {
        "code": "DPM",
        "name": "Diploma in Pastoral Ministry",
        "level": "Diploma",
        "duration_years": 2.0,
        "duration": "2 years",
        "terms_per_year": 3,
        "study_modes": ["Full Time"],
        "campuses": ["Main Campus Nairobi"],
        "short_description": "Practical pastoral formation covering preaching, counselling, church leadership and mis…",
        "image": null,
        "award_title": "Diploma in Pastoral Ministry",
        "application_fee": 1000.0,
        "indicative_fee_per_term": 45000.0,
        "department": "Pastoral Ministry",
        "minimum_entry": "KCSE C- (minus) or equivalent",
        "route": "/programmes/DPM"
      }
    ],
    "total": 4,
    "facets": {
      "levels": ["Bachelor", "Certificate"],
      "study_modes": ["Distance (Online)", "Evening"],
      "campuses": ["Main Campus Nairobi", "Nairobi Main Campus"]
    }
  }
}
```

### `programme`
- **Path:** `mahanaim.api.website.programme`
- **Method:** GET
- **Guard:** guest

Args: `code` (required).

Example args: `{"code": "DBS"}`

```json
{
  "message": {
    "code": "DBS",
    "name": "Diploma in Biblical Studies",
    "level": "Diploma",
    "duration_years": 2.0,
    "duration": "2 years",
    "terms_per_year": 3,
    "study_modes": ["Full Time", "Distance (Online)"],
    "campuses": ["Main Campus Nairobi", "Nakuru Campus"],
    "short_description": "A grounded programme in scripture, theology, ministry leadership and Christian formation.",
    "image": null,
    "award_title": "Diploma in Biblical Studies",
    "application_fee": 1000.0,
    "indicative_fee_per_term": 42000.0,
    "department": "Biblical Studies",
    "minimum_entry": "KCSE C- (minus) or equivalent",
    "route": "/programmes/DBS",
    "overview": "A grounded programme in scripture, theology, ministry leadership and Christian formation.",
    "description": "<p>The Diploma in Biblical Studies equips men and women with a deep, practical knowledg…",
    "entry_requirements": "<ul><li>KCSE mean grade of C- (minus) or a relevant certificate</li><li>A letter of rec…",
    "career_paths": "<ul><li>Pastor or associate pastor</li><li>Bible teacher and Christian education worker…",
    "total_credits": 28.0,
    "min_cgpa_to_graduate": 2.0,
    "curriculum": [
      {
        "year": 1,
        "term": 1,
        "label": "Year 1, Term 1",
        "credits": 7.0,
        "courses": [{"course_code": "BIB101", "title": "Old Testament Survey", "credits": 3.0, "type": "Core"}]
      },
      {
        "year": 1,
        "term": 2,
        "label": "Year 1, Term 2",
        "credits": 12.0,
        "courses": [
          {
            "course_code": "BIB112",
            "title": "Hermeneutics & Biblical Interpretation",
            "credits": 3.0,
            "type": "Core"
          }
        ]
      }
    ],
    "campus_details": [
      {
        "name": "Main Campus Nairobi",
        "code": "MNC",
        "is_main_campus": 1,
        "town": "Kasarani",
        "county": "Nairobi",
        "address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
        "phone": "254722410300",
        "email": "info@mahanaim.ac.ke",
        "map_url": "https://maps.google.com/?q=Kasarani+Nairobi",
        "image": null
      },
      {
        "name": "Nakuru Campus",
        "code": "NKR",
        "is_main_campus": 0,
        "town": "Nakuru",
        "county": "Nakuru",
        "address": null,
        "phone": null,
        "email": null,
        "map_url": null,
        "image": null
      }
    ],
    "fees": {
      "indicative_per_term": 42000.0,
      "currency": "KES",
      "structures": [
        {
          "title": "DBS Standard Fees",
          "campus": null,
          "study_mode": null,
          "academic_term": null,
          "year_of_study": null,
          "total": 49000.0,
          "items": [{"component": "Tuition", "description": "Tuition", "amount": 42000.0}]
        }
      ]
    },
    "intakes": [
      {
        "name": "January 2027",
        "academic_year": "2026-2027",
        "start_date": "2027-01-05",
        "application_close_date": "2026-12-29"
      },
      {
        "name": "January 2027 Intake",
        "academic_year": null,
        "start_date": "2027-01-11",
        "application_close_date": "2026-12-15"
      }
    ],
    "apply_link": "/apply?programme=DBS"
  }
}
```

### `news`
- **Path:** `mahanaim.api.website.news`
- **Method:** GET
- **Guard:** guest

Args: `page` (default `1`), `page_length` (default `9`), `category` (default `None`).

Example args: `{"page_length": 3}`

```json
{
  "message": {
    "data": [
      {
        "name": "NEWS-00005",
        "title": "Applications Open for the January Intake",
        "route": "applications-open-for-the-january-intake",
        "url": "/news/applications-open-for-the-january-intake",
        "category": "Announcement",
        "author": "Admissions Office",
        "published_on": "2026-10-19",
        "cover_image": null,
        "excerpt": "Apply online for diploma and certificate programmes starting in January. Early applican…",
        "is_featured": 0,
        "tags": ["admissions"]
      },
      {
        "name": "NEWS-00004",
        "title": "Strength for the Journey (Genesis 32:1–2)",
        "route": "strength-for-the-journey-genesis-32-1-2",
        "url": "/news/strength-for-the-journey-genesis-32-1-2",
        "category": "Devotional",
        "author": "Rt. Rev. Stephen Mutua",
        "published_on": "2026-10-16",
        "cover_image": null,
        "excerpt": "When Jacob met the angels of God he called the place Mahanaim — God's camp beside his own.",
        "is_featured": 0,
        "tags": ["devotional"]
      }
    ],
    "total": 5,
    "page": 1,
    "pages": 2,
    "categories": [{"category": "Announcement", "count": 1}, {"category": "Campus Life", "count": 1}]
  }
}
```

### `news_post`
- **Path:** `mahanaim.api.website.news_post`
- **Method:** GET
- **Guard:** guest

Args: `route` (required).

Example args: `{"route": "applications-open-for-the-january-intake"}`

```json
{
  "message": {
    "name": "NEWS-00005",
    "title": "Applications Open for the January Intake",
    "route": "applications-open-for-the-january-intake",
    "url": "/news/applications-open-for-the-january-intake",
    "category": "Announcement",
    "author": "Admissions Office",
    "published_on": "2026-10-19",
    "cover_image": null,
    "excerpt": "Apply online for diploma and certificate programmes starting in January. Early applican…",
    "is_featured": 0,
    "tags": ["admissions"],
    "content": "<p>Applications are now open for the January intake. Create an account, complete the on…",
    "meta_description": "Apply online for diploma and certificate programmes starting in January. Early applican…",
    "views": 240,
    "related": [
      {
        "name": "NEWS-00004",
        "title": "Strength for the Journey (Genesis 32:1–2)",
        "route": "strength-for-the-journey-genesis-32-1-2",
        "url": "/news/strength-for-the-journey-genesis-32-1-2",
        "category": "Devotional",
        "author": "Rt. Rev. Stephen Mutua",
        "published_on": "2026-10-16",
        "cover_image": null,
        "excerpt": "When Jacob met the angels of God he called the place Mahanaim — God's camp beside his own.",
        "is_featured": 0,
        "tags": ["devotional"]
      },
      {
        "name": "NEWS-00003",
        "title": "Nakuru Extension Opens New Library Wing",
        "route": "nakuru-extension-opens-new-library-wing",
        "url": "/news/nakuru-extension-opens-new-library-wing",
        "category": "Campus Life",
        "author": "Library Services",
        "published_on": "2026-10-10",
        "cover_image": null,
        "excerpt": "Students in Nakuru now have a quiet study area, 1,200 new titles and full e-library acc…",
        "is_featured": 0,
        "tags": ["library"]
      }
    ]
  }
}
```

### `events`
- **Path:** `mahanaim.api.website.events`
- **Method:** GET
- **Guard:** guest

Args: `scope` (default `'upcoming'`), `page` (default `1`), `page_length` (default `9`).

```json
{
  "message": {
    "data": [
      {
        "name": "EVT-2026-00001",
        "title": "Open Day",
        "route": "open-day",
        "url": "/events/open-day",
        "event_type": "Open Day",
        "status": "Upcoming",
        "start_datetime": "2026-11-09 09:00:00",
        "end_datetime": "2026-11-09 15:00:00",
        "venue": "Main Campus Chapel",
        "campus": "Main Campus Nairobi",
        "cover_image": null,
        "summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
        "organiser": "Admissions Office",
        "livestream_url": null,
        "registration_required": 1,
        "fee": 0.0,
        "capacity": 200,
        "seats_left": 188
      },
      {
        "name": "EVT-2026-00002",
        "title": "Pastors' & Church Leaders' Conference",
        "route": "pastors-and-church-leaders-conference",
        "url": "/events/pastors-and-church-leaders-conference",
        "event_type": "Conference",
        "status": "Upcoming",
        "start_datetime": "2026-12-01 09:00:00",
        "end_datetime": "2026-12-02 15:00:00",
        "venue": "Main Campus Auditorium",
        "campus": "Main Campus Nairobi",
        "cover_image": null,
        "summary": "Two days of teaching and fellowship on the theme 'Shepherds after God's Heart'.",
        "organiser": "Office of the Principal",
        "livestream_url": null,
        "registration_required": 1,
        "fee": 1500.0,
        "capacity": 300,
        "seats_left": 294
      }
    ],
    "total": 2,
    "page": 1,
    "pages": 1,
    "scope": "upcoming"
  }
}
```

### `event`
- **Path:** `mahanaim.api.website.event`
- **Method:** GET
- **Guard:** guest

Args: `route` (required).

Example args: `{"route": "open-day"}`

```json
{
  "message": {
    "name": "EVT-2026-00001",
    "title": "Open Day",
    "route": "open-day",
    "url": "/events/open-day",
    "event_type": "Open Day",
    "status": "Upcoming",
    "start_datetime": "2026-11-09 09:00:00",
    "end_datetime": "2026-11-09 15:00:00",
    "venue": "Main Campus Chapel",
    "campus": "Main Campus Nairobi",
    "cover_image": null,
    "summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
    "organiser": "Admissions Office",
    "livestream_url": null,
    "registration_required": 1,
    "fee": 0.0,
    "capacity": 200,
    "seats_left": 188,
    "description": "<p>Join us for a morning of worship, campus tours, sample lectures and one-on-one admis…",
    "notices": [],
    "partner_church": null,
    "registration": {
      "required": true,
      "open": true,
      "reason": null,
      "capacity": 200,
      "registered": 12,
      "seats_left": 188,
      "deadline": "2026-11-08 09:00:00",
      "fee": 0.0,
      "is_paid": false,
      "waitlist": false,
      "my_registration": null
    }
  }
}
```

### `register_for_event`
- **Path:** `mahanaim.api.website.register_for_event`
- **Method:** POST
- **Guard:** guest · rate-limited

Public RSVP. Returns a reference; paid events also return an M-Pesa payment step.

Args: `event` (required), `full_name` (default `None`), `email` (default `None`), `phone` (default `None`), `attendees` (default `1`), `church` (default `None`), `answers` (default `None`), `website` (default `None`).

Example args: `{"event": "EVT-2026-00001", "full_name": "Ruth Doc", "email": "ruth.doc@example.com", "phone": "0712345678", "attendees": 2, "church": "PCEA Kahawa"}`

```json
{
  "message": {
    "ok": true,
    "reference": "RSVP-2026-000017",
    "status": "Registered",
    "waitlisted": false,
    "payment": null,
    "message": "You're registered! A confirmation has been sent to you."
  }
}
```

### `pay_event_fee`
- **Path:** `mahanaim.api.website.pay_event_fee`
- **Method:** POST
- **Guard:** guest · rate-limited

Retry the M-Pesa prompt for a pending paid registration (the email must match the registration).

Args: `registration` (required), `email` (default `None`), `phone` (default `None`).

Example args: `{"registration": "RSVP-2026-000004", "email": "rev.simon@example.com", "phone": "0712345678"}`

```json
{"message": {"required": true, "amount": 1500.0, "currency": "KES", "registration": "RSVP-2026-000004",
  "request": "STK-2026-000031", "customer_message": "Success. Request accepted for processing", "error": null}}
```

### `faqs`
- **Path:** `mahanaim.api.website.faqs`
- **Method:** GET
- **Guard:** guest

Args: `category` (default `None`).

Example args: `{"category": "Admissions"}`

```json
{
  "message": {
    "data": [
      {
        "name": "bt4ag48kt4",
        "question": "How do I apply?",
        "answer": "<p>Click <strong>Apply</strong>, create an account with your email or phone number, com…",
        "category": "Admissions"
      }
    ],
    "categories": ["Admissions"]
  }
}
```

### `testimonials`
- **Path:** `mahanaim.api.website.testimonials`
- **Method:** GET
- **Guard:** guest

Args: None.

```json
{
  "message": {
    "data": [
      {
        "name": "c9thfce6bg",
        "person_name": "Rev. John Maina",
        "role_title": "Senior Pastor, Harvest Fellowship Thika",
        "programme": "DBS",
        "programme_name": "Diploma in Biblical Studies",
        "photo": null,
        "quote": "Mahanaim gave me more than knowledge — it shaped my character and my love for God's Wor…"
      },
      {
        "name": "c9tq960kef",
        "person_name": "Martha Adhiambo",
        "role_title": "School Chaplain",
        "programme": "DPM",
        "programme_name": "Diploma in Pastoral Ministry",
        "photo": null,
        "quote": "The pastoral care and counselling training prepared me to walk with students through gr…"
      }
    ]
  }
}
```

### `submit_enquiry`
- **Path:** `mahanaim.api.website.submit_enquiry`
- **Method:** POST
- **Guard:** guest · rate-limited

Public contact form. `enquiry_type` maps to the Select; a free-text `subject` is kept in the message.

Args: `full_name` (default `None`), `email` (default `None`), `phone` (default `None`), `subject` (default `None`), `message` (default `None`), `enquiry_type` (default `'General'`), `website` (default `None`).

Example args: `{"full_name": "Ruth Doc", "email": "ruth.doc@example.com", "phone": "0712345678", "subject": "Admissions", "message": "When does the January intake close?"}`

```json
{
  "message": {
    "ok": true,
    "reference": "ENQ-2026-00004",
    "message": "Thank you, Ruth. We have received your message and will respond within two working days."
  }
}
```

### `apply_lookups`
- **Path:** `mahanaim.api.website.apply_lookups`
- **Method:** GET
- **Guard:** guest

Everything the public application form needs in one call.

Args: None.

```json
{
  "message": {
    "programmes": [
      {
        "code": "BTH",
        "name": "Bachelor of Theology",
        "level": "Bachelor",
        "duration": "4 years",
        "campuses": ["Nairobi Main Campus"],
        "study_modes": ["Full Time"],
        "application_fee": 1500.0,
        "minimum_entry": "KCSE C+ (plus) or a diploma in theology",
        "award_title": "Bachelor of Theology"
      },
      {
        "code": "CBS",
        "name": "Certificate in Biblical Studies",
        "level": "Certificate",
        "duration": "1 year",
        "campuses": ["Nairobi Main Campus"],
        "study_modes": ["Full Time"],
        "application_fee": 500.0,
        "minimum_entry": "KCSE D+ or equivalent",
        "award_title": "Certificate in Biblical Studies"
      }
    ],
    "campuses": [
      {
        "name": "Main Campus Nairobi",
        "code": "MNC",
        "town": "Kasarani",
        "county": "Nairobi",
        "is_main_campus": 1
      },
      {
        "name": "Nairobi Main Campus",
        "code": "NRB",
        "town": "Nairobi",
        "county": "Nairobi",
        "is_main_campus": 1
      }
    ],
    "study_modes": [
      {
        "name": "Distance (Online)",
        "code": "OL",
        "is_online": 1,
        "description": "Fully online through the Digital Campus LMS."
      },
      {"name": "Evening", "code": "EV", "is_online": 0, "description": "Weekday evening classes."}
    ],
    "intakes": [
      {
        "name": "January 2027",
        "academic_year": "2026-2027",
        "start_date": "2027-01-05",
        "application_close_date": "2026-12-29"
      },
      {
        "name": "January 2027 Intake",
        "academic_year": null,
        "start_date": "2027-01-11",
        "application_close_date": "2026-12-15"
      }
    ],
    "partner_churches": [
      {
        "name": "Grace Chapel Kitengela",
        "church_name": "Grace Chapel Kitengela",
        "denomination": "Independent",
        "town": "Kitengela"
      },
      {
        "name": "Harvest Fellowship Kasarani",
        "church_name": "Harvest Fellowship Kasarani",
        "denomination": "Harvest Fellowship Churches",
        "town": "Kasarani"
      }
    ],
    "application_fee": 1000.0,
    "application_fee_required": 1,
    "currency": "KES",
    "sponsorship_types": ["Self", "Church"]
  }
}
```

### `search`
- **Path:** `mahanaim.api.website.search`
- **Method:** GET
- **Guard:** guest

Args: `q` (default `None`).

Example args: `{"q": "theology"}`

```json
{
  "message": {
    "query": "theology",
    "results": [
      {
        "type": "Programme",
        "title": "Diploma in Biblical Studies",
        "subtitle": "Diploma",
        "excerpt": "A grounded programme in scripture, theology, ministry leadership and Christian formation.",
        "route": "/programmes/DBS"
      },
      {
        "type": "Programme",
        "title": "Certificate in Theology",
        "subtitle": "Certificate",
        "excerpt": "An accessible foundation in biblical interpretation, doctrine and spiritual disciplines.",
        "route": "/programmes/CTH"
      }
    ],
    "total": 6
  }
}
```

### `cms_overview`
- **Path:** `mahanaim.api.website.cms_overview`
- **Method:** GET
- **Guard:** roles: Communications Officer, Chaplain, Admissions Officer

Args: None.

```json
{
  "message": {
    "counts": {
      "news_published": 5,
      "news_drafts": 1,
      "news_scheduled": 0,
      "events_upcoming": 2,
      "events_draft": 0,
      "registrations_upcoming": 18,
      "faqs": 6,
      "testimonials": 4,
      "enquiries": {"Responded": 1, "In Progress": 1, "New": 1},
      "enquiries_open": 2
    },
    "recent_enquiries": [
      {
        "name": "ENQ-2026-00003",
        "full_name": "Pastor Daniel Kipkemboi",
        "email": "pastor.kipkemboi@example.com",
        "subject": "General",
        "status": "Responded",
        "assigned_to": "comms@mahanaim.demo",
        "creation": "2026-10-22 00:00:27.702970"
      },
      {
        "name": "ENQ-2026-00002",
        "full_name": "Rose Atieno",
        "email": "rose.atieno@example.com",
        "subject": "Partnership",
        "status": "In Progress",
        "assigned_to": "comms@mahanaim.demo",
        "creation": "2026-10-22 00:00:27.699131"
      }
    ],
    "upcoming_events": [
      {
        "name": "EVT-2026-00001",
        "title": "Open Day",
        "route": "open-day",
        "start_datetime": "2026-11-09 09:00:00",
        "capacity": 200,
        "registered_count": 12,
        "registration_required": 1,
        "status": "Upcoming",
        "seats_left": 188
      },
      {
        "name": "EVT-2026-00002",
        "title": "Pastors' & Church Leaders' Conference",
        "route": "pastors-and-church-leaders-conference",
        "start_datetime": "2026-12-01 09:00:00",
        "capacity": 300,
        "registered_count": 6,
        "registration_required": 1,
        "status": "Upcoming",
        "seats_left": 294
      }
    ]
  }
}
```

### `list_news`
- **Path:** `mahanaim.api.website.list_news`
- **Method:** GET
- **Guard:** roles: Communications Officer

Args: `status` (default `None`), `category` (default `None`), `search` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "NEWS-00006",
        "title": "Graduation Day: Save the Date",
        "route": "graduation-day-save-the-date",
        "category": "Announcement",
        "author": "Registrar's Office",
        "published_on": null,
        "cover_image": null,
        "excerpt": "Details of the next graduation ceremony.",
        "is_featured": 0,
        "tags": "graduation",
        "views": 0,
        "published": 0,
        "modified": "2026-10-22 00:00:27.304455",
        "state": "Draft"
      },
      {
        "name": "NEWS-00005",
        "title": "Applications Open for the January Intake",
        "route": "applications-open-for-the-january-intake",
        "category": "Announcement",
        "author": "Admissions Office",
        "published_on": "2026-10-19",
        "cover_image": null,
        "excerpt": "Apply online for diploma and certificate programmes starting in January. Early applican…",
        "is_featured": 0,
        "tags": "admissions",
        "views": 239,
        "published": 1,
        "modified": "2026-10-22 00:00:27.302061",
        "state": "Published"
      }
    ],
    "total": 6
  }
}
```

### `get_news`
- **Path:** `mahanaim.api.website.get_news`
- **Method:** GET
- **Guard:** roles: Communications Officer

Args: `name` (required).

Example args: `{"name": "NEWS-00005"}`

```json
{
  "message": {
    "name": "NEWS-00005",
    "title": "Applications Open for the January Intake",
    "route": "applications-open-for-the-january-intake",
    "category": "Announcement",
    "author": "Admissions Office",
    "published": 1,
    "published_on": "2026-10-19",
    "is_featured": 0,
    "cover_image": null,
    "excerpt": "Apply online for diploma and certificate programmes starting in January. Early applican…",
    "content": "<p>Applications are now open for the January intake. Create an account, complete the on…",
    "tags": "admissions",
    "meta_description": "Apply online for diploma and certificate programmes starting in January. Early applican…",
    "views": 239,
    "modified": "2026-10-22 00:00:27.302061",
    "state": "Published"
  }
}
```

### `save_news`
- **Path:** `mahanaim.api.website.save_news`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `data` (required).

Example args: `{"data": {"title": "Library extends evening hours", "category": "Campus Life", "excerpt": "Open until 9pm.", "content": "<p>From Monday…</p>", "published": 0}}`

```json
{
  "message": {
    "name": "NEWS-00007",
    "title": "Library extends evening hours",
    "route": "library-extends-evening-hours",
    "category": "Campus Life",
    "author": "Brian Otieno",
    "published": 0,
    "published_on": null,
    "is_featured": 0,
    "cover_image": null,
    "excerpt": "Open until 9pm.",
    "content": "<p>From Monday…</p>",
    "tags": null,
    "meta_description": "Open until 9pm.",
    "views": 0,
    "modified": "2026-10-22 00:09:11.860812",
    "state": "Draft"
  }
}
```

### `publish_news`
- **Path:** `mahanaim.api.website.publish_news`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `name` (required), `publish` (default `1`), `published_on` (default `None`).

Example args: `{"name": "NEWS-00005", "publish": 1}`

```json
{
  "message": {
    "name": "NEWS-00005",
    "title": "Applications Open for the January Intake",
    "route": "applications-open-for-the-january-intake",
    "category": "Announcement",
    "author": "Admissions Office",
    "published": 1,
    "published_on": "2026-10-19",
    "is_featured": 0,
    "cover_image": null,
    "excerpt": "Apply online for diploma and certificate programmes starting in January. Early applican…",
    "content": "<p>Applications are now open for the January intake. Create an account, complete the on…",
    "tags": "admissions",
    "meta_description": "Apply online for diploma and certificate programmes starting in January. Early applican…",
    "views": 239,
    "modified": "2026-10-22 00:09:11.868500",
    "state": "Published"
  }
}
```

### `delete_news`
- **Path:** `mahanaim.api.website.delete_news`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `name` (required).

Example args: `{"name": "NEWS-00006"}`

```json
{"message": {"ok": true, "name": "NEWS-00006"}}
```

### `list_events`
- **Path:** `mahanaim.api.website.list_events`
- **Method:** GET
- **Guard:** roles: Communications Officer, Chaplain

Args: `status` (default `None`), `scope` (default `None`), `search` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "EVT-2026-00002",
        "title": "Pastors' & Church Leaders' Conference",
        "route": "pastors-and-church-leaders-conference",
        "event_type": "Conference",
        "status": "Upcoming",
        "start_datetime": "2026-12-01 09:00:00",
        "end_datetime": "2026-12-02 15:00:00",
        "venue": "Main Campus Auditorium",
        "campus": "Main Campus Nairobi",
        "cover_image": null,
        "summary": "Two days of teaching and fellowship on the theme 'Shepherds after God's Heart'.",
        "registration_required": 1,
        "capacity": 300,
        "registration_deadline": "2026-11-30 09:00:00",
        "fee": 1500.0,
        "registered_count": 6,
        "livestream_url": null,
        "organiser": "Office of the Principal",
        "partner_church": null,
        "is_public": 1,
        "attended_count": 0,
        "seats_left": 294
      },
      {
        "name": "EVT-2026-00001",
        "title": "Open Day",
        "route": "open-day",
        "event_type": "Open Day",
        "status": "Upcoming",
        "start_datetime": "2026-11-09 09:00:00",
        "end_datetime": "2026-11-09 15:00:00",
        "venue": "Main Campus Chapel",
        "campus": "Main Campus Nairobi",
        "cover_image": null,
        "summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
        "registration_required": 1,
        "capacity": 200,
        "registration_deadline": "2026-11-08 09:00:00",
        "fee": 0.0,
        "registered_count": 12,
        "livestream_url": null,
        "organiser": "Admissions Office",
        "partner_church": null,
        "is_public": 1,
        "attended_count": 0,
        "seats_left": 188
      }
    ],
    "total": 4
  }
}
```

### `get_event`
- **Path:** `mahanaim.api.website.get_event`
- **Method:** GET
- **Guard:** roles: Communications Officer, Chaplain

Args: `name` (required).

Example args: `{"name": "EVT-2026-00001"}`

```json
{
  "message": {
    "name": "EVT-2026-00001",
    "title": "Open Day",
    "route": "open-day",
    "event_type": "Open Day",
    "status": "Upcoming",
    "start_datetime": "2026-11-09 09:00:00",
    "end_datetime": "2026-11-09 15:00:00",
    "venue": "Main Campus Chapel",
    "campus": "Main Campus Nairobi",
    "is_public": 1,
    "partner_church": null,
    "organiser": "Admissions Office",
    "cover_image": null,
    "livestream_url": null,
    "summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
    "description": "<p>Join us for a morning of worship, campus tours, sample lectures and one-on-one admis…",
    "notices": null,
    "registration_required": 1,
    "capacity": 200,
    "registration_deadline": "2026-11-08 09:00:00",
    "fee": 0.0,
    "registered_count": 12,
    "attended_count": 0,
    "modified": "2026-10-22 00:00:27.308007",
    "registration": {
      "required": true,
      "open": true,
      "reason": null,
      "capacity": 200,
      "registered": 12,
      "seats_left": 188,
      "deadline": "2026-11-08 09:00:00",
      "fee": 0.0,
      "is_paid": false,
      "waitlist": false,
      "my_registration": null
    }
  }
}
```

### `save_event`
- **Path:** `mahanaim.api.website.save_event`
- **Method:** POST
- **Guard:** roles: Communications Officer, Chaplain

Args: `data` (required).

Example args: `{"data": {"name": "EVT-2026-00001", "capacity": 250}}`

```json
{
  "message": {
    "name": "EVT-2026-00001",
    "title": "Open Day",
    "route": "open-day",
    "event_type": "Open Day",
    "status": "Upcoming",
    "start_datetime": "2026-11-09 09:00:00",
    "end_datetime": "2026-11-09 15:00:00",
    "venue": "Main Campus Chapel",
    "campus": "Main Campus Nairobi",
    "is_public": 1,
    "partner_church": null,
    "organiser": "Admissions Office",
    "cover_image": null,
    "livestream_url": null,
    "summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
    "description": "<p>Join us for a morning of worship, campus tours, sample lectures and one-on-one admis…",
    "notices": null,
    "registration_required": 1,
    "capacity": 250,
    "registration_deadline": "2026-11-08 09:00:00",
    "fee": 0.0,
    "registered_count": 12,
    "attended_count": 0,
    "modified": "2026-10-22 00:09:11.875016",
    "registration": {
      "required": true,
      "open": true,
      "reason": null,
      "capacity": 250,
      "registered": 12,
      "seats_left": 238,
      "deadline": "2026-11-08 09:00:00",
      "fee": 0.0,
      "is_paid": false,
      "waitlist": false,
      "my_registration": null
    }
  }
}
```

### `event_registrations`
- **Path:** `mahanaim.api.website.event_registrations`
- **Method:** GET
- **Guard:** roles: Communications Officer, Chaplain

Args: `event` (required), `status` (default `None`), `search` (default `None`).

Example args: `{"event": "EVT-2026-00001"}`

```json
{
  "message": {
    "data": [
      {
        "name": "RSVP-2026-000001",
        "full_name": "Kevin Mutai",
        "email": "kevin.mutai@example.com",
        "phone": "254798359432",
        "status": "Registered",
        "attendees": 1,
        "church": "Deliverance Church Umoja",
        "student": null,
        "user": null,
        "checked_in_on": null,
        "amount": 0.0,
        "payment_status": "Not Required",
        "payment_reference": null,
        "answers": null,
        "creation": "2026-10-22 00:00:27.327597"
      },
      {
        "name": "RSVP-2026-000002",
        "full_name": "Purity Wanjala",
        "email": "purity.wanjala@example.com",
        "phone": "254741415509",
        "status": "Registered",
        "attendees": 2,
        "church": "PCEA Kahawa West",
        "student": null,
        "user": null,
        "checked_in_on": null,
        "amount": 0.0,
        "payment_status": "Not Required",
        "payment_reference": null,
        "answers": null,
        "creation": "2026-10-22 00:00:27.358840"
      }
    ],
    "total": 6,
    "summary": {"Registered": {"registrations": 6, "people": 12}},
    "event": {"title": "Open Day", "capacity": 200, "registered_count": 12, "attended_count": 0, "fee": 0.0}
  }
}
```

### `check_in`
- **Path:** `mahanaim.api.website.check_in`
- **Method:** POST
- **Guard:** roles: Communications Officer, Chaplain

Args: `registration` (required), `undo` (default `0`).

Example args: `{"registration": "RSVP-2026-000006"}`

```json
{
  "message": {
    "name": "RSVP-2026-000006",
    "campus_event": "EVT-2026-00001",
    "full_name": "Faith Mumbi",
    "email": "faith.mumbi@example.com",
    "phone": "254751606738",
    "status": "Attended",
    "attendees": 3,
    "checked_in_on": "2026-10-22 00:09:11.888048",
    "payment_status": "Not Required",
    "amount": 0
  }
}
```

### `set_registration_status`
- **Path:** `mahanaim.api.website.set_registration_status`
- **Method:** POST
- **Guard:** roles: Communications Officer, Chaplain

Args: `registration` (required), `status` (required).

Example args: `{"registration": "RSVP-2026-000006", "status": "Confirmed"}`

```json
{
  "message": {
    "name": "RSVP-2026-000006",
    "campus_event": "EVT-2026-00001",
    "full_name": "Faith Mumbi",
    "email": "faith.mumbi@example.com",
    "phone": "254751606738",
    "status": "Confirmed",
    "attendees": 3,
    "checked_in_on": null,
    "payment_status": "Not Required",
    "amount": 0
  }
}
```

### `export_registrations`
- **Path:** `mahanaim.api.website.export_registrations`
- **Method:** GET
- **Guard:** roles: Communications Officer, Chaplain

Args: `event` (required).

Example args: `{"event": "EVT-2026-00001"}`

```json
{
  "message": {
    "filename": "open-day-registrations.csv",
    "content": "Reference,Full Name,Email,Phone,Church,Attendees,Status,Checked In,Payment,Amount,Payme…",
    "mimetype": "text/csv",
    "rows": 6
  }
}
```

### `list_enquiries`
- **Path:** `mahanaim.api.website.list_enquiries`
- **Method:** GET
- **Guard:** roles: Communications Officer, Admissions Officer

Args: `status` (default `None`), `subject` (default `None`), `assigned_to` (default `None`), `search` (default `None`), `start` (default `0`), `page_length` (default `20`).

Example args: `{"page_length": 2}`

```json
{
  "message": {
    "data": [
      {
        "name": "ENQ-2026-00003",
        "full_name": "Pastor Daniel Kipkemboi",
        "email": "pastor.kipkemboi@example.com",
        "phone": "254734221100",
        "subject": "General",
        "status": "Responded",
        "assigned_to": "comms@mahanaim.demo",
        "creation": "2026-10-22 00:00:27.702970",
        "modified": "2026-10-22 00:00:27.702970",
        "preview": "Please send me the dates for the Pastors' Conference and the fee."
      },
      {
        "name": "ENQ-2026-00002",
        "full_name": "Rose Atieno",
        "email": "rose.atieno@example.com",
        "phone": "254723445566",
        "subject": "Partnership",
        "status": "In Progress",
        "assigned_to": "comms@mahanaim.demo",
        "creation": "2026-10-22 00:00:27.699131",
        "modified": "2026-10-22 00:00:27.699131",
        "preview": "Our church would like to sponsor two students from our congregation. Who should we talk…"
      }
    ],
    "total": 3,
    "counts": {"Responded": 1, "In Progress": 1, "New": 1}
  }
}
```

### `get_enquiry`
- **Path:** `mahanaim.api.website.get_enquiry`
- **Method:** GET
- **Guard:** roles: Communications Officer, Admissions Officer

Args: `name` (required).

Example args: `{"name": "ENQ-2026-00001"}`

```json
{
  "message": {
    "name": "ENQ-2026-00001",
    "full_name": "Kevin Mutai",
    "email": "kevin.mutai@example.com",
    "phone": "254712998877",
    "subject": "Admissions",
    "status": "New",
    "assigned_to": null,
    "message": "Hello, I would like to know if the Diploma in Pastoral Ministry is available on weekends?",
    "response": null,
    "creation": "2026-10-22 00:00:27.693610",
    "modified": "2026-10-22 00:00:27.693610",
    "notes": []
  }
}
```

### `update_enquiry`
- **Path:** `mahanaim.api.website.update_enquiry`
- **Method:** POST
- **Guard:** roles: Communications Officer, Admissions Officer

Assign, respond to (emails the enquirer when status becomes Responded) or annotate an enquiry.

Args: `name` (required), `status` (default `None`), `notes` (default `None`), `assign_to` (default `None`), `response` (default `None`).

Example args: `{"name": "ENQ-2026-00001", "status": "In Progress", "notes": "Called back", "assign_to": "comms@mahanaim.demo"}`

```json
{
  "message": {
    "name": "ENQ-2026-00001",
    "full_name": "Kevin Mutai",
    "email": "kevin.mutai@example.com",
    "phone": "254712998877",
    "subject": "Admissions",
    "status": "In Progress",
    "assigned_to": "comms@mahanaim.demo",
    "message": "Hello, I would like to know if the Diploma in Pastoral Ministry is available on weekends?",
    "response": null,
    "creation": "2026-10-22 00:00:27.693610",
    "modified": "2026-10-22 00:09:11.909971",
    "notes": [
      {
        "name": "h0vhhnhkpo",
        "content": "Called back",
        "comment_email": "admin@mahanaim.demo",
        "creation": "2026-10-22 00:09:11.915167"
      }
    ]
  }
}
```

### `get_website_settings`
- **Path:** `mahanaim.api.website.get_website_settings`
- **Method:** GET
- **Guard:** roles: Communications Officer

Args: None.

```json
{
  "message": {
    "announcement_bar": "Applications for the January intake are open — apply online today.",
    "announcement_link": "/apply",
    "hero_eyebrow": "Raising servant leaders since 1998",
    "hero_title": "Equipping men and women for faithful Christian ministry",
    "hero_subtitle": "Accredited theological training rooted in Scripture, shaped by prayer and practised in …",
    "hero_image": null,
    "hero_cta_label": "Apply for the next intake",
    "hero_cta_link": "/apply",
    "hero_video_url": null,
    "stat_students": 1200,
    "stat_graduates": 4800,
    "stat_churches": 350,
    "stat_years": 27,
    "about_summary": "Mahanaim Bible College trains pastors, evangelists, missionaries and lay leaders for th…",
    "mission": "To equip Christian workers with sound biblical knowledge, godly character and practical…",
    "vision": "A Spirit-filled, biblically grounded generation of leaders transforming communities for…",
    "core_values": "Scripture\nPrayer\nIntegrity\nServant Leadership\nExcellence\nCommunity",
    "about_body": "<p>Mahanaim Bible College is a Christ-centred training institution that has equipped pa…",
    "statement_of_faith": "<ul><li>We believe the Bible is the inspired, infallible and authoritative Word of God.…",
    "history": "<p>The college began in 1999 as an evening Bible school in a church hall in Kasarani wi…",
    "principal_name": "Rt. Rev. Stephen Mutua",
    "principal_title": "Principal",
    "principal_photo": null,
    "principal_message": "<p>Welcome to Mahanaim Bible College. Our name recalls the place where Jacob discovered…",
    "admissions_intro": "<p>We admit students in January, May and September. Applications are completed online a…",
    "admissions_steps": "Create an account and verify your email\nChoose a programme, campus and study mode\nCompl…",
    "fees_intro": "<p>Fees are charged per term and can be paid by M-Pesa or bank deposit. Sponsored stude…",
    "library_intro": "<p>Our library holds more than 12,000 titles across both campuses, plus a growing digit…",
    "contact_phone": "0722 410 300",
    "contact_email": "info@mahanaim.ac.ke",
    "whatsapp": "254722410300",
    "contact_address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
    "office_hours": "Mon–Fri 8:00am – 5:00pm\nSat 9:00am – 1:00pm",
    "map_embed_url": "https://maps.google.com/maps?q=Kasarani%20Nairobi&output=embed",
    "facebook": "https://facebook.com/mahanaimbiblecollege",
    "youtube": "https://youtube.com/@mahanaimbiblecollege",
    "instagram": "https://instagram.com/mahanaimbiblecollege",
    "x_twitter": "https://x.com/mahanaimbc",
    "footer_text": "Equipping servants for the Kingdom since 1999.",
    "meta_description": "Mahanaim Bible College — diploma and certificate programmes in Biblical Studies, Pastor…"
  }
}
```

### `update_website_settings`
- **Path:** `mahanaim.api.website.update_website_settings`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `data` (required).

Example args: `{"data": {"announcement_bar": "January 2027 intake now open"}}`

```json
{
  "message": {
    "announcement_bar": "January 2027 intake now open",
    "announcement_link": "/apply",
    "hero_eyebrow": "Raising servant leaders since 1998",
    "hero_title": "Equipping men and women for faithful Christian ministry",
    "hero_subtitle": "Accredited theological training rooted in Scripture, shaped by prayer and practised in …",
    "hero_image": null,
    "hero_cta_label": "Apply for the next intake",
    "hero_cta_link": "/apply",
    "hero_video_url": null,
    "stat_students": 1200,
    "stat_graduates": 4800,
    "stat_churches": 350,
    "stat_years": 27,
    "about_summary": "Mahanaim Bible College trains pastors, evangelists, missionaries and lay leaders for th…",
    "mission": "To equip Christian workers with sound biblical knowledge, godly character and practical…",
    "vision": "A Spirit-filled, biblically grounded generation of leaders transforming communities for…",
    "core_values": "Scripture\nPrayer\nIntegrity\nServant Leadership\nExcellence\nCommunity",
    "about_body": "<p>Mahanaim Bible College is a Christ-centred training institution that has equipped pa…",
    "statement_of_faith": "<ul><li>We believe the Bible is the inspired, infallible and authoritative Word of God.…",
    "history": "<p>The college began in 1999 as an evening Bible school in a church hall in Kasarani wi…",
    "principal_name": "Rt. Rev. Stephen Mutua",
    "principal_title": "Principal",
    "principal_photo": null,
    "principal_message": "<p>Welcome to Mahanaim Bible College. Our name recalls the place where Jacob discovered…",
    "admissions_intro": "<p>We admit students in January, May and September. Applications are completed online a…",
    "admissions_steps": "Create an account and verify your email\nChoose a programme, campus and study mode\nCompl…",
    "fees_intro": "<p>Fees are charged per term and can be paid by M-Pesa or bank deposit. Sponsored stude…",
    "library_intro": "<p>Our library holds more than 12,000 titles across both campuses, plus a growing digit…",
    "contact_phone": "0722 410 300",
    "contact_email": "info@mahanaim.ac.ke",
    "whatsapp": "254722410300",
    "contact_address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
    "office_hours": "Mon–Fri 8:00am – 5:00pm\nSat 9:00am – 1:00pm",
    "map_embed_url": "https://maps.google.com/maps?q=Kasarani%20Nairobi&output=embed",
    "facebook": "https://facebook.com/mahanaimbiblecollege",
    "youtube": "https://youtube.com/@mahanaimbiblecollege",
    "instagram": "https://instagram.com/mahanaimbiblecollege",
    "x_twitter": "https://x.com/mahanaimbc",
    "footer_text": "Equipping servants for the Kingdom since 1999.",
    "meta_description": "Mahanaim Bible College — diploma and certificate programmes in Biblical Studies, Pastor…"
  }
}
```

### `list_faqs`
- **Path:** `mahanaim.api.website.list_faqs`
- **Method:** GET
- **Guard:** roles: Communications Officer, Admissions Officer

Args: `category` (default `None`).

```json
{
  "message": {
    "data": [
      {
        "name": "bt45rlq538",
        "question": "Are your programmes accredited?",
        "category": "Academics",
        "is_published": 1,
        "sequence": 30,
        "answer": "<p>Our programmes follow a recognised theological curriculum and credits can be transfe…",
        "modified": "2026-10-22 00:00:27.658810"
      },
      {
        "name": "bt47oclsds",
        "question": "Is accommodation available?",
        "category": "Accommodation",
        "is_published": 1,
        "sequence": 50,
        "answer": "<p>Main Campus has limited hostel space for full-time students. Apply early; rooms are …",
        "modified": "2026-10-22 00:00:27.662593"
      }
    ],
    "total": 6
  }
}
```

### `save_faq`
- **Path:** `mahanaim.api.website.save_faq`
- **Method:** POST
- **Guard:** roles: Communications Officer, Admissions Officer

Args: `data` (required).

Example args: `{"data": {"question": "Is there parking?", "answer": "<p>Yes.</p>", "category": "General"}}`

```json
{
  "message": {
    "name": "h0vesb2ofl",
    "question": "Is there parking?",
    "category": "General",
    "is_published": 1,
    "sequence": 10,
    "answer": "<p>Yes.</p>"
  }
}
```

### `delete_faq`
- **Path:** `mahanaim.api.website.delete_faq`
- **Method:** POST
- **Guard:** roles: Communications Officer, Admissions Officer

Args: `name` (required).

Example args: `{"name": "bt4jge0hl5"}`

```json
{"message": {"ok": true, "name": "bt4jge0hl5"}}
```

### `list_testimonials`
- **Path:** `mahanaim.api.website.list_testimonials`
- **Method:** GET
- **Guard:** roles: Communications Officer

Args: None.

```json
{
  "message": {
    "data": [
      {
        "name": "c9thfce6bg",
        "person_name": "Rev. John Maina",
        "role_title": "Senior Pastor, Harvest Fellowship Thika",
        "programme": "DBS",
        "photo": null,
        "is_published": 1,
        "sequence": 10,
        "quote": "Mahanaim gave me more than knowledge — it shaped my character and my love for God's Wor…",
        "modified": "2026-10-22 00:01:08.511801"
      },
      {
        "name": "c9tq960kef",
        "person_name": "Martha Adhiambo",
        "role_title": "School Chaplain",
        "programme": "DPM",
        "photo": null,
        "is_published": 1,
        "sequence": 20,
        "quote": "The pastoral care and counselling training prepared me to walk with students through gr…",
        "modified": "2026-10-22 00:01:08.515080"
      }
    ],
    "total": 4
  }
}
```

### `save_testimonial`
- **Path:** `mahanaim.api.website.save_testimonial`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `data` (required).

Example args: `{"data": {"person_name": "Rev. Doc", "role_title": "Alumnus", "quote": "MBC shaped my ministry."}}`

```json
{
  "message": {
    "name": "h11q8gbvh1",
    "person_name": "Rev. Doc",
    "role_title": "Alumnus",
    "programme": null,
    "photo": null,
    "is_published": 1,
    "sequence": 10,
    "quote": "MBC shaped my ministry."
  }
}
```

### `delete_testimonial`
- **Path:** `mahanaim.api.website.delete_testimonial`
- **Method:** POST
- **Guard:** roles: Communications Officer

Args: `name` (required).

Example args: `{"name": "f6g7h8i9j0"}`

```json
{"message": {"ok": true, "name": "f6g7h8i9j0"}}
```
