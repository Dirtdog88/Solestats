// The SoleStats front page: builds every element with textContent (never innerHTML with data).
const SUBJECTS = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
const CATS = { shoes: 'Shoes', retail: 'Where to buy' };
// Column definitions live in DEFINITIONS (common.js); headers show them on hover and tap.
import { el, api, showEdition, engineName, defined, installTips, overallStatus } from './2026-11-21-common.js';
import { needTable, heatLegend } from './2026-11-22-needs.js';

function scoreCell(s, extraClass = '') {
  if (!s || s.score == null) return el('td', { class: `num ${extraClass}` }, el('span', { class: 'score none' }, '—'));
  return el('td', { class: `num ${extraClass}` }, String(Math.round(s.score)), s.margin != null ? el('span', { class: 'margin' }, `±${Math.round(s.margin)}`) : '');
}

// A horizontal bar sized through the CSSOM (the CSP allows no style attributes).
function fill(pct) { const f = el('div', { class: 'fill' }); f.style.width = `${Math.max(3, Math.min(100, pct))}%`; return el('div', { class: 'track' }, f); }

// The first subject (the AI score) as a bar on a full-length track, out of 100.
function barCell(s) {
  if (!s || s.score == null) return el('td', { class: 'barcell' }, defined('span', 'too_few_score', { class: 'score none' }));
  const v = Math.round(s.score);
  return el('td', { class: 'barcell' }, el('div', { class: 'bar' }, fill(v), el('span', { class: 'val' }, String(v), el('span', { class: 'of' }, '/100')), s.margin != null ? el('span', { class: 'margin' }, `±${Math.round(s.margin)}`) : ''));
}

function brandTable(brands, subjects, overallLabel = 'AI score') {
  if (!brands.length) return el('p', { class: 'empty' }, 'No scores yet.');
  const [first, ...rest] = subjects;
  const head = el('tr', {}, el('th', {}, 'Brand'), defined('th', first, first === 'overall' ? { text: overallLabel } : {}), ...rest.map(s => defined('th', s, { class: 'num sec' })));
  const sorted = [...brands].sort((a, b) => (b.scores[subjects[0]]?.score ?? -1) - (a.scores[subjects[0]]?.score ?? -1) || a.name.localeCompare(b.name));
  // No rank numbers: the order shows it, and SoleStats is not a league table.
  const rows = sorted.map(b => el('tr', {}, el('td', {}, el('a', { href: `/brand.html?b=${encodeURIComponent(b.slug)}` }, b.name)), barCell(b.scores[first]), ...rest.map(s => scoreCell(b.scores[s], 'sec'))));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

function retailTable(data) {
  if (!data.rows.length) return el('p', { class: 'empty' }, 'No data yet.');
  const answers = Object.fromEntries(data.answers.map(a => [a.category, a.n]));
  // Only the where-to-buy questions (Alex, 2026-11-22): answers to the shoe questions rarely name a store.
  const cats = ['retail'];
  const retailers = [...new Set(data.rows.filter(r => r.category === 'retail').map(r => r.retailer_slug))];
  const names = Object.fromEntries(data.rows.map(r => [r.retailer_slug, r.name]));
  const lookup = Object.fromEntries(data.rows.map(r => [r.category + '|' + r.retailer_slug, r.n]));
  const head = el('tr', {}, defined('th', 'place'), el('th', {}, 'Share of answers'));
  const rows = retailers.map(slug => el('tr', {}, el('td', { class: 'wrap' }, names[slug]), ...cats.map(c => {
    const n = lookup[c + '|' + slug] || 0; const d = answers[c] || 0;
    if (!d) return el('td', { class: 'num' }, '—');
    const pct = Math.round(100 * n / d);
    return el('td', { class: 'barcell' }, el('div', { class: 'bar' }, fill(pct), el('span', { class: 'val' }, `${pct}%`)));
  })));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

// One card per engine in the edition (answers, model id, how many searched the web, named sources, searched without
// naming any, or answered without searching), then a dashed
// card for each engine still pending (PENDING_ENGINES in wrangler.toml).
function engineStrip(d) {
  const cards = (d.engines || []).map(e => el('li', { class: 'engine' }, defined('div', 'engine', { class: 'name', text: engineName(e.engine) }), el('div', { class: 'model' }, e.model || ''),
    el('div', { class: 'big' }, String(e.runs)), el('div', { class: 'stat' }, ...engineStat(e))));
  for (const p of d.pending || []) cards.push(el('li', { class: 'engine pending' }, el('div', { class: 'name' }, engineName(p)), el('div', { class: 'stat' }, 'Pending')));
  return cards;
}

// "answers · 381 searched · 381 source not provided · 33 no search": a part is left out when it is zero.
function engineStat(e) {
  const parts = ['answers', `${e.searched || 0} searched`];
  if (e.cited) parts.push(`${e.cited} cited`);
  if (e.not_provided) parts.push(defined('span', 'not_provided', { text: `${e.not_provided} source not provided` }));
  const noSearch = (e.runs || 0) - (e.searched || 0);
  if (noSearch > 0) parts.push(defined('span', 'no_search', { text: `${noSearch} no search` }));
  return parts.flatMap((p, i) => i ? [' · ', p] : [p]);
}

async function main() {
  installTips();
  const health = await api('/api/health').catch(() => ({}));
  const notice = document.getElementById('notice');
  if (health.notice) { notice.textContent = health.notice; notice.hidden = false; }
  showEdition();
  api('/api/summary').then(s => {
    if (!s.sentences || !s.sentences.length) return;
    document.getElementById('summary-text').replaceChildren(...s.sentences.map(t => el('p', {}, t)));
    document.getElementById('summary').hidden = false;
  }).catch(() => {});
  const { brands, round } = await api('/api/brands').catch(() => ({ brands: [], round: null }));
  document.getElementById('engines').replaceChildren(...engineStrip(await api('/api/edition').catch(() => ({ engines: [], pending: [] }))));
  const ai = await overallStatus();
  document.getElementById('shoe-table').replaceChildren(brandTable(brands.filter(b => b.category === 'shoes' && Object.keys(b.scores).length), SUBJECTS, ai.label));
  const byOverall = brands.filter(b => b.category === 'shoes').sort((a, b) => (b.scores.overall?.score ?? -1) - (a.scores.overall?.score ?? -1) || a.name.localeCompare(b.name));
  const needs = await api('/api/views/needs').catch(() => ({}));
  document.getElementById('need-table').replaceChildren(needTable(needs.data, byOverall));
  if (needs.data) document.getElementById('need-legend').replaceChildren(heatLegend());
  document.getElementById('retail-table').replaceChildren(retailTable(await api('/api/retailers').catch(() => ({ rows: [], answers: [] }))));
  const dl = document.getElementById('downloads');
  if (round) for (const f of ['prompts', 'answers', 'citations', 'mentions', 'routes', 'scores', 'financials', 'race-results']) dl.append(el('li', {}, el('a', { href: `/download/${round}/${f}.csv` }, `${f}.csv`)));
  else dl.append(el('li', { class: 'muted' }, 'None yet.'));
}
main();
