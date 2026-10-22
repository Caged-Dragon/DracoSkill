"""
DracoSkill — database layer.

SQLite, zero install, one file. Every function opens and closes its own
connection rather than sharing one across threads, which is the safe way
to use sqlite3 from a multi-threaded server (each request handler runs in
its own thread here).
"""
import os
import sqlite3

DB_PATH = os.environ.get(
    "DRACOSKILL_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "dracoskill.db"),
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("PRAGMA journal_mode=WAL")  # tolerate concurrent requests from the threaded server
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            problem_id TEXT NOT NULL,
            language TEXT NOT NULL,
            code TEXT NOT NULL,
            verdict TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'private',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS project_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id),
            UNIQUE(project_id, filename)
        );
        CREATE TABLE IF NOT EXISTS project_file_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_file_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            saved_at TEXT NOT NULL,
            FOREIGN KEY(project_file_id) REFERENCES project_files(id)
        );
        CREATE TABLE IF NOT EXISTS certificates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            certificate_code TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            track_name TEXT NOT NULL,
            problems_solved INTEGER NOT NULL,
            problems_total INTEGER NOT NULL,
            total_submissions INTEGER NOT NULL,
            accuracy_pct REAL NOT NULL,
            issued_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    """)
    conn.commit()
    conn.close()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.chmod(DB_PATH + suffix, 0o600)  # server-only: sandboxed user code must never read password hashes
        except OSError:
            pass
