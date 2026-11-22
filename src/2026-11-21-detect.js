// Pure functions that read an engine's answer: which brands it names, in what order, which it picks first,
// what it cites and where it sends the shopper. Every result is reviewable by hand; nothing here is final.

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The answer without link markup: OpenAI writes citations into the text as "([rei.com](https://...))", which would
 * otherwise read as the answer naming REI. Citation parentheticals go entirely, as do links whose text is only a domain
 * and bare URLs; other links keep their text.
 */
export function stripLinks(text) {
  return (text || '')
    .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)(?:\s*,\s*\[[^\]]*\]\([^)]*\))*\s*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (m, t) => /^[\w.-]+\.[a-z]{2,}$/i.test(t.trim()) ? '' : t) // "[rei.com](...)" is a citation, not prose
    .replace(/<https?:[^>]+>/g, '')
    .replace(/https?:\/\/[^\s)\]]+/g, '');
}

/** One url per page: no tracking parameters (utm_*, openai's source tag), no fragment, no trailing slash. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k) || k === 'ref' || k === 'source') u.searchParams.delete(k);
    u.hash = '';
    let s = u.toString();
    if (u.pathname.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    return s.replace(/\?$/, '');
  } catch { return url; }
}

// Brands whose name is an ordinary English word need a word boundary and the right case.
const CASE_SENSITIVE = new Set(['on', 'sole-fitness', 'naked', 'polar', 'spring-energy']);

/** Build matchers once per brand list. aliases is "; separated" in the CSV. */
export function brandMatchers(brands) {
  return brands.map(b => {
    const names = [b.name, ...(b.aliases ? b.aliases.split(';') : [])].map(s => s.trim()).filter(Boolean);
    const flags = CASE_SENSITIVE.has(b.slug) ? 'g' : 'gi';
    // "On" alone is too common a word: require "On Running", "On Cloud..." or "On's" style use.
    const patterns = b.slug === 'on'
      ? [/\bOn Running\b/g, /\bOn Cloud\w*/g, /\bOn's\b/g, /\bOn \(the brand\)/g, /\bCloud(?:monster|surfer|runner|eclipse|ultra|boom|swift|stratus|flow|go|vista)\w*/g,
         // "On" bare in a list of brands ("Hoka, Brooks, On, Altra", "(Hoka, On)") or "On (Cloud line)"; capital O only.
         /(?<=(?:[,(]\s?|\b(?:and|or)\s))On(?=\s?[,)]|\s(?:and|or)\s[A-Z]|\.?$|\s*\n)/gm, /\bOn(?=\s\(Cloud)/g]
      : names.map(n => new RegExp('\\b' + escapeRe(n) + '\\b', flags));
    return { slug: b.slug, category: b.category, patterns };
  });
}

/** Brands mentioned in an answer, ordered by first appearance. */
export function findMentions(answer, matchers) {
  const found = [];
  for (const m of matchers) {
    let first = Infinity;
    for (const re of m.patterns) {
      re.lastIndex = 0;
      const hit = re.exec(answer);
      if (hit && hit.index < first) first = hit.index;
    }
    if (first !== Infinity) found.push({ slug: m.slug, category: m.category, at: first });
  }
  found.sort((a, b) => a.at - b.at);
  return found.map((f, i) => ({ brand_slug: f.slug, category: f.category, position: i + 1, top_pick: i === 0 ? 1 : 0 }));
}

// Phrases that introduce an explicit recommendation. The brand named right after one of these is the top pick.
const VERDICT = /(?:i(?:'d| would) (?:go with|pick|choose|recommend|start with|buy)|my (?:top )?(?:pick|recommendation|choice)(?: would be| is|:)|(?:the )?(?:best|safest) (?:overall|choice|bet|pick|option)(?: is| would be|:)|if you (?:can )?only (?:buy|get|own|pick) one(?: pair| shoe)?(?:[,:]| is| would be| go with| get)|(?:^|\n)\**(?:top pick|best overall|our pick|my pick|verdict)\**:?\s*|start with(?: the)?|go with(?: the)?)\s*(?:the\s+)?([^\n.;]{1,80})/gi;

/**
 * Which mentioned brand the answer actually recommends: the first brand named after an explicit verdict phrase,
 * otherwise the first brand mentioned. Returns a new mentions array with top_pick set on exactly one entry.
 * (First mention alone is skewed by quoted snippets that name several brands before the model's own pick.)
 */
export function markTopPick(answer, mentions, matchers) {
  if (!mentions.length) return mentions;
  let pick = null;
  VERDICT.lastIndex = 0;
  let m;
  while (!pick && (m = VERDICT.exec(answer))) {
    const tail = m[1];
    let best = null;
    for (const mm of matchers) {
      if (!mentions.some(x => x.brand_slug === mm.slug)) continue;
      for (const re of mm.patterns) {
        const hit = new RegExp(re.source, re.flags.replace('g', '')).exec(tail);
        if (hit && (!best || hit.index < best.at)) best = { slug: mm.slug, at: hit.index };
      }
    }
    if (best) pick = best.slug;
  }
  const slug = pick || mentions[0].brand_slug;
  return mentions.map(x => ({ ...x, top_pick: x.brand_slug === slug ? 1 : 0 }));
}

/** Head-to-head: which of the two named brands the answer recommends. Returns a slug, 'tie' or 'unclear'. */
export function pickWinner(answer, a, b, matchers) {
  // Markdown off first: "I'd pick **Brooks**" must read as "I'd pick Brooks" (2026-11-22: 57% of head-to-head answers
  // were "unclear", mostly because bold names and "I'd buy the..." went unmatched).
  const plainText = String(answer || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '');
  const text = plainText.toLowerCase();
  const byName = s => matchers.find(m => m.slug === s);
  // Count distinct places the brand is named (aliases can overlap, so count positions, not pattern hits).
  const count = s => { const m = byName(s); if (!m) return 0; const at = new Set(); for (const re of m.patterns) { re.lastIndex = 0; let h; while ((h = re.exec(plainText))) at.add(h.index); } return at.size; };
  // Does a short phrase (lowercase, right after a verdict) start with this brand's name?
  const names = { [a]: byName(a), [b]: byName(b) };
  const leads = (s, phrase) => {
    const mm = names[s];
    if (!mm) return false;
    if (s === 'on') return /^on(?:\b(?![-\s](?:a|the|your|my|its)\b)|\s+cloud|\s+running)/.test(phrase);
    return mm.patterns.some(re => new RegExp('^(?:' + re.source + ')', 'i').test(phrase));
  };
  // Strong signals first: an explicit verdict naming one brand of the pair; the first one wins (later "...instead if"
  // lines are the conditional alternative).
  const verdict = /(?:i(?:'d|’d| would) (?:go with|pick|choose|recommend|buy|get|start with|lean(?: toward| towards)?|take)|my (?:pick|recommendation|vote|choice)(?: would be| is| goes to)?:?|for most (?:people|runners|daily runners)[^.]{0,40}?(?:go with|pick|choose|get|buy)|the (?:better|safer|best) (?:choice|bet|pick|default)(?: for most (?:people|runners))?(?: is| would be)|winner:?)\s+(?:the\s+|an?\s+)?([a-z][a-z .'’-]{1,24})/g;
  let m;
  while ((m = verdict.exec(text))) {
    const hits = [a, b].filter(s => leads(s, m[1].trim()));
    if (hits.length === 1) return hits[0];
  }
  if (/\b(?:it depends|both are|either (?:is|would)|can't go wrong with either|tie)\b/.test(text)) return 'tie';
  const ca = count(a), cb = count(b);
  if (ca > cb * 1.5) return a;
  if (cb > ca * 1.5) return b;
  return 'unclear';
}

const REVIEW_DOMAINS = ['runrepeat.com', 'believeintherun.com', 'doctorsofrunning.com', 'runnersworld.com', 'irunfar.com', 'roadtrailrun.com', 'outsideonline.com', 'wired.com', 'nytimes.com', 'gearlab.com', 'outdoorgearlab.com', 'dcrainmaker.com', 'the5krunner.com', 'rtings.com', 'tomsguide.com', 'cnet.com', 'runningshoesguru.com', 'marathonhandbook.com', 'fleetfeet.com/blog', 'verywellfit.com', 'garagegymreviews.com', 'treadmillreviewguru.com', 'theshoesnob.com', 'solereview.com', 'wearable.com', 'wareable.com', 'livestrong.com', 'womensrunning.com', 'trailrunnermag.com', 'triathlete.com', 'si.com', 'gq.com', 'menshealth.com', 'womenshealthmag.com', 'shape.com', 'cnn.com', 'businessinsider.com', 'nbcnews.com', 'today.com', 'goodhousekeeping.com', 'popsci.com', 'reviewed.com', 'forbes.com', 'theverge.com', 'engadget.com', 'techradar.com', 'runningwarehouse.com/learningcenter'];
const FORUM_DOMAINS = ['reddit.com', 'letsrun.com', 'slowtwitch.com', 'quora.com', 'youtube.com', 'strava.com', 'facebook.com', 'tiktok.com', 'instagram.com', 'x.com', 'twitter.com', 'medium.com', 'substack.com'];

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Gemini's grounding links are Google redirects that hide the site; the grounding chunk's title carries the site's
// domain (e.g. "runrepeat.com"), so that is read instead (found in round 2026-11: 251 of 1,336 named sources).
const REDIRECT_HOSTS = ['vertexaisearch.cloud.google.com'];
const HOST_LIKE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/;

/** The site a cited link points to: its hostname, or for a known redirect the domain given in its title. */
export function citedDomain(url, title = '') {
  const domain = domainOf(url);
  const t = String(title).trim().toLowerCase().replace(/^www\./, '');
  if (REDIRECT_HOSTS.includes(domain) && HOST_LIKE.test(t)) return t;
  return domain;
}

const onDomain = (domain, d) => domain === d || domain.endsWith('.' + d);
const list = s => (s || '').split(';').map(x => x.trim().toLowerCase()).filter(Boolean);
// A country or region subdomain of a brand's site (au.hoka.com, eu.altrarunning.com, emea-support.brooksrunning.com).
// "us" is the US site.
const REGION_LABEL = /^(?!us(?:-|$))(?:[a-z]{2}|eu|emea|apac|latam)(?:-|$)/;

/** Whether a domain is one of the brand's own sites, and whether it is a non-US one (Alex, 2026-11-21: non-US sites
 *  count as the brand's own, and are called out). Own sites: `domain` and `own_domains`; non-US: `intl_domains`
 *  and country subdomains of the others. */
export function brandSite(domain, brand) {
  for (const d of [brand.domain, ...list(brand.own_domains)].filter(Boolean)) {
    if (onDomain(domain, d)) return { intl: domain !== d && REGION_LABEL.test(domain.slice(0, -d.length - 1).split('.').pop()) };
  }
  for (const d of list(brand.intl_domains)) if (onDomain(domain, d)) return { intl: true };
  return null;
}

/** Classify a cited URL: brand | retailer | review | forum | other. Brand and retailer lookups come from the CSVs.
 *  Pass the citation's title so a redirect link is classified by the site it stands for. A brand site carries
 *  `intl: true` when it is a non-US one. */
export function classifyCitation(url, brands, retailers, title = '') {
  const domain = citedDomain(url, title);
  if (!domain) return { domain: '', kind: 'other' };
  const full = domain === domainOf(url) ? url.toLowerCase() : domain;
  for (const b of brands) {
    const own = brandSite(domain, b);
    if (own) return own.intl ? { domain, kind: 'brand', brand_slug: b.slug, intl: true } : { domain, kind: 'brand', brand_slug: b.slug };
  }
  for (const r of retailers) {
    for (const d of (r.domains || '').split(';').map(s => s.trim()).filter(Boolean)) {
      if (domain === d || domain.endsWith('.' + d)) return { domain, kind: 'retailer', retailer_slug: r.slug };
    }
  }
  if (REVIEW_DOMAINS.some(d => full.includes(d))) return { domain, kind: 'review' };
  if (FORUM_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) return { domain, kind: 'forum' };
  return { domain, kind: 'other' };
}

/** Where the answer sends the shopper: retailers named in the text, plus retailer and brand-site citations the answer
 *  attributed. Pages a search merely returned are not routes. A brand-site route from a citation carries the brand
 *  whose site it is (brand_slug); one found only in the prose ("the brand's own website") carries none and stands
 *  for every brand the answer names. */
export function findRoutes(answer, citations, brands, retailers) {
  const routes = new Map();
  const put = (slug, url, brandSlug = null) => { const key = slug + '|' + (brandSlug || ''); if (!routes.has(key)) routes.set(key, { retailer_slug: slug, brand_slug: brandSlug, url: url || null }); };
  for (const r of retailers) {
    if (r.slug === 'local' || r.slug === 'brand-site') continue;
    const re = new RegExp('\\b' + escapeRe(r.name.replace(/'s Sporting Goods$/, "'s")) + '\\b', 'i');
    if (re.test(answer)) put(r.slug);
  }
  if (/\b(local|specialty|independent|your nearest|brick[- ]and[- ]mortar) (running|run) (store|shop|retailer)\b/i.test(answer) || /\brun(?:ning)? specialty\b/i.test(answer)) put('local');
  if (/\b(brand'?s? (?:own )?(?:web)?site|direct from (?:the brand|[A-Z][a-z]+)|\.com directly|manufacturer'?s site)\b/i.test(answer)) put('brand-site');
  for (const c of citations || []) {
    const k = classifyCitation(c.url, brands, retailers, c.title);
    if (k.kind === 'retailer') put(k.retailer_slug, c.url);
    if (k.kind === 'brand') put('brand-site', c.url, k.brand_slug);
  }
  return [...routes.values()];
}
