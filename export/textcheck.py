"""Verbatim-quote checks shared by the export scripts."""


def normalize(text: str) -> str:
    """Fold typographic quotes/dashes and whitespace so verbatim checks ignore typesetting."""
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    text = text.replace("—", "-").replace("–", "-")
    return " ".join(text.split())


def quote_found(quote: str, source: str) -> bool:
    """True if each '…'-separated segment of the quote appears in the source, in order."""
    pos, src = 0, normalize(source).replace('"', "")
    for segment in (normalize(s).replace('"', "").strip(" .,;") for s in quote.split("…")):
        if not segment:
            continue
        idx = src.find(segment, pos)
        if idx < 0:
            return False
        pos = idx + len(segment)
    return True
