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
