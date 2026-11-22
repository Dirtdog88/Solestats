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
  overall: ['Overall', 'Weighted mean of the scored subjects, 0 to 100, no curve. Weights: Recommended 35, Accurate 25, Shoppable 20, Sourced 10, Sale goes home 10. Needs at least three subjects.'],
  recommended: ['Recommended', 'How often the brand is named on prompts where it has a credible shoe, combined with its head-to-head record, how often it is the first pick, and how consistent that is across repeats.'],
  accurate: ['Accurate', 'Share of product facts AI got right against the hand-verified spec sheet (version, price, weight, drop, stack, widths, category). "Not sure" counts as wrong.'],
  shoppable: ['Shoppable', "Share of a manual checklist the brand's site passes: can an assistant find widths, stock, returns and a path to cart."],
  sourced: ['Sourced', "Share of the sources named in answers about the brand that are the brand's own site or an established review site. Only sources the answer names count."],
  not_provided: ['Source not provided', 'The engine ran a web search but named none of its sources in the answer. Counted beside Sourced, not scored.'],
  no_search: ['No search', 'The engine answered from what it already knew, without a web search. These answers still count for Recommended and Sale goes home; beside Sourced they are counted, not scored.'],
  too_few: ['Too few', 'Fewer than 5 answers about the brand named a source, so Sourced is not scored and Overall is weighted over the other subjects.'],
  intl: ['Non-US site', "Sources on the brand's own sites outside the US, such as au.hoka.com or adidas.co.uk. They count as the brand's own site."],
  checked: ['Checked', 'Accurate and Shoppable come from checks run once a quarter; this is the round they were last checked in.'],
  revenue: ['Revenue', "Year-over-year change in what the brand, or the company that owns it, reported for its latest fiscal year, in the currency it reports in, with the amount below. Context only: not scored, and no link to the AI scores is claimed."],
  sov: ['Share of voice', "Of all the brand mentions in AI answers to the shoe questions, the share that are this brand. Each brand counts once per answer; head-to-head and where-to-buy questions are left out. The ± is how much it moved between repeats."],
  top_pick_share: ['Top picks', "Share of the answers' first recommendations that went to this brand."],
  answer_share: ['In answers', 'Share of answers to the shoe questions that name the brand at all.'],
  sov_change: ['Share-of-voice change', 'Change in share of voice since the previous edition, in percentage points.'],
  revenue_scale: ['Reported revenue', "The narrowest revenue figure the brand or its owner reports for its latest fiscal year, converted to US dollars at the Federal Reserve's yearly average rate only to put brands on one scale. Filled dots are the brand or its running business; rings are wider figures (all footwear, a segment or the whole company) and overstate the running business. Running-shoe market share is not published, so this stands in for it."],
  top10_share: ['Top-10 share', "Of the top-10 places at the World Marathon Majors and the World Championships marathon since 2025, men's and women's races, the share whose shoe brand is confirmed and is this brand. Race-day shoes where a source reports them, otherwise the athlete's sponsor."],
  podiums: ['Podiums', 'Top-3 places at those races in this brand, with wins in brackets.'],
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
  const show = node => { const [label, text] = DEFINITIONS[node.dataset.def] || []; if (!text) return; tip.replaceChildren(el('b', {}, label), text); tip.hidden = false; shownAt = Date.now(); };
  // A tap focuses first (which shows the tip) and then clicks; the click must not hide what the focus just showed.
  document.addEventListener('click', e => { const n = e.target.closest('[data-def]'); if (n) { e.preventDefault(); show(n); } else if (!e.target.closest('#tip') && Date.now() - shownAt > 400) tip.hidden = true; });
  document.addEventListener('focusin', e => { const n = e.target.closest('[data-def]'); if (n) show(n); });
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
export async function showEdition() {
  const node = document.getElementById('edition');
  if (!node) return;
  const d = await api('/api/edition').catch(() => null);
  if (!d || !d.round) { node.textContent = 'No edition yet.'; return; }
  const parts = d.engines.map(e => `${engineName(e.engine)} (${e.model})`);
  const list = parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  node.replaceChildren(
    defined('span', 'edition', { text: `Edition ${d.round}` }), el('span', {}, `: ${list || 'no engines yet'}${d.repeats ? `, ${d.repeats} ${d.repeats === 1 ? 'repeat' : 'repeats'} each.` : '.'}`),
    ...(d.pending || []).map(p => el('span', { class: 'pending' }, ` ${engineName(p)}: pending.`)),
  );
}
