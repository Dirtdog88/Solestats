// One brand's report card.
const ORDER = ['overall', 'recommended', 'accurate', 'shoppable', 'sourced', 'routing'];
import { el, engineName, showEdition, plainAnswer, defined, installTips, api, DEFINITIONS, money, overallStatus } from './2026-11-21-common.js';
import { needRow } from './2026-11-22-needs.js';

const PLACE_LABEL = { own: "Brand's own site", specialty: 'Run specialty', amazon: 'Amazon', big_box: 'Big box', other: 'Other' };

/** A subject's score on each engine's answers alone, under the combined score; an engine more than 10 points below
 *  the others (a Top fix) is marked. */
function byEngine(split) {
  const es = Object.entries((split && split.by_engine) || {});
  if (!es.length) return '';
  return el('div', { class: 'by-engine' }, ...es.map(([e, x]) => {
    const text = `${Math.round(x.score)} on ${engineName(e)}'s answers alone (n ${x.n})${split.low === e ? `; more than 10 points below the other engines${split.pattern ? `, as it is for most brands (see the edition summary), so it is not a fix` : ''}` : ''}.`;
    return el('span', { class: split.low === e ? 'eng low' : 'eng', 'data-tip': text, 'data-tip-title': engineName(e), title: text, tabindex: '0' }, `${engineName(e)} ${Math.round(x.score)}`);
  }));
}

/** Models named: the brand's shoes in its answers, the versions named and the competitor shoe named beside each. */
function modelsCard(m, name) {
  if (!m || !m.models || !m.models.length) return null;
  const rows = m.models.slice(0, 8).map(x => {
    const f = el('div', { class: 'fill' }); f.style.width = `${Math.max(2, Math.min(100, x.share))}%`;
    const vs = x.versions.slice(0, 3).map(v => `${v.version} (${v.answers})`).join(', ');
    const text = `Named in ${x.answers} of ${m.answers} answers that mention ${name}.${vs ? ` Versions named: ${vs}.` : ' No version named.'}${x.beside ? ` Named most often beside it: ${x.beside.name} (${x.beside.answers} answers).` : ''}`;
    return el('li', { 'data-tip': text, 'data-tip-title': x.name, title: `${x.name}: ${text}`, tabindex: '0' },
      el('span', { class: 'plabel' }, x.name, x.beside ? el('span', { class: 'sub' }, `beside ${x.beside.name}`) : ''), el('span', { class: 'ptrack' }, f), el('span', { class: 'pval' }, `${Math.round(x.share)}%`));
  });
  return el('section', { class: 'card' }, el('h3', {}, defined('span', 'models')),
    el('ul', { class: 'places models' }, ...rows),
    el('p', { class: 'muted small' }, `Share of the ${m.answers} answers naming ${name} that name each shoe. Tap one for the versions named.`));
}

/** Version and price: is AI naming the current version, and how often does it steer to an older or cheaper pair. */
function versionCard(v, s, name) {
  if (!v && !s) return null;
  const tiles = [];
  if (v) tiles.push(el('div', { class: 'subject' }, defined('div', 'version_current', { class: 'label' }),
    v.pending ? el('div', { class: 'big none' }, '—') : el('div', { class: 'big' }, v.current_share == null ? '—' : `${Math.round(v.current_share)}%`),
    el('div', { class: 'muted small' }, v.pending ? 'Waiting for the spec sheet: current versions are being checked by hand.' : `of ${v.named} mentions that name a version`)));
  if (s) {
    const engines = Object.entries(s.by_engine || {}).map(([e, x]) => `${engineName(e)} ${Math.round(x)}%`).join(', ');
    const text = `Older model ${Math.round(s.older)}%, sale or discount ${Math.round(s.deal)}%, of ${s.answers} answers naming ${name}. By engine: ${engines}.${s.all_brands != null ? ` Across all brands: ${Math.round(s.all_brands)}%.` : ''}`;
    tiles.push(el('div', { class: 'subject', 'data-tip': text, 'data-tip-title': 'Steered to older or cheaper', title: text, tabindex: '0' }, defined('div', 'steering', { class: 'label' }),
      el('div', { class: 'big' }, `${Math.round(s.any)}%`),
      el('div', { class: 'muted small' }, `older model ${Math.round(s.older)}% · sale or discount ${Math.round(s.deal)}%${s.all_brands != null ? ` · all brands ${Math.round(s.all_brands)}%` : ''}`)));
  }
  return el('section', { class: 'card' }, el('h3', {}, 'Version and price'), el('div', { class: 'subjects' }, ...tiles));
}

const KIND = { review: 'review site', forum: 'forum', news: 'news', retailer: 'retailer', brand: 'brand site', other: 'other' };

/** Sources to earn: the sites AI names most for this brand, and the ones it names for competitors but never for it. */
function sourcesCard(s, name) {
  if (!s || !s.answers) return null;
  const engines = Object.entries(s.by_engine || {}).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${engineName(e)} ${n}`).join(', ');
  const basis = s.sourced_answers ? `From the ${s.sourced_answers} of ${s.answers} answers naming ${name} that named a source (${engines}). Engines not listed named none.` : `None of the ${s.answers} answers naming ${name} named a source.`;
  const item = (domain, kind, extra) => el('li', {}, el('span', { class: 'dom' }, domain), el('span', { class: 'muted' }, ` ${KIND[kind] || kind || ''}`), el('span', { class: 'cnt' }, extra));
  const parts = [el('h3', {}, 'Sources'), el('p', { class: 'muted small' }, basis)];
  if (s.top.length) parts.push(el('h4', {}, defined('span', 'sources_top', { text: `Named most for ${name}` })), el('ol', { class: 'sources' }, ...s.top.map(t => item(t.domain, t.kind, `${t.answers} answers`))));
  if (s.gaps.length) parts.push(el('h4', {}, defined('span', 'sources_gap', { text: 'Named for competitors, never for you' })), el('ol', { class: 'sources' }, ...s.gaps.map(g => item(g.domain, g.kind, `${g.answers} ${g.label.toLowerCase()} answers, ${g.competitors} competitors`))));
  else if (s.sourced_answers) parts.push(el('p', { class: 'muted small' }, s.sourced_answers < 5 ? 'Too few answers named a source to look for gaps.' : 'No site was named for competitors in two or more answers and never for this brand.'));
  return el('section', { class: 'card' }, ...parts);
}

/** Where the sale goes for this brand: one bar per kind of place, as a share of the places to buy in its answers. */
function placesCard(p) {
  if (!p || !p.n) return null;
  const rows = Object.entries(PLACE_LABEL).map(([id, label]) => {
    const b = p.buckets[id] || { share: 0, n: 0, margin: null };
    const f = el('div', { class: 'fill' }); f.style.width = `${Math.max(b.share ? 2 : 0, Math.min(100, b.share))}%`;
    const text = `${b.n} of ${p.n} places to buy${b.margin != null ? ` (±${Math.round(b.margin)} between repeats)` : ''}.`;
    return el('li', { 'data-tip': text, 'data-tip-title': label, title: `${label}: ${text}`, tabindex: '0' }, el('span', { class: 'plabel' }, label), el('span', { class: 'ptrack' }, f), el('span', { class: 'pval' }, `${Math.round(b.share)}%`));
  });
  const other = (p.other_places || []).slice(0, 4).map(o => `${o.name} ${o.n}`).join(', ');
  return el('section', { class: 'card' }, el('h3', {}, defined('span', 'places')),
    el('ul', { class: 'places' }, ...rows),
    el('p', { class: 'muted small' }, `${p.n} places to buy in answers that name the brand.${other ? ` Other is mostly ${other}.` : ''}`));
}
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
function revenueCard(rows, sov) {
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
  // Voice vs size, from the share-of-voice view: context beside the revenue, never a cause.
  const vs = sov && sov.voice_ratio != null ? el('li', { class: 'rev' },
    defined('div', 'voice_ratio', { class: 'label' }),
    el('div', { class: 'big' }, `${sov.voice_ratio.toFixed(sov.voice_ratio < 1 ? 2 : 1)}×`),
    el('div', {}, `${sov.sov.toFixed(1)}% of AI's brand mentions against ${sov.revenue_share.toFixed(1)}% of the revenue reported by the ${sov.brands_with_both} brands with both numbers${sov.voice_ratio_wide ? '; the figure is wider than the brand, so this reads low' : ''}.`),
    el('div', { class: 'muted' }, 'Context, not cause.')) : null;
  return el('section', { class: 'card' }, defined('h3', 'revenue'), el('ul', { class: 'revenue' }, ...items, vs));
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
    grid.append(el('div', { class: 'subject' }, defined('div', s, s === 'overall' ? { class: 'label', text: ov.label } : { class: 'label' }), el('div', { class: 'big' }, v.score == null ? '—' : String(Math.round(v.score))), byEngine(d.engines && d.engines[s]),
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
  const mc = modelsCard(d.models, d.brand.name);
  if (mc) card.append(mc);
  const vc = versionCard(d.versions, d.steering, d.brand.name);
  if (vc) card.append(vc);
  const pc = placesCard(d.places);
  if (pc) card.append(pc);
  const sc = sourcesCard(d.sources, d.brand.name);
  if (sc) card.append(sc);
  const sovView = await api('/api/share-of-voice').catch(() => ({ brands: [] }));
  const rev = revenueCard(d.financials || [], { ...(sovView.brands || []).find(b => b.slug === d.brand.slug), brands_with_both: sovView.voice_vs_size?.brands_with_both });
  if (rev) card.append(rev);
  const rc = racesCard(d.races || []);
  if (rc) card.append(rc);
  if (d.fixes.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Top fixes'), el('ol', {}, ...d.fixes.map(f => el('li', {}, el('strong', {}, (DEFINITIONS[f.subject] || [f.subject])[0] + ': '), f.text)))));
  if (d.examples && d.examples.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'What AI said'), ...d.examples.map(x => el('div', { class: 'example' }, el('div', { class: 'q' }, `${engineName(x.engine)}: ${x.prompt_text}`, SOURCING_TAG[x.sourcing] ? ' ' : '', SOURCING_TAG[x.sourcing] ? defined('span', x.sourcing, { class: 'pill grey' }) : ''), el('div', { class: 'a' }, plainAnswer(x.answer))))));
  if (d.context.length) card.append(el('section', { class: 'card' }, el('h3', {}, 'Context'), el('ul', {}, ...d.context.map(c => el('li', {}, `${c.metric}: ${c.value}`, c.source ? el('span', { class: 'muted' }, ` (${c.source})`) : '')))));
}
main();
