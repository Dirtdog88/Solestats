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

/** Fills the #edition element: "Edition 2026-11: ChatGPT (gpt-6.2-astra) and Claude (claude-opus-5-5), 3 repeats each. Gemini: pending." */
export async function showEdition() {
  const node = document.getElementById('edition');
  if (!node) return;
  const d = await api('/api/edition').catch(() => null);
  if (!d || !d.round) { node.textContent = 'No edition yet. The first round is being collected.'; return; }
  const parts = d.engines.map(e => `${engineName(e.engine)} (${e.model})`);
  const list = parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  node.replaceChildren(
    el('span', {}, `Edition ${d.round}: ${list || 'no engines yet'}${d.repeats ? `, ${d.repeats} repeats each.` : '.'}`),
    ...(d.pending || []).map(p => el('span', { class: 'pending' }, ` ${engineName(p)}: pending.`)),
  );
}
