"""
DracoSkill — certificates.

Eligibility and every number on the certificate come from the real
submissions table, not a hardcoded score. "Course completion" doesn't
exist yet (that's Version 6), so eligibility is: solved every problem
currently in the set. Swap the query in `_progress()` for a real course
check once courses exist -- nothing else here needs to change.

Certificates are immutable once issued: re-issuing for a user who already
has one just returns the existing record rather than creating a second,
different one from later (possibly worse) submission data.
"""
import os
import secrets
from datetime import datetime, timezone

from db import get_db
from judge import PROBLEMS

TRACK_NAME = "DracoSkill Problem Solving"

# The domain confirmation links point to. Defaults to where this backend
# actually runs right now. Deploy for real and set the env var -- every
# certificate issued after that points at your real domain automatically;
# nothing else in this file needs to change.
BASE_URL = os.environ.get("DRACOSKILL_BASE_URL", "http://localhost:8787")


def _generate_code():
    # Two lowercase hex segments, hyphenated -- unique, URL-safe, no
    # ambiguous characters, and doesn't look like a sequential row ID.
    return f"{secrets.token_hex(6)}-{secrets.token_hex(6)}"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _progress(conn, user_id):
    total = len(PROBLEMS)
    rows = conn.execute(
        "SELECT problem_id, verdict FROM submissions WHERE user_id = ?", (user_id,)
    ).fetchall()
    solved = {r["problem_id"] for r in rows if r["verdict"] == "Accepted" and r["problem_id"] in PROBLEMS}
    total_submissions = len(rows)
    accepted_submissions = sum(1 for r in rows if r["verdict"] == "Accepted")
    accuracy = round((accepted_submissions / total_submissions) * 100, 1) if total_submissions else 0.0
    return {
        "problems_solved": len(solved),
        "problems_total": total,
        "total_submissions": total_submissions,
        "accuracy_pct": accuracy,
        "eligible": len(solved) >= total and total > 0,
    }


def get_progress(user_id):
    conn = get_db()
    progress = _progress(conn, user_id)
    conn.close()
    return progress, 200


def issue_certificate(user_id, username):
    conn = get_db()
    existing = conn.execute(
        "SELECT * FROM certificates WHERE user_id = ?", (user_id,)
    ).fetchone()
    if existing:
        conn.close()
        return _serialize(existing, username), 200

    progress = _progress(conn, user_id)
    if not progress["eligible"]:
        conn.close()
        return {
            "error": "Not eligible yet",
            "problems_solved": progress["problems_solved"],
            "problems_total": progress["problems_total"],
        }, 400

    code = _generate_code()
    now = _now()
    conn.execute(
        "INSERT INTO certificates (certificate_code, user_id, track_name, problems_solved, "
        "problems_total, total_submissions, accuracy_pct, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (code, user_id, TRACK_NAME, progress["problems_solved"], progress["problems_total"],
         progress["total_submissions"], progress["accuracy_pct"], now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM certificates WHERE certificate_code = ?", (code,)).fetchone()
    conn.close()
    return _serialize(row, username), 200


def get_my_certificate(user_id, username):
    conn = get_db()
    row = conn.execute("SELECT * FROM certificates WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    if row is None:
        return {"issued": False}, 200
    result = _serialize(row, username)
    result["issued"] = True
    return result, 200


def verify_certificate(code):
    conn = get_db()
    row = conn.execute(
        "SELECT certificates.*, users.username FROM certificates "
        "JOIN users ON users.id = certificates.user_id WHERE certificate_code = ?",
        (code,),
    ).fetchone()
    conn.close()
    if row is None:
        return {"valid": False}, 404
    result = _serialize(row, row["username"])
    result["valid"] = True
    return result, 200


def _serialize(row, username):
    return {
        "certificate_code": row["certificate_code"],
        "username": username,
        "track_name": row["track_name"],
        "problems_solved": row["problems_solved"],
        "problems_total": row["problems_total"],
        "total_submissions": row["total_submissions"],
        "accuracy_pct": row["accuracy_pct"],
        "issued_at": row["issued_at"],
        "confirmation_url": f"{BASE_URL}/confirmation/{row['certificate_code']}",
    }
