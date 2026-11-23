// Where the demand is (Alex, 2026-11-22): how much of the asking each runner-need group gets, estimated from free signals
// (Google Trends for the search term behind each shoe prompt, recent Reddit shoe posts sorted into the groups, and real AI
// conversations from public research corpora), and what that means for a brand: a demand-weighted share of voice and the
// groups to fix first. Estimates with a range, refreshed quarterly, never part of the AI score. Pure: the collectors, the
// builder and the score script feed it arrays; nothing here reads a file or the network.
import { GROUPS, GROUP_LABEL } from './2026-11-22-insights.js';

const round1 = x => x == null ? null : Math.round(x * 10) / 10;
const pct = (a, b) => (b ? 100 * a / b : 0);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export const SIGNAL_LABEL = { trends: 'Google Trends', reddit: 'Reddit', corpus: 'AI conversations' };
export const STRONG = 2, WEAK = 1; // points a matched phrase gives its group
export const FIX_FIRST = 3;        // groups named on a brand page

/**
 * Phrase matchers from data/2026-11-22-demand-terms.csv ({ group, kind: strong | weak, phrases: 'a;b*' }): phrases are
 * case-insensitive, matched on word edges; a trailing * allows any ending ("overpronat*" is overpronation, overpronator).
 * Returns [{ group, kind, phrases: [{ text, re }] }].
 */
export function termMatchers(rows) {
  return rows.filter(r => r.group && r.phrases).map(r => ({
    group: r.group, kind: r.kind === 'strong' ? 'strong' : 'weak',
    phrases: r.phrases.split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const star = p.endsWith('*'), body = esc(star ? p.slice(0, -1) : p).replace(/\s+/g, '\\s+');
      const pre = /^\w/.test(p) ? '(?<![\\w-])' : '', post = star ? '\\w*' : /\w$/.test(p) ? '(?![\\w-])' : '';
      return { text: p, re: new RegExp(pre + body + post, 'i') };
    }),
  }));
}

/**
 * Which need group a post or prompt is about: every distinct phrase matched gives its group STRONG or WEAK points; the
 * group with the most points wins, ties going to the group with more strong matches, then to the longest matched phrase,
 * then to the group listed first in GROUPS. Null when nothing matches. Returns the group id, or with detail=true
 * { group, points: { group: n }, matched: { group: [phrases] } }.
 */
export function classify(text, matchers, detail = false) {
  const t = String(text || '');
  const points = {}, strong = {}, longest = {}, matched = {};
  for (const m of matchers) for (const p of m.phrases) {
    if (!p.re.test(t)) continue;
    points[m.group] = (points[m.group] || 0) + (m.kind === 'strong' ? STRONG : WEAK);
    if (m.kind === 'strong') strong[m.group] = (strong[m.group] || 0) + 1;
    longest[m.group] = Math.max(longest[m.group] || 0, p.text.length);
    (matched[m.group] ||= []).push(p.text);
  }
  const order = GROUPS.map(([id]) => id);
  const best = Object.keys(points).sort((a, b) => points[b] - points[a] || (strong[b] || 0) - (strong[a] || 0) || longest[b] - longest[a] || order.indexOf(a) - order.indexOf(b))[0] || null;
  return detail ? { group: best, points, matched } : best;
}

/** Whether a post or prompt is about running shoes at all: shoe words, a watched brand, or a distinctive model name. For
 *  communities that are not only about shoes (r/running) and for the conversation corpora. */
export const SHOE_WORDS = /(?<![\w-])(shoes?|trainers?|sneakers?|kicks|ghost|glycerin|adrenaline|hyperion|clifton|bondi|speedgoat|arahi|skyward|pegasus|vomero|invincible|vaporfly|alphafly|kayano|nimbus|novablast|cumulus|superblast|1080|880|860|rebel|endorphin|kinvara|triumph|adios|ultraboost|supernova|cloudmonster|cloudsurfer|cloudrunner|cloudstratus|torin|lone peak|escalante|hoka|brooks|saucony|asics|altra|topo|salomon|mizuno|merrell|inov-?8|new balance|nike|adidas|puma|skechers|under armour|sportiva)(?![\w-])/i;
export const isShoePost = text => SHOE_WORDS.test(String(text || ''));

/**
 * A chat opening that is someone asking for advice, not a job handed to the AI (2026-11-23: WildChat is full of pasted
 * product-title lists, listings and copy to write, lab reports and stories that happen to say "running" or "gel").
 * Kept: short-ish questions or requests for a recommendation. Dropped: numbered product lists, writing and rewriting
 * jobs, and anything longer than a pasted paragraph.
 */
const WRITING_JOB = /\b(write|rewrite|re-write|paraphrase|generate|compose|draft|translate|summari[sz]e|proofread|product (title|description|listing)s?|listing|seo|keywords?|meta description|slogan|tagline|caption|hashtags?|ad copy|copywriting|article|blog|essay|story|poem|script|lyrics|midjourney|prompt generator|bullet points?|table of contents)\b/i;
export function isAdviceQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 600) return false;
  if (/^\s*1[.)]\s/.test(t) && /\s2[.)]\s/.test(t)) return false; // a pasted numbered list of products
  if (/\b\d+\s?(pcs|pc|pairs?|packs?)\b/i.test(t) && !/\?/.test(t)) return false; // a pasted product title
  if (WRITING_JOB.test(t)) return false;
  return true;
}

/**
 * Weights per need group from the signal rows (data/2026-11-22-demand-signals.csv: { signal, source, key, value }).
 * trends: value is the 12-month average interest of the search term `key` (one per shoe prompt, keywords: [{ prompt_id,
 *   group, keyword }]) on one common scale; a group's demand is the sum over its distinct terms (a term used in two
 *   groups is split between them). reddit: value is the number of posts classified into group `key` in `source` (one
 *   subreddit); each subreddit becomes shares first, then the subreddits are averaged, so a busy one does not outweigh a
 *   quiet one. corpus: the same for prompts in `source` (one dataset).
 * Each signal gives a share per group; the weight is the mean of the signals that have data, rescaled to add up to 100,
 * and low/high are the smallest and largest signal shares (null with one signal). Returns
 * { groups: [{ id, label, weight, low, high, by_signal: { signal: share } }], signals: [ids], n: { signal: observations } }
 * or null when no signal has data.
 */
export function buildWeights(rows, keywords = []) {
  const ids = GROUPS.map(([id]) => id);
  const shares = {}; // signal -> { group: share }
  const n = {};
  // Google Trends: term -> groups it stands for.
  const groupsOf = {};
  for (const k of keywords) if (k.keyword && ids.includes(k.group)) (groupsOf[k.keyword.trim().toLowerCase()] ||= new Set()).add(k.group);
  const trends = rows.filter(r => r.signal === 'trends' && r.value !== '' && r.value != null && !Number.isNaN(Number(r.value)));
  if (trends.length) {
    const sum = Object.fromEntries(ids.map(id => [id, 0]));
    let used = 0;
    const seen = new Set();
    for (const r of trends) {
      const key = String(r.key || '').trim().toLowerCase();
      if (seen.has(key)) continue; // the latest row for a term is first (the builder sorts newest first); one count per term
      seen.add(key);
      const gs = groupsOf[key];
      if (!gs) continue;
      used++;
      for (const g of gs) sum[g] += Number(r.value) / gs.size;
    }
    const total = ids.reduce((a, id) => a + sum[id], 0);
    if (used && total > 0) { shares.trends = Object.fromEntries(ids.map(id => [id, pct(sum[id], total)])); n.trends = used; }
  }
  // Reddit and the corpora: counts per group per source, shares per source, then the mean across sources.
  for (const signal of ['reddit', 'corpus']) {
    const mine = rows.filter(r => r.signal === signal && ids.includes(r.key) && r.value !== '' && r.value != null && !Number.isNaN(Number(r.value)));
    if (!mine.length) continue;
    const bySource = {};
    for (const r of mine) { const s = (bySource[r.source || ''] ||= Object.fromEntries(ids.map(id => [id, null]))); s[r.key] = Number(r.value); } // latest row wins (rows arrive newest first)
    const perSource = Object.values(bySource).map(s => { const total = ids.reduce((a, id) => a + (s[id] || 0), 0); return total > 0 ? Object.fromEntries(ids.map(id => [id, pct(s[id] || 0, total)])) : null; }).filter(Boolean);
    if (!perSource.length) continue;
    shares[signal] = Object.fromEntries(ids.map(id => [id, mean(perSource.map(s => s[id]))]));
    n[signal] = Object.values(bySource).reduce((a, s) => a + ids.reduce((b, id) => b + (s[id] || 0), 0), 0);
  }
  const signals = Object.keys(shares);
  if (!signals.length) return null;
  const raw = ids.map(id => { const xs = signals.map(s => shares[s][id]); return { id, label: GROUP_LABEL[id], mean: mean(xs), low: Math.min(...xs), high: Math.max(...xs), by_signal: Object.fromEntries(signals.map(s => [s, round1(shares[s][id])])) }; });
  const total = raw.reduce((a, g) => a + g.mean, 0);
  const groups = raw.map(g => ({ id: g.id, label: g.label, weight: round1(pct(g.mean, total)), low: signals.length > 1 ? round1(g.low) : null, high: signals.length > 1 ? round1(g.high) : null, by_signal: g.by_signal }));
  return { groups, signals, n };
}

/** The weights as rows for data/2026-11-22-demand.csv, and back. */
export function weightsToRows(w, builtOn) {
  return w.groups.map(g => ({ group: g.id, label: g.label, weight: g.weight, low: g.low ?? '', high: g.high ?? '', trends_share: g.by_signal.trends ?? '', reddit_share: g.by_signal.reddit ?? '', corpus_share: g.by_signal.corpus ?? '', signals: w.signals.join(';'), n: w.signals.map(s => `${s}:${w.n[s]}`).join(';'), built_on: builtOn }));
}
export function weightsFromRows(rows) {
  const num = v => (v === '' || v == null ? null : Number(v));
  const groups = rows.filter(r => GROUP_LABEL[r.group]).map(r => ({ id: r.group, label: GROUP_LABEL[r.group], weight: Number(r.weight), low: num(r.low), high: num(r.high), by_signal: Object.fromEntries([['trends', num(r.trends_share)], ['reddit', num(r.reddit_share)], ['corpus', num(r.corpus_share)]].filter(([, v]) => v != null)) }));
  if (!groups.length) return null;
  const first = rows[0];
  const n = Object.fromEntries((first.n || '').split(';').filter(Boolean).map(x => { const [s, v] = x.split(':'); return [s, Number(v)]; }));
  return { groups, signals: (first.signals || '').split(';').filter(Boolean), n, built_on: first.built_on || null };
}

/**
 * What the weights mean for each brand, from the brand-by-need view (needGrid) and the weights:
 * - weighted_sov: share of voice with each group's answers counted in proportion to its weight (the brand's share of the
 *   brands named in a group, times the group's weight), so it adds up to 100 across brands; groups with no answers in the
 *   round are left out and the weights rescaled over the rest;
 * - rows, one per group: weight, low, high, the brand's share of answers there and its top-pick share, the leader's share
 *   and slug, the gap, whether the brand has a credible shoe for the group (eligible), and priority = weight × gap / 100;
 * - fix_first: up to FIX_FIRST eligible groups with the largest priority (zero priorities left out).
 * eligibleGroups: { slug: Set(group ids) } or null (every group counts for every brand).
 * Returns { '': { weights, leaders, built_on, signals, n }, slug: { weighted_sov, rows, fix_first } }.
 */
export function demandView(needs, weights, eligibleGroups = null) {
  if (!needs || !needs.groups || !weights || !weights.groups) return null;
  const wOf = Object.fromEntries(weights.groups.map(g => [g.id, g]));
  const groups = needs.groups.filter(g => wOf[g.id]);
  const wTotal = groups.reduce((a, g) => a + wOf[g.id].weight, 0);
  if (!groups.length || !wTotal) return null;
  const slugs = Object.keys(needs.brands);
  const leaders = {}, namedTotal = {};
  for (const g of groups) {
    let best = null;
    namedTotal[g.id] = 0;
    for (const s of slugs) {
      const c = needs.brands[s][g.id] || { share: 0, named: 0 };
      namedTotal[g.id] += c.named || 0;
      if (!best || c.share > best.share || (c.share === best.share && s < best.slug)) best = { slug: s, share: c.share };
    }
    leaders[g.id] = best && best.share > 0 ? best : null;
  }
  const out = { '': { weights: { ...weights, groups: weights.groups.map(g => ({ ...g })) }, leaders, built_on: weights.built_on || null, signals: weights.signals, n: weights.n } };
  for (const s of slugs) {
    let wsov = 0;
    const rows = groups.map(g => {
      const w = wOf[g.id], c = needs.brands[s][g.id] || { share: 0, top_share: 0, named: 0 };
      const scaled = 100 * w.weight / wTotal;
      wsov += scaled * pct(c.named || 0, namedTotal[g.id]) / 100;
      const leader = leaders[g.id];
      const eligible = eligibleGroups ? Boolean(eligibleGroups[s] && eligibleGroups[s].has(g.id)) : true;
      const gap = leader ? Math.max(0, leader.share - c.share) : 0;
      return { id: g.id, label: g.label, weight: round1(scaled), low: w.low, high: w.high, answers: g.answers, share: c.share, top_share: c.top_share, leader: leader ? leader.share : null, leader_slug: leader ? leader.slug : null, gap: round1(gap), eligible, priority: round1(scaled * gap / 100) };
    });
    const fix = rows.filter(r => r.eligible && r.priority > 0).sort((a, b) => b.priority - a.priority || b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, FIX_FIRST).map(r => r.id);
    out[s] = { weighted_sov: round1(wsov), rows, fix_first: fix };
  }
  return out;
}
