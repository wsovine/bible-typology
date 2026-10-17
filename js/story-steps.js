import { h } from './util.js';
import { categoryColor } from './palette.js';

const WARRANT_BADGES = {
  scripture: 'Named in the New Testament',
  catechism: 'In the Catechism',
  tradition: 'Commentary tradition',
};

function verseBlock(verse, extraClass = '') {
  return h('figure', { class: `verse ${extraClass}`.trim() },
    h('figcaption', {}, verse.ref),
    h('blockquote', {}, verse.text));
}

function cccBlock(refs) {
  return refs.map((ref) => h('div', { class: 'ccc' },
    h('span', { class: 'ccc-ref' }, `Catechism §${ref.para}`),
    // The Catechism text marks italics with asterisks; drop them for display.
    h('p', {}, `“${ref.quote.replaceAll('*', '')}”`)));
}

function pairCard(step) {
  const { pair } = step;
  const card = h('div', { class: 'pair-card' },
    h('div', { class: 'pair-head' },
      h('span', { class: 'swatch', style: { background: categoryColor(pair.category) }, 'aria-hidden': 'true' }),
      `${pair.typeName} → ${pair.antitypeName}`),
    h('ul', { class: 'warrants', 'aria-label': 'Warrant' },
      step.warrant.map((w) => h('li', { class: 'badge', title: w.label }, WARRANT_BADGES[w.key] ?? w.label))),
    verseBlock(step.ot, 'verse--ot'),
    h('div', { class: 'pair-arrow' }, 'fulfilled in'),
    verseBlock(step.nt, 'verse--nt'));

  if (step.quote) {
    const attribution = [step.quote.by, step.quote.source].filter(Boolean).join(', ');
    card.append(h('div', { class: 'commentary' },
      h('span', { class: 'meta-label' }, 'Commentary'),
      h('p', {}, `“${step.quote.text}”`),
      h('p', { class: 'attribution' }, `— ${attribution}`)));
  }
  card.append(...cccBlock(step.ccc));
  return card;
}

/**
 * Render each chapter's steps into `container`.
 * Returns [{ el, step, chapter }] in scroll order.
 */
export function buildSteps(container, chapters) {
  const built = [];
  for (const chapter of chapters) {
    chapter.steps.forEach((step, index) => {
      const card = h('div', { class: 'step-card' });
      if (index === 0) {
        const label = h('h2', { class: 'chapter-label' }, chapter.title);
        if (chapter.category) {
          label.dataset.category = chapter.category;
          label.style.setProperty('--chapter-color', categoryColor(chapter.category));
        }
        card.append(label);
      }
      card.append(h('p', { class: 'step-text' }, step.text));
      if (step.verse) card.append(verseBlock(step.verse));
      if (step.pair) card.append(pairCard(step));
      else card.append(...cccBlock(step.ccc));

      const el = h('section', { class: 'step', 'data-step': step.id }, card);
      container.append(el);
      built.push({ el, step, chapter });
    });
  }
  return built;
}
