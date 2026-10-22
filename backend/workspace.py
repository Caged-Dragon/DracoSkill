"""
DracoSkill — per-user workspaces on the server's disk.

Layout (all under DRACOSKILL_DATA_DIR):

  users/<user_id>/
    .cache/                 shared pip/npm download cache for this user
    account/                account-scope: libraries available to ALL the user's projects
      .libs/python  .libs/java  .libs/c
      node_modules/         (npm --prefix account/)
      home/                 working dir for the terminal when no project is open
    projects/<project_id>/
      src/                  the project's source files, materialised from the database
      build/                compiler output (class files, binaries) -- never synced back
      .libs/python  .libs/java  .libs/c
      node_modules/         (npm --prefix projects/<id>/; found by Node because src/ is its child)

The database stays the source of truth for source files. materialize() writes
them to src/ before every run or terminal command. A manifest remembers which
files came from the DB, so a file the DB no longer has is removed from disk
while files a program created at run time (out.txt, a.out) are left alone.
"""
import json
import os
import re
import shutil
import tempfile

from sandbox import sandbox_uid, can_drop_privileges

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DRACOSKILL_DATA_DIR", os.path.join(BACKEND_DIR, "workspaces"))
USER_QUOTA_MB = int(os.environ.get("DRACOSKILL_USER_QUOTA_MB", "1024"))
MAX_FILE_BYTES = 1_000_000

_PART_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._+\- ]{0,99}$")
_RESERVED = {"node_modules", "build", ".libs"}


def valid_filename(name):
    """Project filenames are untrusted input that later becomes a path on disk."""
    if not isinstance(name, str) or not name or len(name) > 200 or "\x00" in name or "\\" in name:
        return False
    if name.startswith("/"):
        return False
    parts = name.split("/")
    return all(_PART_RE.match(p) and p not in _RESERVED and p not in (".", "..") for p in parts)


def _chown(path, uid):
    if uid is not None and can_drop_privileges():
        try:
            os.chown(path, uid, uid)
        except OSError:
            pass


def _mkdir(path, uid, mode=0o700):
    os.makedirs(path, exist_ok=True)
    os.chmod(path, mode)
    _chown(path, uid)


def chown_tree(path, uid):
    if uid is None or not can_drop_privileges():
        return
    for root, dirs, files in os.walk(path):
        for n in dirs + files:
            try:
                os.lchown(os.path.join(root, n), uid, uid)
            except OSError:
                pass
    _chown(path, uid)


def init_data_dir():
    os.makedirs(os.path.join(DATA_DIR, "users"), exist_ok=True)
    # Traversable (not listable) so a per-user uid can reach its own 700 directory.
    os.chmod(DATA_DIR, 0o711)
    os.chmod(os.path.join(DATA_DIR, "users"), 0o711)


def find_untraversable_ancestor():
    """With per-user uids, every directory from / down to DATA_DIR must have the
    'other-execute' bit, or sandboxed processes can't reach their own workspace
    (symptom: 'Permission denied' on files that clearly exist). Returns the first
    offending directory, or None."""
    if not can_drop_privileges():
        return None
    p = os.path.abspath(DATA_DIR)
    while True:
        try:
            if not (os.stat(p).st_mode & 0o001):
                return p
        except OSError:
            return p
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent


def ensure_traversable():
    """Platforms like Render mount the disk at /var/data with their own permissions,
    hiding what the Dockerfile set. Sandbox uids need only the 'other-execute' bit
    on each ancestor (traverse, not list). Add exactly that bit, nothing more.
    Returns the directory that still blocks access, or None."""
    for _ in range(12):
        blocked = find_untraversable_ancestor()
        if not blocked:
            return None
        try:
            os.chmod(blocked, os.stat(blocked).st_mode | 0o001)
        except OSError:
            return blocked
    return find_untraversable_ancestor()


def find_world_writable_source():
    """Sandboxed code must never be able to modify the server itself. Files that
    came from a Windows-made zip are often extracted world-writable (666/777).
    Returns a list of offending paths (empty when fine, or when uids aren't dropped)."""
    if not can_drop_privileges():
        return []
    bad = []
    for root, dirs, files in os.walk(BACKEND_DIR):
        dirs[:] = [d for d in dirs if d not in ("workspaces", "__pycache__")]
        for n in dirs + files:
            full = os.path.join(root, n)
            try:
                if os.lstat(full).st_mode & 0o002 and not os.path.islink(full):
                    bad.append(full)
            except OSError:
                pass
    try:
        if os.stat(BACKEND_DIR).st_mode & 0o002:
            bad.append(BACKEND_DIR)
    except OSError:
        pass
    return bad


class Workspace:
    """Paths for one user, optionally scoped to one project. user_id=None -> anonymous scratch."""

    def __init__(self, user_id, project_id=None):
        self.user_id = user_id
        self.project_id = project_id
        self.uid = sandbox_uid(user_id)
        self._anon_dir = None
        if user_id is None:
            init_data_dir()
            os.makedirs(os.path.join(DATA_DIR, "anon"), exist_ok=True)
            os.chmod(os.path.join(DATA_DIR, "anon"), 0o711)
            self._anon_dir = tempfile.mkdtemp(prefix="run-", dir=os.path.join(DATA_DIR, "anon"))
            self.user_root = self._anon_dir
            self.account = self._anon_dir
            self.project = None
            self.src = os.path.join(self._anon_dir, "src")
            self.build = os.path.join(self._anon_dir, "build")
            self.tmp = os.path.join(self._anon_dir, ".tmp")
            self.cache = os.path.join(self._anon_dir, ".cache")
            self.home = self._anon_dir
            for d in (self._anon_dir, self.src, self.build, self.tmp):
                _mkdir(d, self.uid)
            return

        init_data_dir()
        self.user_root = os.path.join(DATA_DIR, "users", str(int(user_id)))
        self.account = os.path.join(self.user_root, "account")
        self.cache = os.path.join(self.user_root, ".cache")
        _mkdir(self.user_root, self.uid)
        _mkdir(self.account, self.uid)
        _mkdir(self.cache, self.uid)
        if project_id is not None:
            self.project = os.path.join(self.user_root, "projects", str(int(project_id)))
            _mkdir(os.path.join(self.user_root, "projects"), self.uid)
            _mkdir(self.project, self.uid)
            self.src = os.path.join(self.project, "src")
            self.build = os.path.join(self.project, "build")
            self.tmp = os.path.join(self.project, ".tmp")
        else:
            self.project = None
            self.src = os.path.join(self.account, "home")
            self.build = os.path.join(self.account, "build")
            self.tmp = os.path.join(self.account, ".tmp")
        self.home = self.src
        for d in (self.src, self.build, self.tmp):
            _mkdir(d, self.uid)

    # ---- library locations ----
    def scope_root(self, scope):
        """scope: 'project' or 'account'."""
        if scope == "project" and self.project:
            return self.project
        return self.account

    def lib_dir(self, scope, kind):
        return os.path.join(self.scope_root(scope), ".libs", kind)

    def ensure_lib_dir(self, scope, kind):
        p = self.lib_dir(scope, kind)
        os.makedirs(p, exist_ok=True)
        chown_tree(os.path.join(self.scope_root(scope), ".libs"), self.uid)
        return p

    def all_scopes(self):
        return ["project", "account"] if self.project else ["account"]

    def python_paths(self):
        return [self.lib_dir(s, "python") for s in self.all_scopes() if os.path.isdir(self.lib_dir(s, "python"))]

    def node_paths(self):
        return [os.path.join(self.scope_root(s), "node_modules") for s in self.all_scopes()
                if os.path.isdir(os.path.join(self.scope_root(s), "node_modules"))]

    def jars(self):
        out = []
        for s in self.all_scopes():
            d = self.lib_dir(s, "java")
            if os.path.isdir(d):
                out += sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".jar"))
        return out

    def c_include_dirs(self):
        out = []
        for s in self.all_scopes():
            base = self.lib_dir(s, "c")
            if not os.path.isdir(base):
                continue
            out.append(base)  # single headers live directly in .libs/c
            for name in sorted(os.listdir(base)):
                d = os.path.join(base, name)
                if os.path.isdir(d):
                    out += [p for p in (d, os.path.join(d, "include"), os.path.join(d, "src")) if os.path.isdir(p)]
        return out

    def run_env_extra(self):
        extra = {}
        if self.python_paths():
            extra["PYTHONPATH"] = os.pathsep.join(self.python_paths())
        if self.node_paths():
            extra["NODE_PATH"] = os.pathsep.join(self.node_paths())
        return extra

    # ---- source sync ----
    def materialize(self, files):
        """files: iterable of (filename, content) from the DB. Returns skipped invalid names."""
        manifest_path = os.path.join(self.project, ".synced.json") if self.project else None
        previous = set()
        if manifest_path and os.path.exists(manifest_path):
            try:
                previous = set(json.load(open(manifest_path)))
            except Exception:
                previous = set()
        wanted, skipped = set(), []
        for name, content in files:
            if not valid_filename(name):
                skipped.append(name)
                continue
            dest = os.path.join(self.src, name)
            if not self.contains(dest):
                skipped.append(name)
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.islink(dest):
                os.unlink(dest)
            with open(dest, "w", encoding="utf-8", newline="") as f:
                f.write(content)
            wanted.add(name)
        for gone in previous - wanted:
            p = os.path.join(self.src, gone)
            if self.contains(p) and os.path.isfile(p) and not os.path.islink(p):
                os.unlink(p)
        if manifest_path:
            with open(manifest_path, "w") as f:
                json.dump(sorted(wanted), f)
        chown_tree(self.src, self.uid)
        if manifest_path:
            _chown(manifest_path, self.uid)
        return skipped

    def contains(self, path):
        """True if path (after resolving symlinks) is inside src/. Symlinks a user
        program created cannot be used to make server-side file ops escape."""
        root = os.path.realpath(self.src)
        real = os.path.realpath(path)
        return real == root or real.startswith(root + os.sep)

    def usage_mb(self):
        total = 0
        for root, _, files in os.walk(self.user_root):
            for f in files:
                try:
                    total += os.lstat(os.path.join(root, f)).st_size
                except OSError:
                    pass
        return total / (1024 * 1024)

    def over_quota(self):
        return self.usage_mb() >= USER_QUOTA_MB

    def cleanup_anon(self):
        if self._anon_dir:
            shutil.rmtree(self._anon_dir, ignore_errors=True)
