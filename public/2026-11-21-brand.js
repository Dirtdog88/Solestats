// One brand's report card.
const LABELS = { overall: 'Overall', recommended: 'Recommended', accurate: 'Accurate', shoppable: 'Shoppable by AI', sourced: 'Sourced', routing: 'Where the sale goes' };
const ORDER = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) k === 'class' ? n.className = v : n.setAttribute(k, v); for (const k of kids) n.append(k == null ? '' : k); return n; };

async function main() {
  const slug = new URLSearchParams(location.search).get('b');
  const card = document.getElementById('card');
  if (!slug) { card.append(el('p', { class: 'empty' }, 'No brand given.')); return; }
  const r = await fetch(`/api/brands/${encodeURIComponent(slug)}`);
  if (!r.ok) { card.append(el('p', { class: 'empty' }, 'No such brand in the index.')); return; }
  const d = await r.json();
  document.title = `SoleStats · ${d.brand.name}`;
  document.getElementById('name').textContent = d.brand.name;
  document.getElementById('sub').textContent = d.round ? `Edition ${d.round}` : 'No edition published yet';
  const grid = el('div', { class: 'subjects' });
  for (const s of ORDER) {
    const v = d.scores[s];
    if (!v) continue;
    grid.append(el('div', { class: 'subject' }, el('div', { class: 'label' }, LABELS[s]), el('div', { class: 'big' }, v.score == null ? '—' : String(Math.round(v.score))), el('div', { class: 'muted' }, v.margin != null ? `±${Math.round(v.margin)} across repeats · ${v.n} observations` : `${v.n} observations`)));
  }
  card.append(el('section', { class: 'card' }, el('h3', {}, 'Scores'), Object.keys(d.scores).length ? grid : el('p', { class: 'muted' }, 'Not scored yet.')));
  if (d.fixes.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Top fixes'), el('ol', {}, ...d.fixes.map(f => el('li', {}, el('strong', {}, LABELS[f.subject] + ': '), f.text)))));
  if (d.examples && d.examples.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'What AI said'), ...d.examples.map(x => el('div', { class: 'example' }, el('div', { class: 'q' }, `${x.engine}: ${x.prompt_text}`), el('div', { class: 'a' }, x.answer || '')))));
  if (d.context.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Context (not scored)'), el('ul', {}, ...d.context.map(c => el('li', {}, `${c.metric}: ${c.value}`, c.source ? el('span', { class: 'muted' }, ` (${c.source})`) : '')))));
}
main();
