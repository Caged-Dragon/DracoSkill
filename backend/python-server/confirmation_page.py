"""
DracoSkill -- the real confirmation page a scanned QR code lands on.

Server-rendered HTML, not a client-side fetch -- the page arrives with
the result already in it, and it's self-contained (the logo is inlined)
so it works even if the separate frontend static server isn't running.
Only this backend needs to be up for a scanned QR code to resolve, which
matters: a verifier is someone who just wants an answer, not someone
who's expected to have the whole dev setup running.
"""
import base64
import html
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
# 1x1 transparent PNG: a missing logo must never stop the server from starting.
_BLANK_PNG = base64.b64encode(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)).decode()


def _load_mark():
    # Own copy first (works in Docker, where only this folder is shipped), then the repo's frontend.
    for rel in (("assets", "dracoskill-mark.png"),
                ("..", "..", "frontend", "assets", "dracoskill-mark.png"),
                ("..", "frontend", "assets", "dracoskill-mark.png")):
        try:
            with open(os.path.join(_HERE, *rel), "rb") as f:
                return base64.b64encode(f.read()).decode()
        except OSError:
            continue
    return _BLANK_PNG


_MARK_B64 = _load_mark()

_STYLE = """
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Manrope:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');
  :root { --bg:#121317; --surface:#1C1F26; --surface-2:#23262F; --border:#2E323C;
    --text:#F5F3EF; --text-dim:#A39D95; --text-faint:#6B6560; --ok:#4ADE80; --err:#F07868; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:'Manrope',sans-serif; line-height:1.6; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 48px 24px; }
  .brand { display:flex; align-items:center; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:17px; margin-bottom:28px; }
  .brand img { width:30px; height:30px; border-radius:8px; margin-right:10px; }
  .status { font-weight:700; font-size:16px; padding:10px 16px; border-radius:9px; display:inline-block; margin-bottom:20px; }
  .valid { color:var(--ok); background:rgba(74,222,128,0.12); border:1px solid rgba(74,222,128,0.35); }
  .invalid { color:var(--err); background:rgba(240,120,104,0.12); border:1px solid rgba(240,120,104,0.35); }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:22px; }
  .row { display:flex; justify-content:space-between; padding:9px 0; border-top:1px solid var(--surface-2); font-size:14px; }
  .row:first-child { border-top:none; }
  .k { color:var(--text-faint); } .v { color:var(--text); font-weight:600; }
  .code { font-family:'JetBrains Mono',monospace; font-size:12.5px; color:var(--text-dim); word-break:break-all; }
  p.hint { color:var(--text-dim); font-size:13.5px; }
"""


def render(cert):
    """cert is the dict from certificates.verify_certificate(), or None if invalid."""
    brand = f'<div class="brand"><img src="data:image/png;base64,{_MARK_B64}" alt="DracoSkill"/>DracoSkill</div>'

    if cert is None:
        body = (
            f'<div class="status invalid">Not a valid certificate</div>'
            f'<p class="hint">No certificate with this ID exists in the database. '
            f'If you followed a QR code or a link, the ID may have been mistyped or the certificate was never issued.</p>'
        )
    else:
        issued = html.escape(cert["issued_at"][:10])
        body = (
            f'<div class="status valid">Verified</div>'
            f'<div class="card">'
            f'<div class="row"><span class="k">Issued to</span><span class="v">{html.escape(cert["username"])}</span></div>'
            f'<div class="row"><span class="k">Track</span><span class="v">{html.escape(cert["track_name"])}</span></div>'
            f'<div class="row"><span class="k">Problems solved</span><span class="v">{cert["problems_solved"]} / {cert["problems_total"]}</span></div>'
            f'<div class="row"><span class="k">Accuracy</span><span class="v">{cert["accuracy_pct"]:g}%</span></div>'
            f'<div class="row"><span class="k">Issued on</span><span class="v">{issued}</span></div>'
            f'<div class="row"><span class="k">Certificate ID</span><span class="v code">{html.escape(cert["certificate_code"])}</span></div>'
            f'</div>'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DracoSkill certificate confirmation</title>
<style>{_STYLE}</style>
</head>
<body>
<div class="wrap">
{brand}
{body}
</div>
</body>
</html>"""
