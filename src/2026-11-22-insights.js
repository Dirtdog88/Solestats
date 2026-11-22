// Views for brand teams (the CMO brief, 2026-11-22): pure functions over a round's scored runs. The score script
// stores what they return in the views table; the Worker only reads it. None of this is part of Overall, and nothing
// here hard-codes a round: every number comes from the runs passed in. The scoring rubric itself stays in
// src/2026-11-21-score.js.

/** The runner-need groups of the shoe prompts, in the order the site shows them (the group column of prompts.csv). */
export const GROUPS = [
  ['starting-out', 'Starting out'], ['budget', 'Budget'], ['cushion', 'Cushion'], ['stability', 'Stability'],
  ['fit', 'Fit and width'], ['racing', 'Racing'], ['trail', 'Trail'], ['drop', 'Drop and minimal'],
  ['conditions', 'Weather and surface'], ['people', 'Who is running'], ['brand', 'Which brand'],
];
export const GROUP_LABEL = Object.fromEntries(GROUPS);

const round1 = x => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? (100 * a) / b : 0);
const sd = xs => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
const groupOf = prompts => Object.fromEntries(prompts.filter(p => (p.set_name || p.set) === 'shoe' && (p.group || p.prompt_group)).map(p => [p.id, p.group || p.prompt_group]));

/**
 * Brand by need: for each need group, the share of answers in that group that name each brand (once per answer),
 * the share where it is the top pick, and a margin from the spread across repeats. Brands never named in a group get 0.
 * Returns { groups: [{ id, label, answers }], brands: { slug: { id: { share, top_share, margin, named } } } }.
 */
export function needGrid(runs, prompts, brandSlugs) {
  const gOf = groupOf(prompts);
  const rel = runs.filter(r => r.status === 'ok' && gOf[r.prompt_id]);
  const repeats = [...new Set(rel.map(r => r.repeat_no))].sort();
  const groups = GROUPS.filter(([id]) => rel.some(r => gOf[r.prompt_id] === id)).map(([id, label]) => ({ id, label, answers: rel.filter(r => gOf[r.prompt_id] === id).length }));
  const brands = {};
  for (const slug of brandSlugs) {
    brands[slug] = {};
    for (const g of groups) {
      const inG = rel.filter(r => gOf[r.prompt_id] === g.id);
      const names = r => (r.mentions || []).some(m => m.brand_slug === slug);
      const tops = r => (r.mentions || []).some(m => m.brand_slug === slug && m.top_pick);
      const named = inG.filter(names).length;
      const byRepeat = repeats.map(n => { const xs = inG.filter(r => r.repeat_no === n); return pct(xs.filter(names).length, xs.length); });
      brands[slug][g.id] = { share: round1(pct(named, inG.length)), top_share: round1(pct(inG.filter(tops).length, inG.length)), margin: repeats.length > 1 ? round1(sd(byRepeat)) : null, named };
    }
  }
  return { groups, brands };
}

/**
 * Head-to-head grid: for each pair of brands asked about head to head, what the answers concluded (the winner the
 * import read from each answer: a brand slug, 'tie' or 'unclear'), in total and by engine. A pair's win rate counts a
 * tie as half and leaves unclear answers out. Brand names in the prompts are matched to slugs through brands.
 * Returns { brands: [slug], pairs: [{ prompt_id, a, b, n, a_wins, b_wins, ties, unclear, a_rate, by_engine }] }.
 */
export function h2hGrid(runs, prompts, brands) {
  const slugOf = name => (brands.find(b => b.name.toLowerCase() === String(name || '').toLowerCase()) || {}).slug;
  const tally = (list, a, b) => {
    const t = { n: list.length, a_wins: 0, b_wins: 0, ties: 0, unclear: 0 };
    for (const r of list) {
      if (r.winner === a) t.a_wins++; else if (r.winner === b) t.b_wins++; else if (r.winner === 'tie') t.ties++; else t.unclear++;
    }
    const decided = t.a_wins + t.b_wins + t.ties;
    t.a_rate = decided ? round1(pct(t.a_wins + t.ties / 2, decided)) : null;
    return t;
  };
  const pairs = [];
  for (const p of prompts.filter(p => (p.set_name || p.set) === 'h2h')) {
    const a = slugOf(p.pair_a), b = slugOf(p.pair_b);
    if (!a || !b) continue;
    const rel = runs.filter(r => r.prompt_id === p.id && r.status === 'ok');
    const engines = [...new Set(rel.map(r => r.engine))].sort();
    pairs.push({ prompt_id: p.id, a, b, ...tally(rel, a, b), by_engine: Object.fromEntries(engines.map(e => [e, tally(rel.filter(r => r.engine === e), a, b)])) });
  }
  const order = brands.map(b => b.slug);
  const inPairs = new Set(pairs.flatMap(p => [p.a, p.b]));
  return { brands: order.filter(s => inPairs.has(s)), pairs };
}

/** One brand's side of a pair: { rate, wins, losses, ties, unclear, n, by_engine } from the row brand's point of view. */
export function sideOf(pair, slug) {
  const flip = t => pair.a === slug ? { rate: t.a_rate, wins: t.a_wins, losses: t.b_wins, ties: t.ties, unclear: t.unclear, n: t.n }
    : { rate: t.a_rate == null ? null : round1(100 - t.a_rate), wins: t.b_wins, losses: t.a_wins, ties: t.ties, unclear: t.unclear, n: t.n };
  return { ...flip(pair), opponent: pair.a === slug ? pair.b : pair.a, by_engine: Object.fromEntries(Object.entries(pair.by_engine || {}).map(([e, t]) => [e, flip(t)])) };
}

/** The five places a sale can go, in the order the brand page shows them. */
export const PLACE_BUCKETS = [['own', "Brand's own site"], ['specialty', 'Run specialty (store and online)'], ['amazon', 'Amazon'], ['big_box', 'Big box'], ['other', 'Other']];
const bucketOf = (slug, retailers) => {
  if (slug === 'brand-site') return 'own';
  if (slug === 'amazon') return 'amazon';
  const kind = (retailers.find(r => r.slug === slug) || {}).kind;
  if (kind === 'run-specialty' || kind === 'run-specialty-online') return 'specialty';
  if (kind === 'big-box') return 'big_box';
  return 'other';
};

/**
 * Where the sale goes, per brand: of the places to buy in answers that name the brand (placesFor: a place counts once
 * per answer, and only the brand's own site counts as its site), the share in each bucket, with the places behind
 * "other" and a margin from the repeats. Returns { slug: { n, buckets: { own: { share, n, margin } ... }, other_places } }.
 */
export function placesView(runs, brands, retailers, placesFor) {
  const out = {};
  const repeats = [...new Set(runs.map(r => r.repeat_no))].sort();
  for (const b of brands) {
    const rel = runs.filter(r => r.status === 'ok' && (r.mentions || []).some(m => m.brand_slug === b.slug));
    const places = rel.flatMap(r => placesFor(b, r).map(slug => ({ slug, repeat_no: r.repeat_no })));
    if (!places.length) continue;
    const buckets = {};
    for (const [id] of PLACE_BUCKETS) {
      const n = places.filter(p => bucketOf(p.slug, retailers) === id).length;
      const byRepeat = repeats.map(k => { const xs = places.filter(p => p.repeat_no === k); return pct(xs.filter(p => bucketOf(p.slug, retailers) === id).length, xs.length); });
      buckets[id] = { share: round1(pct(n, places.length)), n, margin: repeats.length > 1 ? round1(sd(byRepeat)) : null };
    }
    const other = {};
    for (const p of places) if (bucketOf(p.slug, retailers) === 'other') other[p.slug] = (other[p.slug] || 0) + 1;
    out[b.slug] = { n: places.length, buckets, other_places: Object.entries(other).sort((x, y) => y[1] - x[1]).map(([slug, n]) => ({ slug, name: (retailers.find(r => r.slug === slug) || {}).name || slug, n })) };
  }
  return out;
}
