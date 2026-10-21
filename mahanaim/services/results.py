"""Results services (owned by backend domain B2).

CONTRACT:
	transcript_data(student: str, as_of_term: str | None = None, published_only: bool = True) -> dict
		{"student": {...}, "terms": [{"term", "label", "courses": [{code,title,credits,total,grade,grade_points,
		 status}], "gpa", "credits"}], "cgpa", "total_credits", "classification"}
		Used by credentials (B3) to snapshot transcripts.
"""

import frappe


def transcript_data(student, as_of_term=None, published_only=True) -> dict:
	raise NotImplementedError
