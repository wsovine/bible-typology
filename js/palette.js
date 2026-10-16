// Category hues live in css/variables.css; read them from there so CSS stays the single source.
const CATEGORY_VARS = {
  Christological: '--cat-christological',
  Sacramental: '--cat-sacramental',
  Marian: '--cat-marian',
  Ecclesial: '--cat-ecclesial',
};

export const CATEGORY_NAMES = {
  Christological: 'Christ',
  Sacramental: 'the sacraments',
  Marian: 'Mary',
  Ecclesial: 'the Church',
  Eschatological: 'the end of time',
  Covenantal: 'the covenants',
};

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The category's hue, or the neutral link color for themes the story doesn't feature. */
export function categoryColor(category) {
  return cssVar(CATEGORY_VARS[category] ?? '--link-neutral');
}
