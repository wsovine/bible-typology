import { loadData, loadEvidence } from './data-loader.js';
import { Explorer } from './explorer.js';
import { GraphRenderer } from './graph-renderer.js';
import { buildAppendix, buildSteps } from './story-steps.js';
import { debounce, h } from './util.js';

const MOBILE_QUERY = '(max-width: 899px)';

function viewFor({ step, chapter }) {
  return { view: step.view, category: chapter.category, pair: step.pair ?? null };
}

function showError(error) {
  console.error(error);
  document.querySelector('.scrolly').replaceChildren(
    h('p', { class: 'load-error' }, `Sorry, the story failed to load (${error.message}).`));
}

async function init() {
  const { typology, story } = await loadData();
  document.getElementById('story-title').textContent = story.meta.title;
  document.getElementById('story-subtitle').textContent = story.meta.subtitle;

  // Sources & methods closes the page as plain text after the explorer; every other chapter scrolls.
  const steps = buildSteps(document.getElementById('steps'), story.chapters.filter((c) => c.id !== 'sources'));
  const appendix = story.chapters.find((c) => c.id === 'sources');
  if (appendix) buildAppendix(document.getElementById('sources'), appendix);
  const renderer = new GraphRenderer(
    document.getElementById('graph'), document.getElementById('legend'), typology, story.metadata.christFamily);
  renderer.setView(viewFor(steps[0]), { immediate: true });

  // Steps trigger later on phones, where the graphic covers the top of the screen. Scrollama 3 can't
  // change its offset in place, so rebuild it when the layout crosses the phone breakpoint.
  let scroller;
  let mobile;
  const setupScroller = () => {
    mobile = window.matchMedia(MOBILE_QUERY).matches;
    scroller?.destroy();
    scroller = scrollama();
    scroller
      .setup({ step: '.step', offset: mobile ? 0.8 : 0.55 })
      .onStepEnter(({ index }) => {
        steps.forEach((s, i) => s.el.classList.toggle('is-active', i === index));
        renderer.setView(viewFor(steps[index]));
      });
  };
  setupScroller();

  // The graph re-lays itself out (ResizeObserver); scrollama needs to re-measure the steps.
  window.addEventListener('resize', debounce(() => {
    if (window.matchMedia(MOBILE_QUERY).matches !== mobile) setupScroller();
    else scroller.resize();
  }, 200));

  // Review helper: ?step=<id> jumps straight to a step (handy for screenshots and sharing a moment).
  const jump = new URLSearchParams(window.location.search).get('step');
  const target = steps.findIndex((s) => s.step.id === jump);
  if (target >= 0) {
    const el = steps[target].el;
    if (window.matchMedia(MOBILE_QUERY).matches) {
      // Land the card just below the sticky graphic rather than underneath it.
      const graphic = document.querySelector('.graphic').offsetHeight;
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - graphic + 8);
    } else {
      el.scrollIntoView({ block: 'center' });
    }
    steps.forEach((s, i) => s.el.classList.toggle('is-active', i === target));
    renderer.setView(viewFor(steps[target]), { immediate: true });
  }

  // Explorer: evidence loads as the reader approaches it, or immediately for a #type= link.
  const explorerRoot = document.getElementById('explorer');
  const explorer = new Explorer(explorerRoot, typology, loadEvidence);
  new IntersectionObserver((entries, observer) => {
    if (entries.some((e) => e.isIntersecting)) {
      explorer.ensureEvidence();
      observer.disconnect();
    }
  }, { rootMargin: '800px 0px' }).observe(explorerRoot);
  const hashType = () => decodeURIComponent(window.location.hash.match(/^#type=(.+)$/)?.[1] ?? '');
  window.addEventListener('hashchange', () => { if (hashType()) explorer.select(hashType(), { scroll: true }); });
  if (hashType()) explorer.select(hashType(), { scroll: true });

  window.typologyDebug = { typology, story, renderer, explorer, scroller: () => scroller };
}

init().catch(showError);
