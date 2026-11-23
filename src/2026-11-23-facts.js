// Accurate (2026-11-23): short fact questions built from the confirmed spec sheet, and the grader that marks each answer
// right, wrong or not sure against it. Pure: the runner (scripts/2026-11-23-facts.js) does the calls and the files.
// Tolerances (Alex, 2026-11-23): carbs within 1 g, caffeine exact, sodium and price within 10%, vegan exact.
// A blank cell in the spec sheet means the fact is not asked (for example caffeine that differs by flavour).

const pct = p => v => Math.abs(v) * p;
export const FACTS = {
  gels: {
    carbs_g: { unit: /g(?:rams?)?\b/i, tol: () => 1, q: n => `How many grams of carbohydrate are in one ${n}? Start your answer with the number.` },
    caffeine_mg: { unit: /mg\b|milligrams?\b/i, tol: () => 0, zero: /\b(no caffeine|caffeine[- ]free|non[- ]caffeinated|(?:does not|doesn't|do not|don't) contain (?:any )?caffeine|zero caffeine|isn't caffeinated|is not caffeinated|0\s?mg)\b/i, q: n => `How much caffeine is in one ${n}? Start your answer with the amount in milligrams.` },
    sodium_mg: { unit: /mg\b|milligrams?\b/i, tol: pct(0.10), q: n => `How much sodium is in one ${n}? Start your answer with the amount in milligrams.` },
    price_usd: { price: true, tol: pct(0.10), q: n => `What does a single ${n} cost in the US? Start your answer with the price.` },
    vegan: { yesno: true, q: n => `Is ${n} vegan? Start your answer with yes or no.` },
  },
};

/** The product's name as a shopper would type it: the brand in front unless the name already starts with it. */
export function askName(product, brandName) {
  const first = String(brandName).split(/\s+/)[0].toLowerCase();
  return String(product.name).toLowerCase().startsWith(first) ? product.name : `${brandName} ${product.name}`;
}

/** One question per confirmed fact: [{ model_id, brand_slug, fact, question, expected }]. */
export function factQuestions(specRows, brands, category) {
  const facts = FACTS[category] || {};
  const name = Object.fromEntries(brands.map(b => [b.slug, b.name]));
  const out = [];
  for (const r of specRows.filter(r => r.verified_on)) {
    for (const [fact, f] of Object.entries(facts)) {
      const v = r[fact];
      if (v == null || String(v).trim() === '') continue;
      out.push({ model_id: r.id, brand_slug: r.brand_slug, fact, question: f.q(askName(r, name[r.brand_slug] || '')), expected: f.yesno ? String(v).trim().toLowerCase() : Number(v) });
    }
  }
  return out;
}

const plain = t => String(t || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim();

/** Mark one answer: { result: 'right' | 'wrong' | 'not_sure', found }. Reads the opening of the answer, where the
 *  question asked for the figure; a range counts as right when the true value is inside it (within tolerance). */
export function gradeFact(category, fact, answer, expected) {
  const f = (FACTS[category] || {})[fact];
  if (!f) return { result: 'not_sure', found: null };
  const head = plain(answer).slice(0, 400);
  if (f.yesno) {
    const m = head.match(/^(yes|no)\b/i) || head.match(/\b(?:is|are) (not )?vegan\b/i);
    if (!m) return { result: 'not_sure', found: null };
    const said = m[1] && /^(yes|no)$/i.test(m[1]) ? m[1].toLowerCase() : (m[1] ? 'no' : 'yes');
    return { result: said === expected ? 'right' : 'wrong', found: said };
  }
  let lo = null, hi = null;
  if (f.zero && f.zero.test(head.slice(0, 160))) lo = hi = 0;
  if (lo == null) {
    const n = '(\\d+(?:\\.\\d+)?)';
    const re = f.price
      ? new RegExp(`\\$\\s?${n}(?:\\s?(?:-|–|—|to)\\s?\\$?\\s?${n})?`)
      : new RegExp(`${n}(?:\\s?(?:-|–|—|to)\\s?${n})?\\s?(?:${f.unit.source})`, 'i');
    const m = head.match(re);
    if (m) { lo = Number(m[1]); hi = m[2] != null ? Number(m[2]) : lo; }
  }
  if (lo == null) return { result: 'not_sure', found: null };
  const tol = f.tol(expected);
  const ok = expected >= Math.min(lo, hi) - tol && expected <= Math.max(lo, hi) + tol && (hi - lo) <= Math.max(2 * tol, tol + 2);
  return { result: ok ? 'right' : 'wrong', found: lo === hi ? lo : `${lo}-${hi}` };
}
