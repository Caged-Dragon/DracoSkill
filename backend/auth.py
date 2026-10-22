"""
DracoSkill — accounts and sessions.

Username + password only (no email) -- there's no way to send a
verification email from here, so a fake "email" field that's never
checked would just be theater.

Passwords are hashed with salted PBKDF2-HMAC-SHA256 (stdlib only, no
bcrypt/argon2 dependency to install), never stored plain. Sessions are
random tokens stored server-side in SQLite, sent by the client as a
X-Session-Token header -- not a cookie, which sidesteps cross-origin
cookie complexity between the frontend's origin and this API's origin.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from db import get_db


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return digest.hex(), salt


def verify_password(password, salt, expected_hash):
    computed, _ = hash_password(password, salt)
    return hmac.compare_digest(computed, expected_hash)


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    conn = get_db()
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    return token


def get_user_from_token(token):
    if not token:
        return None
    conn = get_db()
    row = conn.execute(
        "SELECT users.id, users.username FROM sessions "
        "JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?",
        (token,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def handle_register(body):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if len(username) < 3:
        return {"error": "Username must be at least 3 characters"}, 400
    if len(password) < 6:
        return {"error": "Password must be at least 6 characters"}, 400

    conn = get_db()
    if conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
        conn.close()
        return {"error": "That username is already taken"}, 409

    pw_hash, salt = hash_password(password)
    cur = conn.execute(
        "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
        (username, pw_hash, salt, datetime.now(timezone.utc).isoformat()),
    )
    user_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"token": create_session(user_id), "username": username}, 200


def handle_login(body):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    conn = get_db()
    row = conn.execute(
        "SELECT id, password_hash, salt FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()
    if row is None or not verify_password(password, row["salt"], row["password_hash"]):
        return {"error": "Invalid username or password"}, 401
    return {"token": create_session(row["id"]), "username": username}, 200


def handle_logout(token):
    if token:
        conn = get_db()
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
    return {"status": "ok"}, 200
