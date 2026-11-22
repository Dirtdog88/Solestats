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

/**
 * Sources to earn, per brand. Only sources an answer names count (source !== 'searched'), each domain once per answer.
 * top: the 10 domains named most often in answers that mention the brand. gaps: domains named in answers that mention
 * competitors within a need group where the brand also appears, but never in any answer that mentions the brand; brand
 * sites are left out (a brand cannot earn a mention on a rival's site). A gap must be named in at least two answers in
 * that group, for at least two competitors; ranked by answers, then competitors (one long answer naming many brands
 * should not outrank a site the engines keep coming back to). With fewer than minSourced answers naming a source, no gaps are listed (too little to go on).
 * Returns { slug: { sourced_answers, by_engine, top: [{ domain, kind, answers }], gaps: [{ domain, kind, group, label, competitors, answers }] } }.
 */
export function sourcesView(runs, prompts, brands, minSourced) {
  const gOf = groupOf(prompts);
  const named = r => (r.citations || []).filter(c => c.source !== 'searched' && c.domain);
  const ok = runs.filter(r => r.status === 'ok');
  const mentions = (r, slug) => (r.mentions || []).some(m => m.brand_slug === slug);
  // domain -> group -> { brands: Set(slugs it was named for), answers }, and kinds.
  const forBrandInGroup = {}, kindOf = {};
  for (const r of ok) {
    const g = gOf[r.prompt_id];
    for (const c of named(r)) {
      kindOf[c.domain] ||= c.kind;
    }
    if (!g) continue;
    for (const d of new Set(named(r).filter(c => c.kind !== 'brand').map(c => c.domain))) {
      const cell = ((forBrandInGroup[d] ||= {})[g] ||= { brands: new Set(), answers: 0 });
      cell.answers++;
      for (const m of r.mentions || []) cell.brands.add(m.brand_slug);
    }
  }
  const out = {};
  for (const b of brands) {
    const mine = ok.filter(r => mentions(r, b.slug));
    const sourced = mine.filter(r => named(r).length);
    const counts = {};
    for (const r of sourced) for (const d of new Set(named(r).map(c => c.domain))) counts[d] = (counts[d] || 0) + 1;
    const top = Object.entries(counts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 10).map(([domain, answers]) => ({ domain, kind: kindOf[domain], answers }));
    const myGroups = new Set(mine.map(r => gOf[r.prompt_id]).filter(Boolean));
    const gaps = [];
    if (sourced.length >= minSourced) {
      for (const [domain, byGroup] of Object.entries(forBrandInGroup)) {
        if (counts[domain]) continue;
        let best = null;
        for (const [g, cell] of Object.entries(byGroup)) {
          if (!myGroups.has(g)) continue;
          const competitors = [...cell.brands].filter(s => s !== b.slug).length;
          if (competitors < 2 || cell.answers < 2) continue;
          if (!best || cell.answers > best.answers || (cell.answers === best.answers && competitors > best.competitors)) best = { group: g, label: GROUP_LABEL[g] || g, competitors, answers: cell.answers };
        }
        if (best) gaps.push({ domain, kind: kindOf[domain], ...best });
      }
      gaps.sort((x, y) => y.answers - x.answers || y.competitors - x.competitors || x.domain.localeCompare(y.domain));
    }
    const byEngine = {};
    for (const r of sourced) byEngine[r.engine] = (byEngine[r.engine] || 0) + 1;
    out[b.slug] = { sourced_answers: sourced.length, answers: mine.length, by_engine: byEngine, top, gaps: gaps.slice(0, 10) };
  }
  return out;
}

/** The fixes a brand's source gaps suggest: the top three on sites a brand can work with (review sites, forums, news and
 *  retailers; not medical pages or other companies' stores, which the card still lists), for the Top fixes list. */
export const EARNABLE = ['review', 'forum', 'news', 'retailer'];
export function sourceFixes(slug, view, max = 3) {
  return (view.gaps || []).filter(g => EARNABLE.includes(g.kind)).slice(0, max).map(g => ({ brand: slug, subject: 'sourced', text: `Earn a mention on ${g.domain}: cited in ${g.answers} ${g.label.toLowerCase()} answers naming ${g.competitors} competitors, never in one naming you.` }));
}

/**
 * Voice vs size: share of voice divided by the brand's share of the reported revenue of the brands that have both a
 * share of voice and a revenue figure in US dollars. 1 means AI talks about the brand in line with its size; above 1,
 * more; below, less. Context, not cause. A figure wider than the brand (footwear, segment, whole company) overstates
 * its size, so its ratio reads low: `wide` says so. Adds revenue_share and voice_ratio to each row it can.
 */
export function voiceVsSize(rows) {
  const have = rows.filter(r => r.sov != null && r.revenue && r.revenue.usd > 0);
  const total = have.reduce((a, r) => a + r.revenue.usd, 0);
  for (const r of rows) {
    if (!have.includes(r) || !total) { r.revenue_share = null; r.voice_ratio = null; continue; }
    r.revenue_share = round1(pct(r.revenue.usd, total));
    r.voice_ratio = Math.round((r.sov / pct(r.revenue.usd, total)) * 100) / 100;
    r.voice_ratio_wide = !['brand', 'category'].includes(r.revenue.level);
  }
  return { brands_with_both: have.length };
}

export const ENGINE_LABEL = { openai: 'ChatGPT', anthropic: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', rufus: 'Amazon Rufus' };
export const ENGINE_GAP = 10; // points: an engine this far below every other engine's score becomes a fix
export const ENGINE_MIN_N = 20; // observations an engine's score needs to take part in that comparison

/**
 * Engine split: each subject that comes from the answers, scored on each engine's answers alone, beside the combined
 * score. scorers is { subject: runs => { score, n } } (the rubric's own functions, so the rules stay in score.js).
 * Returns { subject: { by_engine: { engine: { score, n } } } } with only the engines that have a score.
 */
export function engineSplit(runs, scorers) {
  const engines = [...new Set(runs.map(r => r.engine))].sort();
  const out = {};
  for (const [subject, f] of Object.entries(scorers)) {
    const by = {};
    for (const e of engines) { const s = f(runs.filter(r => r.engine === e)); if (s && s.score != null) by[e] = { score: s.score, n: s.n }; }
    out[subject] = { by_engine: by };
  }
  return out;
}

/** Fixes from the engine split: a subject where one engine is more than ENGINE_GAP points below every other engine
 *  that has a score (at least two engines scored), counting only engines with ENGINE_MIN_N observations or more. */
export function engineFixes(slug, split, subjectLabel = s => s) {
  const fixes = [];
  for (const [subject, { by_engine: by }] of Object.entries(split)) {
    const es = Object.entries(by).filter(([, s]) => (s.n ?? 0) >= ENGINE_MIN_N);
    if (es.length < 2) continue;
    for (const [e, s] of es) {
      const others = es.filter(([o]) => o !== e);
      if (others.every(([, o]) => o.score - s.score > ENGINE_GAP)) {
        const list = others.map(([o, x]) => `${Math.round(x.score)} on ${ENGINE_LABEL[o] || o}`).join(' and ');
        fixes.push({ brand: slug, subject, engine: e, text: `Close the gap on ${ENGINE_LABEL[e] || e}: ${subjectLabel(subject)} there is ${Math.round(s.score)}, against ${list}.` });
      }
    }
  }
  return fixes;
}

/**
 * Engine patterns (Alex, 2026-11-22): when one engine is low on the same subject for most brands (more than half of
 * the brands with two or more engines compared on it), the gap says more about the engine than about any brand, so it
 * becomes one note in the edition summary instead of a fix on every brand page. Takes the engine fixes (with their
 * engine) and the engine views; returns { fixes: what stays, patterns: [{ engine, subject, brands_low, brands_compared }] }.
 */
export function enginePatterns(fixes, engineViews) {
  const compared = {};
  for (const subjects of Object.values(engineViews)) for (const [subject, v] of Object.entries(subjects || {})) {
    if (Object.values(v.by_engine || {}).filter(x => (x.n ?? 0) >= ENGINE_MIN_N).length >= 2) compared[subject] = (compared[subject] || 0) + 1;
  }
  const low = {};
  for (const f of fixes) { const k = f.engine + '|' + f.subject; low[k] = (low[k] || 0) + 1; }
  const patterns = Object.entries(low).filter(([k, n]) => n > (compared[k.split('|')[1]] || 0) / 2)
    .map(([k, n]) => { const [engine, subject] = k.split('|'); return { engine, subject, brands_low: n, brands_compared: compared[subject] }; });
  const systemic = new Set(patterns.map(p => p.engine + '|' + p.subject));
  return { fixes: fixes.filter(f => !systemic.has(f.engine + '|' + f.subject)), patterns };
}

/** The domains named as sources most often across the round (once per answer), brand sites left out. */
export function topSourceDomains(runs, n = 5) {
  const counts = {}, kinds = {};
  let sourced = 0;
  for (const r of runs.filter(x => x.status === 'ok')) {
    const named = (r.citations || []).filter(c => c.source !== 'searched' && c.domain);
    if (named.length) sourced++;
    for (const c of named) kinds[c.domain] ||= c.kind;
    for (const d of new Set(named.filter(c => c.kind !== 'brand').map(c => c.domain))) counts[d] = (counts[d] || 0) + 1;
  }
  return { sourced_answers: sourced, top: Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([domain, answers]) => ({ domain, kind: kinds[domain], answers })) };
}

const NOISE = 5; // points: gaps under this are noise (the method page says so)
const SUBJECT_WORD = { recommended: 'Recommended', sourced: 'Sourced', routing: 'Sale goes home' };
const listOf = xs => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
const fmt = v => (Math.round(v * 10) / 10).toFixed(1);

/**
 * The edition summary on the front page: four or five sentences made only from the data passed in, so a new round
 * rewrites it with no edits. No ranks, grades or verdicts beyond what the numbers say; gaps under five points are
 * called level. Input: { engines: [{ engine, runs, cited }], brands: [{ slug, name, overall, overall_provisional, sov,
 * voice_ratio, voice_ratio_wide }], engineViews: { slug: { subject: { by_engine } } }, sources: { sourced_answers, top } }.
 */
export function editionSummary({ engines = [], brands = [], engineViews = {}, sources = null, patterns = [], minN = 20 }) {
  const out = [];
  const name = Object.fromEntries(brands.map(b => [b.slug, b.name]));
  const answers = engines.reduce((a, e) => a + (e.runs || 0), 0);
  // 1. Who leads on Overall and on share of voice.
  const byOverall = brands.filter(b => b.overall != null).sort((a, b) => b.overall - a.overall);
  const bySov = brands.filter(b => b.sov != null).sort((a, b) => b.sov - a.sov);
  if (byOverall.length && bySov.length) {
    const [o1, o2] = byOverall, [s1] = bySov;
    const ov = `the highest${byOverall[0].overall_provisional ? ' provisional' : ''} Overall (${Math.round(o1.overall)}${o2 ? o1.overall - o2.overall < NOISE ? `, level with ${o2.name} at ${Math.round(o2.overall)}` : `, ${Math.round(o1.overall - o2.overall)} points above ${o2.name}` : ''})`;
    const lead = `Across ${answers.toLocaleString('en-US')} answers from ${listOf(engines.map(e => ENGINE_LABEL[e.engine] || e.engine))}, `;
    out.push(o1.slug === s1.slug ? `${lead}${o1.name} has ${ov} and the largest share of voice (${fmt(s1.sov)}% of brand mentions).`
      : `${lead}${o1.name} has ${ov}, and ${s1.name} the largest share of voice (${fmt(s1.sov)}% of brand mentions).`);
  }
  // 2. Voice against size: the widest gaps either way, preferring figures at brand or running level.
  const narrow = brands.filter(b => b.voice_ratio != null && !b.voice_ratio_wide);
  const pool = narrow.length >= 2 ? narrow : brands.filter(b => b.voice_ratio != null);
  if (pool.length >= 2) {
    const sorted = [...pool].sort((a, b) => b.voice_ratio - a.voice_ratio);
    const hi = sorted[0], lo = sorted[sorted.length - 1];
    const r = v => `${v < 1 ? v.toFixed(2) : v.toFixed(1)}×`;
    const side = lo.voice_ratio > 1 ? '; all of them get more voice than their size alone would suggest' : hi.voice_ratio < 1 ? '; all of them get less voice than their size alone would suggest' : '';
    out.push(`Among the ${pool.length} brands with ${pool === narrow ? 'a brand or running-level revenue figure' : 'a revenue figure'}, ${hi.name} gets the most share of voice for its size (${r(hi.voice_ratio)}) and ${lo.name} the least (${r(lo.voice_ratio)})${side}; context, not cause.`);
  }
  // 3. Where the engines disagree most.
  let best = null;
  for (const [slug, subjects] of Object.entries(engineViews)) for (const [subject, v] of Object.entries(subjects || {})) {
    const es = Object.entries(v.by_engine || {}).filter(([, x]) => (x.n ?? 0) >= minN);
    if (es.length < 2) continue;
    es.sort((a, b) => b[1].score - a[1].score);
    const gap = es[0][1].score - es[es.length - 1][1].score;
    if (!best || gap > best.gap) best = { slug, subject, gap, hi: es[0], lo: es[es.length - 1] };
  }
  // 3b. A gap one engine shows for most brands is said once here (enginePatterns), not as a fix on each brand page.
  for (const p of patterns) out.push(`${ENGINE_LABEL[p.engine] || p.engine} scores more than ${ENGINE_GAP} points below the other engines on ${SUBJECT_WORD[p.subject] || p.subject} for ${p.brands_low} of the ${p.brands_compared} brands compared, which says more about the engine than about any brand.`);
  if (best && best.gap >= NOISE) out.push(`The engines disagree most on ${name[best.slug] || best.slug}'s ${SUBJECT_WORD[best.subject] || best.subject} score: ${Math.round(best.hi[1].score)} on ${ENGINE_LABEL[best.hi[0]] || best.hi[0]}'s answers against ${Math.round(best.lo[1].score)} on ${ENGINE_LABEL[best.lo[0]] || best.lo[0]}'s.`);
  // 4. Sourcing: who names sources, and what gets named.
  if (engines.length && answers) {
    const parts = engines.map(e => ({ e: ENGINE_LABEL[e.engine] || e.engine, p: e.runs ? Math.round(100 * (e.cited || 0) / e.runs) : 0 })).sort((a, b) => b.p - a.p);
    const named = parts.filter(x => x.p > 0).map(x => `${x.e} in ${x.p}%`), none = parts.filter(x => !x.p).map(x => x.e);
    const total = engines.reduce((a, e) => a + (e.cited || 0), 0);
    let s = `${Math.round(100 * total / answers)}% of answers named their sources${named.length ? `: ${listOf(named)}` : ''}${none.length ? `, ${listOf(none)} in none` : ''}.`;
    if (sources && sources.top && sources.top.length) s = s.slice(0, -1) + `; outside brand sites, the most named was ${sources.top[0].domain} (${sources.top[0].answers} answers).`;
    out.push(s);
  }
  return out;
}
