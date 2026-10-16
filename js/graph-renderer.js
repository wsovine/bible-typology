import { CATEGORY_NAMES, categoryColor, cssVar } from './palette.js';
import { deoverlap, h, lerp, truncate } from './util.js';

// Fulfillments are grouped by the dominant theme of the links reaching them, in story order.
const NT_GROUP_ORDER = ['Christological', 'Sacramental', 'Marian', 'Ecclesial', 'Eschatological', 'Covenantal', null];
const MORPH_MS = 1400;
const STYLE_MS = 600;

const spread = (items, from, to, set) => items.forEach((item, i) => {
  if (item) set(item, items.length > 1 ? lerp(from, to, i / (items.length - 1)) : (from + to) / 2);
});
const fmt = (v) => Math.round(v * 10) / 10;

/**
 * Draws the typology graph in two layouts and morphs between them:
 *  - "shores": Old Testament figures on one side, their New Testament fulfillments on the other
 *    (columns on wide screens, top/bottom rows on phones);
 *  - "radial": Christ and the events of his life at the center, every other figure on a ring.
 * setView() applies a story step's highlight; only one category hue is ever shown at a time.
 */
export class GraphRenderer {
  constructor(svgEl, legendEl, typology, christFamily) {
    this.svg = d3.select(svgEl);
    this.desc = this.svg.select('desc');
    this.legendEl = legendEl;
    this.nodes = typology.types.map((t) => ({ ...t, pos: {}, x: 0, y: 0 }));
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = typology.links.map((l) => ({
      ...l, s: this.byId.get(l.source), t: this.byId.get(l.target), ctrl: {}, cur: null,
    }));
    this.christFamily = new Set(christFamily);
    this.layout = 'shores';
    this.view = null;
    this.morphing = false;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.gHeaders = this.svg.append('g');
    this.gLinks = this.svg.append('g').attr('fill', 'none');
    this.gNodes = this.svg.append('g');
    this.gLabels = this.svg.append('g');
    this.linkSel = this.gLinks.selectAll('path')
      .data(this.links, (d) => `${d.source}|${d.target}`)
      .join('path')
      .attr('stroke-linecap', 'round');
    this.nodeSel = this.gNodes.selectAll('circle').data(this.nodes, (d) => d.id).join('circle');
    this.nodeSel.append('title').text((d) => d.displayName);

    this.resize();
    // Re-lay out whenever the drawing area changes size (window resize, rotation, legend reflow).
    this.size = { width: this.W, height: this.H };
    new ResizeObserver(() => {
      const { width, height } = svgEl.getBoundingClientRect();
      if (Math.abs(width - this.size.width) < 1 && Math.abs(height - this.size.height) < 1) return;
      this.size = { width, height };
      this.resize();
    }).observe(svgEl);
  }

  // ---- layout ------------------------------------------------------------

  resize() {
    const { width, height } = this.svg.node().getBoundingClientRect();
    this.W = width;
    this.H = height;
    this.vertical = width < 600;
    this.svg.interrupt('morph');
    this.morphing = false;
    this.computeShores();
    this.computeRadial();
    for (const layout of ['shores', 'radial']) {
      for (const l of this.links) l.ctrl[layout] = this.controls(layout, l);
    }
    this.place(this.layout, this.layout, 1);
    this.drawHeaders();
    if (this.view) this.setView(this.view, { immediate: true });
  }

  computeShores() {
    const { W, H } = this;
    this.otOrder = this.nodes.filter((n) => n.testament === 'OT')
      .sort((a, b) => a.canonPosition - b.canonPosition || a.displayName.localeCompare(b.displayName));
    this.ntOrder = this.nodes.filter((n) => n.testament === 'NT')
      .sort((a, b) => NT_GROUP_ORDER.indexOf(a.group) - NT_GROUP_ORDER.indexOf(b.group)
        || b.inDegree - a.inDegree || a.displayName.localeCompare(b.displayName));
    // A blank slot between theme groups on the fulfillment side.
    const ntSlots = [];
    this.ntOrder.forEach((n, i) => {
      if (i && n.group !== this.ntOrder[i - 1].group) ntSlots.push(null);
      ntSlots.push(n);
    });

    if (this.vertical) {
      this.otRowY = 44;
      this.ntRowY = H - 40;
      spread(this.otOrder, 12, W - 12, (n, x) => { n.pos.shores = { x, y: this.otRowY }; });
      spread(ntSlots, 12, W - 12, (n, x) => { n.pos.shores = { x, y: this.ntRowY }; });
    } else {
      const column = Math.max(110, Math.min(W * 0.28, 210));
      this.otX = column;
      this.ntX = W - column;
      spread(this.otOrder, 48, H - 24, (n, y) => { n.pos.shores = { x: this.otX, y }; });
      spread(ntSlots, 48, H - 24, (n, y) => { n.pos.shores = { x: this.ntX, y }; });
    }
  }

  computeRadial() {
    const { W, H } = this;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) / 2 - (this.vertical ? 22 : 64);
    this.center = { x: cx, y: cy };
    // Christ at the center; the events of his life on a small inner ring.
    const inner = this.nodes.filter((n) => this.christFamily.has(n.id)).sort((a, b) => b.inDegree - a.inDegree);
    inner.forEach((n, i) => {
      if (i === 0) {
        n.pos.radial = { x: cx, y: cy };
        return;
      }
      const a = -Math.PI / 2 + (2 * Math.PI * (i - 1)) / (inner.length - 1);
      n.pos.radial = { x: cx + Math.cos(a) * R * 0.26, y: cy + Math.sin(a) * R * 0.26 };
    });
    const outer = [...this.otOrder, ...this.ntOrder].filter((n) => !this.christFamily.has(n.id));
    outer.forEach((n, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / outer.length;
      n.pos.radial = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
    });
  }

  /** Cubic Bézier control points for a link in a given layout. */
  controls(layout, l) {
    const s = l.s.pos[layout];
    const t = l.t.pos[layout];
    if (layout === 'radial') {
      const c = this.center;
      return [{ x: lerp(s.x, c.x, 0.6), y: lerp(s.y, c.y, 0.6) }, { x: lerp(t.x, c.x, 0.35), y: lerp(t.y, c.y, 0.35) }];
    }
    if (this.vertical) {
      if (s.y !== t.y) {
        const m = (s.y + t.y) / 2;
        return [{ x: s.x, y: m }, { x: t.x, y: m }];
      }
      const bulge = (this.H / 2 - s.y) * 0.6; // same-testament link: bow toward the middle
      return [{ x: s.x, y: s.y + bulge }, { x: t.x, y: t.y + bulge }];
    }
    if (s.x !== t.x) {
      const m = (s.x + t.x) / 2;
      return [{ x: m, y: s.y }, { x: m, y: t.y }];
    }
    const bulge = (this.W / 2 - s.x) * 0.45;
    return [{ x: s.x + bulge, y: s.y }, { x: t.x + bulge, y: t.y }];
  }

  /** Position everything at fraction k of the way from layout `from` to layout `to`. */
  place(from, to, k) {
    for (const n of this.nodes) {
      n.x = lerp(n.pos[from].x, n.pos[to].x, k);
      n.y = lerp(n.pos[from].y, n.pos[to].y, k);
    }
    for (const l of this.links) {
      const [a1, a2] = l.ctrl[from];
      const [b1, b2] = l.ctrl[to];
      l.cur = [
        { x: lerp(a1.x, b1.x, k), y: lerp(a1.y, b1.y, k) },
        { x: lerp(a2.x, b2.x, k), y: lerp(a2.y, b2.y, k) },
      ];
    }
    this.nodeSel.attr('cx', (d) => fmt(d.x)).attr('cy', (d) => fmt(d.y));
    this.linkSel.attr('d', (l) => {
      const [c1, c2] = l.cur;
      return `M${fmt(l.s.x)},${fmt(l.s.y)}C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(l.t.x)},${fmt(l.t.y)}`;
    });
  }

  morph(target, immediate) {
    let from = this.layout;
    if (this.morphing) {
      // Interrupted mid-morph: continue from wherever things are now.
      this.svg.interrupt('morph');
      for (const n of this.nodes) n.pos.current = { x: n.x, y: n.y };
      for (const l of this.links) l.ctrl.current = l.cur;
      from = 'current';
    }
    this.layout = target;
    this.gLabels.selectAll('g.label').interrupt().transition().duration(150).attr('opacity', 0).remove();
    if (immediate || this.reduceMotion) {
      this.morphing = false;
      this.place(target, target, 1);
      this.drawLabels(this.styleFor(this.view).labels, 0);
      return;
    }
    this.morphing = true;
    this.svg.transition('morph')
      .duration(MORPH_MS)
      .ease(d3.easeCubicInOut)
      .tween('layout', () => (k) => this.place(from, target, k))
      .on('end', () => {
        this.morphing = false;
        this.drawLabels(this.styleFor(this.view).labels, STYLE_MS);
      });
  }

  // ---- views -------------------------------------------------------------

  setView(view, { immediate = false } = {}) {
    this.view = view;
    const ms = immediate || this.reduceMotion ? 0 : STYLE_MS;
    const style = this.styleFor(view);
    const linkStyle = new Map(this.links.map((l) => [l, style.link(l)]));

    this.linkSel.interrupt('style').transition('style').duration(ms)
      .attr('stroke', (l) => linkStyle.get(l).color)
      .attr('stroke-width', (l) => linkStyle.get(l).width)
      .attr('stroke-opacity', (l) => linkStyle.get(l).opacity);
    this.linkSel.filter((l) => linkStyle.get(l).raise).raise();
    this.nodeSel.interrupt('style').transition('style').duration(ms)
      .attr('r', (d) => this.radius(d) * (style.node(d).scale ?? 1))
      .attr('fill', (d) => style.node(d).fill)
      .attr('fill-opacity', (d) => style.node(d).opacity);

    const target = view.view === 'radial' ? 'radial' : 'shores';
    this.gHeaders.transition('style').duration(ms).attr('opacity', target === 'shores' ? 1 : 0);
    this.renderLegend(style.legend);
    this.desc.text(style.description);

    if (target !== this.layout) this.morph(target, immediate);
    else if (!this.morphing) this.drawLabels(style.labels, ms);
  }

  radius(d) {
    const r = d.testament === 'NT' ? 2 + Math.sqrt(d.inDegree) * 0.55 : 1.6 + Math.sqrt(d.outDegree) * 0.45;
    return this.vertical ? r * 0.8 : r;
  }

  styleFor({ view, category, pair }) {
    const neutral = cssVar('--link-neutral');
    const dim = cssVar('--link-dim');
    const nodeFill = cssVar('--node');
    const strong = cssVar('--text-primary');
    const total = this.links.length;

    if (view === 'radial') {
      const gold = categoryColor('Christological');
      const intoChrist = (l) => this.christFamily.has(l.target);
      const count = this.links.filter(intoChrist).length;
      return {
        link: (l) => (intoChrist(l)
          ? { color: gold, width: 1.1, opacity: 0.65, raise: true }
          : { color: dim, width: 0.8, opacity: 0.55 }),
        node: (d) => (this.christFamily.has(d.id) ? { fill: gold, opacity: 1, scale: 1.2 } : { fill: nodeFill, opacity: 0.5 }),
        labels: this.nodes.filter((d) => (this.vertical ? d.id === 'christ' : this.christFamily.has(d.id)))
          .map((d) => ({ node: d, strong: d.id === 'christ' })),
        legend: [
          { color: gold, text: `${count} links into Christ or an event of his life` },
          { color: dim, text: `${total - count} other links` },
        ],
        description: `Radial view: ${count} of ${total} links point to Christ or an event of his life.`,
      };
    }

    if (view === 'pair' && pair) {
      const color = categoryColor(pair.category);
      const isPair = (l) => l.source === pair.type && l.target === pair.antitype;
      const ends = new Set([pair.type, pair.antitype]);
      const others = this.links.filter((l) => l.category === pair.category).length - 1;
      return {
        link: (l) => {
          if (isPair(l)) return { color, width: 3.5, opacity: 1, raise: true };
          if (l.category === pair.category) return { color, width: 1, opacity: 0.3 };
          return { color: dim, width: 0.7, opacity: 0.35 };
        },
        node: (d) => (ends.has(d.id) ? { fill: strong, opacity: 1, scale: 1.8 } : { fill: nodeFill, opacity: 0.3 }),
        labels: [this.byId.get(pair.type), this.byId.get(pair.antitype)].map((node) => ({ node, strong: true })),
        legend: [
          { color, text: `${pair.typeName} → ${pair.antitypeName}` },
          { color, faint: true, text: `${others} other links about ${CATEGORY_NAMES[pair.category]}` },
        ],
        description: `${pair.typeName} prefigures ${pair.antitypeName}.`,
      };
    }

    if (category) {
      const color = categoryColor(category);
      const inCategory = this.links.filter((l) => l.category === category);
      const ends = new Set(inCategory.flatMap((l) => [l.source, l.target]));
      const fulfillments = this.ntOrder.filter((n) => inCategory.some((l) => l.target === n.id));
      return {
        link: (l) => (l.category === category
          ? { color, width: 1.4, opacity: 0.85, raise: true }
          : { color: dim, width: 0.7, opacity: 0.35 }),
        node: (d) => (ends.has(d.id) ? { fill: nodeFill, opacity: 1 } : { fill: nodeFill, opacity: 0.25 }),
        labels: this.vertical ? [] : fulfillments.map((node) => ({ node, strong: false })),
        legend: [
          { color, text: `${inCategory.length} links about ${CATEGORY_NAMES[category]}` },
          { color: dim, text: `${total - inCategory.length} other links` },
        ],
        description: `${inCategory.length} of ${total} links are about ${CATEGORY_NAMES[category]}.`,
      };
    }

    return {
      link: () => ({ color: neutral, width: 0.9, opacity: 0.3 }),
      node: () => ({ fill: nodeFill, opacity: 0.85 }),
      labels: this.vertical ? [] : this.ntOrder.map((node) => ({ node, strong: false })),
      legend: [{ color: neutral, text: `${total} links, each from an Old Testament figure to its fulfillment` }],
      description: `${this.nodes.length} figures and ${total} links between them.`,
    };
  }

  // ---- labels, headers, legend -------------------------------------------

  placeLabels(labels) {
    const placed = [];
    if (this.layout === 'radial') {
      for (const { node, strong } of labels) {
        const dx = node.x - this.center.x;
        const dy = node.y - this.center.y;
        if (Math.hypot(dx, dy) < 1) {
          placed.push({ node, strong, x: node.x, y: node.y + 18, anchor: 'middle', rotate: 0, leader: false });
          continue;
        }
        const a = Math.atan2(dy, dx);
        placed.push({
          node, strong, x: node.x + Math.cos(a) * 10, y: node.y + Math.sin(a) * 10,
          anchor: Math.cos(a) >= 0 ? 'start' : 'end', rotate: 0, leader: false,
        });
      }
    } else if (this.vertical) {
      for (const { node, strong } of labels) {
        const above = node.testament === 'OT';
        const third = node.x < this.W / 3 ? 'start' : node.x > (2 * this.W) / 3 ? 'end' : 'middle';
        placed.push({
          node, strong, x: node.x, y: (above ? this.otRowY : this.ntRowY) + (above ? -14 : 15),
          anchor: third, rotate: 0, leader: false, maxChars: 28,
        });
      }
    } else {
      for (const testament of ['OT', 'NT']) {
        const items = labels.filter((l) => l.node.testament === testament).map((l) => ({ ...l, want: l.node.y }));
        const gap = items.some((it) => it.strong) ? 17 : 14;
        deoverlap(items, gap, 44, this.H - 10).forEach((it) => {
          const left = testament === 'OT';
          const x = left ? this.otX - 14 : this.ntX + 14;
          const room = left ? x - 8 : this.W - x - 8; // px available for the label text
          placed.push({
            ...it, x, y: it.at, anchor: left ? 'end' : 'start', rotate: 0,
            leader: true, lx: left ? x + 3 : x - 3, ly: it.at, maxChars: Math.floor(room / (it.strong ? 7.4 : 6.2)),
          });
        });
      }
    }
    return placed.map((p) => ({ ...p, text: truncate(p.node.displayName, p.maxChars ?? 40) }));
  }

  drawLabels(labels, ms) {
    const placed = this.placeLabels(labels);
    const sel = this.gLabels.selectAll('g.label').data(placed, (d) => d.node.id);
    sel.exit().interrupt().transition().duration(ms / 2).attr('opacity', 0).remove();
    const enter = sel.enter().append('g').attr('class', 'label').attr('opacity', 0);
    enter.append('line').attr('class', 'leader');
    enter.append('text');
    const all = enter.merge(sel);
    all.select('text')
      .attr('class', (d) => `node-label${d.strong ? ' is-strong' : ''}`)
      .attr('text-anchor', (d) => d.anchor)
      .attr('dy', '0.32em')
      .attr('transform', (d) => `translate(${fmt(d.x)},${fmt(d.y)}) rotate(${d.rotate})`)
      .text((d) => d.text);
    all.select('line')
      .attr('x1', (d) => fmt(d.node.x)).attr('y1', (d) => fmt(d.node.y))
      .attr('x2', (d) => fmt(d.lx ?? d.node.x)).attr('y2', (d) => fmt(d.ly ?? d.node.y))
      .attr('visibility', (d) => (d.leader ? 'visible' : 'hidden'));
    all.interrupt().transition().duration(ms).attr('opacity', 1);
  }

  drawHeaders() {
    const rows = this.vertical
      ? [{ text: 'Old Testament', x: 12, y: 14, anchor: 'start' },
        { text: 'New Testament', x: 12, y: this.H - 6, anchor: 'start' }]
      : [{ text: 'Old Testament', x: this.otX, y: 24, anchor: 'end' },
        { text: 'New Testament', x: this.ntX, y: 24, anchor: 'start' }];
    this.gHeaders.selectAll('text').data(rows).join('text')
      .attr('class', 'graph-header')
      .attr('x', (d) => d.x).attr('y', (d) => d.y)
      .attr('text-anchor', (d) => d.anchor)
      .text((d) => d.text);
  }

  renderLegend(rows) {
    this.legendEl.replaceChildren(...rows.map((row) => h('div', { class: 'legend-row' },
      h('span', { class: 'swatch', style: { background: row.color, opacity: row.faint ? '0.45' : '1' } }),
      row.text)));
  }
}
