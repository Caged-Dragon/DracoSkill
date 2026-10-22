"""
DracoSkill — project persistence.

Multi-file projects, actually saved. Every mutating function checks
ownership before touching anything -- a user can rename, save, or delete
only their own projects. Reading a project is allowed for the owner
always, and for anyone else only if its visibility is 'unlisted' or
'public' (a private project 404s for non-owners rather than 403ing, so
its existence isn't leaked either).

Every file save also appends a row to project_file_versions -- a real,
if simple, version history: an append-only log of what the file
contained at each save, not just a last-modified timestamp.
"""
from datetime import datetime, timezone

from db import get_db
from workspace import valid_filename

VALID_VISIBILITY = ("private", "unlisted", "public")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _owns(conn, project_id, user_id):
    row = conn.execute("SELECT user_id FROM projects WHERE id = ?", (project_id,)).fetchone()
    return row is not None and row["user_id"] == user_id


def create_project(user_id, name):
    name = (name or "").strip()
    if not name:
        return {"error": "Project name is required"}, 400
    conn = get_db()
    now = _now()
    cur = conn.execute(
        "INSERT INTO projects (user_id, name, visibility, created_at, updated_at) VALUES (?, ?, 'private', ?, ?)",
        (user_id, name, now, now),
    )
    project_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": project_id, "name": name, "visibility": "private", "files": []}, 200


def list_projects(user_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, visibility, created_at, updated_at FROM projects "
        "WHERE user_id = ? ORDER BY updated_at DESC",
        (user_id,),
    ).fetchall()
    conn.close()
    return {"projects": [dict(r) for r in rows]}, 200


def get_project(project_id, requesting_user_id):
    conn = get_db()
    proj = conn.execute(
        "SELECT id, user_id, name, visibility, created_at, updated_at FROM projects WHERE id = ?",
        (project_id,),
    ).fetchone()
    if proj is None:
        conn.close()
        return {"error": "Project not found"}, 404

    is_owner = proj["user_id"] == requesting_user_id
    if not is_owner and proj["visibility"] == "private":
        conn.close()
        return {"error": "Project not found"}, 404  # don't leak existence of private projects

    files = conn.execute(
        "SELECT filename, content, updated_at FROM project_files WHERE project_id = ? ORDER BY filename",
        (project_id,),
    ).fetchall()
    conn.close()
    return {
        "id": proj["id"], "name": proj["name"], "visibility": proj["visibility"],
        "owner": is_owner, "created_at": proj["created_at"], "updated_at": proj["updated_at"],
        "files": [dict(f) for f in files],
    }, 200


def rename_project(project_id, user_id, new_name):
    new_name = (new_name or "").strip()
    if not new_name:
        return {"error": "Project name is required"}, 400
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    conn.execute("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", (new_name, _now(), project_id))
    conn.commit()
    conn.close()
    return {"status": "ok", "name": new_name}, 200


def set_visibility(project_id, user_id, visibility):
    if visibility not in VALID_VISIBILITY:
        return {"error": f"Visibility must be one of {VALID_VISIBILITY}"}, 400
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    conn.execute("UPDATE projects SET visibility = ?, updated_at = ? WHERE id = ?", (visibility, _now(), project_id))
    conn.commit()
    conn.close()
    return {"status": "ok", "visibility": visibility}, 200


def delete_project(project_id, user_id):
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    file_ids = [r["id"] for r in conn.execute("SELECT id FROM project_files WHERE project_id = ?", (project_id,)).fetchall()]
    for fid in file_ids:
        conn.execute("DELETE FROM project_file_versions WHERE project_file_id = ?", (fid,))
    conn.execute("DELETE FROM project_files WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}, 200


def duplicate_project(project_id, user_id, new_name=None):
    conn = get_db()
    proj = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if proj is None or (proj["user_id"] != user_id and proj["visibility"] == "private"):
        conn.close()
        return {"error": "Project not found"}, 404

    now = _now()
    name = (new_name or f"{proj['name']} (copy)").strip()
    cur = conn.execute(
        "INSERT INTO projects (user_id, name, visibility, created_at, updated_at) VALUES (?, ?, 'private', ?, ?)",
        (user_id, name, now, now),
    )
    new_id = cur.lastrowid
    files = conn.execute("SELECT filename, content FROM project_files WHERE project_id = ?", (project_id,)).fetchall()
    for f in files:
        conn.execute(
            "INSERT INTO project_files (project_id, filename, content, updated_at) VALUES (?, ?, ?, ?)",
            (new_id, f["filename"], f["content"], now),
        )
    conn.commit()
    conn.close()
    return {"id": new_id, "name": name}, 200


def create_file(project_id, user_id, filename, content=""):
    filename = (filename or "").strip()
    if not filename:
        return {"error": "Filename is required"}, 400
    if not valid_filename(filename):
        return {"error": "Invalid filename. Use letters, digits, . _ - + and optional folders like src/Main.java "
                         "(no .., no leading dot, no node_modules/build/.libs)."}, 400
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    existing = conn.execute(
        "SELECT id FROM project_files WHERE project_id = ? AND filename = ?", (project_id, filename)
    ).fetchone()
    if existing:
        conn.close()
        return {"error": "A file with that name already exists"}, 409
    now = _now()
    conn.execute(
        "INSERT INTO project_files (project_id, filename, content, updated_at) VALUES (?, ?, ?, ?)",
        (project_id, filename, content, now),
    )
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    conn.commit()
    conn.close()
    return {"status": "ok", "filename": filename}, 200


def save_file(project_id, user_id, filename, content):
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    file_row = conn.execute(
        "SELECT id FROM project_files WHERE project_id = ? AND filename = ?", (project_id, filename)
    ).fetchone()
    if file_row is None:
        conn.close()
        return {"error": "File not found"}, 404
    now = _now()
    conn.execute("UPDATE project_files SET content = ?, updated_at = ? WHERE id = ?", (content, now, file_row["id"]))
    conn.execute(
        "INSERT INTO project_file_versions (project_file_id, content, saved_at) VALUES (?, ?, ?)",
        (file_row["id"], content, now),
    )
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    conn.commit()
    conn.close()
    return {"status": "ok", "saved_at": now}, 200


def delete_file(project_id, user_id, filename):
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    file_row = conn.execute(
        "SELECT id FROM project_files WHERE project_id = ? AND filename = ?", (project_id, filename)
    ).fetchone()
    if file_row is None:
        conn.close()
        return {"error": "File not found"}, 404
    conn.execute("DELETE FROM project_file_versions WHERE project_file_id = ?", (file_row["id"],))
    conn.execute("DELETE FROM project_files WHERE id = ?", (file_row["id"],))
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (_now(), project_id))
    conn.commit()
    conn.close()
    return {"status": "ok"}, 200


def get_file_history(project_id, user_id, filename):
    conn = get_db()
    if not _owns(conn, project_id, user_id):
        conn.close()
        return {"error": "Project not found"}, 404
    file_row = conn.execute(
        "SELECT id FROM project_files WHERE project_id = ? AND filename = ?", (project_id, filename)
    ).fetchone()
    if file_row is None:
        conn.close()
        return {"error": "File not found"}, 404
    versions = conn.execute(
        "SELECT content, saved_at FROM project_file_versions WHERE project_file_id = ? ORDER BY saved_at DESC",
        (file_row["id"],),
    ).fetchall()
    conn.close()
    return {"filename": filename, "versions": [dict(v) for v in versions]}, 200
