// The SoleStats front page: builds every element with textContent (never innerHTML with data).
const SUBJECTS = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
const LABELS = { overall: 'Overall', recommended: 'Recommended', accurate: 'Accurate', shoppable: 'Shoppable', sourced: 'Sourced', routing: 'Sale goes home' };
const CATS = { shoes: 'Shoes', retail: 'Where to buy' };
// The three engines every edition is meant to include, in display order. One that has no runs yet shows as pending.
const ENGINES = [['anthropic', 'Claude'], ['openai', 'ChatGPT'], ['gemini', 'Gemini']];

import { el, api, showEdition } from './2026-11-21-common.js';

function scoreCell(s) {
  if (!s || s.score == null) return el('td', { class: 'num' }, el('span', { class: 'score none' }, '—'));
  const v = Math.round(s.score);
  const cls = v >= 70 ? 'good' : v >= 45 ? 'mid' : 'bad';
  return el('td', { class: 'num' }, el('span', { class: `score ${cls}` }, String(v)), s.margin != null ? el('span', { class: 'margin' }, `±${Math.round(s.margin)}`) : '');
}

function brandTable(brands, subjects) {
  if (!brands.length) return el('p', { class: 'empty' }, 'No scores yet. The first round is being collected.');
  const head = el('tr', {}, el('th', {}, 'Brand'), el('th', {}, 'Category'), ...subjects.map(s => el('th', {}, LABELS[s])));
  const sorted = [...brands].sort((a, b) => (b.scores[subjects[0]]?.score ?? -1) - (a.scores[subjects[0]]?.score ?? -1) || a.name.localeCompare(b.name));
  const rows = sorted.map(b => el('tr', {}, el('td', {}, el('a', { href: `/brand.html?b=${encodeURIComponent(b.slug)}` }, b.name)), el('td', { class: 'muted' }, CATS[b.category] || b.category), ...subjects.map(s => scoreCell(b.scores[s]))));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

function retailTable(data) {
  if (!data.rows.length) return el('p', { class: 'empty' }, 'No routing data yet.');
  const answers = Object.fromEntries(data.answers.map(a => [a.category, a.n]));
  const cats = [...new Set(data.rows.map(r => r.category))];
  const retailers = [...new Set(data.rows.map(r => r.retailer_slug))];
  const names = Object.fromEntries(data.rows.map(r => [r.retailer_slug, r.name]));
  const lookup = Object.fromEntries(data.rows.map(r => [r.category + '|' + r.retailer_slug, r.n]));
  const head = el('tr', {}, el('th', {}, 'Place to buy'), ...cats.map(c => el('th', {}, CATS[c] || c)));
  const rows = retailers.map(slug => el('tr', {}, el('td', {}, names[slug]), ...cats.map(c => { const n = lookup[c + '|' + slug] || 0; const d = answers[c] || 0; return el('td', { class: 'num' }, d ? `${Math.round(100 * n / d)}%` : '—'); })));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows));
}

function engineStrip(data) {
  const by = {};
  for (const e of data.engines || []) (by[e.engine] ||= []).push(e);
  return ENGINES.map(([slug, label]) => {
    const rows = by[slug];
    if (!rows) return el('li', { class: 'engine pending' }, el('div', { class: 'name' }, label), el('div', { class: 'stat' }, 'Not yet run in this edition'));
    const answers = rows.reduce((a, r) => a + Number(r.ok || 0), 0);
    const searched = rows.reduce((a, r) => a + Number(r.searched || 0), 0);
    const cited = rows.reduce((a, r) => a + Number(r.cited || 0), 0);
    return el('li', { class: 'engine' }, el('div', { class: 'name' }, label), el('div', { class: 'model' }, rows.map(r => r.model).filter(Boolean).join(', ')),
      el('div', { class: 'stat' }, `${answers} answers · ${searched} searched the web · ${cited} cited sources`));
  });
}

async function main() {
  const health = await api('/api/health').catch(() => ({}));
  const notice = document.getElementById('notice');
  if (health.notice) { notice.textContent = health.notice; notice.hidden = false; }
  showEdition();
  const { brands, round } = await api('/api/brands').catch(() => ({ brands: [], round: null }));
  document.getElementById('engines').replaceChildren(...engineStrip(await api('/api/engines').catch(() => ({ engines: [] }))));
  const list = document.getElementById('brand-list');
  for (const b of brands) list.append(el('option', { value: b.name }));
  document.getElementById('shoe-table').replaceChildren(brandTable(brands.filter(b => b.category === 'shoes' && Object.keys(b.scores).length), SUBJECTS));
  document.getElementById('retail-table').replaceChildren(retailTable(await api('/api/retailers').catch(() => ({ rows: [], answers: [] }))));
  const dl = document.getElementById('downloads');
  if (round) for (const f of ['prompts', 'answers', 'citations', 'mentions', 'routes', 'scores']) dl.append(el('li', {}, el('a', { href: `/download/${round}/${f}.csv` }, `${f}.csv`)));
  else dl.append(el('li', { class: 'muted' }, 'Downloads appear with the first round.'));
  document.getElementById('lookup').addEventListener('submit', e => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim().toLowerCase();
    const b = brands.find(x => x.name.toLowerCase() === q) || brands.find(x => x.name.toLowerCase().startsWith(q));
    if (b) location.href = `/brand.html?b=${encodeURIComponent(b.slug)}`;
    else { notice.textContent = `No brand called "${document.getElementById('q').value.trim()}" in the index yet.`; notice.hidden = false; }
  });
}
main();
