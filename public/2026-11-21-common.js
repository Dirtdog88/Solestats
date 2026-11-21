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
  sourced: ['Sourced', "Share of the sources behind answers that name the brand that are the brand's own site or an established review site. Attributed citations when the engine gives them, otherwise the pages its search returned."],
  routing: ['Sale goes home', "Share of the places to buy, in answers that name the brand, that are the brand's own site or a run specialty store."],
  margin: ['±', 'How much the score moved between repeats of the same prompts. Gaps under about five points are noise.'],
  n: ['n', 'How many answers, sources or routes the score is built from.'],
  place: ['Place to buy', "Share of answers in the column's category that point the shopper to this place."],
  edition: ['Edition', 'The engines, model ids and repeats behind every number on the page. A pending engine joins the same edition when its answers are in.'],
  engine: ['Engine', 'Answers from this engine in the edition, how many ran a web search, and how many attributed sources in the answer.'],
  preview: ['Preview', 'Numbers on a preview come from a partial or sample round and are not findings.'],
};

/** A header or label that explains itself on hover (title) and on tap (the shared tip box). */
export function defined(tag, key, attrs = {}) {
  const [label, text] = DEFINITIONS[key] || [key, ''];
  return el(tag, { ...attrs, title: text, 'data-def': key, tabindex: '0' }, attrs.text ?? label);
}

/** Phones have no hover: a tap or focus on any [data-def] shows its definition in #tip; a tap elsewhere hides it. */
export function installTips() {
  const tip = document.getElementById('tip');
  if (!tip) return;
  const show = node => { const [label, text] = DEFINITIONS[node.dataset.def] || []; if (!text) return; tip.replaceChildren(el('b', {}, label), text); tip.hidden = false; };
  document.addEventListener('click', e => { const n = e.target.closest('[data-def]'); if (n) { e.preventDefault(); show(n); } else tip.hidden = true; });
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
