"""Pull showtimes straight from IMAX's own Algolia index.

imax.com is backed by a public, search-only Algolia index that aggregates every
IMAX venue on earth. One request returns, per theatre:

    events[].movie.name                     film
    events[].movieVariantLabel              "70MM" / "2D" / ...
    events[].showtimes[YYYYMMDD][HH:MM]     { epochMs, screening, type, ticketing }
                                            type == "Soldout" when it is gone
    _geoloc                                 lat/lng, so distance is free

That single call replaces the per-chain scraping entirely for discovery: no rate
limits, no bot walls, and it covers venues we would otherwise never have found.
It carries no seat-level data — that still comes from each chain's seat map.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

from curl_cffi import requests as cr

APP_ID = "10MXKGB0UH"
SEARCH_KEY = "7c9c8e2eadbdc26fb3b97b5db64a28dd"   # public search-only key from imax.com
INDEX = "dev_web23_showtimes"
ENDPOINT = f"https://{APP_ID.lower()}-dsn.algolia.net/1/indexes/{INDEX}/query"

HEADERS = {
    "X-Algolia-API-Key": SEARCH_KEY,
    "X-Algolia-Application-Id": APP_ID,
    "Content-Type": "application/json",
    "Referer": "https://www.imax.com/",
    "Origin": "https://www.imax.com",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}


def haversine(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r = 3958.8
    dlat, dlng = radians(b_lat - a_lat), radians(b_lng - a_lng)
    h = sin(dlat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(dlng / 2) ** 2
    return round(2 * r * asin(sqrt(h)), 1)


def fetch(lat: float, lng: float, radius_m: int, page: int = 0) -> dict:
    params = (
        f"query=&hitsPerPage=100&page={page}"
        f"&aroundLatLng={lat}%2C{lng}&aroundRadius={radius_m}"
    )
    r = cr.post(
        ENDPOINT, headers=HEADERS, data=json.dumps({"params": params}),
        impersonate="chrome131", timeout=30,
    )
    r.raise_for_status()
    return r.json()


def collect(film: str, variant: str, lat: float, lng: float, radius_mi: float) -> list[dict]:
    radius_m = int(radius_mi * 1609)
    hits, page, pages = [], 0, 1
    while page < pages:
        d = fetch(lat, lng, radius_m, page)
        hits.extend(d.get("hits") or [])
        pages = min(d.get("nbPages", 1), 20)
        page += 1

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    out = []
    for h in hits:
        geo = h.get("_geoloc") or {}
        dist = (
            haversine(lat, lng, geo["lat"], geo["lng"])
            if geo.get("lat") is not None else None
        )
        for ev in h.get("events") or []:
            if (ev.get("movie") or {}).get("name") != film:
                continue
            if variant and (ev.get("movieVariantLabel") or "").upper() != variant.upper():
                continue
            for daykey, day in (ev.get("showtimes") or {}).items():
                for hhmm, s in (day.get("showtimes") or {}).items():
                    if (s.get("epochMs") or 0) < now_ms:
                        continue          # 已经开场的场次没有意义
                    hh, mm = (int(x) for x in hhmm.split(":"))
                    iso = f"{daykey[:4]}-{daykey[4:6]}-{daykey[6:]}"
                    wd = datetime.fromisoformat(iso).weekday()
                    out.append({
                        "id": str(s.get("screening") or f"{h['slug']}-{daykey}-{hhmm}"),
                        "screening": s.get("screening"),
                        "date": iso,
                        "time": f"{hh % 12 or 12}:{mm:02d}{'am' if hh < 12 else 'pm'}",
                        "hhmm": hhmm,
                        "epoch_ms": s.get("epochMs"),
                        "weekday": wd,
                        "is_weekend": wd >= 5,
                        "theatre": h["name"],
                        "city": h.get("city"),
                        "state": h.get("state"),
                        "miles": dist,
                        "format": f"IMAX {variant}" if variant else
                                  f"IMAX {ev.get('movieVariantLabel')}",
                        "sold_out": (s.get("type") == "Soldout"),
                        "on_sale": (s.get("type") != "Soldout"),
                        "seat_level": False,
                        "ticket_url": (s.get("ticketing") or {}).get("fandango_url"),
                    })
    out.sort(key=lambda s: (s["date"], s["hhmm"], s["theatre"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--film", default="The Odyssey")
    ap.add_argument("--variant", default="70MM")
    ap.add_argument("--lat", type=float, default=37.7749)
    ap.add_argument("--lng", type=float, default=-122.4194)
    ap.add_argument("--miles", type=float, default=120)
    ap.add_argument("--out", default="data/imax-screenings.json")
    args = ap.parse_args()

    shows = collect(args.film, args.variant, args.lat, args.lng, args.miles)
    Path(args.out).parent.mkdir(exist_ok=True)
    Path(args.out).write_text(json.dumps({s["id"]: s for s in shows}, separators=(",", ":")))

    venues: dict[str, list] = {}
    for s in shows:
        venues.setdefault(f"{s['theatre']} ({s['city']}, {s['miles']} mi)", []).append(s)
    print(f"{args.film} · IMAX {args.variant} · within {args.miles:.0f} mi")
    print(f"{len(shows)} upcoming showtimes across {len(venues)} venues\n")
    for name, ss in sorted(venues.items(), key=lambda kv: kv[1][0]["miles"] or 999):
        sold = sum(1 for x in ss if x["sold_out"])
        days = len({x["date"] for x in ss})
        print(f"  {name:52} {len(ss):>3} showtimes  {len(ss)-sold:>3} on sale  "
              f"{sold:>3} sold out  ({days} days)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
