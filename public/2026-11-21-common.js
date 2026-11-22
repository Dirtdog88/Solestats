// Shared by the site's scripts: element building with textContent (never innerHTML with data), the JSON API, and the
// line that says which engines are in the current edition and which are still pending.
export const ENGINE_NAMES = { openai: 'ChatGPT', anthropic: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', rufus: 'Amazon Rufus' };

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? n.className = v : k === 'hidden' ? n.hidden = v : n.setAttribute(k, v);
  for (const k of kids) n.append(k == null ? '' : k);
  return n;
};

export const api = p => fetch(p).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)));

export const engineName = e => ENGINE_NAMES[e] || e;

/** Every metric's definition, in one place: the hover/tap tips on the data pages and the Definitions list on the
 *  method page both read it. Keep each to one or two sentences. */
export const DEFINITIONS = {
  overall: ['AI score', "One number out of 100 for how AI assistants treat the brand: how often they recommend it, what they cite about it, whether they get its product facts right, how easy its site is for them to shop, and where they send shoppers to buy. Weights: Recommended 35, Accurate 25, Shoppable 20, Sourced 10, Sale goes home 10; no curve. Needs at least three of the five."],
  recommended: ['Recommended', 'How often the brand is named on prompts where it has a credible shoe, combined with its head-to-head record, how often it is the first pick, and how consistent that is across repeats.'],
  accurate: ['Accurate', 'Share of product facts AI got right against the hand-verified spec sheet (version, price, weight, drop, stack, widths, category). "Not sure" counts as wrong.'],
  shoppable: ['Shoppable', "Share of a manual checklist the brand's site passes: can an assistant find widths, stock, returns and a path to cart."],
  sourced: ['Sourced', "Share of the sources named in answers about the brand that are the brand's own site or an established review site. Only sources the answer names count."],
  not_provided: ['Source not provided', 'The engine ran a web search but named none of its sources in the answer. Counted beside Sourced, not scored.'],
  no_search: ['No search', 'The engine answered from what it already knew, without a web search. These answers still count for Recommended and Sale goes home; beside Sourced they are counted, not scored.'],
  too_few_score: ['Not enough data yet', 'Too few answers about the brand named a source this edition, so it has fewer than the three scored parts an AI score needs. Its other numbers are on its page.'],
  too_few: ['Too few', 'Fewer than 5 answers about the brand named a source, so Sourced is not scored and the AI score is weighted over the other subjects.'],
  intl: ['Non-US site', "Sources on the brand's own sites outside the US, such as au.hoka.com or adidas.co.uk. They count as the brand's own site."],
  checked: ['Checked', 'Accurate and Shoppable come from checks run once a quarter; this is the round they were last checked in.'],
  revenue: ['Revenue', "Year-over-year change in what the brand, or the company that owns it, reported for its latest fiscal year, in the currency it reports in, with the amount below. Context only: not scored, and no link to the AI scores is claimed."],
  sov: ['Share of voice', "Of all the brand mentions in AI answers to the shoe questions, the share that are this brand. Each brand counts once per answer; head-to-head and where-to-buy questions are left out. The ± is how much it moved between repeats."],
  top_pick_share: ['Top picks', "Share of the answers' first recommendations that went to this brand."],
  answer_share: ['In answers', 'Share of answers to the shoe questions that name the brand at all.'],
  voice_ratio: ['Voice vs size', "Share of voice divided by the brand's share of reported revenue among the brands that have both, in US dollars. 1× means AI mentions the brand in line with its size; above 1×, more; below, less. A ○ marks a figure wider than the brand (footwear, a segment or the whole company), which overstates its size, so the ratio reads low. Context, not cause."],
  sov_change: ['Share-of-voice change', 'Change in share of voice since the previous edition, in percentage points.'],
  revenue_scale: ['Reported revenue', "The narrowest revenue figure the brand or its owner reports for its latest fiscal year, converted to US dollars at the Federal Reserve's yearly average rate only to put brands on one scale. Filled dots are the brand or its running business; rings are wider figures (all footwear, a segment or the whole company) and overstate the running business. Running-shoe market share is not published, so this stands in for it."],
  top10_share: ['Top-10 share', "Of the top-10 places at the World Marathon Majors and the World Championships marathon since 2025, men's and women's races, the share whose shoe brand is confirmed and is this brand. Race-day shoes where a source reports them, otherwise the athlete's sponsor."],
  podiums: ['Podiums', 'Top-3 places at those races in this brand, with wins in brackets.'],
  need: ['By runner need', "Share of answers in each group of shoe questions (starting out, stability, trail and so on) that name the brand, once per answer. The tip adds how often it was the top pick. Not part of the AI score; every brand is counted on every group, whether or not it makes a shoe for that need."],
  h2h: ['Head to head', "Share of answers to \"Brand A or Brand B: which should I buy?\" that favour this brand, ties counted as half and answers that pick neither left out. Nine answers per pair (three engines, three repeats), so small gaps are noise. Part of Recommended."],
  places: ['Where the sale goes', "Of the places to buy named in answers that mention the brand, the share that are its own site, run specialty stores and their online shops, Amazon, big box stores, or anywhere else. A place counts once per answer; another brand's site is not a place to buy this brand. Own site plus run specialty is the Sale goes home score."],
  sources_top: ['Named most', "The sites AI names as its sources most often in answers that mention the brand, counted once per answer. Only sources an answer names count, so this comes from the engines that name them."],
  sources_gap: ['Sources to earn', "Sites named as sources in answers that mention competitors, in a group of questions where the brand also appears, but never in an answer that mentions the brand. Each was named in at least two such answers. Review sites, forums, news and retailers become Top fixes."],
  by_engine: ['By engine', "The same score worked out on one engine's answers at a time. An engine more than 10 points below every other engine (each with at least 20 observations) is marked and becomes a Top fix."],
  models: ['Models named', "The brand's shoes named in answers that mention the brand, from the models on the spec sheet: the share of those answers naming each, the versions named, and the other brand's shoe named most often in the same answers."],
  pair_models: ['Shoes named most', "Each brand's shoe named most often in the answers to that pair's question. The question names only the brands, so this is the shoe the engines chose to compare."],
  version_current: ['Current version', "Of the times the brand's shoes are named with a version number, the share naming the version on sale now, from the hand-checked spec sheet."],
  steering: ['Steered to older or cheaper', "Share of answers naming the brand where the part about the brand points the shopper to last year's model or an older version, or to a sale, discount, outlet or clearance. Phrase lists, read in the sentence or bullet that names the brand or its shoe."],
  substitution: ['When not you, who', "On shoe questions where the brand has a credible shoe but the answer does not name it, the brand the answer picked first. Credible comes from the spec sheet's needs; while a brand's rows are not yet checked by hand, the draft rows stand in and the card says so."],
  attributes: ['What AI says about it', "Share of answers naming the brand where the sentence or bullet about the brand or its shoe uses each attribute's words (cushioning, stability, price, width and so on), beside the same share across all brands. Cautions are fit warnings, durability complaints, ride complaints and 'avoid' language; a caution right after 'not', 'no' or 'without' does not count. From a phrase list checked by hand."],
  routing: ['Sale goes home', "Share of the places to buy, in answers that name the brand, that are the brand's own site or a run specialty store."],
  margin: ['±', 'How much the score moved between repeats of the same prompts. Gaps under about five points are noise.'],
  n: ['n', 'How many answers, sources or routes the score is built from.'],
  place: ['Place to buy', "Share of answers in the column's category that point the shopper to this place."],
  edition: ['Edition', 'The engines, model ids and repeats behind every number on the page. A pending engine joins the same edition when its answers are in.'],
  engine: ['Engine', 'Answers from this engine in the edition: how many ran a web search, named their sources, searched without naming any, or answered without searching.'],
  preview: ['Preview', 'Numbers on a preview come from a partial or sample round and are not findings.'],
};

/** A reported amount in its own currency, short: $2.2B, €24.8B, ¥680B. `unit` is millions or billions. */
export function money(value, unit, currency) {
  const n = Number(value) * (unit === 'billions' ? 1e9 : 1e6);
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n); }
  catch { return `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} ${currency || ''}`.trim(); }
}

/** A header or label that explains itself on hover (title) and on tap (the shared tip box). */
export function defined(tag, key, attrs = {}) {
  const [label, text] = DEFINITIONS[key] || [key, ''];
  return el(tag, { ...attrs, title: text, 'data-def': key, tabindex: '0' }, attrs.text ?? label);
}

/** Phones have no hover: a tap or focus on any [data-def] shows its definition in #tip; a tap elsewhere hides it. */
export function installTips() {
  const tip = document.getElementById('tip');
  if (!tip) return;
  let shownAt = 0;
  // [data-def] shows a definition; [data-tip] (a heat-map cell, say) shows its own numbers.
  const show = node => { const [label, text] = node.dataset.tip ? [node.dataset.tipTitle || '', node.dataset.tip] : DEFINITIONS[node.dataset.def] || []; if (!text) return; tip.replaceChildren(el('b', {}, label), text); tip.hidden = false; shownAt = Date.now(); };
  // A tap focuses first (which shows the tip) and then clicks; the click must not hide what the focus just showed.
  document.addEventListener('click', e => { const n = e.target.closest('[data-def],[data-tip]'); if (n) { e.preventDefault(); show(n); } else if (!e.target.closest('#tip') && Date.now() - shownAt > 400) tip.hidden = true; });
  document.addEventListener('focusin', e => { const n = e.target.closest('[data-def],[data-tip]'); if (n) show(n); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') tip.hidden = true; });
}

/** The method page's Definitions list, from the same map. */
export function fillDefinitions(dl) {
  for (const [, [label, text]] of Object.entries(DEFINITIONS)) dl.append(el('dt', {}, label), el('dd', {}, text));
}

/** An answer as readable text for display: citation parentheticals and link targets out, bold markers off. The raw
 *  answer with its markup stays in the data and the downloads. */
export function plainAnswer(text) {
  return (text || '')
    .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)(?:\s*[,;]?\s*\[[^\]]*\]\([^)]*\))*\s*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '');
}

/** Fills the #edition element: "Edition 2026-11: ChatGPT (gpt-6.2-astra) and Claude (claude-opus-5-5), 3 repeats each. Gemini: pending." */
/** The edition (engines, models, which subjects the AI score covers), fetched once per page. */
let editionPromise = null;
export const edition = () => (editionPromise ||= api('/api/edition').catch(() => null));

const SUBJECT_NAME = { recommended: 'Recommended', accurate: 'Accurate', shoppable: 'Shoppable', sourced: 'Sourced', routing: 'Sale goes home' };
const list = xs => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

/** The AI score (subject "overall") is provisional while some subjects are unscored (Accurate and Shoppable until the
 *  quarterly checks). Rewrites its definition to say which subjects it covers this edition, and returns { provisional,
 *  label }. */
export async function overallStatus() {
  const d = await edition();
  const o = d && d.overall;
  if (!o || !o.subjects || !o.subjects.length) return { provisional: false, label: 'AI score' };
  if (o.provisional) {
    const missing = o.all.filter(s => !o.subjects.includes(s)).map(s => SUBJECT_NAME[s] || s);
    DEFINITIONS.overall = ['AI score', `One number out of 100 for how AI assistants treat the brand. This edition it covers ${list(o.subjects.map(s => SUBJECT_NAME[s] || s))} only; ${list(missing)} ${missing.length === 1 ? 'is' : 'are'} not scored yet. Full weights: Recommended 35, Accurate 25, Shoppable 20, Sourced 10, Sale goes home 10.`];
  }
  return { provisional: Boolean(o.provisional), label: 'AI score' };
}

export async function showEdition() {
  const node = document.getElementById('edition');
  if (!node) return;
  const d = await edition();
  if (!d || !d.round) { node.textContent = 'No edition yet.'; return; }
  const parts = d.engines.map(e => `${engineName(e.engine)} (${e.model})`);
  const list = parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  node.replaceChildren(
    defined('span', 'edition', { text: `Edition ${d.round}` }), el('span', {}, `: ${list || 'no engines yet'}${d.repeats ? `, ${d.repeats} ${d.repeats === 1 ? 'repeat' : 'repeats'} each.` : '.'}`),
    ...(d.pending || []).map(p => el('span', { class: 'pending' }, ` ${engineName(p)}: pending.`)),
  );
}
