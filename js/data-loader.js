/**
 * Data URLs resolve through the page's import map, which export/stamp.py fills with content-hashed
 * versions (`data/typology.json?v=…`), so a deploy never serves a cached old file next to new code.
 * Without the map (or in a browser lacking import.meta.resolve) this falls back to the plain URL.
 */
function dataUrl(name) {
  const specifier = `../data/${name}`;
  return typeof import.meta.resolve === 'function'
    ? import.meta.resolve(specifier)
    : new URL(specifier, import.meta.url).href;
}

async function fetchJson(name) {
  const response = await fetch(dataUrl(name));
  if (!response.ok) throw new Error(`Failed to load ${name}: ${response.status}`);
  return response.json();
}

/** Load the generated graph and story (see export/). */
export async function loadData() {
  const [typology, story] = await Promise.all([fetchJson('typology.json'), fetchJson('story.json')]);
  return { typology, story };
}

/** Explorer-only evidence (verses, notes, Catechism excerpts); fetched on demand. */
export function loadEvidence() {
  return fetchJson('evidence.json');
}
