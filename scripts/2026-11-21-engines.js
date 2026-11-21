// One adapter per engine. Each returns the same shape:
//   { model, answer, citations: [{url, title}], raw, input_tokens, output_tokens, stop_reason }
// All engines run with web search on, so the answers look like what a shopper sees in the consumer apps
// (and so there are citations to score). Keys come from the environment; spend caps live at each provider.
//
// Models are pinned by environment variable so a round records exactly what ran:
//   SOLESTATS_ANTHROPIC_MODEL (default claude-opus-5-5), SOLESTATS_OPENAI_MODEL, SOLESTATS_GEMINI_MODEL,
//   SOLESTATS_PERPLEXITY_MODEL. Check the OpenAI and Gemini ids against their docs before a round.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = 'You are answering a shopper who is deciding what to buy. Answer the way you normally would.';

// ---------- Anthropic (official SDK, server-side web search) ----------
let anthropic;
export async function askAnthropic(prompt) {
  anthropic ||= new Anthropic(); // ANTHROPIC_API_KEY from the environment
  const model = process.env.SOLESTATS_ANTHROPIC_MODEL || 'claude-opus-5-5';
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];
  const messages = [{ role: 'user', content: prompt }];
  let response, usage = { input: 0, output: 0 }, hops = 0;
  // A long server-tool turn can pause; resend the same messages plus the assistant content to resume (at most 3 times).
  for (;;) {
    response = await anthropic.messages.create({ model, max_tokens: 4000, system: SYSTEM, tools, messages });
    usage.input += response.usage.input_tokens; usage.output += response.usage.output_tokens;
    if (response.stop_reason !== 'pause_turn' || ++hops > 3) break;
    messages.push({ role: 'assistant', content: response.content });
  }
  const texts = [], citations = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      texts.push(block.text);
      for (const c of block.citations || []) if (c.url) citations.push({ url: c.url, title: c.title || '' });
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === 'web_search_result' && r.url) citations.push({ url: r.url, title: r.title || '', searched: true });
    }
  }
  return { model: response.model, answer: texts.join('\n'), citations: dedupe(citations), raw: response, input_tokens: usage.input, output_tokens: usage.output, stop_reason: response.stop_reason };
}

// ---------- OpenAI Responses API with the web_search tool ----------
export async function askOpenAI(prompt) {
  const model = process.env.SOLESTATS_OPENAI_MODEL || 'gpt-5';
  const res = await post('https://api.openai.com/v1/responses', { Authorization: `Bearer ${need('OPENAI_API_KEY')}` }, {
    model, instructions: SYSTEM, input: prompt, tools: [{ type: 'web_search' }], max_output_tokens: 4000,
  });
  const texts = [], citations = [];
  for (const item of res.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type !== 'output_text') continue;
      texts.push(part.text);
      for (const a of part.annotations || []) if (a.type === 'url_citation' && a.url) citations.push({ url: a.url, title: a.title || '' });
    }
  }
  return { model: res.model || model, answer: texts.join('\n'), citations: dedupe(citations), raw: res, input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens, stop_reason: res.status };
}

// ---------- Google Gemini with Google Search grounding ----------
export async function askGemini(prompt) {
  const model = process.env.SOLESTATS_GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': need('GEMINI_API_KEY') }, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { maxOutputTokens: 4000 },
  });
  const cand = (res.candidates || [])[0] || {};
  const answer = (cand.content?.parts || []).map(p => p.text || '').join('');
  const citations = (cand.groundingMetadata?.groundingChunks || []).filter(c => c.web?.uri).map(c => ({ url: c.web.uri, title: c.web.title || '' }));
  return { model: res.modelVersion || model, answer, citations: dedupe(citations), raw: res, input_tokens: res.usageMetadata?.promptTokenCount, output_tokens: res.usageMetadata?.candidatesTokenCount, stop_reason: cand.finishReason };
}

// ---------- Perplexity Sonar (search built in) ----------
export async function askPerplexity(prompt) {
  const model = process.env.SOLESTATS_PERPLEXITY_MODEL || 'sonar';
  const res = await post('https://api.perplexity.ai/chat/completions', { Authorization: `Bearer ${need('PERPLEXITY_API_KEY')}` }, {
    model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], max_tokens: 4000,
  });
  const answer = res.choices?.[0]?.message?.content || '';
  const citations = (res.search_results || []).map(r => ({ url: r.url, title: r.title || '' }));
  for (const u of res.citations || []) if (!citations.some(c => c.url === u)) citations.push({ url: u, title: '' });
  return { model: res.model || model, answer, citations: dedupe(citations), raw: res, input_tokens: res.usage?.prompt_tokens, output_tokens: res.usage?.completion_tokens, stop_reason: res.choices?.[0]?.finish_reason };
}

export const ENGINES = { anthropic: askAnthropic, openai: askOpenAI, gemini: askGemini, perplexity: askPerplexity };

// Rough list prices per million tokens, for the running cost shown during a round. Not billing.
export const PRICES = {
  anthropic: { input: 4, output: 20 }, openai: { input: 2, output: 8 }, gemini: { input: 0.3, output: 2.5 }, perplexity: { input: 1, output: 1 },
};
export function estimateCost(engine, inTok = 0, outTok = 0) {
  const p = PRICES[engine] || { input: 0, output: 0 };
  return (inTok * p.input + outTok * p.output) / 1e6;
}

function need(name) { const v = process.env[name]; if (!v) throw new Error(`${name} is not set`); return v; }
function dedupe(cs) { const seen = new Set(); return cs.filter(c => c.url && !seen.has(c.url) && seen.add(c.url)); }
async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
