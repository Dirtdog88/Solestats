// The SoleStats front page: builds every element with textContent (never innerHTML with data).
const SUBJECTS = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
const CATS = { shoes: 'Shoes', retail: 'Where to buy' };
// Column definitions live in DEFINITIONS (common.js); headers show them on hover and tap.
import { el, api, showEdition, engineName, defined, installTips } from './2026-11-21-common.js';

function scoreCell(s, extraClass = '') {
  if (!s || s.score == null) return el('td', { class: `num ${extraClass}` }, el('span', { class: 'score none' }, '—'));
  return el('td', { class: `num ${extraClass}` }, String(Math.round(s.score)), s.margin != null ? el('span', { class: 'margin' }, `±${Math.round(s.margin)}`) : '');
}

// A horizontal bar sized through the CSSOM (the CSP allows no style attributes).
function fill(pct) { const f = el('div', { class: 'fill' }); f.style.width = `${Math.max(3, Math.min(100, pct))}%`; return el('div', { class: 'track' }, f); }

// The first subject (Overall) as a horizontal bar with the number beside it, like a split.
function barCell(s) {
  if (!s || s.score == null) return el('td', { class: 'barcell' }, el('span', { class: 'score none' }, '—'));
  const v = Math.round(s.score);
  return el('td', { class: 'barcell' }, el('div', { class: 'bar' }, fill(v), el('span', { class: 'val' }, String(v)), s.margin != null ? el('span', { class: 'margin' }, `±${Math.round(s.margin)}`) : ''));
}

function brandTable(brands, subjects) {
  if (!brands.length) return el('p', { class: 'empty' }, 'No scores yet.');
  const [first, ...rest] = subjects;
  const head = el('tr', {}, el('th', {}, 'Brand'), defined('th', first), ...rest.map(s => defined('th', s, { class: 'num sec' })));
  const sorted = [...brands].sort((a, b) => (b.scores[subjects[0]]?.score ?? -1) - (a.scores[subjects[0]]?.score ?? -1) || a.name.localeCompare(b.name));
  const rows = sorted.map(b => el('tr', {}, el('td', {}, el('a', { href: `/brand.html?b=${encodeURIComponent(b.slug)}` }, b.name)), barCell(b.scores[first]), ...rest.map(s => scoreCell(b.scores[s], 'sec'))));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

function retailTable(data) {
  if (!data.rows.length) return el('p', { class: 'empty' }, 'No data yet.');
  const answers = Object.fromEntries(data.answers.map(a => [a.category, a.n]));
  const cats = [...new Set(data.rows.map(r => r.category))];
  const retailers = [...new Set(data.rows.map(r => r.retailer_slug))];
  const names = Object.fromEntries(data.rows.map(r => [r.retailer_slug, r.name]));
  const lookup = Object.fromEntries(data.rows.map(r => [r.category + '|' + r.retailer_slug, r.n]));
  const head = el('tr', {}, defined('th', 'place'), ...cats.map(c => el('th', {}, CATS[c] || c)));
  const rows = retailers.map(slug => el('tr', {}, el('td', {}, names[slug]), ...cats.map(c => {
    const n = lookup[c + '|' + slug] || 0; const d = answers[c] || 0;
    if (!d) return el('td', { class: 'num' }, '—');
    const pct = Math.round(100 * n / d);
    return el('td', { class: 'barcell' }, el('div', { class: 'bar' }, fill(pct), el('span', { class: 'val' }, `${pct}%`)));
  })));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

// One card per engine in the edition (answers, model id, how many searched the web and cited sources), then a dashed
// card for each engine still pending (PENDING_ENGINES in wrangler.toml).
function engineStrip(d) {
  const cards = (d.engines || []).map(e => el('li', { class: 'engine' }, defined('div', 'engine', { class: 'name', text: engineName(e.engine) }), el('div', { class: 'model' }, e.model || ''),
    el('div', { class: 'big' }, String(e.runs)), el('div', { class: 'stat' }, `answers · ${e.searched || 0} searched · ${e.cited || 0} cited`)));
  for (const p of d.pending || []) cards.push(el('li', { class: 'engine pending' }, el('div', { class: 'name' }, engineName(p)), el('div', { class: 'stat' }, 'Pending')));
  return cards;
}

async function main() {
  installTips();
  const health = await api('/api/health').catch(() => ({}));
  const notice = document.getElementById('notice');
  if (health.notice) { notice.textContent = health.notice; notice.hidden = false; }
  showEdition();
  const { brands, round } = await api('/api/brands').catch(() => ({ brands: [], round: null }));
  document.getElementById('engines').replaceChildren(...engineStrip(await api('/api/edition').catch(() => ({ engines: [], pending: [] }))));
  const list = document.getElementById('brand-list');
  for (const b of brands) list.append(el('option', { value: b.name }));
  document.getElementById('shoe-table').replaceChildren(brandTable(brands.filter(b => b.category === 'shoes' && Object.keys(b.scores).length), SUBJECTS));
  document.getElementById('retail-table').replaceChildren(retailTable(await api('/api/retailers').catch(() => ({ rows: [], answers: [] }))));
  const dl = document.getElementById('downloads');
  if (round) for (const f of ['prompts', 'answers', 'citations', 'mentions', 'routes', 'scores']) dl.append(el('li', {}, el('a', { href: `/download/${round}/${f}.csv` }, `${f}.csv`)));
  else dl.append(el('li', { class: 'muted' }, 'None yet.'));
  document.getElementById('lookup').addEventListener('submit', e => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim().toLowerCase();
    const b = brands.find(x => x.name.toLowerCase() === q) || brands.find(x => x.name.toLowerCase().startsWith(q));
    if (b) location.href = `/brand.html?b=${encodeURIComponent(b.slug)}`;
    else { notice.textContent = `Not in the index: ${document.getElementById('q').value.trim()}`; notice.hidden = false; }
  });
}
main();
