"""Static content for the demo dataset (see `mahanaim.demo.seed`). Names, copy and figures are fictional
but realistic for a Kenyan Bible college; programme names/fees follow the original proof of concept."""

DEMO_DOMAIN = "mahanaim.demo"
DEMO_PASSWORD = "Demo@12345"

CAMPUSES = [
	{
		"campus_name": "Main Campus Nairobi",
		"code": "MNC",
		"is_main_campus": 1,
		"county": "Nairobi",
		"town": "Kasarani",
		"phone": "0722 410 300",
		"email": "info@mahanaim.ac.ke",
		"address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
		"map_url": "https://maps.google.com/?q=Kasarani+Nairobi",
	},
	{
		"campus_name": "Nakuru Extension",
		"code": "NKR",
		"county": "Nakuru",
		"town": "Nakuru",
		"phone": "0733 518 220",
		"email": "nakuru@mahanaim.ac.ke",
		"address": "Kenyatta Avenue, Harvest House 2nd Floor, Nakuru",
		"map_url": "https://maps.google.com/?q=Kenyatta+Avenue+Nakuru",
	},
]

DEPARTMENTS = [
	("Biblical Studies", "BIB", "Old and New Testament studies, hermeneutics and the biblical languages."),
	("Theology", "THE", "Systematic, historical and practical theology."),
	("Pastoral Ministry", "PAS", "Preaching, pastoral care, worship and mission."),
	("Leadership", "LDR", "Christian leadership, administration and communication."),
]

# code, title, credits, department, description
COURSES = [
	(
		"BIB101",
		"Old Testament Survey",
		3,
		"Biblical Studies",
		"A panoramic study of the Old Testament: its history, literature, covenants and redemptive themes.",
	),
	(
		"BIB102",
		"New Testament Survey",
		3,
		"Biblical Studies",
		"The background, content and message of the twenty-seven books of the New Testament.",
	),
	(
		"BIB112",
		"Hermeneutics & Biblical Interpretation",
		3,
		"Biblical Studies",
		"Principles and practice of sound interpretation: context, genre, grammar and application.",
	),
	(
		"BIB150",
		"Biblical Greek I",
		3,
		"Biblical Studies",
		"Alphabet, morphology and basic syntax of Koine Greek with readings from John's Gospel.",
	),
	(
		"CHH102",
		"Church History",
		3,
		"Theology",
		"The story of the church from the apostolic age through the Reformation to Christianity in Africa.",
	),
	(
		"THE106",
		"Systematic Theology I",
		3,
		"Theology",
		"Revelation, Scripture, the doctrine of God and the Trinity.",
	),
	(
		"THE110",
		"Christian Ethics",
		3,
		"Theology",
		"Biblical foundations for moral reasoning and contemporary ethical issues in Kenya.",
	),
	(
		"THE120",
		"Introduction to Christian Doctrine",
		3,
		"Theology",
		"An accessible overview of the major doctrines of the Christian faith.",
	),
	(
		"MIN105",
		"Spiritual Formation",
		2,
		"Pastoral Ministry",
		"Prayer, Scripture meditation, worship and accountability as the foundation of ministry.",
	),
	(
		"MIN120",
		"Foundations of Christian Ministry",
		3,
		"Pastoral Ministry",
		"The call, character and competencies of the servant of God.",
	),
	(
		"PAS201",
		"Homiletics: Preaching the Word",
		3,
		"Pastoral Ministry",
		"Preparing and delivering expository sermons with practical preaching labs.",
	),
	(
		"PAS210",
		"Pastoral Care & Counselling",
		3,
		"Pastoral Ministry",
		"Shepherding God's people through crisis, grief, marriage and family challenges.",
	),
	(
		"PAS220",
		"Worship & Liturgy",
		2,
		"Pastoral Ministry",
		"Biblical theology of worship and planning meaningful services.",
	),
	(
		"PAS230",
		"Church Administration & Management",
		3,
		"Leadership",
		"Governance, planning, finance and people management in the local church.",
	),
	(
		"MIS130",
		"Missions & Evangelism",
		3,
		"Pastoral Ministry",
		"The mission of God, cross-cultural witness and personal evangelism.",
	),
	(
		"GEN101",
		"Communication Skills",
		2,
		"Leadership",
		"Academic writing, public speaking and effective communication for ministry.",
	),
	(
		"LDR101",
		"Foundations of Christian Leadership",
		3,
		"Leadership",
		"Biblical models of leadership and the character of the leader.",
	),
	(
		"LDR110",
		"Servant Leadership & Discipleship",
		3,
		"Leadership",
		"Leading like Jesus: mentoring, multiplying disciples and developing teams.",
	),
	(
		"LDR120",
		"Team Building & Conflict Resolution",
		2,
		"Leadership",
		"Building healthy ministry teams and handling conflict biblically.",
	),
	(
		"LDR130",
		"Stewardship & Church Finance",
		2,
		"Leadership",
		"Biblical stewardship, budgeting and financial accountability in ministry.",
	),
]

_LIST = "<ul>{}</ul>"


def _ul(*items):
	return _LIST.format("".join(f"<li>{i}</li>" for i in items))


# curriculum rows: (year, term, course, type)
PROGRAMMES = [
	{
		"code": "DBS",
		"programme_name": "Diploma in Biblical Studies",
		"level": "Diploma",
		"department": "Biblical Studies",
		"duration_years": 2,
		"fee": 42000,
		"award_title": "Diploma in Biblical Studies",
		"minimum_entry": "KCSE C- (minus) or equivalent",
		"campuses": ["MNC", "NKR"],
		"modes": ["Full Time", "Distance (Online)"],
		"overview": "A grounded programme in scripture, theology, ministry leadership and Christian formation.",
		"description": "<p>The Diploma in Biblical Studies equips men and women with a deep, practical knowledge "
		"of the Bible. Students study both Testaments, learn to interpret Scripture faithfully and grow in "
		"Christian character through chapel, mentoring and supervised ministry. Delivered on campus in Nairobi "
		"and Nakuru, or blended online.</p>",
		"entry_requirements": _ul(
			"KCSE mean grade of C- (minus) or a relevant certificate",
			"A letter of recommendation from your pastor",
			"Evidence of a personal Christian commitment",
		),
		"career_paths": _ul(
			"Pastor or associate pastor",
			"Bible teacher and Christian education worker",
			"Youth and children's ministry leader",
			"Chaplaincy assistant",
			"Further studies towards a degree in theology",
		),
		"curriculum": [
			(1, 1, "BIB101", "Core"),
			(1, 1, "MIN105", "Core"),
			(1, 1, "GEN101", "Core"),
			(1, 2, "BIB112", "Core"),
			(1, 2, "THE106", "Core"),
			(1, 2, "MIN120", "Core"),
			(1, 2, "CHH102", "Core"),
			(1, 3, "BIB102", "Core"),
			(2, 1, "BIB150", "Elective"),
			(2, 1, "THE110", "Core"),
		],
	},
	{
		"code": "DPM",
		"programme_name": "Diploma in Pastoral Ministry",
		"level": "Diploma",
		"department": "Pastoral Ministry",
		"duration_years": 2,
		"fee": 45000,
		"award_title": "Diploma in Pastoral Ministry",
		"minimum_entry": "KCSE C- (minus) or equivalent",
		"campuses": ["MNC", "NKR"],
		"modes": ["Full Time"],
		"overview": "Practical pastoral formation covering preaching, counselling, church leadership and mission.",
		"description": "<p>The Diploma in Pastoral Ministry prepares pastors and church workers for faithful "
		"shepherding. Alongside biblical and theological foundations, students preach in homiletics labs, "
		"learn pastoral counselling and serve in a supervised church placement every term.</p>",
		"entry_requirements": _ul(
			"KCSE mean grade of C- (minus) or a Certificate in Theology",
			"A recommendation from your church leadership",
			"At least one year of active church ministry",
		),
		"career_paths": _ul(
			"Senior or associate pastor",
			"Church planter",
			"Pastoral counsellor",
			"Missions and outreach coordinator",
			"Church administrator",
		),
		"curriculum": [
			(1, 1, "BIB101", "Core"),
			(1, 1, "MIN105", "Core"),
			(1, 2, "MIN120", "Core"),
			(1, 2, "PAS201", "Core"),
			(1, 2, "PAS210", "Core"),
			(1, 3, "BIB102", "Core"),
			(1, 3, "THE106", "Core"),
			(2, 1, "MIS130", "Core"),
			(2, 1, "PAS220", "Core"),
			(2, 2, "PAS230", "Practicum"),
		],
	},
	{
		"code": "CTH",
		"programme_name": "Certificate in Theology",
		"level": "Certificate",
		"department": "Theology",
		"duration_years": 1,
		"fee": 28000,
		"award_title": "Certificate in Theology",
		"minimum_entry": "KCSE D+ (plus) or equivalent",
		"campuses": ["MNC"],
		"modes": ["Distance (Online)", "Part Time"],
		"overview": "An accessible foundation in biblical interpretation, doctrine and spiritual disciplines.",
		"description": "<p>The Certificate in Theology is a one-year foundation for lay leaders, church "
		"workers and anyone who wants to understand the faith more deeply. It is offered fully online with "
		"live weekly tutorials, so you can study without leaving your family, work or ministry.</p>",
		"entry_requirements": _ul(
			"KCSE mean grade of D+ (plus) or equivalent",
			"Basic computer and internet access for online study",
			"A recommendation from your pastor",
		),
		"career_paths": _ul(
			"Lay preacher and Bible study leader",
			"Sunday school superintendent",
			"Progression to the Diploma in Biblical Studies",
		),
		"curriculum": [
			(1, 1, "BIB101", "Core"),
			(1, 1, "THE120", "Core"),
			(1, 2, "BIB102", "Core"),
			(1, 2, "BIB112", "Core"),
			(1, 3, "THE106", "Core"),
			(1, 3, "CHH102", "Core"),
			(1, 3, "THE110", "Elective"),
		],
	},
	{
		"code": "CLM",
		"programme_name": "Certificate in Christian Leadership & Ministry",
		"level": "Certificate",
		"department": "Leadership",
		"duration_years": 1,
		"fee": 30000,
		"award_title": "Certificate in Christian Leadership & Ministry",
		"minimum_entry": "KCSE D+ (plus) or equivalent",
		"campuses": ["MNC", "NKR"],
		"modes": ["Weekend"],
		"overview": "Leadership formation for ministry teams, church workers and emerging Christian leaders.",
		"description": "<p>Designed for working church leaders, this weekend programme develops servant "
		"leaders who can build teams, steward resources and lead change in the church and community.</p>",
		"entry_requirements": _ul(
			"KCSE mean grade of D+ (plus) or equivalent",
			"Currently serving in a church or ministry leadership role",
		),
		"career_paths": _ul(
			"Church elder or deacon",
			"Ministry team leader",
			"Church administrator",
			"Leader in Christian NGOs and community organisations",
		),
		"curriculum": [
			(1, 1, "LDR101", "Core"),
			(1, 1, "MIN105", "Core"),
			(1, 2, "LDR110", "Core"),
			(1, 2, "GEN101", "Core"),
			(1, 3, "LDR120", "Core"),
			(1, 3, "LDR130", "Core"),
			(1, 3, "MIS130", "Elective"),
		],
	},
]

FEE_ITEMS = [
	("Registration", 1500),
	("Library", 1000),
	("ICT", 1500),
	("Examination", 2000),
	("Student Welfare", 1000),
]

# key, salutation, first, last, email local part, lecturer, roles, department, campus, designation, website seq
STAFF = [
	{
		"key": "kimani",
		"salutation": "Dr",
		"first_name": "David",
		"last_name": "Kimani",
		"email": "lecturer",
		"is_lecturer": 1,
		"roles": [],
		"department": "Biblical Studies",
		"campus": "MNC",
		"designation": "Senior Lecturer, Biblical Studies",
		"seq": 3,
		"specialisation": "Old Testament and Hermeneutics",
		"qualifications": "PhD (Old Testament), MDiv",
		"bio": "Dr. Kimani has taught the Old Testament for fifteen years and pastors a congregation in Ruiru.",
	},
	{
		"key": "njoroge",
		"salutation": "Rev.",
		"first_name": "Miriam",
		"last_name": "Njoroge",
		"email": "dean",
		"is_lecturer": 1,
		"roles": ["Academic Dean"],
		"department": "Theology",
		"campus": "MNC",
		"designation": "Academic Dean",
		"seq": 2,
		"specialisation": "Systematic Theology",
		"qualifications": "DTh (Systematic Theology), MA (Theology)",
		"bio": "Rev. Njoroge leads the academic team and teaches Systematic Theology.",
	},
	{
		"key": "mwangi",
		"salutation": "Pastor",
		"first_name": "Joseph",
		"last_name": "Mwangi",
		"email": "joseph.mwangi",
		"is_lecturer": 1,
		"roles": [],
		"department": "Pastoral Ministry",
		"campus": "MNC",
		"designation": "Lecturer, Pastoral Ministry",
		"seq": 4,
		"specialisation": "Homiletics and Pastoral Care",
		"qualifications": "MA (Pastoral Studies), BTh",
		"bio": "Ps. Mwangi brings twenty years of pastoral experience to the classroom.",
	},
	{
		"key": "atieno",
		"salutation": "Dr",
		"first_name": "Sarah",
		"last_name": "Atieno",
		"email": "sarah.atieno",
		"is_lecturer": 1,
		"roles": [],
		"department": "Theology",
		"campus": "MNC",
		"designation": "Lecturer, Church History",
		"seq": 5,
		"specialisation": "Church History and Ethics",
		"qualifications": "PhD (Church History)",
		"bio": "Dr. Atieno researches the growth of the church in East Africa.",
	},
	{
		"key": "ochieng",
		"salutation": "Rev.",
		"first_name": "Peter",
		"last_name": "Ochieng",
		"email": "peter.ochieng",
		"is_lecturer": 1,
		"roles": [],
		"department": "Leadership",
		"campus": "NKR",
		"designation": "Coordinator, Nakuru Extension",
		"seq": 6,
		"specialisation": "Christian Leadership",
		"qualifications": "MA (Organisational Leadership)",
		"bio": "Rev. Ochieng coordinates the Nakuru Extension and teaches leadership courses.",
	},
	{
		"key": "principal",
		"salutation": "Rt. Rev.",
		"first_name": "Stephen",
		"last_name": "Mutua",
		"email": "principal",
		"is_lecturer": 0,
		"roles": ["College Administrator"],
		"department": "Theology",
		"campus": "MNC",
		"designation": "Principal",
		"seq": 1,
		"specialisation": "Pastoral Theology",
		"qualifications": "DMin, MDiv",
		"bio": "Bishop Mutua has served as Principal since 2019.",
	},
	{
		"key": "registrar",
		"salutation": "Ms",
		"first_name": "Esther",
		"last_name": "Achieng",
		"email": "registrar",
		"is_lecturer": 0,
		"roles": ["Registrar"],
		"staff_type": "Administrative",
		"campus": "MNC",
		"designation": "Registrar",
	},
	{
		"key": "finance",
		"salutation": "Mr",
		"first_name": "Daniel",
		"last_name": "Kiprop",
		"email": "finance",
		"is_lecturer": 0,
		"roles": ["Finance Officer"],
		"staff_type": "Administrative",
		"campus": "MNC",
		"designation": "Finance Officer",
	},
	{
		"key": "admissions",
		"salutation": "Mrs",
		"first_name": "Ruth",
		"last_name": "Wambui",
		"email": "admissions",
		"is_lecturer": 0,
		"roles": ["Admissions Officer"],
		"staff_type": "Administrative",
		"campus": "MNC",
		"designation": "Admissions Officer",
	},
	{
		"key": "admin",
		"salutation": "Mr",
		"first_name": "Brian",
		"last_name": "Otieno",
		"email": "admin",
		"is_lecturer": 0,
		"roles": ["College Administrator"],
		"staff_type": "Administrative",
		"campus": "MNC",
		"designation": "College Administrator",
	},
	{
		"key": "library",
		"salutation": "Ms",
		"first_name": "Lucy",
		"last_name": "Chebet",
		"email": "library",
		"is_lecturer": 0,
		"roles": ["Library Officer"],
		"staff_type": "Support",
		"campus": "MNC",
		"designation": "Librarian",
	},
	{
		"key": "comms",
		"salutation": "Mr",
		"first_name": "Kevin",
		"last_name": "Omondi",
		"email": "comms",
		"is_lecturer": 0,
		"roles": ["Communications Officer"],
		"staff_type": "Administrative",
		"campus": "MNC",
		"designation": "Communications Officer",
	},
	{
		"key": "chaplain",
		"salutation": "Rev.",
		"first_name": "James",
		"last_name": "Kamau",
		"email": "chaplain",
		"is_lecturer": 0,
		"roles": ["Chaplain"],
		"staff_type": "Administrative",
		"campus": "MNC",
		"designation": "College Chaplain",
	},
]

# Current-term offerings: campus -> [(course, lecturer key)]
CURRENT_OFFERINGS = {
	"MNC": [
		("BIB112", "kimani"),
		("THE106", "njoroge"),
		("MIN120", "mwangi"),
		("CHH102", "atieno"),
		("BIB101", "kimani"),
		("THE120", "njoroge"),
		("PAS201", "mwangi"),
		("PAS210", "mwangi"),
		("LDR101", "ochieng"),
		("LDR110", "ochieng"),
		("BIB150", "kimani"),
		("THE110", "atieno"),
		("MIS130", "mwangi"),
		("PAS220", "atieno"),
	],
	"NKR": [
		("BIB112", "ochieng"),
		("THE106", "njoroge"),
		("MIN120", "ochieng"),
		("PAS201", "ochieng"),
		("LDR101", "ochieng"),
	],
}
PREVIOUS_OFFERINGS = {
	"MNC": [("BIB101", "kimani"), ("BIB102", "kimani"), ("MIN105", "mwangi"), ("GEN101", "atieno")],
	"NKR": [("BIB101", "ochieng"), ("MIN105", "ochieng"), ("GEN101", "ochieng")],
}

# Students. group A = joined at the previous-term intake (has published results), B = joined this term,
# C = second-years (joined a year before B). `church` keys refer to CHURCHES.
STUDENTS = [
	("Grace", "Wanjiku", "F", "DBS", "MNC", "Full Time", "A", "kasarani", "student"),
	("Brian", "Mutiso", "M", "DBS", "MNC", "Full Time", "A", "kasarani", None),
	("Joy", "Chebet", "F", "DBS", "MNC", "Distance (Online)", "A", "kitengela", None),
	("Daniel", "Omondi", "M", "DPM", "MNC", "Full Time", "A", "thika", None),
	("Mercy", "Njeri", "F", "DPM", "MNC", "Full Time", "A", "kasarani", None),
	("Samuel", "Otieno", "M", "CTH", "MNC", "Distance (Online)", "A", None, None),
	("Esther", "Nyambura", "F", "CTH", "MNC", "Distance (Online)", "A", "kitengela", None),
	("Peter", "Kariuki", "M", "CLM", "MNC", "Weekend", "A", "thika", None),
	("Ann", "Wairimu", "F", "CLM", "NKR", "Weekend", "A", "nakuru", None),
	("Joseph", "Kiplagat", "M", "DBS", "NKR", "Full Time", "A", "nakuru", None),
	("Lydia", "Akinyi", "F", "DPM", "NKR", "Full Time", "A", "nakuru", None),
	("Timothy", "Kibet", "M", "DBS", "NKR", "Full Time", "A", None, None),
	("Ruth", "Moraa", "F", "DBS", "MNC", "Full Time", "B", "kasarani", None),
	("Collins", "Wekesa", "M", "DPM", "MNC", "Full Time", "B", None, None),
	("Naomi", "Jeptoo", "F", "CTH", "MNC", "Distance (Online)", "B", None, None),
	("Isaac", "Mutua", "M", "CLM", "MNC", "Weekend", "B", "thika", None),
	("Rebecca", "Atieno", "F", "DBS", "NKR", "Full Time", "B", "nakuru", None),
	("Elijah", "Kirui", "M", "DPM", "NKR", "Full Time", "B", None, None),
	("Priscilla", "Wangari", "F", "CLM", "NKR", "Weekend", "B", "nakuru", None),
	("Moses", "Barasa", "M", "CTH", "MNC", "Part Time", "B", "kitengela", None),
	("Stephen", "Njoroge", "M", "DBS", "MNC", "Full Time", "C", "kasarani", None),
	("Hannah", "Wambui", "F", "DBS", "MNC", "Full Time", "C", "thika", None),
	("Philip", "Ndungu", "M", "DPM", "MNC", "Full Time", "C", "kasarani", None),
	("Dorcas", "Muthoni", "F", "DPM", "NKR", "Full Time", "C", "nakuru", None),
	("Caleb", "Rotich", "M", "DBS", "NKR", "Full Time", "C", None, None),
]

ALUMNI = [
	("John", "Maina", "M", "DBS", "MNC", 2023, "Senior Pastor, Harvest Fellowship Thika", "Senior Pastor"),
	("Martha", "Adhiambo", "F", "DPM", "MNC", 2022, "Chaplain, St. Paul's Girls' School", "School Chaplain"),
	("Paul", "Ouma", "M", "CTH", "MNC", 2024, "Youth Pastor, Grace Chapel Kitengela", "Youth Pastor"),
]

# first, last, gender, programme, campus, mode, status, extra
APPLICATIONS = [
	("Faith", "Chebet", "F", "DBS", "MNC", "Full Time", "Draft", {"user": "applicant"}),
	("Kelvin", "Mugo", "M", "CTH", "MNC", "Distance (Online)", "Submitted", {"fee_status": "Unpaid"}),
	("Beatrice", "Nduta", "F", "DPM", "MNC", "Full Time", "Submitted", {"fee_status": "Paid"}),
	("Victor", "Langat", "M", "DBS", "NKR", "Full Time", "Under Review", {}),
	("Purity", "Kendi", "F", "CLM", "MNC", "Weekend", "Under Review", {}),
	("Emmanuel", "Waweru", "M", "DPM", "NKR", "Full Time", "Interview", {"interview_in_days": 5}),
	("Sharon", "Jelagat", "F", "DBS", "MNC", "Distance (Online)", "Admitted", {}),
	("Dennis", "Kamau", "M", "CLM", "NKR", "Weekend", "Waitlisted", {}),
	(
		"Lilian",
		"Auma",
		"F",
		"CTH",
		"MNC",
		"Part Time",
		"Rejected",
		{
			"rejection_reason": "Incomplete academic documents; you are welcome to re-apply for the next intake."
		},
	),
	("George", "Nyaga", "M", "DBS", "MNC", "Full Time", "Accepted", {}),
]

CHURCHES = {
	"hfc": {
		"church_name": "Harvest Fellowship Churches",
		"church_code": "HFC",
		"church_type": "Headquarters",
		"denomination": "Harvest Fellowship Churches",
		"is_group": 1,
		"county": "Nairobi",
		"town": "Nairobi",
		"senior_pastor": "Bishop Samuel Gitonga",
		"phone": "0720 111 222",
		"email": "office@harvestfellowship.example",
	},
	"kasarani": {
		"church_name": "Harvest Fellowship Kasarani",
		"church_code": "HFC-KSR",
		"parent": "hfc",
		"denomination": "Harvest Fellowship Churches",
		"county": "Nairobi",
		"town": "Kasarani",
		"senior_pastor": "Rev. Joseph Gitau",
		"phone": "0720 333 444",
	},
	"nakuru": {
		"church_name": "Harvest Fellowship Nakuru Town",
		"church_code": "HFC-NKR",
		"parent": "hfc",
		"denomination": "Harvest Fellowship Churches",
		"county": "Nakuru",
		"town": "Nakuru",
		"senior_pastor": "Pastor Agnes Chepkoech",
		"phone": "0720 555 666",
	},
	"thika": {
		"church_name": "Harvest Fellowship Thika",
		"church_code": "HFC-THK",
		"parent": "hfc",
		"denomination": "Harvest Fellowship Churches",
		"county": "Kiambu",
		"town": "Thika",
		"senior_pastor": "Rev. John Maina",
		"phone": "0720 777 888",
	},
	"kitengela": {
		"church_name": "Grace Chapel Kitengela",
		"church_code": "GCK",
		"church_type": "Local Church",
		"denomination": "Independent",
		"county": "Kajiado",
		"town": "Kitengela",
		"senior_pastor": "Pastor Moses Lekishon",
		"phone": "0711 909 808",
	},
}

SPONSORS = [
	{
		"key": "kasarani",
		"sponsor_name": "Harvest Fellowship Kasarani Missions Board",
		"sponsor_type": "Church",
		"church": "kasarani",
		"email": "sponsor",
		"phone": "0722 600 700",
		"contact_person": "Elder Joseph Gitau",
		"preferred_communication": "Email",
		"portal": True,
	},
	{
		"key": "kamau",
		"sponsor_name": "John & Mary Kamau",
		"sponsor_type": "Individual",
		"email": "kamau.family@example.com",
		"phone": "0733 101 202",
		"preferred_communication": "WhatsApp",
	},
	{
		"key": "livinghope",
		"sponsor_name": "Living Hope Foundation",
		"sponsor_type": "Foundation",
		"email": "grants@livinghope.example",
		"phone": "0700 303 404",
		"contact_person": "Mrs. Wanjiru Kahiga",
		"country": "Kenya",
	},
	{
		"key": "alumni",
		"sponsor_name": "MBC Alumni Association",
		"sponsor_type": "Alumni",
		"email": "alumni@mahanaim.example",
		"phone": "0711 505 606",
		"contact_person": "Rev. John Maina",
	},
]

# sponsor key, student first name, coverage, amount, percentage, status
SPONSORSHIPS = [
	("kasarani", "Grace", "Percentage", 0, 50, "Active"),
	("kasarani", "Joseph", "Full Fees", 0, 0, "Active"),
	("kasarani", "Mercy", "Fixed Amount", 20000, 0, "Active"),
	("kamau", "Brian", "Fixed Amount", 15000, 0, "Active"),
	("livinghope", "Lydia", "Full Fees", 0, 0, "Active"),
	("livinghope", "Dorcas", "Full Fees", 0, 0, "Active"),
	("alumni", "Ruth", "Percentage", 0, 25, "Active"),
	("livinghope", "Elijah", "Percentage", 0, 40, "Proposed"),
]

# giving type, giver type, giver key, amount, months ago, mode
GIVING = [
	("Scholarship Fund", "Sponsor", "kasarani", 25000, 0, "Bank"),
	("Scholarship Fund", "Sponsor", "kasarani", 25000, 3, "Bank"),
	("Scholarship Fund", "Sponsor", "kamau", 10000, 1, "M-Pesa"),
	("Building Fund", "Partner Church", "kitengela", 50000, 2, "Bank"),
	("Building Fund", "Partner Church", "nakuru", 35000, 6, "Cheque"),
	("Missions", "Other", "Mr. Paul Wekesa", 5000, 1, "M-Pesa"),
	("Missions", "Staff", "Rev. James Kamau", 3000, 4, "M-Pesa"),
	("Thanksgiving", "Other", "Mrs. Agnes Mumbi", 2500, 0, "M-Pesa"),
	("Thanksgiving", "Anonymous", None, 1000, 5, "M-Pesa"),
	("Offering", "Anonymous", None, 8450, 0, "Cash"),
	("Tithe", "Staff", "Dr. David Kimani", 6000, 2, "M-Pesa"),
	("Scholarship Fund", "Sponsor", "alumni", 40000, 8, "Bank"),
	("Missions", "Partner Church", "thika", 15000, 10, "M-Pesa"),
	("Building Fund", "Other", "Kahiga Family", 20000, 11, "Bank"),
]

NEWS = [
	{
		"title": "September Intake Welcomes 140 New Students",
		"category": "News",
		"is_featured": 1,
		"days_ago": 45,
		"author": "Communications Office",
		"excerpt": "Our largest intake yet joins Main Campus and the Nakuru Extension for the new academic year.",
		"content": "<p>Mahanaim Bible College welcomed 140 new students this September across the Diploma in "
		"Biblical Studies, Diploma in Pastoral Ministry and our certificate programmes. Orientation week included "
		"campus tours, library induction, a portal walkthrough and a commissioning service led by the Principal."
		'</p><p>"You have come to be equipped, not merely educated," the Principal told the new students, '
		"reminding them that Mahanaim means <em>two camps</em> — the place where Jacob saw that God's angels "
		"were with him on the journey.</p>",
		"tags": "intake, orientation",
	},
	{
		"title": "Missions Week: Students Serve 12 Villages in Baringo",
		"category": "Ministry",
		"days_ago": 20,
		"author": "Rev. James Kamau",
		"excerpt": "Teams preached, ran children's clubs and supported a medical camp during Missions Week.",
		"content": "<p>Over five days, eight student teams partnered with local churches in Baringo County to run "
		"open-air meetings, children's clubs and a free medical camp that served more than 900 people.</p>"
		"<p>Students described the week as a highlight of their training. Thank you to every church and sponsor "
		"who made it possible.</p>",
		"tags": "missions, outreach",
	},
	{
		"title": "Nakuru Extension Opens New Library Wing",
		"category": "Campus Life",
		"days_ago": 12,
		"author": "Library Services",
		"excerpt": "Students in Nakuru now have a quiet study area, 1,200 new titles and full e-library access.",
		"content": "<p>The Nakuru Extension has opened a new library wing with 40 study seats, 1,200 new titles "
		"and dedicated computers for the digital library. The wing was funded by partner churches and alumni.</p>",
		"tags": "library, nakuru",
	},
	{
		"title": "Strength for the Journey (Genesis 32:1–2)",
		"category": "Devotional",
		"days_ago": 6,
		"author": "Rt. Rev. Stephen Mutua",
		"excerpt": "When Jacob met the angels of God he called the place Mahanaim — God's camp beside his own.",
		"content": '<p>Jacob was afraid of what lay ahead, yet before he faced Esau, "the angels of God met him" '
		"(Genesis 32:1). He named the place Mahanaim: two camps. God's camp was pitched right beside his own.</p>"
		"<p>Whatever journey you are on this term, you do not travel alone. Take courage: the Lord of hosts is "
		"with us.</p>",
		"tags": "devotional",
	},
	{
		"title": "Applications Open for the January Intake",
		"category": "Announcement",
		"days_ago": 3,
		"author": "Admissions Office",
		"excerpt": "Apply online for diploma and certificate programmes starting in January. Early applicants "
		"receive priority for accommodation.",
		"content": "<p>Applications are now open for the January intake. Create an account, complete the online "
		"form, upload your documents and pay the application fee by M-Pesa. Most applicants receive a decision "
		"within two weeks.</p>",
		"tags": "admissions",
	},
	{
		"title": "Graduation Day: Save the Date",
		"category": "Announcement",
		"days_ago": 0,
		"published": 0,
		"author": "Registrar's Office",
		"excerpt": "Details of the next graduation ceremony.",
		"content": "<p>Draft — details to be confirmed by the Registrar's office.</p>",
		"tags": "graduation",
	},
]

EVENTS = [
	{
		"title": "Open Day",
		"event_type": "Open Day",
		"days": 18,
		"hours": 6,
		"campus": "MNC",
		"venue": "Main Campus Chapel",
		"registration_required": 1,
		"capacity": 200,
		"organiser": "Admissions Office",
		"summary": "Tour the campus, sit in on a class, meet lecturers and get help with your application.",
		"description": "<p>Join us for a morning of worship, campus tours, sample lectures and one-on-one "
		"admissions advice. Bring your KCSE certificate if you'd like help completing your application.</p>",
	},
	{
		"title": "Pastors' & Church Leaders' Conference",
		"event_type": "Conference",
		"days": 40,
		"hours": 30,
		"campus": "MNC",
		"venue": "Main Campus Auditorium",
		"registration_required": 1,
		"capacity": 300,
		"fee": 1500,
		"organiser": "Office of the Principal",
		"summary": "Two days of teaching and fellowship on the theme 'Shepherds after God's Heart'.",
		"description": "<p>Plenary sessions, workshops on preaching, counselling and church finance, and "
		"fellowship with church leaders from across Kenya. The fee covers meals and conference materials.</p>",
	},
	{
		"title": "Missions Week Commissioning Service",
		"event_type": "Chapel",
		"days": -24,
		"hours": 2,
		"campus": "MNC",
		"venue": "Main Campus Chapel",
		"registration_required": 0,
		"summary": "Commissioning student mission teams before they depart for Baringo.",
		"description": "<p>A special chapel service to pray for and commission the Missions Week teams.</p>",
	},
	{
		"title": "Graduation Ceremony",
		"event_type": "Graduation",
		"days": -95,
		"hours": 5,
		"campus": "MNC",
		"venue": "Main Campus Grounds",
		"registration_required": 1,
		"capacity": 600,
		"organiser": "Registrar's Office",
		"summary": "Celebrating our graduates in the Diploma and Certificate programmes.",
		"description": "<p>Family and friends joined us to celebrate the graduating class.</p>",
	},
]

FAQS = [
	(
		"How do I apply?",
		"Admissions",
		"<p>Click <strong>Apply</strong>, create an account with your email or phone number, complete the online "
		"form, upload your documents and pay the application fee by M-Pesa. You can save and return at any time.</p>",
	),
	(
		"How much are the fees and can I pay in instalments?",
		"Fees",
		"<p>Fees range from KES 28,000 to KES 45,000 per term depending on the programme. Fees can be paid by "
		"M-Pesa or bank deposit, and the Finance Office can approve instalment plans.</p>",
	),
	(
		"Are your programmes accredited?",
		"Academics",
		"<p>Our programmes follow a recognised theological curriculum and credits can be transferred to partner "
		"degree-awarding institutions. Contact the Registrar for details.</p>",
	),
	(
		"Can I study online?",
		"Online Learning",
		"<p>Yes. The Certificate in Theology and the Diploma in Biblical Studies are available by distance "
		"learning with live weekly tutorials on the student portal.</p>",
	),
	(
		"Is accommodation available?",
		"Accommodation",
		"<p>Main Campus has limited hostel space for full-time students. Apply early; rooms are allocated on a "
		"first-come, first-served basis.</p>",
	),
	(
		"Do I need a recommendation from my pastor?",
		"General",
		"<p>Yes. Every applicant needs a recommendation from their pastor or church leadership, which you can "
		"upload during the application.</p>",
	),
]

TESTIMONIALS = [
	(
		"Rev. John Maina",
		"Senior Pastor, Harvest Fellowship Thika",
		"DBS",
		"Mahanaim gave me more than knowledge — it shaped my character and my love for God's Word. I still "
		"preach from the notes I took in Hermeneutics.",
	),
	(
		"Martha Adhiambo",
		"School Chaplain",
		"DPM",
		"The pastoral care and counselling training prepared me to walk with students through grief and crisis.",
	),
	(
		"Paul Ouma",
		"Youth Pastor, Grace Chapel Kitengela",
		"CTH",
		"Studying online meant I could keep serving my youth group while I trained. The lecturers were always "
		"available.",
	),
	(
		"Grace Wanjiku",
		"Diploma student",
		"DBS",
		"Chapel, mentoring and the student portal make it easy to grow spiritually and keep up with my studies.",
	),
]

ENQUIRIES = [
	(
		"Kevin Mutai",
		"kevin.mutai@example.com",
		"0712 998 877",
		"Admissions",
		"Hello, I would like to know if the Diploma in Pastoral Ministry is available on weekends?",
		"New",
	),
	(
		"Rose Atieno",
		"rose.atieno@example.com",
		"0723 445 566",
		"Partnership",
		"Our church would like to sponsor two students from our congregation. Who should we talk to?",
		"In Progress",
	),
	(
		"Pastor Daniel Kipkemboi",
		"pastor.kipkemboi@example.com",
		"0734 221 100",
		"General",
		"Please send me the dates for the Pastors' Conference and the fee.",
		"Responded",
	),
]

# title, item_type, authors, subject, year, access, copies, campus, extra
LIBRARY_ITEMS = [
	("Knowing God", "Book", "J. I. Packer", "Theology", 1973, "Students", 4, "MNC", {}),
	(
		"How to Read the Bible for All Its Worth",
		"Book",
		"Gordon D. Fee; Douglas Stuart",
		"Biblical Studies",
		1981,
		"Students",
		5,
		"MNC",
		{},
	),
	(
		"Africa Bible Commentary",
		"Commentary",
		"Tokunboh Adeyemo (ed.)",
		"Biblical Studies",
		2006,
		"Students",
		3,
		"MNC",
		{},
	),
	(
		"Systematic Theology: An Introduction to Biblical Doctrine",
		"Book",
		"Wayne Grudem",
		"Theology",
		1994,
		"Students",
		3,
		"MNC",
		{},
	),
	("Mere Christianity", "Book", "C. S. Lewis", "Theology", 1952, "Students", 2, "MNC", {}),
	("The Cost of Discipleship", "Book", "Dietrich Bonhoeffer", "Theology", 1937, "Students", 2, "MNC", {}),
	("Spiritual Leadership", "Book", "J. Oswald Sanders", "Leadership", 1967, "Students", 4, "NKR", {}),
	(
		"Between Two Worlds: The Art of Preaching in the Twentieth Century",
		"Book",
		"John R. W. Stott",
		"Pastoral Ministry",
		1982,
		"Students",
		3,
		"MNC",
		{},
	),
	("The Cross of Christ", "Book", "John R. W. Stott", "Theology", 1986, "Students", 2, "NKR", {}),
	(
		"Celebration of Discipline",
		"Book",
		"Richard J. Foster",
		"Pastoral Ministry",
		1978,
		"Students",
		3,
		"MNC",
		{},
	),
	(
		"Church History in Plain Language",
		"Book",
		"Bruce L. Shelley",
		"Church History",
		1982,
		"Students",
		3,
		"MNC",
		{},
	),
	("Transforming Mission", "Book", "David J. Bosch", "Missions", 1991, "Students", 2, "MNC", {}),
	(
		"The Master Plan of Evangelism",
		"Book",
		"Robert E. Coleman",
		"Missions",
		1963,
		"Students",
		3,
		"NKR",
		{},
	),
	(
		"Basics of Biblical Greek",
		"Book",
		"William D. Mounce",
		"Biblical Languages",
		1993,
		"Students",
		4,
		"MNC",
		{},
	),
	(
		"New Bible Dictionary",
		"Reference",
		"IVP",
		"Biblical Studies",
		1962,
		"Students",
		2,
		"MNC",
		{"location": "Reference section — not for loan"},
	),
	(
		"Strong's Exhaustive Concordance",
		"Reference",
		"James Strong",
		"Biblical Studies",
		1890,
		"Public",
		2,
		"MNC",
		{},
	),
	(
		"Spiritual Disciplines for the Christian Life",
		"Book",
		"Donald S. Whitney",
		"Pastoral Ministry",
		1991,
		"Students",
		2,
		"NKR",
		{},
	),
	(
		"Theology Brewed in an African Pot",
		"Book",
		"Agbonkhianmeghe E. Orobator",
		"Theology",
		2008,
		"Students",
		2,
		"MNC",
		{},
	),
	("Competent to Counsel", "Book", "Jay E. Adams", "Counselling", 1970, "Students", 2, "MNC", {}),
	(
		"Lectures to My Students",
		"E-Book",
		"C. H. Spurgeon",
		"Pastoral Ministry",
		1875,
		"Public",
		0,
		None,
		{"external_url": "https://www.ccel.org/ccel/spurgeon/lectures.html"},
	),
	(
		"Confessions",
		"E-Book",
		"Augustine of Hippo",
		"Church History",
		None,
		"Public",
		0,
		None,
		{"external_url": "https://www.gutenberg.org/ebooks/3296"},
	),
	(
		"The Pilgrim's Progress",
		"E-Book",
		"John Bunyan",
		"General",
		1678,
		"Public",
		0,
		None,
		{"external_url": "https://www.gutenberg.org/ebooks/131"},
	),
	(
		"Institutes of the Christian Religion",
		"E-Book",
		"John Calvin",
		"Theology",
		1536,
		"Students",
		0,
		None,
		{"external_url": "https://www.ccel.org/ccel/calvin/institutes.html"},
	),
	(
		"Commentary on the Whole Bible",
		"Commentary",
		"Matthew Henry",
		"Biblical Studies",
		1706,
		"Public",
		0,
		None,
		{"external_url": "https://www.ccel.org/ccel/henry/mhc.html"},
	),
	(
		"Africa Journal of Evangelical Theology (selected issues)",
		"Journal",
		"Various",
		"Theology",
		2020,
		"Students",
		1,
		"MNC",
		{},
	),
	(
		"Christian Leadership in Africa: Case Studies",
		"Periodical",
		"MBC Leadership Department",
		"Leadership",
		2024,
		"Students",
		1,
		"NKR",
		{},
	),
	(
		"The Role of Lay Leaders in Rural Church Growth in Nakuru County",
		"Thesis",
		"John Maina",
		"Pastoral Ministry",
		2023,
		"Staff",
		1,
		"MNC",
		{},
	),
	(
		"Chapel Sermon Series: Nehemiah — Rebuilding the Walls",
		"Audio",
		"Rt. Rev. Stephen Mutua",
		"Pastoral Ministry",
		2025,
		"Students",
		0,
		None,
		{"external_url": "https://www.youtube.com/results?search_query=nehemiah+sermon+series"},
	),
	(
		"Homiletics Masterclass: From Text to Sermon",
		"Video",
		"Pastor Joseph Mwangi",
		"Pastoral Ministry",
		2025,
		"Students",
		0,
		None,
		{"external_url": "https://www.youtube.com/results?search_query=expository+preaching"},
	),
	(
		"Faculty Handbook: Assessment and Moderation",
		"Reference",
		"Academic Office",
		"General",
		2026,
		"Staff",
		0,
		None,
		{"external_url": "https://example.com/mbc/faculty-handbook.pdf"},
	),
]

# item title, borrower first name (student) or staff key, kind, issued days ago, due in days, status
LOANS = [
	("How to Read the Bible for All Its Worth", "Grace", "student", 5, 9, "Issued"),
	("Knowing God", "Grace", "student", 25, -11, "Issued"),
	("Africa Bible Commentary", "Brian", "student", 30, -16, "Returned"),
	(
		"Between Two Worlds: The Art of Preaching in the Twentieth Century",
		"Daniel",
		"student",
		8,
		6,
		"Issued",
	),
	("Spiritual Leadership", "Ann", "student", 20, -6, "Issued"),
	("Transforming Mission", "kimani", "staff", 10, 20, "Issued"),
	("Celebration of Discipline", "Mercy", "student", 0, 14, "Requested"),
]

ANNOUNCEMENTS = [
	{
		"title": "Welcome to the new term",
		"audience": "Everyone",
		"is_pinned": 1,
		"body": "<p>Welcome back! Lectures, chapel and the library are running on the normal timetable. Check "
		"your portal for your courses, assignments and fee statement.</p>",
	},
	{
		"title": "Missions Week 2–6 November",
		"audience": "All Students",
		"body": "<p>All full-time students take part in Missions Week. Team lists and travel details are on the "
		"chapel notice board. Bring a sleeping bag and your Bible.</p>",
	},
	{
		"title": "THE106: CAT 1 is open on the portal",
		"audience": "Course Offering",
		"offering": "THE106",
		"body": "<p>CAT 1 on the Doctrine of God is open in the Exams section. You have 40 minutes once you start. "
		"God bless your preparation.</p>",
	},
	{
		"title": "Termly sponsor reports are ready",
		"audience": "Sponsors",
		"body": "<p>Thank you for standing with our students. Progress reports for this term are available on "
		"your sponsor portal.</p>",
	},
]

STUDENT_NOTIFICATIONS = [
	(
		"Fee statement updated",
		"Finance",
		"/student/finance",
		"Your fee statement for this term is ready. Your outstanding balance is shown on the Finance page.",
	),
	(
		"Library book overdue",
		"Info",
		"/student/library",
		"'Knowing God' is overdue. Please return it to the library to avoid further fines.",
	),
	(
		"Chapel this Wednesday",
		"Event",
		"/student",
		"Join us at 10:00am in the Main Campus Chapel. Theme: Two Camps — God with us on the journey.",
	),
]

WEBSITE = {
	"announcement_bar": "Applications for the January intake are open — apply online today.",
	"announcement_link": "/apply",
	"about_body": "<p>Mahanaim Bible College is a Christ-centred training institution that has equipped "
	"pastors, missionaries and church leaders in Kenya for over 25 years. From our Main Campus in Nairobi and "
	"our Nakuru Extension, we train students on campus, on weekends and online.</p>",
	"statement_of_faith": "<ul><li>We believe the Bible is the inspired, infallible and authoritative Word of "
	"God.</li><li>We believe in one God, eternally existing in three persons: Father, Son and Holy Spirit.</li>"
	"<li>We believe in the deity of our Lord Jesus Christ, His virgin birth, sinless life, atoning death and "
	"bodily resurrection.</li><li>We believe salvation is by grace through faith in Christ alone.</li><li>We "
	"believe in the present ministry of the Holy Spirit and the mission of the Church to make disciples of all "
	"nations.</li></ul>",
	"history": "<p>The college began in 1999 as an evening Bible school in a church hall in Kasarani with 18 "
	"students. It moved to its own campus off Thika Road in 2008, opened the Nakuru Extension in 2016 and "
	"launched online learning in 2020.</p>",
	"principal_name": "Rt. Rev. Stephen Mutua",
	"principal_title": "Principal",
	"principal_message": "<p>Welcome to Mahanaim Bible College. Our name recalls the place where Jacob "
	"discovered that God's camp was right beside his own (Genesis 32:2). We believe God is raising a "
	"generation of servant leaders for His church in Africa, and it is our joy to walk with them as they are "
	"equipped in the Word, in character and in ministry.</p>",
	"admissions_intro": "<p>We admit students in January, May and September. Applications are completed "
	"online and most applicants receive a decision within two weeks.</p>",
	"fees_intro": "<p>Fees are charged per term and can be paid by M-Pesa or bank deposit. Sponsored students "
	"and church-supported students are welcome; speak to the Finance Office about instalments.</p>",
	"library_intro": "<p>Our library holds more than 12,000 titles across both campuses, plus a growing "
	"digital collection open to students anywhere.</p>",
	"contact_phone": "0722 410 300",
	"contact_email": "info@mahanaim.ac.ke",
	"whatsapp": "254722410300",
	"contact_address": "Off Thika Road, Kasarani, P.O. Box 41230-00100, Nairobi",
	"map_embed_url": "https://maps.google.com/maps?q=Kasarani%20Nairobi&output=embed",
	"facebook": "https://facebook.com/mahanaimbiblecollege",
	"youtube": "https://youtube.com/@mahanaimbiblecollege",
	"instagram": "https://instagram.com/mahanaimbiblecollege",
	"x_twitter": "https://x.com/mahanaimbc",
	"footer_text": "Equipping servants for the Kingdom since 1999.",
	"meta_description": "Mahanaim Bible College — diploma and certificate programmes in Biblical Studies, "
	"Pastoral Ministry, Theology and Christian Leadership in Nairobi, Nakuru and online.",
}

# THE106 question bank for the demo CAT: (type, marks, question, payload)
QUESTIONS = [
	(
		"Multiple Choice",
		1,
		"Which attribute of God describes His being present everywhere at once?",
		{"options": [("Omnipresence", 1), ("Omniscience", 0), ("Immutability", 0), ("Aseity", 0)]},
	),
	(
		"Multiple Choice",
		1,
		"Which council in AD 325 affirmed that the Son is 'of one substance' with the Father?",
		{"options": [("Nicaea", 1), ("Chalcedon", 0), ("Trent", 0), ("Jerusalem", 0)]},
	),
	(
		"Multiple Select",
		2,
		"Which of the following are communicable attributes of God? (Select all that apply.)",
		{
			"options": [
				("Love", 1),
				("Holiness", 1),
				("Faithfulness", 1),
				("Omnipresence", 0),
				("Self-existence", 0),
			]
		},
	),
	(
		"True or False",
		1,
		"God's immutability means that He does not change in His being, perfections, purposes or promises.",
		{"correct_boolean": "True"},
	),
	(
		"True or False",
		1,
		"General revelation alone is sufficient to bring a person to saving faith in Christ.",
		{"correct_boolean": "False"},
	),
	(
		"Fill in the Blank",
		1,
		"The theological term for God's self-existence (He depends on nothing outside Himself) is ______.",
		{"accepted_answers": "aseity"},
	),
	(
		"Matching",
		2,
		"Match each passage to the attribute of God it most clearly teaches.",
		{
			"pairs": [
				("Malachi 3:6", "Immutability"),
				("Psalm 139:7–10", "Omnipresence"),
				("1 John 4:8", "Love"),
				("Isaiah 6:3", "Holiness"),
			]
		},
	),
	(
		"Essay",
		5,
		"In not more than 300 words, explain why the doctrine of the Trinity matters for Christian "
		"worship and ministry in an African church context.",
		{
			"marking_guide": "Award up to 2 marks for an accurate statement of the doctrine, 2 for connecting it to "
			"worship/prayer, and 1 for a relevant contextual application."
		},
	),
]
