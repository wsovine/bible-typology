const DATA_PATH = './data';

async function fetchJson(name) {
  const response = await fetch(`${DATA_PATH}/${name}`);
  if (!response.ok) throw new Error(`Failed to load ${name}: ${response.status}`);
  return response.json();
}

/** Load the generated graph and story (see export/). */
export async function loadData() {
  const [typology, story] = await Promise.all([fetchJson('typology.json'), fetchJson('story.json')]);
  return { typology, story };
}
