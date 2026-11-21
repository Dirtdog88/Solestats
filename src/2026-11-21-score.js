// Scoring rules (pure). Every subject is 0-100, no curve. Inputs are plain arrays so the tests and the scripts
// can feed them from JSONL or from D1. Rubric: the DogHaus task "Write the rubric" and the method page.

export const WEIGHTS = { recommended: 35, accurate: 25, shoppable: 20, sourced: 10, routing: 10 };

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sd = xs => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
const pct = (num, den) => den ? 100 * num / den : null;
const round1 = x => x == null ? null : Math.round(x * 10) / 10;

/**
 * Eligibility: a brand is scored on a prompt only if one of its verified models carries one of the prompt's tags.
 * models: [{brand_slug, needs: 'a;b'}], prompt.tags: 'a;b'. Scan categories have no spec sheet: every brand
 * in the prompt's category is eligible.
 */
export function eligible(brand, prompt, models) {
  if (prompt.set_name === 'retailer') return false;
  if (brand.category !== prompt.category) return false;
  if (brand.category !== 'shoes') return true;
  const tags = new Set((prompt.tags || '').split(';').filter(Boolean));
  if (tags.has('h2h')) return prompt.pair_a === brand.name || prompt.pair_b === brand.name;
  const own = models.filter(m => m.brand_slug === brand.slug);
  // No verified models yet for this brand: every shoe prompt counts, and scoreRecommended says so in its detail.
  if (!own.length) return true;
  return own.some(m => (m.needs || '').split(';').some(t => tags.has(t)));
}

/**
 * Recommended = presence 50 + head-to-head 20 + position 15 + consistency 15 (draft weights, 2026-11-09).
 * runs: [{prompt_id, engine, repeat_no, mentions: [{brand_slug, position, top_pick}], winner}]
 * Returns {score, margin, n, detail}. margin = the spread of the presence score across repeats (sd), a plain
 * "how much this moves between runs" figure, not a confidence interval.
 */
export function scoreRecommended(brand, prompts, runs, models) {
  const elig = prompts.filter(p => p.set_name !== 'h2h' && eligible(brand, p, models));
  const eligIds = new Set(elig.map(p => p.id));
  const main = runs.filter(r => eligIds.has(r.prompt_id) && r.status === 'ok');
  if (!main.length) return { score: null, margin: null, n: 0, detail: { reason: 'no eligible prompts with answers' } };
  const named = main.filter(r => r.mentions.some(m => m.brand_slug === brand.slug));
  const presence = pct(named.length, main.length);
  const top = main.filter(r => r.mentions.some(m => m.brand_slug === brand.slug && m.top_pick));
  const position = pct(top.length, main.length);
  // Consistency: for each prompt x engine, the share of repeats that agree with the majority outcome.
  const groups = new Map();
  for (const r of main) { const k = r.prompt_id + '|' + r.engine; (groups.get(k) || groups.set(k, []).get(k)).push(r.mentions.some(m => m.brand_slug === brand.slug) ? 1 : 0); }
  const agree = [...groups.values()].map(g => { const yes = g.reduce((a, b) => a + b, 0); return Math.max(yes, g.length - yes) / g.length; });
  const consistency = 100 * mean(agree);
  // Head-to-head: win rate across the brand's pairs (ties count half, unclear is left out).
  const h2hIds = new Set(prompts.filter(p => p.set_name === 'h2h' && (p.pair_a === brand.name || p.pair_b === brand.name)).map(p => p.id));
  const h2h = runs.filter(r => h2hIds.has(r.prompt_id) && r.status === 'ok' && r.winner && r.winner !== 'unclear');
  const wins = h2h.reduce((a, r) => a + (r.winner === brand.slug ? 1 : r.winner === 'tie' ? 0.5 : 0), 0);
  const headToHead = h2h.length ? pct(wins, h2h.length) : null;
  const parts = [[presence, 50], [headToHead, 20], [position, 15], [consistency, 15]].filter(([v]) => v != null);
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  const score = parts.reduce((a, [v, w]) => a + v * w, 0) / wsum;
  // Margin: presence recomputed per repeat number, then its spread.
  const perRepeat = [...new Set(main.map(r => r.repeat_no))].map(n => { const rs = main.filter(r => r.repeat_no === n); return pct(rs.filter(r => r.mentions.some(m => m.brand_slug === brand.slug)).length, rs.length); });
  const eligibility = models.some(m => m.brand_slug === brand.slug) ? 'verified models' : 'all shoe prompts (no verified models yet)';
  return { score: round1(score), margin: round1(sd(perRepeat)), n: main.length, detail: { presence: round1(presence), head_to_head: round1(headToHead), position: round1(position), consistency: round1(consistency), eligible_prompts: elig.length, h2h_answers: h2h.length, eligibility } };
}

/** Accurate = share of fact checks right. not_sure counts as wrong (Alex, 2026-11-09). */
export function scoreAccurate(checks) {
  if (!checks.length) return { score: null, margin: null, n: 0, detail: {} };
  const right = checks.filter(c => c.result === 'right').length;
  const notSure = checks.filter(c => c.result === 'not_sure').length;
  const byFact = {};
  for (const c of checks) { byFact[c.fact] = byFact[c.fact] || { right: 0, n: 0 }; byFact[c.fact].n++; if (c.result === 'right') byFact[c.fact].right++; }
  const perRepeat = [...new Set(checks.map(c => c.repeat_no))].map(n => { const cs = checks.filter(c => c.repeat_no === n); return pct(cs.filter(c => c.result === 'right').length, cs.length); });
  return { score: round1(pct(right, checks.length)), margin: round1(sd(perRepeat)), n: checks.length, detail: { not_sure_rate: round1(pct(notSure, checks.length)), by_fact: Object.fromEntries(Object.entries(byFact).map(([k, v]) => [k, round1(pct(v.right, v.n))])) } };
}

/**
 * How an answer stands on sources (Alex, 2026-11-21): 'sourced' if it names at least one source (an attributed
 * citation); 'not_provided' if the engine searched the web but named none; 'no_search' if it answered without searching.
 * Pages a search merely returned (source 'searched') never count as the answer's sources.
 */
export function sourcing(run) {
  const cites = run.citations || [];
  if (cites.some(c => c.source !== 'searched')) return 'sourced';
  if ((run.searches || 0) > 0 || cites.some(c => c.source === 'searched')) return 'not_provided';
  return 'no_search';
}

/**
 * Sourced = share of the sources named in answers about the brand that are the brand's own sites or established review
 * sites. Another brand's site does not count.
 * Only attributed citations count. Answers that searched but named no source (not_provided) and answers that did not
 * search (no_search) stay in the counts beside the score, so the page can say so, but are not scored. With fewer than
 * MIN_SOURCED_ANSWERS answers that name a source there is no score (detail.too_few). Non-US brand sites count as
 * brand sites; detail.intl_own_site says how many.
 */
export const MIN_SOURCED_ANSWERS = 5; // Alex, 2026-11-21: fewer answers that name a source and Sourced is not scored

export function scoreSourced(brand, runs) {
  const rel = runs.filter(r => r.status === 'ok' && r.mentions.some(m => m.brand_slug === brand.slug));
  const groups = { sourced: 0, not_provided: 0, no_search: 0 };
  const cites = [];
  for (const r of rel) {
    const g = sourcing(r);
    groups[g]++;
    if (g === 'sourced') cites.push(...r.citations.filter(c => c.source !== 'searched'));
  }
  const counts = { answers: rel.length, ...groups };
  if (groups.sourced < MIN_SOURCED_ANSWERS) return { score: null, margin: null, n: cites.length, detail: { ...counts, too_few: true, min: MIN_SOURCED_ANSWERS } };
  // Only this brand's own sites count as its own (Alex, 2026-11-21): another brand's site is tallied as other_brand.
  const own = c => c.kind === 'brand' && c.brand_slug === brand.slug;
  const kinds = {};
  for (const c of cites) { const k = c.kind === 'brand' && !own(c) ? 'other_brand' : c.kind; kinds[k] = (kinds[k] || 0) + 1; }
  const good = (kinds.brand || 0) + (kinds.review || 0);
  const intl = cites.filter(c => own(c) && c.intl).length;
  return { score: round1(pct(good, cites.length)), margin: null, n: cites.length, detail: { ...counts, kinds, own_site_share: round1(pct(kinds.brand || 0, cites.length)), intl_own_site: intl } };
}

/** Where the sale goes = share of routes, in answers that name the brand, going to the brand's own site or run specialty. */
export function scoreRouting(brand, runs, retailers) {
  const rel = runs.filter(r => r.status === 'ok' && r.mentions.some(m => m.brand_slug === brand.slug));
  const routes = rel.flatMap(r => r.routes || []);
  if (!routes.length) return { score: null, margin: null, n: 0, detail: {} };
  const kindOf = slug => slug === 'brand-site' ? 'brand' : (retailers.find(x => x.slug === slug) || {}).kind || 'other';
  const tally = {};
  for (const rt of routes) tally[rt.retailer_slug] = (tally[rt.retailer_slug] || 0) + 1;
  const good = routes.filter(rt => ['brand', 'run-specialty', 'run-specialty-online'].includes(kindOf(rt.retailer_slug))).length;
  return { score: round1(pct(good, routes.length)), margin: null, n: routes.length, detail: { by_retailer: tally } };
}

/** Shoppable by AI = share of checklist items passed (the checklist itself is still to be defined). */
export function scoreShoppable(items) {
  if (!items.length) return { score: null, margin: null, n: 0, detail: {} };
  return { score: round1(pct(items.filter(i => i.result).length, items.length)), margin: null, n: items.length, detail: { failed: items.filter(i => !i.result).map(i => i.item) } };
}

/** Overall: weighted mean of the subjects that have a score, weights renormalised. Null if fewer than three subjects. */
export function overall(subjects) {
  const have = Object.entries(WEIGHTS).filter(([k]) => subjects[k] && subjects[k].score != null);
  if (have.length < 3) return { score: null, margin: null, n: have.length, detail: { subjects: have.map(([k]) => k) } };
  const w = have.reduce((a, [, v]) => a + v, 0);
  const score = have.reduce((a, [k, v]) => a + subjects[k].score * v, 0) / w;
  const margin = have.reduce((a, [k, v]) => a + (subjects[k].margin || 0) * v, 0) / w;
  return { score: round1(score), margin: round1(margin), n: have.length, detail: { weights: Object.fromEntries(have) } };
}

/** The retailer routing table across every answer: share of routes per retailer, per category. */
export function routingTable(runs, prompts) {
  const cat = Object.fromEntries(prompts.map(p => [p.id, p.category]));
  const out = {};
  for (const r of runs) {
    if (r.status !== 'ok') continue;
    const c = cat[r.prompt_id] || 'unknown';
    out[c] = out[c] || { answers: 0, with_route: 0, by_retailer: {} };
    out[c].answers++;
    if (r.routes && r.routes.length) out[c].with_route++;
    for (const rt of r.routes || []) out[c].by_retailer[rt.retailer_slug] = (out[c].by_retailer[rt.retailer_slug] || 0) + 1;
  }
  return out;
}
