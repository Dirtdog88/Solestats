// The one-page brand brief (Alex, 2026-11-22): the brand page's CMO view on one printable page, from the same API, so it
// updates itself every edition. Built with textContent like every other page.
import { el, api, engineName, fixBody, setCategory } from './2026-11-21-common.js';
const SUBJ = [['recommended', 'Recommended'], ['sourced', 'Sourced'], ['routing', 'Sale goes home'], ['accurate', 'Accurate'], ['shoppable', 'Shoppable']];
const STEPS = [5, 15, 30, 50, 70];
const bar = (label, pct, text) => { const f = el('div', { class: 'f' }); f.style.width = `${Math.max(1, Math.min(100, pct))}%`; return el('li', {}, el('span', {}, label), el('div', { class: 't' }, f), el('span', { class: 'n' }, text ?? `${Math.round(pct)}%`)); };
async function main() {
  const slug = new URLSearchParams(location.search).get('b');
  const d = await api(`/api/brands/${encodeURIComponent(slug)}`);
  setCategory(d.brand.category); // the names and the edition come from the brand's own category
  const [all, ed] = await Promise.all([api('/api/brands'), api('/api/edition')]);
  const item = d.brand.category === 'shoes' ? 'shoe' : 'product';
  if (item !== 'shoe') { document.getElementById('eyebrow').textContent = 'SOLESTATS · THE ENERGY GEL AI INDEX'; document.getElementById('needs-h').textContent = 'By need'; document.getElementById('home').textContent = 'solestats.net/fuel'; }
  const names = Object.fromEntries(all.brands.map(b => [b.slug, b.name]));
  const name = d.brand.name;
  document.title = `SoleStats · ${name} brief`;
  document.getElementById('name').textContent = name;
  document.getElementById('ed').textContent = `Edition ${ed.round}: ${ed.engines.map(e => engineName(e.engine)).join(', ')}, ${ed.repeats} tries per question. Brand brief, one page.`;
  const ai = d.scores.overall;
  document.getElementById('score').replaceChildren(ai ? String(Math.round(ai.score)) : '—', el('small', {}, ai ? ' /100' : ' not enough data yet'));
  document.getElementById('subj').replaceChildren(...SUBJ.map(([k, l]) => { const v = d.scores[k]; return el('li', {}, el('span', {}, l), el('span', { class: v ? 'v' : 'v none' }, v ? String(Math.round(v.score)) : 'to come')); }));
  document.getElementById('fixes').replaceChildren(...(d.fixes.length ? d.fixes.slice(0, 3).map(f => el('li', {}, el('span', { class: 's' }, f.subject === 'routing' ? 'Sale goes home' : f.subject), ...fixBody(f.text))) : [el('p', {}, 'Nothing flagged this edition.')]));
  if (d.fixes.length > 3) document.getElementById('fixes').after(el('p', { class: 'note' }, `${d.fixes.length - 3} more on the brand page.`));
  const s = d.substitution;
  if (s && s.missed) {
    document.getElementById('sub-h').textContent = `When not ${name}, who`;
    document.getElementById('subs').replaceChildren(...s.substitutes.slice(0, 4).map(x => bar(names[x.slug] || x.slug, x.share)));
    document.getElementById('sub-note').textContent = item === 'shoe' ? `First pick in the ${s.missed} of ${s.eligible} answers that left ${name} out where it has a credible shoe.` : `First pick in the ${s.missed} of ${s.eligible} answers to the need questions that left ${name} out.`;
  }
  const P = { own: "Brand's own site", specialty: item === 'shoe' ? 'Run specialty' : 'Specialty', amazon: 'Amazon', big_box: 'Big box', other: 'Other' };
  if (d.places) document.getElementById('places').replaceChildren(...Object.entries(P).map(([k, l]) => bar(l, d.places.buckets[k]?.share || 0)));
  if (d.needs) document.getElementById('needs').replaceChildren(...d.needs.groups.map(g => { const c = d.needs.cells[g.id] || { share: 0 }; return el('div', {}, el('div', { class: 'l' }, g.label), el('div', { class: `c h${STEPS.filter(x => c.share >= x).length}` }, String(Math.round(c.share)))); }));
  // Where the demand is: the groups to fix first, by demand weight times the gap to the leader (src/2026-11-22-demand.js).
  const dm = d.demand;
  if (dm && dm.fix_first && dm.fix_first.length) {
    const rows = Object.fromEntries(dm.rows.map(r => [r.id, r]));
    document.getElementById('demand').textContent = `Fix these first, by demand: ${dm.fix_first.map(id => { const r = rows[id]; return `${r.label} (${Math.round(r.weight)}% of the asking; ${name} ${Math.round(r.share)}% against ${names[r.leader_slug] || r.leader_slug} ${Math.round(r.leader)}%)`; }).join('; ')}. Share of voice weighted by demand: ${dm.weighted_sov.toFixed(1)}%.`;
  }
  // What AI says about it: the attributes furthest above or below all brands (the fixes already name the sources to earn).
  const at = (d.attributes?.attributes || []).map(a => ({ ...a, diff: a.share - a.all })).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, 5);
  document.getElementById('attrs').replaceChildren(...(at.length ? at.map(a => el('li', {}, el('span', {}, a.label), el('span', {}, el('span', { class: `d ${a.diff >= 10 ? 'up' : a.diff <= -10 ? 'down' : ''}` }, `${Math.round(a.share)}%`), el('span', { class: 'all' }, ` vs ${Math.round(a.all)}%`)))) : [el('li', {}, 'Not enough answers yet.')]));
  if (d.models) document.getElementById('models').replaceChildren(...d.models.models.slice(0, 5).map(m => bar(m.name, m.share)));
  document.getElementById('url').textContent = `solestats.net/brand.html?b=${slug}`;
  document.getElementById('back').href = `/brand.html?b=${encodeURIComponent(slug)}`;
}
document.getElementById('print').addEventListener('click', () => window.print());
main();
