"""Grading and GPA (owned by backend domain B2).

CONTRACT:
	grade_for(score: float, scale: str | None = None) -> dict {grade, grade_points, is_pass, description}
	classification_for(cgpa: float, scale: str | None = None) -> str | None
	compute_gpa(student: str, academic_term: str | None = None) -> dict {gpa, credits, quality_points}
	refresh_student_standing(student: str) -> dict  # updates Student.cgpa / credits_earned / academic_standing
"""

import frappe


def grade_for(score, scale=None) -> dict:
	raise NotImplementedError


def classification_for(cgpa, scale=None):
	raise NotImplementedError


def compute_gpa(student, academic_term=None) -> dict:
	raise NotImplementedError


def refresh_student_standing(student) -> dict:
	raise NotImplementedError
