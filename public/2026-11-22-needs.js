// Brand by need (2026-11-22): the share of answers in each runner-need group that name a brand, as a heat map on the
// front page and one row on each brand page. One hue, light to dark, in six fixed steps so rounds compare; the number
// is always printed, and the top-pick share is in the cell's tip (hover, focus or tap).
import { el, defined } from './2026-11-21-common.js';

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

/** The front-page heat map: rows are brands in the order given (by AI score), columns the need groups. */
export function needTable(view, brands) {
  if (!view || !view.groups || !view.groups.length) return el('p', { class: 'empty' }, 'No need groups in this edition yet.');
  const head = el('tr', {}, el('th', { class: 'stick' }, 'Brand'), ...view.groups.map(g => el('th', { class: 'heat-h' }, g.label)));
  const rows = brands.filter(b => view.brands[b.slug]).map(b => el('tr', {},
    el('td', { class: 'stick' }, el('a', { href: `/brand.html?b=${encodeURIComponent(b.slug)}` }, b.name)),
    ...view.groups.map(g => cell('td', b.name, g, view.brands[b.slug][g.id] || { share: 0, top_share: 0, margin: null }))));
  return el('table', { class: 'heatmap' }, el('thead', {}, head), el('tbody', {}, ...rows));
}

/** The brand page's row: one labelled tile per need group. */
export function needRow(needs, name) {
  if (!needs || !needs.groups) return null;
  return el('section', { class: 'card' }, el('h3', {}, defined('span', 'need', { text: 'By runner need' })),
    el('div', { class: 'need-row' }, ...needs.groups.map(g => el('div', { class: 'need-tile' }, el('div', { class: 'label' }, g.label), cell('div', name, g, needs.cells[g.id] || { share: 0, top_share: 0, margin: null }, { class: 'big' })))),
    heatLegend());
}
