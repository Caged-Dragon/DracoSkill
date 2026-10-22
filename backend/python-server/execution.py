"""
DracoSkill — execution facade.

Kept as the module the rest of the backend imports (judge.py, server.py), so
nothing else had to change when the engine grew from 2 languages to 5. The
real work is in sandbox.py (processes), workspace.py (files) and runner.py
(compile + run).

run_code() is the original single-snippet entry point, used by /execute and
the judge. Anonymous runs get a throwaway workspace that is deleted after.
"""
import re

from runner import execute
from sandbox import RUN_LANGUAGES, SANDBOXES
from workspace import Workspace

_SINGLE_FILE = {"python": "main.py", "javascript": "main.js", "java": "Main.java", "c": "main.c", "cpp": "main.cpp"}


def _snippet_filename(language, code):
    if language == "java":
        m = re.search(r"public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum|record)\s+(\w+)", code)
        return (m.group(1) if m else "Main") + ".java"
    return _SINGLE_FILE[language]


def run_code(language, code, stdin_data=""):
    if language not in RUN_LANGUAGES:
        return {"error": f"Unsupported language: {language}. Supported: {', '.join(RUN_LANGUAGES)}."}, 400
    ws = Workspace(None)
    try:
        name = _snippet_filename(language, code)
        ws.materialize([(name, code)])
        return execute(ws, language, entry=name, stdin=stdin_data)
    finally:
        ws.cleanup_anon()


def run_project(user_id, project_id, entry=None, stdin_data="", language=None):
    """Run a saved project's files. Source of truth is the DB; src/ on disk is rewritten first."""
    import projects
    from sandbox import language_from_filename
    res, status = projects.get_project(project_id, user_id)
    if status != 200 or not res.get("owner"):
        return {"error": "Project not found"}, 404
    if not res["files"]:
        return {"error": "This project has no files yet."}, 400
    lang = language or (language_from_filename(entry) if entry else None)
    if lang is None:
        return {"error": "Pick a source file to run (.py .js .java .c .cpp)."}, 400
    ws = Workspace(user_id, project_id)
    skipped = ws.materialize([(f["filename"], f["content"]) for f in res["files"]])
    result, code = execute(ws, lang, entry=entry, stdin=stdin_data)
    if skipped:
        result["skippedFiles"] = skipped
    return result, code
