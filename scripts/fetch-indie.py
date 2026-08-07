"""Collect horror screenings from independent / repertory theatres.

Alamo Drafthouse publishes a market schedule as open JSON — no auth, no bot wall,
roughly 900KB per market covering every screen and session. The one thing it does
not carry is genre, so horror has to be identified here.

Classification is deliberately conservative, in two passes:

  1. Title match against the whatscares catalog (136 hand-tagged horror films).
     This is what catches repertory programming, which is most of what makes
     indie houses worth checking — Alamo runs a lot of older horror.
  2. An explicit list of current horror releases, because new films are by
     definition not in the catalog yet.

A keyword heuristic was considered and rejected: "Blood", "Dead" and "Night" in a
title produce enough false positives (Blood Simple, Dead Poets Society, A Hard
Day's Night) that a wrong call would be worse than a missing one. Anything not
matched is simply left out.

    python3 collect_indie.py --market sf
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

from curl_cffi import requests as cr

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,*/*",
}

# Horror in theatres now that predates the catalog. Kept explicit and short so it
# is obvious what is asserted rather than inferred.
CURRENT_HORROR = {
    "insidious: out of the further",
    "teenage sex and death at camp miasma",
    "mystery machine",
}

# Repertory titles Alamo programmes that read as horror-adjacent. Listed rather
# than pattern-matched for the same reason.
REPERTORY_HORROR = {
    "little shop of horrors (1986)": "horror comedy",
    "mothra vs. godzilla": "kaiju",
    "raising cain": "psychological thriller",
}


def norm(t: str) -> str:
    t = t.lower().strip()
    t = re.sub(r"\s*\(\d{4}\)\s*$", "", t)          # drop a trailing year
    t = re.sub(r":\s*\d+(st|nd|rd|th)\s+anniversary$", "", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def load_catalog(path: Path) -> dict[str, dict]:
    """whatscares' movies.js — the tagged horror catalog used as the seed.

    movies.js is JavaScript, not JSON (unquoted keys, single quotes, apostrophes
    inside titles). Regex-converting it is a losing game, so hand it to node,
    which already knows how to read JavaScript.
    """
    if not path.exists():
        return {}
    src = path.read_text()
    arr = src[src.index("["): src.rindex("]") + 1]
    try:
        proc = subprocess.run(
            ["node", "-e", "let a=" + arr + ";process.stdout.write(JSON.stringify(a))"],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return {}
    if proc.returncode != 0 or not proc.stdout:
        return {}
    films = json.loads(proc.stdout)
    return {norm(f["t"]): f for f in films if f.get("t")}


def classify(title: str, catalog: dict[str, dict]) -> dict | None:
    n = norm(title)
    if n in catalog:
        f = catalog[n]
        return {"why": "whatscares catalog", "tags": f.get("tags", [])[:3],
                "scare": f.get("scare"), "gore": f.get("gore"), "dread": f.get("dread"),
                "slug": re.sub(r"[^a-z0-9]+", "-", norm(f["t"])).strip("-")}
    if n in {norm(x) for x in CURRENT_HORROR}:
        return {"why": "current horror release", "tags": [], "slug": None}
    for k, v in REPERTORY_HORROR.items():
        if n == norm(k):
            return {"why": "repertory horror", "tags": [v], "slug": None}
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", default="sf")
    ap.add_argument("--catalog", default="movies.js")
    ap.add_argument("--out", default="data/indie-screenings.json")
    args = ap.parse_args()

    catalog = load_catalog(Path(args.catalog))
    print(f"catalog seed: {len(catalog)} horror titles")

    url = f"https://drafthouse.com/s/mother/v2/schedule/market/{args.market}"
    r = cr.get(url, headers=HEADERS, impersonate="chrome131", timeout=40)
    r.raise_for_status()
    d = r.json()["data"]

    cinemas = {c["id"]: c for c in (d["market"][0].get("cinemas") or [])}
    pres = {p["slug"]: p for p in d.get("presentations", [])}

    out: dict[str, dict] = {}
    hits: dict[str, dict] = {}
    for s in d.get("sessions", []):
        p = pres.get(s.get("presentationSlug"))
        if not p:
            continue
        title = ((p.get("show") or {}).get("title") or "").strip()
        if not title:
            continue
        verdict = classify(title, catalog)
        if not verdict:
            continue
        cin = cinemas.get(s.get("cinemaId")) or {}
        when = s.get("showTimeClt") or ""
        try:
            dt = datetime.fromisoformat(when.replace("Z", "+00:00"))
        except ValueError:
            continue
        sid = str(s.get("sessionId"))
        out[sid] = {
            "id": sid,
            "title": title,
            "date": dt.date().isoformat(),
            "time": f"{dt.hour % 12 or 12}:{dt.minute:02d}{'am' if dt.hour < 12 else 'pm'}",
            "hhmm": f"{dt.hour:02d}:{dt.minute:02d}",
            "weekday": dt.weekday(),
            "is_weekend": dt.weekday() >= 5,
            "theatre": f"Alamo Drafthouse {cin.get('name', '')}".strip(),
            "city": cin.get("name"),
            "chain": "Alamo Drafthouse",
            "sold_out": (s.get("status") or "").upper() in ("SOLDOUT", "SOLD_OUT"),
            "on_sale": (s.get("status") or "").upper() not in ("SOLDOUT", "SOLD_OUT"),
            "seat_level": False,
            "why_horror": verdict["why"],
            "tags": verdict["tags"],
            "whatscares_slug": verdict.get("slug"),
            "ticket_url": f"https://drafthouse.com/ticketing/{s.get('cinemaId')}/{sid}",
        }
        hits.setdefault(title, {"n": 0, "why": verdict["why"], "slug": verdict.get("slug")})
        hits[title]["n"] += 1

    Path(args.out).parent.mkdir(exist_ok=True)
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")))

    print(f"\n{len(out)} horror screenings across "
          f"{len({v['theatre'] for v in out.values()})} independent screens\n")
    for t, info in sorted(hits.items(), key=lambda kv: -kv[1]["n"]):
        link = f"  -> whatscares.com/movies/{info['slug']}.html" if info["slug"] else ""
        print(f"  {info['n']:>3} screenings  {t[:44]:46} [{info['why']}]{link}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
