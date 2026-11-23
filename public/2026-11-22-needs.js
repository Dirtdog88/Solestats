// Brand by need (2026-11-22): the share of answers in each runner-need group that name a brand, as a heat map on the
// front page and one row on each brand page. One hue, light to dark, in six fixed steps so rounds compare; the number
// is always printed, and the top-pick share is in the cell's tip (hover, focus or tap).
import { el, defined, category } from './2026-11-21-common.js';

export const HEAT_STEPS = [5, 15, 30, 50, 70]; // step edges in percent: 0-5, 5-15, 15-30, 30-50, 50-70, 70+
export const heatStep = v => HEAT_STEPS.filter(x => v >= x).length;

function tipFor(name, g, c) {
  return [`${name} · ${g.label}`, `Named in ${Math.round(c.share)}% of ${g.answers} answers${c.margin != null ? ` (±${Math.round(c.margin)} between repeats)` : ''}; top pick in ${Math.round(c.top_share)}%.`];
}

function cell(tag, name, g, c, extra = {}) {
  const [title, text] = tipFor(name, g, c);
  return el(tag, { ...extra, class: `heat h${heatStep(c.share)} ${extra.class || ''}`.trim(), title: `${title}: ${text}`, 'data-tip': text, 'data-tip-title': title, tabindex: '0' }, String(Math.round(c.share)));
}

export function heatLegend() {
  const edges = [0, ...HEAT_STEPS];
  return el('div', { class: 'heat-legend', 'aria-hidden': 'true' }, ...edges.map((lo, i) => el('span', { class: 'key' }, el('span', { class: `swatch heat h${i}` }), i < HEAT_STEPS.length ? `${lo}–${HEAT_STEPS[i]}` : `${lo}+`)), el('span', { class: 'muted' }, '% of answers'));
}

/** The front-page heat map: rows are brands in the order given (by AI score), columns the need groups. With demand
 *  weights (src/2026-11-22-demand.js), the columns run from the most asked group to the least, each with its share of the
 *  asking under its name and the range in its tip. */
export function needTable(view, brands, weights = null) {
  if (!view || !view.groups || !view.groups.length) return el('p', { class: 'empty' }, 'No need groups in this edition yet.');
  const wOf = weights && weights.groups ? Object.fromEntries(weights.groups.map(g => [g.id, g])) : null;
  const groups = wOf ? [...view.groups].sort((a, b) => ((wOf[b.id] || {}).weight ?? -1) - ((wOf[a.id] || {}).weight ?? -1)) : view.groups;
  const th = g => {
    const w = wOf && wOf[g.id];
    if (!w) return el('th', { class: 'heat-h' }, g.label);
    const text = `About ${Math.round(w.weight)}% of the asking${w.low != null && w.high != null ? ` (range ${Math.round(w.low)}–${Math.round(w.high)} across the signals)` : ''}.`;
    return el('th', { class: 'heat-h', 'data-tip': text, 'data-tip-title': g.label, title: `${g.label}: ${text}`, tabindex: '0' }, g.label, el('span', { class: 'sub' }, `${Math.round(w.weight)}%`));
  };
  const head = el('tr', {}, el('th', { class: 'stick' }, 'Brand'), ...groups.map(th));
  const rows = brands.filter(b => view.brands[b.slug]).map(b => el('tr', {},
    el('td', { class: 'stick' }, el('a', { href: `/brand.html?b=${encodeURIComponent(b.slug)}` }, b.name)),
    ...groups.map(g => cell('td', b.name, g, view.brands[b.slug][g.id] || { share: 0, top_share: 0, margin: null }))));
  return el('table', { class: 'heatmap' }, el('thead', {}, head), el('tbody', {}, ...rows));
}

/** The brand page's row: one labelled tile per need group. */
export function needRow(needs, name) {
  if (!needs || !needs.groups) return null;
  return el('section', { class: 'card' }, el('h3', {}, defined('span', 'need', { text: category() === 'shoes' ? 'By runner need' : 'By need' })),
    el('div', { class: 'need-row' }, ...needs.groups.map(g => el('div', { class: 'need-tile' }, el('div', { class: 'label' }, g.label), cell('div', name, g, needs.cells[g.id] || { share: 0, top_share: 0, margin: null }, { class: 'big' })))),
    heatLegend());
}
