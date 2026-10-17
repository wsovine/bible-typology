import { categoryColor, cssVar } from './palette.js';
import { h, truncate } from './util.js';

const THEMES = ['Christological', 'Sacramental', 'Marian', 'Ecclesial', 'Eschatological', 'Covenantal'];
const THEME_LABELS = {
  Christological: 'Christ',
  Sacramental: 'Sacraments',
  Marian: 'Mary',
  Ecclesial: 'Church',
  Eschatological: 'End of time',
  Covenantal: 'Covenants',
};
const FEATURED = ['noahs-ark', 'melchizedek', 'eve', 'jonah', 'the-temple-of-jerusalem', 'christ'];
const EGO_CAP = 10; // figures drawn per side of the diagram; the lists below always show everything
const VERSES_SHOWN = 6;

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const linkKey = (l) => `${l.source}|${l.target}`;
const sourceLabel = (s) => (s.startsWith('CCC-') ? `Catechism §${s.slice(4)}` : s === 'haydock' ? 'Haydock commentary' : s);

/**
 * Search, filter and inspect every figure: its links grouped by theme, the verses and Catechism
 * paragraphs behind it, and the Catechism clarification notes. Evidence loads lazily (data/evidence.json).
 */
export class Explorer {
  constructor(root, typology, loadEvidence) {
    this.root = root;
    this.loadEvidence = loadEvidence;
    this.types = typology.types;
    this.byId = new Map(this.types.map((t) => [t.id, t]));
    this.outgoing = new Map(this.types.map((t) => [t.id, []]));
    this.incoming = new Map(this.types.map((t) => [t.id, []]));
    for (const l of typology.links) {
      this.outgoing.get(l.source).push(l);
      this.incoming.get(l.target).push(l);
    }
    this.state = { query: '', testament: 'all', theme: null, sort: 'links', selected: null };
    this.buildShell();
    this.renderList();
    this.renderPanel();
  }

  // ---- data ----------------------------------------------------------------

  ensureEvidence() {
    this.evidencePromise ??= this.loadEvidence().then((evidence) => {
      this.evidence = evidence;
      // Notes on a Type (not link-specific) show on its card and beside every link that touches it.
      this.typeNotes = new Map();
      this.linkNotes = new Map();
      for (const note of evidence.contextNotes) {
        const map = note.target.link ? this.linkNotes : this.typeNotes;
        if (!map.has(note.key)) map.set(note.key, []);
        map.get(note.key).push(note);
      }
      return evidence;
    });
    return this.evidencePromise;
  }

  notesBesideLink(link, viewedId) {
    const other = link.source === viewedId ? link.target : link.source;
    const fromOtherType = (this.typeNotes.get(other) ?? [])
      .filter((n) => n.appliesTo === 'type' || n.appliesTo === 'type-name');
    return [...(this.linkNotes.get(linkKey(link)) ?? []), ...fromOtherType];
  }

  // ---- shell ---------------------------------------------------------------

  buildShell() {
    this.search = h('input', {
      type: 'search', class: 'explorer-search', placeholder: 'Search figures (e.g. Noah, manna, Mary)',
      'aria-label': 'Search figures', autocomplete: 'off',
    });
    this.search.addEventListener('input', () => { this.state.query = this.search.value; this.renderList(); });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.visible[0]) this.select(this.visible[0].id);
    });

    const testaments = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Testament' },
      [['all', 'Both'], ['OT', 'Old Testament'], ['NT', 'New Testament']].map(([value, label]) => {
        const button = h('button', { type: 'button', 'data-value': value, 'aria-pressed': String(value === 'all') }, label);
        button.addEventListener('click', () => {
          this.state.testament = value;
          testaments.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
          this.renderList();
        });
        return button;
      }));

    const themes = h('div', { class: 'theme-chips', role: 'group', 'aria-label': 'Theme' },
      THEMES.map((theme) => {
        const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' },
          h('span', { class: 'swatch', style: { background: categoryColor(theme) }, 'aria-hidden': 'true' }),
          THEME_LABELS[theme]);
        chip.addEventListener('click', () => {
          this.state.theme = this.state.theme === theme ? null : theme;
          themes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === chip && this.state.theme === theme)));
          this.renderList();
        });
        return chip;
      }));

    this.sortSelect = h('select', { class: 'explorer-sort', 'aria-label': 'Sort figures' },
      [['links', 'Most links'], ['name', 'A–Z'], ['canon', 'Bible order']].map(([v, label]) => h('option', { value: v }, label)));
    this.sortSelect.addEventListener('change', () => { this.state.sort = this.sortSelect.value; this.renderList(); });

    this.count = h('p', { class: 'explorer-count', 'aria-live': 'polite' });
    this.list = h('ul', { class: 'explorer-list' });
    this.panel = h('div', { class: 'explorer-panel', 'aria-live': 'polite' });

    this.root.append(
      h('div', { class: 'explorer-toolbar' }, this.search, testaments, themes, this.sortSelect),
      h('div', { class: 'explorer-layout' },
        h('nav', { class: 'explorer-sidebar', 'aria-label': 'Figures' }, this.count, this.list),
        this.panel));
  }

  // ---- list ----------------------------------------------------------------

  degree(id) {
    return this.outgoing.get(id).length + this.incoming.get(id).length;
  }

  hasTheme(id, theme) {
    return [...this.outgoing.get(id), ...this.incoming.get(id)].some((l) => l.category === theme);
  }

  renderList() {
    const { query, testament, theme, sort } = this.state;
    const q = fold(query.trim());
    const matches = this.types.filter((t) => (testament === 'all' || t.testament === testament)
      && (!theme || this.hasTheme(t.id, theme))
      && (!q || fold(`${t.displayName} ${t.name} ${t.description ?? ''}`).includes(q)));
    const byName = (a, b) => a.displayName.localeCompare(b.displayName);
    const sorters = {
      links: (a, b) => this.degree(b.id) - this.degree(a.id) || byName(a, b),
      name: byName,
      canon: (a, b) => (a.testament === b.testament ? 0 : a.testament === 'OT' ? -1 : 1)
        || (a.canonPosition ?? Infinity) - (b.canonPosition ?? Infinity) || byName(a, b),
    };
    this.visible = matches.sort(sorters[sort]);
    this.count.textContent = `${this.visible.length} of ${this.types.length} figures`;
    this.list.replaceChildren(...this.visible.map((t) => {
      const button = h('button', { type: 'button', class: 'figure-item', 'aria-current': String(t.id === this.state.selected) },
        h('span', { class: 'figure-name' }, t.displayName),
        h('span', { class: 'figure-meta' }, `${t.testament === 'OT' ? 'OT' : 'NT'} · ${this.degree(t.id)}`));
      button.addEventListener('click', () => this.select(t.id));
      return h('li', {}, button);
    }));
  }

  // ---- selection -----------------------------------------------------------

  async select(id, { scroll = false } = {}) {
    if (!this.byId.has(id)) return;
    this.state.selected = id;
    history.replaceState(null, '', `#type=${encodeURIComponent(id)}`);
    this.list.querySelectorAll('.figure-item').forEach((b, i) => {
      b.setAttribute('aria-current', String(this.visible[i]?.id === id));
    });
    // Keep the selected figure in view inside the list (without scrolling the page).
    const current = this.list.querySelector('[aria-current="true"]');
    if (current) this.list.scrollTop = current.offsetTop - this.list.clientHeight / 2;
    this.panel.replaceChildren(h('p', { class: 'explorer-loading' }, 'Loading…'));
    await this.ensureEvidence();
    if (this.state.selected !== id) return;
    this.renderPanel();
    // Scroll only once the panel has its final height, so the explorer lands at the top. Jump instantly
    // from far away (e.g. a story card): smooth-scrolling through the story would replay every step.
    if (scroll) {
      const far = Math.abs(this.root.getBoundingClientRect().top) > window.innerHeight * 1.5;
      this.root.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'start' });
    } else {
      // In-explorer navigation: bring the new figure's details into view if they're off screen
      // (a link deep in a long panel, or the list above the panel on phones).
      const top = this.panel.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) this.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  renderPanel() {
    const id = this.state.selected;
    if (!id) {
      this.panel.replaceChildren(h('div', { class: 'explorer-empty' },
        h('p', {}, 'Choose a figure from the list, or start with one of these:'),
        h('div', { class: 'featured' }, FEATURED.map((fid) => {
          const b = h('button', { type: 'button', class: 'chip' }, this.byId.get(fid).displayName);
          b.addEventListener('click', () => this.select(fid));
          return b;
        }))));
      return;
    }
    const t = this.byId.get(id);
    const out = this.outgoing.get(id);
    const inc = this.incoming.get(id);
    // replaceChildren() would print a null as text, so drop empty sections first.
    this.panel.replaceChildren(...[
      this.header(t),
      this.egoDiagram(t, inc, out),
      out.length ? this.linkSection('Foreshadows', out, id, 'target') : null,
      inc.length ? this.linkSection('Foreshadowed by', inc, id, 'source') : null,
      this.verseSection(t),
      this.cccSection(t),
    ].filter(Boolean));
  }

  // ---- panel pieces --------------------------------------------------------

  contextNote(note) {
    return h('aside', { class: 'context-note' },
      h('span', { class: 'meta-label' }, 'What the Church teaches'),
      h('p', {}, note.text),
      note.ccc.map((q) => h('p', { class: 'context-ccc' }, `Catechism §${q.para}: “${q.quote.replaceAll('*', '')}”`)));
  }

  header(t) {
    const notes = (this.typeNotes.get(t.id) ?? []);
    return h('header', { class: 'figure-header' },
      h('p', { class: 'eyebrow' }, t.testament === 'OT' ? 'Old Testament figure' : 'New Testament fulfillment'),
      h('h3', {}, t.displayName),
      t.description ? h('p', { class: 'figure-description' }, t.description) : null,
      notes.map((n) => this.contextNote(n)));
  }

  egoDiagram(t, inc, out) {
    const rows = Math.min(Math.max(inc.length, out.length), EGO_CAP + 1);
    const height = Math.max(120, rows * 26 + 30);
    const svg = d3.create('svg')
      .attr('class', 'ego')
      .attr('viewBox', `0 0 640 ${height}`)
      .attr('role', 'img')
      .attr('aria-label', `${t.displayName}: foreshadowed by ${inc.length}, foreshadows ${out.length}`);
    const cx = 320;
    const cy = height / 2;
    const dim = cssVar('--link-neutral');
    const side = (links, end, x, anchor) => {
      // Same order as the grouped lists below: by theme, then the best-connected figures first.
      const sorted = [...links].sort((a, b) => THEMES.indexOf(a.category) - THEMES.indexOf(b.category)
        || this.degree(b[end]) - this.degree(a[end])
        || this.byId.get(a[end]).displayName.localeCompare(this.byId.get(b[end]).displayName));
      const shown = sorted.slice(0, EGO_CAP);
      links = sorted;
      const extra = links.length - shown.length;
      const n = shown.length + (extra ? 1 : 0);
      const y = (i) => (n === 1 ? cy : 20 + (i * (height - 40)) / (n - 1));
      shown.forEach((l, i) => {
        const other = this.byId.get(l[end]);
        const [x1, x2] = anchor === 'end' ? [x, cx] : [cx, x];
        const [y1, y2] = anchor === 'end' ? [y(i), cy] : [cy, y(i)];
        const path = svg.append('path')
          .attr('d', `M${x1},${y1}C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`)
          .attr('fill', 'none').attr('stroke', dim).attr('stroke-opacity', 0.45).attr('stroke-width', 1.2)
          .attr('data-key', linkKey(l));
        const g = svg.append('g').attr('class', 'ego-node').attr('tabindex', 0).attr('role', 'button')
          .attr('aria-label', `Open ${other.displayName}`)
          .on('click', () => this.select(other.id))
          .on('keydown', (e) => { if (e.key === 'Enter') this.select(other.id); })
          .on('mouseenter focus', () => path.attr('stroke', categoryColor(l.category)).attr('stroke-opacity', 1).attr('stroke-width', 2.5))
          .on('mouseleave blur', () => path.attr('stroke', dim).attr('stroke-opacity', 0.45).attr('stroke-width', 1.2));
        g.append('circle').attr('cx', x).attr('cy', y(i)).attr('r', 4);
        g.append('text').attr('x', x + (anchor === 'end' ? -9 : 9)).attr('y', y(i)).attr('dy', '0.32em')
          .attr('text-anchor', anchor).text(truncate(other.displayName, 26));
      });
      if (extra) {
        svg.append('text').attr('class', 'ego-more').attr('x', x + (anchor === 'end' ? -9 : 9)).attr('y', y(n - 1))
          .attr('dy', '0.32em').attr('text-anchor', anchor).text(`+${extra} more below`);
      }
    };
    side(inc, 'source', 212, 'end');
    side(out, 'target', 428, 'start');
    svg.append('circle').attr('class', 'ego-center').attr('cx', cx).attr('cy', cy).attr('r', 7);
    svg.append('text').attr('class', 'ego-center-label').attr('x', cx).attr('y', cy + 22)
      .attr('text-anchor', 'middle').text(truncate(t.displayName, 28));
    return h('figure', { class: 'ego-figure' }, svg.node());
  }

  linkSection(title, links, viewedId, otherEnd) {
    const byTheme = THEMES.map((theme) => [theme, links.filter((l) => l.category === theme)]).filter(([, ls]) => ls.length);
    return h('section', { class: 'link-section' },
      h('h4', {}, `${title} (${links.length})`),
      byTheme.map(([theme, ls]) => h('div', { class: 'theme-group' },
        h('h5', {},
          h('span', { class: 'swatch', style: { background: categoryColor(theme) }, 'aria-hidden': 'true' }),
          `${THEME_LABELS[theme]} (${ls.length})`),
        h('ul', { class: 'link-list' }, ls
          .sort((a, b) => this.degree(b[otherEnd]) - this.degree(a[otherEnd])
            || this.byId.get(a[otherEnd]).displayName.localeCompare(this.byId.get(b[otherEnd]).displayName))
          .map((l) => this.linkItem(l, viewedId, otherEnd))))));
  }

  linkItem(link, viewedId, otherEnd) {
    const other = this.byId.get(link[otherEnd]);
    const key = linkKey(link);
    const open = h('button', { type: 'button', class: 'figure-link' }, other.displayName);
    open.addEventListener('click', () => this.select(other.id));
    const verses = this.evidence.linkVerses[key] ?? [];
    return h('li', { class: 'link-item' },
      h('div', { class: 'link-main' }, open,
        h('span', { class: 'link-meta' }, `${link.confidence} confidence · ${link.sources.map(sourceLabel).join(', ')}`)),
      this.evidence.linkNotes[key] ? h('p', { class: 'link-note' }, this.evidence.linkNotes[key]) : null,
      this.notesBesideLink(link, viewedId).map((n) => this.contextNote(n)),
      verses.length ? h('details', { class: 'link-verses' },
        h('summary', {}, `Attested at ${verses.map((v) => this.evidence.verses[v]?.ref ?? v).join(', ')}`),
        verses.map((v) => this.verseLine(v))) : null);
  }

  verseLine(vid, tag) {
    const verse = this.evidence.verses[vid];
    if (!verse) return null;
    return h('figure', { class: 'verse' },
      h('figcaption', {}, verse.ref, tag ? h('span', { class: 'verse-tag' }, tag) : null),
      h('blockquote', {}, verse.text));
  }

  verseSection(t) {
    const all = this.evidence.memberships[t.id] ?? [];
    const section = h('section', { class: 'verse-section' }, h('h4', {}, `Scripture (${all.length})`));
    if (!all.length) {
      section.append(h('p', { class: 'muted' },
        'No verses are attached to this figure yet. Its links above carry the verses where commentators noticed it.'));
      return section;
    }
    // Curated evidence first; verses found by mining cross-references are labelled as such.
    const ordered = [...all.filter(([, p]) => p === 'curated'), ...all.filter(([, p]) => p === 'mined')];
    const lines = ordered.map(([vid, p]) => this.verseLine(vid, p === 'mined' ? 'via cross-references' : null));
    const list = h('div', { class: 'verse-list' }, lines.slice(0, VERSES_SHOWN));
    section.append(list);
    if (lines.length > VERSES_SHOWN) {
      const more = h('button', { type: 'button', class: 'show-more' }, `Show all ${lines.length} verses`);
      more.addEventListener('click', () => { list.replaceChildren(...lines); more.remove(); });
      section.append(more);
    }
    return section;
  }

  cccSection(t) {
    const paras = this.evidence.teaches[t.id] ?? [];
    if (!paras.length) return null;
    return h('section', { class: 'ccc-section' },
      h('h4', {}, 'In the Catechism'),
      paras.sort((a, b) => a - b).map((p) => h('div', { class: 'ccc' },
        h('span', { class: 'ccc-ref' }, `Catechism §${p}`),
        h('p', {}, this.evidence.ccc[String(p)]))));
  }
}
