"""What part of the LogosGraph typology layer this site shows.

The graph holds more than the site draws. The site shows Old Testament -> New Testament figures
(PREFIGURES across the testaments) and the evidence gathered for them. It does not show:

  - same-testament PREFIGURES links (Paul's Ishmael allegory; New Testament figures such as
    Mary -> the Church),
  - prophecy (FORETELLS) links, which the exporters never query,
  - Types that have no drawn link (oracle Types, New Testament figure Types),
  - verse and Catechism evidence added by the prophecy / New Testament figure pass
    (MEMBER_OF and TEACHES edges whose source is in HIDDEN_SOURCES).

All three exporters use these helpers, so the graphic, the story's counts and the explorer's evidence
agree on what is shown.
"""

HIDDEN_SOURCES = {"ccc-review-2"}


def drawn_links(links: list[dict], testament: dict[str, str], source: str = "source", target: str = "target"):
    """(drawn, held): links across the testaments, and the same-testament links the site holds back."""
    drawn = [l for l in links if testament[l[source]] != testament[l[target]]]
    held = [l for l in links if testament[l[source]] == testament[l[target]]]
    return drawn, held


def drawn_type_ids(links: list[dict], source: str = "source", target: str = "target") -> set[str]:
    """Types with at least one drawn link."""
    return {l[source] for l in links} | {l[target] for l in links}


def shown_evidence(rows: list[dict], type_ids: set[str], type_key: str = "type") -> list[dict]:
    """Evidence rows (MEMBER_OF / TEACHES, each with its edge's `source`) the site shows."""
    return [r for r in rows if r[type_key] in type_ids and r.get("source") not in HIDDEN_SOURCES]
