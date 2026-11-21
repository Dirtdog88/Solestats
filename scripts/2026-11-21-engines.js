// One adapter per engine. Each returns the same shape:
//   { model, answer, citations: [{url, title}], searched: [{url, title}], searches, raw, input_tokens, output_tokens, stop_reason }
// citations = pages the answer attributed (inline citations, annotations, grounding); searched = pages a web search
// returned that the answer did not attribute (kept as context, never counted as a route); searches = how many
// web searches ran (billed separately from tokens).
// All engines run with web search on, so the answers look like what a shopper sees in the consumer apps
// (and so there are citations to score). Keys come from the environment (SOLESTATS_ANTHROPIC_KEY or
// ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY); spend caps live at each provider.
//
// Models are pinned by environment variable so a round records exactly what ran:
//   SOLESTATS_ANTHROPIC_MODEL (default claude-opus-5-5), SOLESTATS_OPENAI_MODEL, SOLESTATS_GEMINI_MODEL,
//   SOLESTATS_PERPLEXITY_MODEL. Check the OpenAI and Gemini ids against their docs before a round.

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = 'You are answering a shopper who is deciding what to buy. Answer the way you normally would.';

// ---------- Anthropic (official SDK, server-side web search) ----------
let anthropic;
export async function askAnthropic(prompt) {
  // SOLESTATS_ANTHROPIC_KEY first: cloud sessions refuse to pass a variable named ANTHROPIC_API_KEY (it would
  // collide with Claude Code's own sign-in). Without it the SDK falls back to ANTHROPIC_API_KEY, which works on a PC.
  anthropic ||= new Anthropic({ apiKey: process.env.SOLESTATS_ANTHROPIC_KEY || undefined });
  const model = process.env.SOLESTATS_ANTHROPIC_MODEL || 'claude-opus-5-5';
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];
  const messages = [{ role: 'user', content: prompt }];
  let response, usage = { input: 0, output: 0, cached: 0 }, hops = 0, searches = 0;
  const responses = [], blocks = [];
  // A long server-tool turn can pause; resend the same messages plus the assistant content to resume (at most 3 times).
  for (;;) {
    response = await anthropic.messages.create({ model, max_tokens: 4000, system: SYSTEM, tools, messages });
    responses.push(response); blocks.push(...response.content);
    usage.input += response.usage.input_tokens + (response.usage.cache_read_input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0);
    usage.output += response.usage.output_tokens; usage.cached += response.usage.cache_read_input_tokens || 0;
    searches += response.usage.server_tool_use?.web_search_requests ?? response.content.filter(b => b.type === 'server_tool_use' && b.name === 'web_search').length;
    if (response.stop_reason !== 'pause_turn' || ++hops > 3) break;
    messages.push({ role: 'assistant', content: response.content });
  }
  const texts = [], citations = [], searched = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      texts.push(block.text);
      for (const c of block.citations || []) if (c.url) citations.push({ url: c.url, title: c.title || '' });
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === 'web_search_result' && r.url) searched.push({ url: r.url, title: r.title || '' });
    }
  }
  // Text blocks are segments of one answer: join with nothing, or line breaks appear mid-sentence.
  return { model: response.model, answer: texts.join(''), citations: dedupe(citations), searched: dedupe(searched), searches, raw: responses.length === 1 ? response : responses, input_tokens: usage.input, output_tokens: usage.output, cached_tokens: usage.cached, stop_reason: response.stop_reason };
}

// ---------- OpenAI Responses API with the web_search tool ----------
export async function askOpenAI(prompt) {
  const model = process.env.SOLESTATS_OPENAI_MODEL || 'gpt-5';
  const res = await post('https://api.openai.com/v1/responses', { Authorization: `Bearer ${need('OPENAI_API_KEY')}` }, {
    model, instructions: SYSTEM, input: prompt, tools: [{ type: 'web_search' }], max_output_tokens: 4000,
    include: ['web_search_call.action.sources'],
  });
  const texts = [], citations = [], searched = [];
  let searches = 0;
  for (const item of res.output || []) {
    if (item.type === 'web_search_call') { searches++; for (const src of item.action?.sources || []) if (src.url) searched.push({ url: src.url, title: src.title || '' }); continue; }
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type !== 'output_text') continue;
      texts.push(part.text);
      for (const a of part.annotations || []) if (a.type === 'url_citation' && a.url) citations.push({ url: a.url, title: a.title || '' });
    }
  }
  return { model: res.model || model, answer: texts.join(''), citations: dedupe(citations), searched: dedupe(searched), searches, raw: res, input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens, cached_tokens: res.usage?.input_tokens_details?.cached_tokens || 0, stop_reason: res.status };
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
  const searches = cand.groundingMetadata?.webSearchQueries?.length || 0;
  return { model: res.modelVersion || model, answer, citations: dedupe(citations), searched: [], searches, raw: res, input_tokens: res.usageMetadata?.promptTokenCount, output_tokens: res.usageMetadata?.candidatesTokenCount, stop_reason: cand.finishReason };
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
  return { model: res.model || model, answer, citations: dedupe(citations), searched: [], searches: 1, raw: res, input_tokens: res.usage?.prompt_tokens, output_tokens: res.usage?.completion_tokens, stop_reason: res.choices?.[0]?.finish_reason };
}

export const ENGINES = { anthropic: askAnthropic, openai: askOpenAI, gemini: askGemini, perplexity: askPerplexity };

// Rough list prices, for the running cost shown during a round. Not billing. input/output per million tokens;
// search per web search (billed on top of tokens). Note the web search tool adds a few thousand input tokens of
// scaffolding to every Anthropic call, searched or not.
export const PRICES = {
  anthropic: { input: 4, output: 20, search: 0.01 }, openai: { input: 2, output: 8, search: 0.01 }, gemini: { input: 0.3, output: 2.5, search: 0.035 }, perplexity: { input: 1, output: 1, search: 0.005 },
};
export function estimateCost(engine, inTok = 0, outTok = 0, searches = 0, cachedTok = 0) {
  const p = PRICES[engine] || { input: 0, output: 0, search: 0 };
  const cached = Math.min(cachedTok || 0, inTok || 0); // cached input is billed at about a tenth
  return ((inTok - cached) * p.input + cached * p.input * 0.1 + outTok * p.output) / 1e6 + searches * (p.search || 0);
}

function need(name) { const v = process.env[name]; if (!v) throw new Error(`${name} is not set`); return v; }
function dedupe(cs) { const seen = new Set(); return cs.filter(c => c.url && !seen.has(c.url) && seen.add(c.url)); }
async function post(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  // Keep enough of an error body to see Google's quota details (they sit past the first 500 characters).
  if (!r.ok) throw new Error(`${url} -> ${r.status}: ${text.slice(0, 2500)}`);
  return JSON.parse(text);
}
