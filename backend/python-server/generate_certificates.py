#!/usr/bin/env python3
"""
DracoSkill — certificate mail merge.

Takes the real .pptx you uploaded and merges real certificate records
from the database into it, editing the actual file's data fields --
name, scores, date, certificate ID, QR code -- rather than recreating the
design. Every label, font, color, and position is untouched because
nothing about the slide is being redrawn; this is the same outcome as
Word's mail merge (one template + many records -> many personalized
documents), done in Python because the template is a .pptx, not a .docx,
so Word's own merge feature doesn't apply directly to it.

One thing intentionally NOT preserved: the template's watermark reads
"DRACOAKILL", which is a typo for DRACOSKILL. That gets corrected on
every generated certificate. Everything else -- including labels like
"Assignments" and "Proctored Exam" -- is left exactly as designed; only
the values inside them are replaced with the closest real numbers this
platform actually tracks (see MAPPING NOTES below).

MAPPING NOTES (the only judgment calls made -- easy to change):
    "Overall Score"   <- accuracy percentage on real submissions
    "Assignments"     <- problems solved / problems total
    "Proctored Exam"  <- total submission count (shown as a plain number,
                          since nothing here was actually proctored)

Requires (only this script -- server.py stays dependency-free):
    pip install python-pptx qrcode --break-system-packages

Run:
    python3 generate_certificates.py
    # One .pptx (+ .pdf if LibreOffice's `soffice` is on PATH) per
    # issued certificate, written to certificate-template/output/
"""
import os
import shutil
import subprocess
import sys
from datetime import datetime

import qrcode
from pptx import Presentation
from pptx.util import Emu

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from db import get_db
from certificates import BASE_URL

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(HERE, "certificate-template", "template.pptx")
OUTPUT_DIR = os.path.join(HERE, "certificate-template", "output")

# Shape indices in the template -- found by inspecting the actual file
# once (python-pptx: enumerate slide.shapes, print .name and .text).
# If you edit the template's layout later, re-check these.
SHAPE_WATERMARK = 2
SHAPE_NAME = 5
SHAPE_TRACK = 7
SHAPE_SCORE_BOX = 8
SHAPE_ASSIGNMENTS_BOX = 9
SHAPE_PROCTORED_BOX = 10
SHAPE_DATE = 11
SHAPE_FOOTER = 13
SHAPE_QR_PICTURE = 14
SHAPE_VERIFY_TEXT = 15


def _set_run_text(shape, para_index, run_index, text):
    """Mutates an existing run's text in place -- preserves that run's
    font, size, color, and bold exactly, unlike setting text_frame.text
    (which wipes formatting back to the frame default)."""
    shape.text_frame.paragraphs[para_index].runs[run_index].text = text


def _replace_qr(slide, verify_url, tmp_qr_path):
    qrcode.make(verify_url).save(tmp_qr_path)
    old = slide.shapes[SHAPE_QR_PICTURE]
    left, top, width, height = old.left, old.top, old.width, old.height
    old._element.getparent().remove(old._element)
    slide.shapes.add_picture(tmp_qr_path, left, top, width, height)


def merge_one(record):
    prs = Presentation(TEMPLATE_PATH)
    slide = prs.slides[0]

    verify_url = f"{BASE_URL}/confirmation/{record['certificate_code']}"
    issued_display = datetime.fromisoformat(record["issued_at"]).strftime("%d %B %Y")

    _set_run_text(slide.shapes[SHAPE_WATERMARK], 0, 0, "DRACOSKILL")
    _set_run_text(slide.shapes[SHAPE_NAME], 0, 0, record["username"].upper())
    _set_run_text(slide.shapes[SHAPE_TRACK], 0, 0, record["track_name"].upper())
    _set_run_text(slide.shapes[SHAPE_SCORE_BOX], 1, 0, f"{record['accuracy_pct']:g}%")
    _set_run_text(slide.shapes[SHAPE_ASSIGNMENTS_BOX], 1, 0,
                  f"{record['problems_solved']} / {record['problems_total']}")
    _set_run_text(slide.shapes[SHAPE_PROCTORED_BOX], 1, 0, f"{record['total_submissions']} submissions")
    _set_run_text(slide.shapes[SHAPE_DATE], 0, 0, f"Issued on: {issued_display}")
    _set_run_text(
        slide.shapes[SHAPE_FOOTER], 0, 0,
        f"Certificate ID: {record['certificate_code']}     |     Credits: 4     |     QR Verification Available",
    )
    _set_run_text(slide.shapes[SHAPE_VERIFY_TEXT], 0, 1, f" {verify_url}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    tmp_qr = os.path.join(OUTPUT_DIR, f"_tmp_qr_{record['certificate_code']}.png")
    _replace_qr(slide, verify_url, tmp_qr)

    pptx_path = os.path.join(OUTPUT_DIR, f"certificate_{record['certificate_code']}.pptx")
    prs.save(pptx_path)
    os.remove(tmp_qr)
    return pptx_path


def convert_to_pdf(pptx_path):
    if shutil.which("soffice") is None:
        return None  # LibreOffice not installed -- the .pptx is still real and complete
    try:
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", OUTPUT_DIR, pptx_path],
            check=True, capture_output=True, timeout=60,
        )
        return pptx_path[:-5] + ".pdf"
    except Exception:
        return None


def fetch_real_certificates():
    conn = get_db()
    rows = conn.execute("""
        SELECT certificates.*, users.username FROM certificates
        JOIN users ON users.id = certificates.user_id
        ORDER BY certificates.issued_at
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


if __name__ == "__main__":
    records = fetch_real_certificates()
    if not records:
        print("No certificates issued yet -- earn one in the app first (Problems tab -> solve all three -> Certificates tab).")
        sys.exit(0)

    print(f"Merging {len(records)} real certificate record(s) into the template...")
    for r in records:
        pptx_path = merge_one(r)
        pdf_path = convert_to_pdf(pptx_path)
        if pdf_path:
            print(f"  {r['username']:20s} -> {os.path.basename(pdf_path)}")
        else:
            print(f"  {r['username']:20s} -> {os.path.basename(pptx_path)}  (LibreOffice not found -- .pptx only)")
