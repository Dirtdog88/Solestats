// The head-to-head page (2026-11-22): the core brands' pairs as a grid, each cell the share of answers that favour the
// row brand over the column brand, on a diverging scale (orange below an even split, grey around it, blue above). The
// number is always printed; counts and the engine split are in the tip and in the table below. Built with textContent.
import { el, api, showEdition, engineName, defined, installTips } from './2026-11-21-common.js';

export const H2H_STEPS = [20, 40, 60, 80]; // under 20 | 20-40 | 40-60 | 60-80 | 80 and over
const step = v => H2H_STEPS.filter(x => v >= x).length;

export function describe(name, other, s) {
  const per = Object.entries(s.by_engine || {}).map(([e, t]) => `${engineName(e)} ${t.wins}–${t.losses}${t.ties ? ` (${t.ties} tie${t.ties > 1 ? 's' : ''})` : ''}${t.unclear ? `, ${t.unclear} unclear` : ''}`).join('; ');
  const head = s.rate == null ? 'No answer picked either.' : `${name} favoured in ${Math.round(s.rate)}% of the answers that picked.`;
  return `${head} ${s.wins} for ${name}, ${s.losses} for ${other}, ${s.ties} tie${s.ties === 1 ? '' : 's'}, ${s.unclear} unclear, of ${s.n} answers. By engine: ${per}.`;
}

function grid(order, names, by) {
  const head = el('tr', {}, el('th', { class: 'stick' }, ''), ...order.map(c => el('th', { class: 'heat-h' }, names[c] || c)));
  const rows = order.map(r => el('tr', {}, el('td', { class: 'stick' }, el('a', { href: `/brand.html?b=${encodeURIComponent(r)}` }, names[r] || r)), ...order.map(c => {
    if (r === c) return el('td', { class: 'heat self' }, '');
    const s = (by[r]?.sides || []).find(x => x.opponent === c);
    if (!s) return el('td', { class: 'heat d-none' }, '');
    const title = `${names[r]} vs ${names[c]}`, text = describe(names[r], names[c], s);
    return el('td', { class: `heat ${s.rate == null ? 'd-none' : 'd' + step(s.rate)}`, title: `${title}: ${text}`, 'data-tip': text, 'data-tip-title': title, tabindex: '0' }, s.rate == null ? '—' : String(Math.round(s.rate)));
  })));
  return el('table', { class: 'heatmap h2h' }, el('thead', {}, head), el('tbody', {}, ...rows));
}

function legend() {
  const labels = ['under 20', '20–40', '40–60', '60–80', '80+'];
  return el('div', { class: 'heat-legend', 'aria-hidden': 'true' }, ...labels.map((l, i) => el('span', { class: 'key' }, el('span', { class: `swatch heat d${i}` }), l)), el('span', { class: 'muted' }, '% favouring the row brand'));
}

function pairTable(pairs, names) {
  const head = el('tr', {}, el('th', {}, 'Answers favouring'), el('th', { class: 'num' }, 'Tie'), el('th', { class: 'num' }, 'Unclear'), defined('th', 'n', { class: 'num' }));
  const rows = pairs.map(p => el('tr', {}, el('td', {}, `${names[p.a] || p.a} ${p.a_wins} · ${names[p.b] || p.b} ${p.b_wins}`), el('td', { class: 'num' }, String(p.ties)), el('td', { class: 'num' }, String(p.unclear)), el('td', { class: 'num' }, String(p.n))));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

async function main() {
  installTips();
  const health = await api('/api/health').catch(() => ({}));
  const notice = document.getElementById('notice');
  if (health.notice) { notice.textContent = health.notice; notice.hidden = false; }
  showEdition();
  const [{ brands }, v] = await Promise.all([api('/api/brands').catch(() => ({ brands: [] })), api('/api/views/h2h').catch(() => ({}))]);
  const host = document.getElementById('h2h-grid');
  if (!v.data || !v.data.pairs.length) { host.replaceChildren(el('p', { class: 'empty' }, 'No head-to-head answers in this edition yet.')); return; }
  const names = Object.fromEntries(brands.map(b => [b.slug, b.name]));
  const overall = Object.fromEntries(brands.map(b => [b.slug, b.scores.overall?.score ?? -1]));
  const order = [...v.data.brands].sort((a, b) => overall[b] - overall[a] || (names[a] || a).localeCompare(names[b] || b));
  host.replaceChildren(grid(order, names, v.by));
  document.getElementById('h2h-legend').replaceChildren(legend());
  const ns = [...new Set(v.data.pairs.map(p => p.n))];
  const engines = [...new Set(v.data.pairs.flatMap(p => Object.keys(p.by_engine || {})))];
  document.getElementById('h2h-n').textContent = `${v.data.pairs.length} pairs, ${ns.length === 1 ? ns[0] : ns.join(' to ')} answers each (${engines.length} engines × repeats). With so few answers per pair, a difference of one or two answers is noise: read the grid for clear leans, not small gaps. Brands are in Overall order.`;
  document.getElementById('h2h-table').replaceChildren(pairTable(v.data.pairs, names));
}
// The brand page imports the helpers below; only the head-to-head page has the grid.
if (document.getElementById('h2h-grid')) main();

/** The brand page's card: this brand against each of the other core brands, Overall order, with a link to the grid. */
export function h2hCard(h2h, name, names, overall) {
  if (!h2h || !h2h.sides || !h2h.sides.length) return null;
  const sides = [...h2h.sides].sort((a, b) => (overall[b.opponent] ?? -1) - (overall[a.opponent] ?? -1));
  return el('section', { class: 'card' }, el('h3', {}, defined('span', 'h2h')),
    el('p', { class: 'muted small' }, `Share of answers favouring ${name} when asked to choose between ${name} and each brand.`),
    el('ul', { class: 'h2h-list' }, ...sides.map(s => {
      const other = names[s.opponent] || s.opponent, text = describe(name, other, s), title = `${name} vs ${other}`;
      return el('li', {}, el('span', {}, `vs ${other}`), el('span', { class: `heat ${s.rate == null ? 'd-none' : 'd' + step(s.rate)}`, title: `${title}: ${text}`, 'data-tip': text, 'data-tip-title': title, tabindex: '0' }, s.rate == null ? '—' : String(Math.round(s.rate))));
    })),
    el('p', { class: 'small' }, el('a', { href: '/h2h.html' }, 'All head-to-head pairs')));
}
