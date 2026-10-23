# Shadow & Fulfillment (working title)

A scroll-driven story about biblical **typology**: how Old Testament figures, events and institutions
foreshadow their New Testament fulfillments. It ends with an explorer of every figure. Built from the
typology layer of [LogosGraph](https://github.com/wsovine/LogosGraph), a Neo4j knowledge graph of the 73-book Catholic Bible.

**Live:** https://wsovine.github.io/bible-typology/ (served by GitHub Pages from `main`). The story has 38 scroll
steps, followed by the explorer.

## Run it locally

```bash
python3 serve.py                   # from this directory (no browser caching)
open http://127.0.0.1:8765/
```

Add `?step=<step-id>` to jump straight to a step, for example `?step=waters-flood`. Step IDs are in
`export/story.toml`. Add `#type=<id>` to open a figure in the explorer, for example `#type=noahs-ark`.

## Data pipeline

Everything in `data/` is generated; never edit it by hand. The story text lives in `export/story.toml`.

```bash
# from this directory, with LogosGraph's Neo4j running (this machine: port 17687)
NEO4J_URI=bolt://localhost:17687 python export/export_typology.py   # -> data/typology.json
NEO4J_URI=bolt://localhost:17687 python export/render_story.py      # -> data/story.json + export/story-draft.md
NEO4J_URI=bolt://localhost:17687 python export/export_evidence.py   # -> data/evidence.json + export/context-notes-draft.md
```

`data/evidence.json` holds the explorer's verses, link notes, Catechism excerpts and clarification notes. It
loads only when a reader approaches the explorer.

`render_story.py` validates the script before writing `data/story.json`. It refuses to write the file if
anything fails:

- every verse, Catechism paragraph and type → antitype link must exist in the graph;
- every commentary quote must appear verbatim in the Haydock commentary for that pair;
- every Catechism quote must appear verbatim in its paragraph;
- every quoted phrase in the on-screen text must be real CPDV or Catechism wording.

`export/story-draft.md` is the readable review copy, with the real verse, commentary and Catechism text.

## Structure

```
index.html
css/   variables.css (design tokens) · main.css · explorer.css · responsive.css
js/    main.js (scroll wiring) · graph-renderer.js (two-column and radial layouts, morph, highlights)
       story-steps.js (step cards, sources section) · explorer.js (search, figure panels, ego diagram)
       palette.js · data-loader.js · util.js
data/  typology.json · story.json · evidence.json (generated)
export/ story.toml (the script) · context_notes.toml (Catechism clarifications)
        render_story.py · export_typology.py · export_evidence.py · textcheck.py
        story-draft.md · context-notes-draft.md (generated review copies)
```

No build step. D3 7.9.0 and Scrollama 3.2.0 load from jsDelivr with pinned versions.

## Design notes

- **One theme color at a time.** The four featured themes have their own hues (Christ: gold,
  sacraments: aqua, Mary: blue, Church: magenta), validated on the dark background. No set of four can
  be told apart reliably when shown together, so a view shows one hue plus neutral gray, and a hue
  always means the same theme.
- **Warrant badges.** Each featured pair says how strong its basis is: the New Testament draws the link
  itself, the Catechism teaches it, or it comes from the commentary tradition.
- On phones, the graph sticks to the top of the screen and the step cards scroll beneath it. Labels are
  limited to the pair being discussed.
- **Explorer:** links are listed by theme, with a text label beside every color. A Catechism note on a
  figure also shows beside every link that touches that figure. Verses found by mining cross-references
  are labelled "via cross-references".

## Sources

- **Scripture:** Catholic Public Domain Version (CPDV), with Vulgate numbering. Psalms also show the
  Hebrew number, e.g. Psalm 109 (110).
- **Typology:** the Catechism of the Catholic Church (short excerpts, © Libreria Editrice Vaticana) and
  the Haydock Bible commentary (first published 1811–1814; 1883 edition, public domain).
- **AI assistance:** an AI assistant made a first review pass with suggestions, and the author then
  reviewed selections of them personally, over several rounds.

Part of the LogosGraph project, alongside
[bible-crossrefs-visualization](https://github.com/wsovine/bible-crossrefs-visualization) and
[bible-timeline](https://github.com/wsovine/bible-timeline).
