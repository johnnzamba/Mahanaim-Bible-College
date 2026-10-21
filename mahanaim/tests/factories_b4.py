"""Test factories for backend domain B4 (website, communication, church, library, dashboard)."""

from __future__ import annotations

import frappe
from frappe.utils import add_days, add_to_date, now_datetime, nowdate, random_string

from mahanaim.tests import factories as f


def make_news(title="Chapel Week News _T", published=1, published_on=None, category="News", **extra):
	doc = frappe.get_doc(
		{
			"doctype": "News Post",
			"title": title,
			"category": category,
			"published": published,
			"published_on": published_on,
			"content": f"<p>{title}: the full story.</p>",
			**extra,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_event(title="Missions Conference _T", capacity=0, fee=0, days_ahead=10, status="Upcoming", **extra):
	start = add_to_date(now_datetime(), days=days_ahead)
	doc = frappe.get_doc(
		{
			"doctype": "Campus Event",
			"title": title,
			"status": status,
			"start_datetime": start,
			"end_datetime": add_to_date(start, hours=3),
			"venue": "Main Chapel",
			"is_public": 1,
			"registration_required": 1,
			"capacity": capacity,
			"fee": fee,
			"description": "<p>Join us.</p>",
			**extra,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_sponsor(name="Grace Partners _T", email=None, user=None, sponsor_type="Organisation"):
	doc = frappe.get_doc(
		{
			"doctype": "Sponsor",
			"sponsor_name": name,
			"sponsor_type": sponsor_type,
			"email": email or f"sponsor.{random_string(6).lower()}@example.com",
			"phone": "0722000111",
			"user": user,
			"status": "Active",
		}
	)
	doc.flags.create_user = False
	doc.insert(ignore_permissions=True)
	return doc


def make_sponsor_with_user(name="Portal Sponsor _T"):
	user = f.make_user(roles=("Sponsor",), first_name="Sponsor")
	return make_sponsor(name, email=user.name, user=user.name), user.name


def make_sponsorship(
	sponsor, student, coverage="Fixed Amount", amount=20000, percentage=None, status="Active"
):
	doc = frappe.get_doc(
		{
			"doctype": "Sponsorship",
			"sponsor": sponsor,
			"student": student,
			"coverage": coverage,
			"amount": amount,
			"percentage": percentage,
			"status": status,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_giving_type(name="Scholarship Fund _T", allow_online=1):
	if frappe.db.exists("Giving Type", name):
		return frappe.get_doc("Giving Type", name)
	doc = frappe.get_doc(
		{
			"doctype": "Giving Type",
			"giving_type_name": name,
			"is_active": 1,
			"allow_online": allow_online,
			"suggested_amounts": "500, 1000",
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_library_item(
	title="Systematic Theology _T", copies=1, access_level="Students", item_type="Book", **extra
):
	doc = frappe.get_doc(
		{
			"doctype": "Library Item",
			"title": title,
			"item_type": item_type,
			"subject": "Theology",
			"authors": "Test Author",
			"access_level": access_level,
			"total_copies": copies,
			**extra,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_loan(item, student, issue_date=None, due_date=None):
	doc = frappe.get_doc(
		{
			"doctype": "Library Loan",
			"library_item": item,
			"borrower_type": "Student",
			"student": student,
			"status": "Issued",
			"issue_date": issue_date,
			"due_date": due_date,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def make_announcement(title, audience="Everyone", status="Sent", **extra):
	doc = frappe.get_doc(
		{
			"doctype": "Announcement",
			"title": title,
			"audience": audience,
			"status": status,
			"show_in_portal": 1,
			"body": f"<p>{title}</p>",
			"sent_on": now_datetime() if status == "Sent" else None,
			**extra,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


def days_ago(days: int):
	return add_days(nowdate(), -days)
