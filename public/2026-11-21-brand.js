// One brand's report card.
const ORDER = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
import { el, engineName, showEdition, plainAnswer, defined, installTips, api, DEFINITIONS, money, overallStatus } from './2026-11-21-common.js';
import { needRow } from './2026-11-22-needs.js';
import { h2hCard } from './2026-11-22-h2h.js';
const TREATMENT = { full: 'core brand', eligible: 'watched brand', scan: 'scan' };

const SOURCING_TAG = { not_provided: true, no_search: true };

// Beside Sourced: answers about the brand that searched but named no source, and answers given without a search.
function sourcedPills(detail) {
  if (!detail) return [];
  const out = [];
  if (detail.not_provided) out.push(defined('span', 'not_provided', { class: 'pill grey', text: `not provided ${detail.not_provided}` }));
  if (detail.no_search) out.push(defined('span', 'no_search', { class: 'pill grey', text: `no search ${detail.no_search}` }));
  if (detail.intl_own_site) out.push(defined('span', 'intl', { class: 'pill grey', text: `non-US site ${detail.intl_own_site}` }));
  return out;
}

const LEVEL = { brand: 'brand', category: 'category', footwear: 'footwear', segment: 'segment', company: 'whole company' };

// Publicly reported revenue, newest fiscal year only: one line per measure. Year-over-year growth is the headline
// (Alex, 2026-11-21); the amount, in the currency reported, sits under it with a link to the filing.
function revenueCard(rows) {
  if (!rows.length) return null;
  const latest = rows[0].fiscal_year;
  const order = Object.keys(LEVEL); // narrowest first: brand, category, footwear, segment, whole company
  const items = rows.filter(r => r.fiscal_year === latest).sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)).map(r => {
    const growth = r.yoy_pct != null ? `${r.yoy_pct >= 0 ? '+' : '−'}${Math.abs(r.yoy_pct).toFixed(1)}%` : null;
    const amount = r.value == null ? (growth ? 'amount not disclosed' : 'Not disclosed') : money(r.value, r.unit, r.currency);
    const src = /^https:\/\//.test(r.source_url || '') ? el('a', { href: r.source_url, rel: 'noopener noreferrer' }, r.source_type || 'source') : (r.source_type || '');
    return el('li', { class: 'rev' },
      el('div', { class: 'label' }, `${r.measure} (${LEVEL[r.level] || r.level})`),
      el('div', { class: 'big' + (growth && r.yoy_pct < 0 ? ' down' : '') }, growth ?? amount),
      el('div', {}, growth ? `${amount}, ${r.fiscal_year}` : r.value == null ? `${r.owner || 'The company'} does not report it separately` : `${r.fiscal_year}, no prior year to compare`),
      el('div', { class: 'muted' }, `${r.period_end ? 'Year to ' + r.period_end + ' · ' : ''}${r.owner || ''} `, src));
  });
  return el('section', { class: 'card' }, defined('h3', 'revenue'), el('ul', { class: 'revenue' }, ...items));
}

// Top-10 finishes at the World Marathon Majors and the World Championships marathon in this brand's shoes.
function racesCard(rows) {
  if (!rows.length) return null;
  const podiums = rows.filter(r => r.place <= 3).length, wins = rows.filter(r => r.place === 1).length;
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  return el('section', { class: 'card' }, defined('h3', 'top10_share', { text: 'Top 10 at the majors' }),
    el('div', { class: 'subjects' },
      el('div', { class: 'subject' }, el('div', { class: 'label' }, 'Top-10 places'), el('div', { class: 'big' }, String(rows.length))),
      el('div', { class: 'subject' }, defined('div', 'podiums', { class: 'label', text: 'Podiums' }), el('div', { class: 'big' }, String(podiums)), el('div', { class: 'muted' }, `${wins} ${wins === 1 ? 'win' : 'wins'}`))),
    el('ul', { class: 'races' }, ...rows.map(r => el('li', {},
      el('strong', {}, `${ord(r.place)}`), ` ${r.athlete} (${r.country}), ${r.race} ${r.year}, ${r.gender}, ${r.time}`,
      el('span', { class: 'muted' }, ` · ${r.model ? r.model + ', ' : ''}${r.basis === 'worn' ? 'race-day shoe' : 'sponsor'} `),
      /^https:\/\//.test(r.shoe_source_url || '') ? el('a', { href: r.shoe_source_url, rel: 'noopener noreferrer', class: 'muted' }, 'source') : ''))));
}

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
  const ov = await overallStatus();
  const grid = el('div', { class: 'subjects' });
  // Sourced held back for too few answers that name a source: there is no score row, so the counts come from the API.
  const src = d.sourcing || {};
  const heldSourced = !d.scores.sourced && (src.sourced || 0) < src.min ? { sourced: src.sourced || 0, not_provided: src.not_provided || 0, no_search: src.no_search || 0, min: src.min } : null;
  for (const s of ORDER) {
    const v = d.scores[s];
    if (!v && s === 'sourced' && heldSourced) {
      grid.append(el('div', { class: 'subject' }, defined('div', s, { class: 'label' }), el('div', { class: 'big' }, '—'),
        el('div', { class: 'pills' }, defined('span', 'too_few', { class: 'pill grey', text: `too few: ${heldSourced.sourced} of ${heldSourced.min}` }), ...sourcedPills({ ...heldSourced, intl_own_site: 0 }))));
      continue;
    }
    if (!v) continue;
    grid.append(el('div', { class: 'subject' }, defined('div', s, s === 'overall' ? { class: 'label', text: ov.label } : { class: 'label' }), el('div', { class: 'big' }, v.score == null ? '—' : String(Math.round(v.score))),
      el('div', { class: 'pills' }, v.margin != null ? defined('span', 'margin', { class: 'pill', text: `±${Math.round(v.margin)}` }) : '', defined('span', 'n', { class: 'pill grey', text: `n ${v.n}` }), ...(s === 'sourced' ? sourcedPills(v.detail) : []), v.detail?.checked_round ? defined('span', 'checked', { class: 'pill grey', text: `checked ${v.detail.checked_round}` }) : '')));
  }
  card.append(el('section', { class: 'card' }, el('h3', {}, 'Scores'), Object.keys(d.scores).length ? grid : el('p', { class: 'muted' }, 'Not scored yet.')));
  const nr = needRow(d.needs, d.brand.name);
  if (nr) card.append(nr);
  if (d.h2h) {
    const { brands } = await api('/api/brands').catch(() => ({ brands: [] }));
    const hc = h2hCard(d.h2h, d.brand.name, Object.fromEntries(brands.map(b => [b.slug, b.name])), Object.fromEntries(brands.map(b => [b.slug, b.scores.overall?.score ?? -1])));
    if (hc) card.append(hc);
  }
  const rev = revenueCard(d.financials || []);
  if (rev) card.append(rev);
  const rc = racesCard(d.races || []);
  if (rc) card.append(rc);
  if (d.fixes.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Top fixes'), el('ol', {}, ...d.fixes.map(f => el('li', {}, el('strong', {}, (DEFINITIONS[f.subject] || [f.subject])[0] + ': '), f.text)))));
  if (d.examples && d.examples.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'What AI said'), ...d.examples.map(x => el('div', { class: 'example' }, el('div', { class: 'q' }, `${engineName(x.engine)}: ${x.prompt_text}`, SOURCING_TAG[x.sourcing] ? ' ' : '', SOURCING_TAG[x.sourcing] ? defined('span', x.sourcing, { class: 'pill grey' }) : ''), el('div', { class: 'a' }, plainAnswer(x.answer))))));
  if (d.context.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Context'), el('ul', {}, ...d.context.map(c => el('li', {}, `${c.metric}: ${c.value}`, c.source ? el('span', { class: 'muted' }, ` (${c.source})`) : '')))));
}
main();
