// Pure helpers for race results: which watched brand a named shoe brand is, and the per-brand counts the site shows.

/** The watched brand's slug for a brand name as written in a source ("ASICS", "HOKA", "New Balance"), else null. */
export function brandSlugFor(name, brands) {
  const n = String(name || '').trim().toLowerCase().replace(/[®™]/g, '').replace(/\s+/g, ' ');
  if (!n) return null;
  for (const b of brands) {
    const names = [b.name, ...(b.aliases ? b.aliases.split(';') : [])].map(x => x.trim().toLowerCase()).filter(Boolean);
    if (names.includes(n) || n === b.slug.replace(/-/g, ' ')) return b.slug;
  }
  return null;
}

/**
 * Counts per brand over a set of top-10 results: top-10 places, podiums (top 3) and wins, how many rest on a race-day
 * source rather than a sponsor, and the brand's share of the top-10 places whose shoe brand is confirmed. Brands
 * outside the watch list are keyed by their name.
 */
export function brandCounts(results) {
  const known = results.filter(r => r.brand);
  const out = {};
  for (const r of known) {
    const key = r.brand_slug || 'other:' + r.brand;
    const c = out[key] ||= { key, slug: r.brand_slug || null, name: r.brand, top10: 0, podiums: 0, wins: 0, worn: 0 };
    c.top10++;
    if (r.place <= 3) c.podiums++;
    if (r.place === 1) c.wins++;
    if (r.basis === 'worn') c.worn++;
  }
  for (const c of Object.values(out)) c.top10_share = known.length ? Math.round(1000 * c.top10 / known.length) / 10 : null;
  return { brands: Object.values(out).sort((a, b) => b.top10 - a.top10 || b.podiums - a.podiums || b.wins - a.wins), places: results.length, known: known.length, races: new Set(results.map(r => `${r.race} ${r.year} ${r.gender}`)).size };
}

/** Whether a source page names both the athlete (by surname, accents ignored) and the brand, outside scripts and tags. */
export function claimFound(html, athlete, brand) {
  const plain = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const t = plain(String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'"));
  const surname = plain(athlete).trim().split(/\s+/).pop();
  const b = plain(brand).replace(/\s+/g, '\\s*');
  return Boolean(surname) && t.includes(surname) && new RegExp('\\b' + b + '\\b').test(t);
}
