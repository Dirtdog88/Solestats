// Tier 2 extraction (the CMO brief, 2026-11-22): one pass over the stored answers, no AI calls. Pure functions; the
// score script runs them and stores what they return in the views table. Phrase and model lists live in data files
// reviewed by hand (data/2026-11-22-model-aliases.csv, data/2026-11-22-attributes.csv).

const round1 = x => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? (100 * a) / b : 0);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An answer as plain prose: link targets, emphasis and heading marks out, so names match the way a reader sees them. */
export function plainText(answer) {
  return String(answer || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '');
}

// A version after a model name: "Ghost 17", "Kayano 32", "1080v14", "880 v15", "Speedgoat 6", "Clifton 10".
const VERSION = String.raw`(?:\s?v?(\d{1,2}))?(?![\w-])`;

/**
 * Matchers for the spec sheet's models. Names and aliases match case-insensitively on word edges, longest first, so
 * "Pegasus Trail" is not also a "Pegasus". A model marked needs_context in the aliases file (a common word such as
 * Ride, Guide or Structure) counts only with its brand's name just before it or a version number just after.
 * Returns [{ id, brand_slug, name, re, context }].
 */
export function modelMatchers(models, aliases, brands) {
  const al = Object.fromEntries((aliases || []).map(a => [a.id, a]));
  const brandNames = Object.fromEntries((brands || []).map(b => [b.slug, [b.name, ...String(b.aliases || '').split(';').filter(Boolean)]]));
  const out = [];
  for (const m of models) {
    const a = al[m.id] || {};
    const names = [...new Set([m.name, ...String(a.aliases || '').split(';').map(s => s.trim()).filter(Boolean)])];
    // Only a one-word name needs context ("Boston"); "Adizero Boston" stands on its own.
    for (const n of names) out.push({ id: m.id, brand_slug: m.brand_slug, name: m.name, alias: n, context: a.needs_context === '1' && !/[\s-]/.test(n), brandNames: brandNames[m.brand_slug] || [] });
  }
  out.sort((x, y) => y.alias.length - x.alias.length);
  for (const o of out) {
    // A common word must be written as a name (capitalised) to count; other names match in any case.
    o.re = new RegExp(String.raw`(?<![\w-])${esc(o.alias).replace(/[\s-]+/g, '[\\s-]?')}${VERSION}`, o.context ? 'g' : 'gi');
    o.brandBefore = o.brandNames.length ? new RegExp(String.raw`(?:${o.brandNames.map(esc).join('|')})(?:'s)?[\s-]+(?:\w+[\s-]+)?$`, 'i') : null;
  }
  return out;
}

/** The models named in one answer: [{ id, brand_slug, name, versions: [n] }], each model once, versions as named. */
export function modelsIn(answer, matchers) {
  let text = plainText(answer);
  const found = {};
  for (const m of matchers) {
    text = text.replace(m.re, (whole, version, offset) => {
      if (m.context && !version && !(m.brandBefore && m.brandBefore.test(text.slice(Math.max(0, offset - 40), offset)))) return whole;
      const f = (found[m.id] ||= { id: m.id, brand_slug: m.brand_slug, name: m.name, versions: [] });
      if (version && !f.versions.includes(Number(version))) f.versions.push(Number(version));
      return ' '.repeat(whole.length); // a longer name, once matched, is not matched again as a shorter one
    });
  }
  return Object.values(found);
}

/**
 * Model mentions per brand: of the answers that name the brand, the share naming each of its models, the versions
 * named, and the other brand's model most often named in the same answers. Answers to the shoe and head-to-head
 * prompts. Returns { slug: { answers, models: [{ id, name, answers, share, versions: [{ version, answers }], beside }] } }
 * and, under '', the models per head-to-head prompt for the /h2h page.
 */
export function modelView(runs, prompts, matchers, brandSlugs) {
  const sets = Object.fromEntries(prompts.map(p => [p.id, p.set_name || p.set]));
  const rel = runs.filter(r => r.status === 'ok' && ['shoe', 'h2h'].includes(sets[r.prompt_id])).map(r => ({ r, models: modelsIn(r.answer, matchers) }));
  const out = {};
  for (const slug of brandSlugs) {
    const mine = rel.filter(x => (x.r.mentions || []).some(m => m.brand_slug === slug));
    const per = {};
    for (const x of mine) for (const m of x.models.filter(m => m.brand_slug === slug)) {
      const p = (per[m.id] ||= { id: m.id, name: m.name, answers: 0, versions: {}, beside: {} });
      p.answers++;
      for (const v of m.versions) p.versions[v] = (p.versions[v] || 0) + 1;
      for (const o of x.models.filter(o => o.brand_slug !== slug)) p.beside[o.id] = (p.beside[o.id] || 0) + 1;
    }
    const names = Object.fromEntries(matchers.map(m => [m.id, { name: m.name, brand_slug: m.brand_slug }]));
    out[slug] = {
      answers: mine.length,
      models: Object.values(per).sort((a, b) => b.answers - a.answers || a.name.localeCompare(b.name)).map(p => {
        const [bid, bn] = Object.entries(p.beside).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [];
        return { id: p.id, name: p.name, answers: p.answers, share: round1(pct(p.answers, mine.length)),
          versions: Object.entries(p.versions).map(([v, n]) => ({ version: Number(v), answers: n })).sort((a, b) => b.answers - a.answers || b.version - a.version),
          beside: bid ? { id: bid, name: names[bid].name, brand_slug: names[bid].brand_slug, answers: bn } : null };
      }),
    };
  }
  const h2h = {};
  for (const x of rel.filter(x => sets[x.r.prompt_id] === 'h2h')) for (const m of x.models) {
    const p = ((h2h[x.r.prompt_id] ||= {})[m.id] ||= { id: m.id, name: m.name, brand_slug: m.brand_slug, answers: 0 });
    p.answers++;
  }
  out[''] = { h2h: Object.fromEntries(Object.entries(h2h).map(([pid, ms]) => [pid, Object.values(ms).sort((a, b) => b.answers - a.answers)])) };
  return out;
}
