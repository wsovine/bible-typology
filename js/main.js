import { loadData } from './data-loader.js';
import { GraphRenderer } from './graph-renderer.js';
import { buildSteps } from './story-steps.js';
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

  const steps = buildSteps(document.getElementById('steps'), story.chapters);
  const renderer = new GraphRenderer(
    document.getElementById('graph'), document.getElementById('legend'), typology, story.metadata.christFamily);
  renderer.setView(viewFor(steps[0]), { immediate: true });

  const scroller = scrollama();
  const offset = () => (window.matchMedia(MOBILE_QUERY).matches ? 0.8 : 0.55);
  scroller
    .setup({ step: '.step', offset: offset() })
    .onStepEnter(({ index }) => {
      steps.forEach((s, i) => s.el.classList.toggle('is-active', i === index));
      renderer.setView(viewFor(steps[index]));
    });

  // The graph re-lays itself out (ResizeObserver); scrollama needs to re-measure the steps.
  window.addEventListener('resize', debounce(() => {
    scroller.offsetTrigger(offset());
    scroller.resize();
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

  window.typologyDebug = { typology, story, renderer, scroller };
}

init().catch(showError);
