"""Frappe LMS bridge (owned by backend domain B2). LMS is a SOFT dependency (has_app("lms")).

CONTRACT:
	sync_offering(offering) -> str | None      # create/update LMS Course for a Course Offering
	enrol(course_enrolment) -> str | None      # create LMS Enrollment; respects lms fee clearance
	unenrol(course_enrolment)                  # remove/deactivate LMS Enrollment
	lms_course_url(offering) -> str | None
"""

import frappe


def sync_offering(offering) -> str | None:
	return None


def enrol(course_enrolment) -> str | None:
	return None


def unenrol(course_enrolment):
	pass


def lms_course_url(offering) -> str | None:
	return None
