/** Delay `fn` until `wait` ms have passed without another call. */
export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Create an element; string children become text nodes (never parsed as HTML). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'style') Object.assign(el.style, value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Spread 1-D label positions so neighbours are at least `gap` apart, staying inside [lo, hi].
 * Mutates and returns items, each { want, at }.
 */
export function deoverlap(items, gap, lo, hi) {
  items.sort((a, b) => a.want - b.want);
  items.forEach((item, i) => {
    item.at = Math.max(item.want, i ? items[i - 1].at + gap : lo);
  });
  for (let i = items.length - 1; i >= 0; i--) {
    const ceiling = i === items.length - 1 ? hi : items[i + 1].at - gap;
    items[i].at = Math.max(lo, Math.min(items[i].at, ceiling));
  }
  return items;
}
