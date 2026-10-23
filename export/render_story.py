#!/usr/bin/env python3
"""Compile story.toml into data/story.json and a human-readable review draft.

Resolves every verse, Catechism paragraph and PREFIGURES edge the script references, checks that
quotes appear verbatim in their sources, and fills {placeholders} from live graph stats. Writes
export/story-draft.md for review and, only if nothing failed, data/story.json for the site.

Usage (Neo4j running; on this machine it listens on 17687):
    NEO4J_URI=bolt://localhost:17687 python export/render_story.py
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

from src.data.book_mapping import CPDV_BOOK_ID_TO_ABBREV, display_ref  # noqa: E402
from src.data.cpdv_parser import parse_cpdv  # noqa: E402
from src.db.connection import get_connection  # noqa: E402
from textcheck import normalize, quote_found  # noqa: E402

MAX_WORDS = 60
OT_BOOKS = {CPDV_BOOK_ID_TO_ABBREV[i] for i in range(1, 47)}
WARRANTS = {
    "scripture": "the New Testament draws this link itself",
    "catechism": "taught in the Catechism",
    "tradition": "from the commentary tradition",
}
QUOTED = re.compile(r"“([^”]+)”")


def load_graph():
    conn = get_connection()
    conn.connect()
    with conn.session() as s:
        types = {r["id"]: dict(r) for r in s.run(
            "MATCH (t:Type) RETURN t.id AS id, t.name AS name, t.testament AS testament")}
        edges = {(r["a"], r["b"]): dict(r) for r in s.run(
            "MATCH (a:Type)-[r:PREFIGURES]->(b:Type) RETURN a.id AS a, b.id AS b, r.category AS category, "
            "r.confidence AS confidence, r.sources AS sources, r.notes AS notes")}
        verse_links = s.run("MATCH ()-[r:MEMBER_OF]->() RETURN count(r) AS n").single()["n"]
        ccc_links = s.run("MATCH ()-[r:TEACHES]->() RETURN count(r) AS n").single()["n"]
    conn.close()
    return types, edges, verse_links, ccc_links


def main() -> int:
    story = tomllib.loads((HERE / "story.toml").read_text())
    verses = {v["id"]: v["text"].strip() for v in parse_cpdv()}
    # The source marks italics with asterisks; they're formatting, not words, so quotes are checked without them
    ccc = {p["id"]: " ".join(p["text"].replace("*", "").split())
           for p in json.loads((PROJECT_ROOT / "data/raw/catechism/catechism.json").read_text())}
    commentary = defaultdict(list)  # (type, antitype) -> [(verse_id, original_text)]
    for line in (PROJECT_ROOT / "data/reviewed/typology_approved.jsonl").read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            commentary[(rec["type_id"], rec["antitype_id"])].append((rec["verse_id"], rec["original_text"]))
    types, edges, verse_links, ccc_links = load_graph()
    # Same-testament links aren't drawn on the site (see export_typology.py), so they don't count here either
    edges = {k: e for k, e in edges.items() if types[k[0]]["testament"] != types[k[1]]["testament"]}

    by_category = defaultdict(int)
    for e in edges.values():
        by_category[e["category"]] += 1
    family = story["stats"]["christ_family"]
    stats = {
        "types": len(types), "links": len(edges), "verseLinks": f"{verse_links:,}", "cccLinks": ccc_links,
        "christLinks": sum(1 for (_, b) in edges if b in family),
        **{c.lower(): n for c, n in by_category.items() if c},
    }
    labels = story.get("labels", {})
    label = lambda tid: labels.get(tid, types[tid]["name"])
    # Every “quoted” fragment of on-screen text must be real CPDV or Catechism wording (case-insensitive).
    corpus = "\n".join(normalize(s).replace('"', "").lower() for s in [*verses.values(), *ccc.values()])

    errors, warnings = [], []

    def resolve_verse(vid: str, sid: str, testament: str | None = None) -> dict | None:
        if vid not in verses:
            errors.append(f"{sid}: verse {vid} does not exist")
            return None
        if testament == "OT" and vid.split("-")[0] not in OT_BOOKS:
            warnings.append(f"{sid}: OT verse {vid} is from the New Testament")
        if testament == "NT" and vid.split("-")[0] in OT_BOOKS:
            warnings.append(f"{sid}: NT verse {vid} is from the Old Testament")
        return {"id": vid, "ref": display_ref(vid), "text": verses[vid]}

    chapters = []
    for chapter in story["chapter"]:
        cat = chapter.get("category")
        steps = []
        for step in chapter["step"]:
            sid = step["id"]
            try:
                text = " ".join(step["text"].split()).format_map(stats)
            except KeyError as e:
                errors.append(f"{sid}: unknown placeholder {e}")
                text = " ".join(step["text"].split())
            words = len(text.split())
            if words > MAX_WORDS:
                warnings.append(f"{sid}: {words} words (limit {MAX_WORDS})")
            if "[CONFIRM" in text:
                warnings.append(f"{sid}: has an open [CONFIRM] for the user")
            for frag in QUOTED.findall(text):
                if len(frag.split()) > 2 and not quote_found(frag.lower(), corpus):
                    errors.append(f"{sid}: quoted text not found in CPDV or the Catechism: “{frag}”")
            out = {"id": sid, "view": step["view"], "text": text, "words": words}

            if "verse" in step:
                out["verse"] = resolve_verse(step["verse"], sid)

            pair = step.get("pair")
            if pair:
                key = (pair["type"], pair["antitype"])
                edge = edges.get(key)
                if not edge:
                    errors.append(f"{sid}: no PREFIGURES edge {key[0]} -> {key[1]}")
                else:
                    if cat and edge["category"] != cat:
                        warnings.append(f"{sid}: edge category {edge['category']} != chapter {cat}")
                    out["pair"] = {"type": key[0], "antitype": key[1], "typeName": label(key[0]),
                                   "antitypeName": label(key[1]), "category": edge["category"],
                                   "confidence": edge["confidence"], "sources": edge["sources"]}
                warrant = step.get("warrant", [])
                if not warrant or set(warrant) - WARRANTS.keys():
                    errors.append(f"{sid}: warrant must be a non-empty subset of {sorted(WARRANTS)}")
                if "catechism" in warrant and "ccc" not in step:
                    warnings.append(f"{sid}: 'catechism' warrant but no Catechism excerpt on the card")
                out["warrant"] = [{"key": w, "label": WARRANTS.get(w, w)} for w in warrant]
                out["ot"] = resolve_verse(step["ot"], sid, "OT")
                out["nt"] = resolve_verse(step["nt"], sid, "NT")

            quote = step.get("quote")
            if quote:
                # Prefer the commentary text itself; reviewer-written edge notes are a fallback only.
                key = (pair["type"], pair["antitype"]) if pair else None
                source = next((f"Haydock commentary on {display_ref(vid)}"
                               for vid, text_src in commentary.get(key, []) if quote_found(quote["text"], text_src)),
                              None)
                if source is None and key in edges and quote_found(quote["text"], edges[key]["notes"] or ""):
                    source = "reviewer's link notes only"
                    warnings.append(f"{sid}: quote verified only against reviewer notes, not the commentary text")
                if source is None:
                    errors.append(f"{sid}: quote not found verbatim in its sources: {quote['text'][:60]}…")
                by = None if quote["by"] == "Haydock commentary" else quote["by"]
                out["quote"] = {"text": quote["text"], "by": by, "source": source}

            refs = step.get("ccc", [])
            out["ccc"] = []
            for ref in [refs] if isinstance(refs, dict) else refs:
                para = ccc.get(ref["para"])
                if para is None:
                    errors.append(f"{sid}: CCC {ref['para']} does not exist")
                elif not quote_found(ref["quote"], para):
                    errors.append(f"{sid}: quote not found in CCC {ref['para']}: {ref['quote'][:60]}…")
                out["ccc"].append({"para": ref["para"], "quote": ref["quote"]})
            steps.append(out)
        chapters.append({"id": chapter["id"], "title": chapter["title"], "category": cat, "steps": steps})

    write_draft(story["meta"], stats, chapters, errors, warnings)
    if not errors:
        payload = {
            "metadata": {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                         "source": "export/story.toml + LogosGraph Neo4j", "stats": stats,
                         "christFamily": family},
            "meta": story["meta"],
            "chapters": chapters,
        }
        (SITE / "data/story.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")

    print(f"{len(errors)} errors, {len(warnings)} warnings"
          + ("" if errors else f" -> wrote {SITE / 'data/story.json'}"))
    for e in errors:
        print("  ERROR", e)
    for w in warnings:
        print("  warn ", w)
    return 1 if errors else 0


def write_draft(meta: dict, stats: dict, chapters: list, errors: list, warnings: list) -> None:
    """Render export/story-draft.md: the script with real verse, commentary and Catechism text."""
    lines = [
        f"# {meta['title']}: script draft (rendered)\n",
        f"_{meta['subtitle']}_\n",
        "> Generated by `export/render_story.py` from `export/story.toml`; edit the TOML, not this file. "
        "Verse text is CPDV; Psalm refs show Vulgate (Hebrew) numbering.\n",
        f"**Live stats:** {stats['types']} Types · {stats['links']} links · {stats['verseLinks']} verse links · "
        f"{stats['cccLinks']} Catechism links · {stats['christLinks']} links into Christ or his life\n",
        f"**Validation:** {len(errors)} errors · {len(warnings)} warnings\n",
        *[f"- ❌ {e}" for e in errors], *[f"- ⚠️ {w}" for w in warnings],
    ]
    verse_line = lambda label, v: f"- **{label}: {v['ref']}** · “{v['text']}”" if v else f"- **{label}:** ⚠️ MISSING"
    for chapter in chapters:
        cat = chapter["category"]
        lines.append(f"\n## {chapter['title']}" + (f"  ·  _{cat}_" if cat else "") + f"  `{chapter['id']}`\n")
        for s in chapter["steps"]:
            lines.append(f"### `{s['id']}` · {s['view']} · {s['words']} words\n\n{s['text']}\n")
            if "verse" in s:
                lines.append(verse_line("Verse", s["verse"]))
            if "pair" in s:
                p = s["pair"]
                lines.append(f"- **Link:** {p['typeName']} → {p['antitypeName']} · {p['category']} · "
                             f"{p['confidence']} · sources: {', '.join(p['sources'])}")
            if "warrant" in s:
                lines.append("- **Warrant:** " + "; ".join(w["label"] for w in s["warrant"]))
            if "ot" in s:
                lines += [verse_line("Old Testament", s["ot"]), verse_line("New Testament", s["nt"])]
            if "quote" in s:
                q = s["quote"]
                by = f"{q['by']}, " if q["by"] else ""
                lines.append(f"- **Commentary:** “{q['text']}” — {by}{q['source'] or '⚠️ NOT FOUND'}")
            for ref in s["ccc"]:
                lines.append(f"- **Catechism §{ref['para']}:** “{ref['quote']}”")
            lines.append("")
    (HERE / "story-draft.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
