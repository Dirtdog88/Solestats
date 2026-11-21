// One brand's report card.
const ORDER = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
import { el, engineName, showEdition, plainAnswer, defined, installTips, DEFINITIONS } from './2026-11-21-common.js';
const TREATMENT = { full: 'core brand', eligible: 'watched brand', scan: 'scan' };

async function main() {
  installTips();
  const slug = new URLSearchParams(location.search).get('b');
  const card = document.getElementById('card');
  if (!slug) { card.append(el('p', { class: 'empty' }, 'No brand given.')); return; }
  const r = await fetch(`/api/brands/${encodeURIComponent(slug)}`);
  if (!r.ok) { card.append(el('p', { class: 'empty' }, 'No such brand in the index.')); return; }
  const d = await r.json();
  document.title = `SoleStats · ${d.brand.name}`;
  document.getElementById('name').textContent = d.brand.name;
  document.getElementById('sub').textContent = [d.brand.category === 'shoes' ? 'Running shoes' : d.brand.category, TREATMENT[d.brand.treatment] || d.brand.treatment].join(' · ');
  showEdition();
  const grid = el('div', { class: 'subjects' });
  for (const s of ORDER) {
    const v = d.scores[s];
    if (!v) continue;
    grid.append(el('div', { class: 'subject' }, defined('div', s, { class: 'label' }), el('div', { class: 'big' }, v.score == null ? '—' : String(Math.round(v.score))),
      el('div', {}, v.margin != null ? defined('span', 'margin', { class: 'pill', text: `±${Math.round(v.margin)}` }) : '', v.margin != null ? ' ' : '', defined('span', 'n', { class: 'pill grey', text: `n ${v.n}` }))));
  }
  card.append(el('section', { class: 'card' }, el('h3', {}, 'Scores'), Object.keys(d.scores).length ? grid : el('p', { class: 'muted' }, 'Not scored yet.')));
  if (d.fixes.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Top fixes'), el('ol', {}, ...d.fixes.map(f => el('li', {}, el('strong', {}, (DEFINITIONS[f.subject] || [f.subject])[0] + ': '), f.text)))));
  if (d.examples && d.examples.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'What AI said'), ...d.examples.map(x => el('div', { class: 'example' }, el('div', { class: 'q' }, `${engineName(x.engine)}: ${x.prompt_text}`), el('div', { class: 'a' }, plainAnswer(x.answer))))));
  if (d.context.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Context'), el('ul', {}, ...d.context.map(c => el('li', {}, `${c.metric}: ${c.value}`, c.source ? el('span', { class: 'muted' }, ` (${c.source})`) : '')))));
}
main();
