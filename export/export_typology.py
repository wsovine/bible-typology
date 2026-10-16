#!/usr/bin/env python3
"""Export the LogosGraph typology layer to data/typology.json.

Types carry what the graphic needs to lay them out: testament, a canonical position (first attesting
verse, for ordering Old Testament figures Genesis -> Malachi), the dominant theme of the links that
reach them (for grouping fulfillments), and degree counts. Edge notes are deliberately not exported:
a third of them are reviewer meta-text, and the explorer will get curated text separately.

Usage (Neo4j running; on this machine it listens on 17687):
    NEO4J_URI=bolt://localhost:17687 python export/export_typology.py
"""

import json
import sys
import tomllib
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
PROJECT_ROOT = SITE.parent.parent  # LogosGraph repo (this site is a submodule under scrollytelling/)
sys.path.insert(0, str(PROJECT_ROOT))

from src.data.book_mapping import CPDV_BOOK_ID_TO_ABBREV  # noqa: E402
from src.db.connection import get_connection  # noqa: E402

BOOK_ORDER = {abbrev: order for order, abbrev in CPDV_BOOK_ID_TO_ABBREV.items()}
CATEGORY_ORDER = ["Christological", "Sacramental", "Marian", "Ecclesial", "Eschatological", "Covenantal"]


def canon_position(verse_id: str) -> int:
    """Sortable canonical position: book order, then chapter, then verse."""
    book, chapter, verse = verse_id.rsplit("-", 2)
    return BOOK_ORDER[book] * 1_000_000 + int(chapter) * 1_000 + int(verse)


def main() -> int:
    labels = tomllib.loads((HERE / "story.toml").read_text()).get("labels", {})
    conn = get_connection()
    conn.connect()
    with conn.session() as s:
        types = [dict(r) for r in s.run(
            "MATCH (t:Type) RETURN t.id AS id, t.name AS name, t.testament AS testament, "
            "t.description AS description ORDER BY t.id")]
        links = [dict(r) for r in s.run(
            "MATCH (a:Type)-[r:PREFIGURES]->(b:Type) RETURN a.id AS source, b.id AS target, "
            "r.category AS category, r.confidence AS confidence, r.sources AS sources ORDER BY a.id, b.id")]
        members = defaultdict(list)
        for r in s.run("MATCH (v:Verse)-[:MEMBER_OF]->(t:Type) RETURN t.id AS t, v.id AS v"):
            members[r["t"]].append(r["v"])
    conn.close()

    in_degree, out_degree = Counter(l["target"] for l in links), Counter(l["source"] for l in links)
    incoming = defaultdict(Counter)
    for l in links:
        incoming[l["target"]][l["category"]] += 1

    for t in types:
        verses = members.get(t["id"], [])
        t["displayName"] = labels.get(t["id"], t["name"])
        t["canonPosition"] = min(map(canon_position, verses)) if verses else None
        t["verseCount"] = len(verses)
        t["inDegree"], t["outDegree"] = in_degree[t["id"]], out_degree[t["id"]]
        # Dominant theme of incoming links (ties broken by story order) groups fulfillments in the graphic.
        cats = incoming[t["id"]]
        t["group"] = min(cats, key=lambda c: (-cats[c], CATEGORY_ORDER.index(c))) if cats else None

    payload = {
        "metadata": {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "LogosGraph Neo4j typology layer",
            "counts": {"types": len(types), "links": len(links),
                       "categories": dict(Counter(l["category"] for l in links))},
        },
        "categories": CATEGORY_ORDER,
        "types": types,
        "links": links,
    }
    out = SITE / "data/typology.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {out}: {len(types)} types, {len(links)} links ({out.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
