#!/usr/bin/env python3
"""Export the explorer's evidence to data/evidence.json (loaded only when a reader opens the explorer).

For each Type: the verses that attest it (curated or cross-reference-mined) and the Catechism paragraphs
that teach it. For each link: its reviewer note, unless the note is AI review meta-text ("AI-assisted: …"),
and its attesting verses. Plus the verse texts, short Catechism excerpts, and the Catechism clarification
notes from export/context_notes.toml (validated: targets must exist, quotes must be verbatim).

Usage (Neo4j running; on this machine it listens on 17687):
    NEO4J_URI=bolt://localhost:17687 python export/export_evidence.py
"""

import json
import re
import sys
import tomllib
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
PROJECT_ROOT = SITE.parent.parent  # LogosGraph repo (this site is a submodule under scrollytelling/)
sys.path.insert(0, str(PROJECT_ROOT))

from src.data.book_mapping import display_ref  # noqa: E402
from src.db.connection import get_connection  # noqa: E402
from textcheck import quote_found  # noqa: E402

CCC_EXCERPT_CHARS = 320
NOTE_TARGET_KINDS = {"type", "type-name", "type-description", "link-note"}


def ccc_excerpt(text: str) -> str:
    """The paragraph's opening sentences, up to CCC_EXCERPT_CHARS (short excerpts only: the text is © LEV)."""
    text = re.sub(r"\s*\((?:\d+(?:[-–]\d+)?(?:,\s*)?)+\)\s*$", "", " ".join(text.split()))  # trailing cross-refs
    text = text.replace("*", "")  # the source marks italics with asterisks
    sentences, out = re.split(r"(?<=[.?!])\s+", text), ""
    for s in sentences:
        if len(out) + len(s) + 1 > CCC_EXCERPT_CHARS:
            break
        out = f"{out} {s}".strip()
    return out or f"{text[:CCC_EXCERPT_CHARS - 1].rstrip()}…"


def main() -> int:
    conn = get_connection()
    conn.connect()
    with conn.session() as s:
        type_ids = {r["id"] for r in s.run("MATCH (t:Type) RETURN t.id AS id")}
        members = [dict(r) for r in s.run(
            "MATCH (v:Verse)-[m:MEMBER_OF]->(t:Type) RETURN t.id AS type, v.id AS verse, "
            "m.source AS source, m.confidence AS confidence ORDER BY t.id, v.id")]
        links = [dict(r) for r in s.run(
            "MATCH (a:Type)-[r:PREFIGURES]->(b:Type) RETURN a.id AS source, b.id AS target, "
            "r.notes AS notes, r.source_verses AS verses ORDER BY a.id, b.id")]
        teaches = [dict(r) for r in s.run(
            "MATCH (c:CatechismParagraph)-[:TEACHES]->(t:Type) RETURN t.id AS type, c.id AS ccc, c.text AS text")]
        wanted = sorted({m["verse"] for m in members} | {v for l in links for v in l["verses"]})
        verses = {r["id"]: r["text"].strip() for r in s.run(
            "MATCH (v:Verse) WHERE v.id IN $ids RETURN v.id AS id, v.text AS text", ids=wanted)}
        ccc_all = {r["id"]: r["text"] for r in s.run(
            "MATCH (c:CatechismParagraph) RETURN c.id AS id, c.text AS text")}
    conn.close()

    memberships = defaultdict(list)
    for m in members:
        provenance = "mined" if m["source"] == "crossref-mined" else "curated"
        memberships[m["type"]].append([m["verse"], provenance])
    link_notes, link_verses = {}, {}
    for l in links:
        key = f"{l['source']}|{l['target']}"
        if l["notes"] and not l["notes"].startswith("AI-assisted"):
            link_notes[key] = l["notes"]
        if l["verses"]:
            link_verses[key] = l["verses"]
    teaches_by_type, ccc = defaultdict(list), {}
    for t in teaches:
        para = int(t["ccc"].removeprefix("CCC-"))
        teaches_by_type[t["type"]].append(para)
        ccc[para] = ccc_excerpt(t["text"])

    # Catechism clarification notes (D4): validate before exporting.
    errors, notes = [], []
    notes_path = HERE / "context_notes.toml"
    raw_notes = tomllib.loads(notes_path.read_text()).get("note", []) if notes_path.exists() else []
    link_keys = {f"{l['source']}|{l['target']}" for l in links}
    for i, n in enumerate(raw_notes):
        target = n.get("target", {})
        if "type" in target:
            if target["type"] not in type_ids:
                errors.append(f"note {i}: unknown type {target['type']}")
            key = target["type"]
        elif "link" in target:
            key = "|".join(target["link"])
            if key not in link_keys:
                errors.append(f"note {i}: unknown link {key}")
        else:
            errors.append(f"note {i}: target needs 'type' or 'link'")
            continue
        if n.get("applies_to", "type") not in NOTE_TARGET_KINDS:
            errors.append(f"note {i}: applies_to must be one of {sorted(NOTE_TARGET_KINDS)}")
        quotes = []
        for ref in n.get("ccc", []):
            source = ccc_all.get(f"CCC-{ref['para']}")
            if source is None:
                errors.append(f"note {i}: CCC {ref['para']} does not exist")
            elif not quote_found(ref["quote"], source):
                errors.append(f"note {i}: quote not verbatim in CCC {ref['para']}: {ref['quote'][:50]}…")
            quotes.append({"para": ref["para"], "quote": ref["quote"]})
        notes.append({"target": target, "key": key, "appliesTo": n.get("applies_to", "type"),
                      "text": " ".join(n["text"].split()), "ccc": quotes})
    if errors:
        print(f"{len(errors)} errors in context_notes.toml; data/evidence.json not written")
        for e in errors:
            print("  ERROR", e)
        return 1

    payload = {
        "metadata": {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "LogosGraph Neo4j typology layer + export/context_notes.toml",
            "counts": {"verses": len(verses), "memberships": len(members), "linkNotes": len(link_notes),
                       "cccParagraphs": len(ccc), "contextNotes": len(notes)},
        },
        "verses": {vid: {"ref": display_ref(vid), "text": text} for vid, text in sorted(verses.items())},
        "memberships": memberships,
        "linkNotes": link_notes,
        "linkVerses": link_verses,
        "teaches": teaches_by_type,
        "ccc": {str(p): text for p, text in sorted(ccc.items())},
        "contextNotes": notes,
    }
    out = SITE / "data/evidence.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB): " + ", ".join(
        f"{k} {v}" for k, v in payload["metadata"]["counts"].items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
