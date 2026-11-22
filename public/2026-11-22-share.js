// Share of voice beside revenue (Alex, 2026-11-22). Two scatter charts and a table:
//   1. share of voice (y) against reported revenue in US dollars on a log scale (x). Market share is not public for
//      running shoes, so revenue scale stands in; filled dots are brand or running figures, rings are broader ones
//      (footwear, segment or whole company), which overstate the running business.
//   2. change in share of voice since the previous round (y) against reported revenue growth (x). Empty until there
//      are two rounds.
// Built with the DOM and SVG elements (no innerHTML, no inline styles: CSP).
import { el, api, engineName, showEdition, defined, installTips, money } from './2026-11-21-common.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); for (const k of kids) n.append(k); return n; };
const NARROW = new Set(['brand', 'category']);
const LEVEL_WORD = { brand: 'brand', category: 'running category', footwear: 'all footwear', segment: 'segment', company: 'whole company' };
const usd = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);
const pct1 = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const pts = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} pts`;

/** A scatter chart: x and y scales, gridlines, axis labels, a dot per point with a larger hit target, a direct name
 *  label where it fits, and a readout line that hover, focus or tap fills. */
function scatter(host, readout, points, { x, y, xTicks, yTicks, xFmt, yFmt, xLabel, yLabel, zeroX = false, zeroY = false, diagonal = false, describe }) {
  const W = Math.max(320, Math.min(host.clientWidth || 640, 900)), H = Math.round(Math.min(460, Math.max(300, W * 0.62)));
  const m = { l: 46, r: 14, t: 12, b: 46 };
  const sx = v => m.l + (x.log ? (Math.log10(v) - Math.log10(x.min)) / (Math.log10(x.max) - Math.log10(x.min)) : (v - x.min) / (x.max - x.min)) * (W - m.l - m.r);
  const sy = v => H - m.b - (v - y.min) / (y.max - y.min) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${yLabel} against ${xLabel}`, class: 'scatter' });
  for (const t of yTicks) svg.append(s('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: 'grid' }), s('text', { x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'tick' }, yFmt(t)));
  xTicks.forEach((t, i) => svg.append(s('line', { x1: sx(t), x2: sx(t), y1: m.t, y2: H - m.b, class: 'grid' }), s('text', { x: sx(t), y: H - m.b + 18, 'text-anchor': i === xTicks.length - 1 ? 'end' : i === 0 && x.log ? 'start' : 'middle', class: 'tick' }, xFmt(t))));
  if (zeroX) svg.append(s('line', { x1: sx(0), x2: sx(0), y1: m.t, y2: H - m.b, class: 'zero' }));
  if (zeroY) svg.append(s('line', { x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0), class: 'zero' }));
  if (diagonal) { const top = Math.min(x.max, y.max); svg.append(s('line', { x1: sx(0), y1: sy(0), x2: sx(top), y2: sy(top), class: 'zero diag' }), s('text', { x: sx(top) - 4, y: sy(top) + 14, 'text-anchor': 'end', class: 'tick' }, 'equal shares')); }
  svg.append(s('text', { x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, xLabel));
  svg.append(s('text', { x: 12, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${(m.t + H - m.b) / 2})`, class: 'axis-label' }, yLabel));
  // Labels: right of the dot, else left, else above, else below; skipped when none fits (the readout and table carry it).
  const boxes = [];
  const fits = b => b.x1 >= m.l && b.x2 <= W - m.r && b.y1 >= m.t && b.y2 <= H - m.b && !boxes.some(o => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
  const placed = [...points].sort((a, b) => b.weight - a.weight);
  for (const p of placed) { p.cx = sx(p.x); p.cy = sy(p.y); boxes.push({ x1: p.cx - 6, x2: p.cx + 6, y1: p.cy - 6, y2: p.cy + 6 }); }
  const show = p => { readout.textContent = describe(p); };
  for (const p of placed) {
    const g = s('g', { class: 'pt', tabindex: 0, role: 'button', 'aria-label': describe(p) });
    g.append(s('circle', { cx: p.cx, cy: p.cy, r: 12, class: 'hit' }), s('circle', { cx: p.cx, cy: p.cy, r: 5, class: p.filled ? 'dot' : 'dot ring' }));
    const w = p.label.length * 7.2 + 4;
    const tries = [[p.cx + 9, p.cy + 4, 'start', { x1: p.cx + 8, x2: p.cx + 9 + w, y1: p.cy - 8, y2: p.cy + 7 }], [p.cx - 9, p.cy + 4, 'end', { x1: p.cx - 9 - w, x2: p.cx - 8, y1: p.cy - 8, y2: p.cy + 7 }], [p.cx, p.cy - 11, 'middle', { x1: p.cx - w / 2, x2: p.cx + w / 2, y1: p.cy - 23, y2: p.cy - 8 }], [p.cx, p.cy + 21, 'middle', { x1: p.cx - w / 2, x2: p.cx + w / 2, y1: p.cy + 8, y2: p.cy + 24 }]];
    const at = tries.find(t => fits(t[3]));
    if (at) { boxes.push(at[3]); g.append(s('text', { x: at[0], y: at[1], 'text-anchor': at[2], class: 'pt-label' }, p.label)); }
    for (const ev of ['mouseenter', 'focus', 'click']) g.addEventListener(ev, () => show(p));
    svg.append(g);
  }
  host.replaceChildren(svg);
  readout.textContent = 'Hover or tap a dot for its numbers.';
}

function niceMax(v, step) { return Math.max(step, Math.ceil(v / step) * step); }

async function main() {
  installTips();
  showEdition();
  const health = await api('/api/health').catch(() => ({}));
  if (health.notice) { const n = document.getElementById('notice'); n.textContent = health.notice; n.hidden = false; }
  const d = await api('/api/share-of-voice').catch(() => ({ brands: [] }));
  const brands = d.brands || [];

  // Chart 1: share of voice against revenue scale.
  document.getElementById('h-scale').replaceChildren(defined('span', 'sov', { text: 'Share of voice' }), ' against ', defined('span', 'revenue_scale', { text: 'reported revenue' }));
  document.getElementById('legend-scale').replaceChildren(
    el('span', { class: 'key' }, el('span', { class: 'swatch' }), 'brand or running figure'),
    el('span', { class: 'key' }, el('span', { class: 'swatch ring' }), 'footwear, segment or whole-company figure'));
  const p1 = brands.filter(b => b.sov != null && b.revenue && b.revenue.usd).map(b => ({ label: b.name, x: b.revenue.usd, y: b.sov, weight: b.sov, filled: NARROW.has(b.revenue.level), b }));
  const ymax1 = niceMax(Math.max(0, ...p1.map(p => p.y)) * 1.1, 5);
  const lo = Math.min(...p1.map(p => p.x), 1e9), hi = Math.max(...p1.map(p => p.x), 1e9);
  const xmin = 10 ** Math.floor(Math.log10(lo)), xmax = 10 ** Math.ceil(Math.log10(hi));
  const xt = []; for (let v = xmin; v <= xmax; v *= 10) xt.push(v);
  if (p1.length) scatter(document.getElementById('chart-scale'), document.getElementById('readout-scale'), p1, {
    x: { min: xmin, max: xmax, log: true }, y: { min: 0, max: ymax1 }, xTicks: xt, yTicks: Array.from({ length: ymax1 / 5 + 1 }, (_, i) => i * 5),
    xFmt: usd, yFmt: v => `${v}%`, xLabel: 'Reported revenue, US dollars (log scale)', yLabel: 'Share of voice',
    describe: p => `${p.b.name}: share of voice ${p.b.sov.toFixed(1)}%${p.b.sov_margin != null ? ` ±${p.b.sov_margin.toFixed(1)}` : ''}; ${p.b.revenue.measure} ${money(p.b.revenue.value, p.b.revenue.unit, p.b.revenue.currency)}${p.b.revenue.currency !== 'USD' ? ` (about ${usd(p.b.revenue.usd)})` : ''}, ${p.b.revenue.fiscal_year}, ${LEVEL_WORD[p.b.revenue.level] || p.b.revenue.level}.`,
  });
  else document.getElementById('chart-scale').replaceChildren(el('p', { class: 'empty' }, 'No data yet.'));
  const missing = brands.filter(b => b.sov != null && !(b.revenue && b.revenue.usd));
  document.getElementById('missing-scale').textContent = missing.length ? `Not plotted, no reported revenue amount: ${missing.map(b => `${b.name} (${b.sov.toFixed(1)}%)`).join(', ')}.` : '';

  // Chart 2: share-of-voice change against revenue growth.
  document.getElementById('h-growth').replaceChildren(defined('span', 'sov_change', { text: 'Share-of-voice change' }), ' against ', defined('span', 'revenue', { text: 'revenue growth' }));
  const p2 = brands.filter(b => b.sov_change != null && b.revenue && b.revenue.yoy_pct != null).map(b => ({ label: b.name, x: b.revenue.yoy_pct, y: b.sov_change, weight: Math.abs(b.sov_change), filled: NARROW.has(b.revenue.level), b }));
  if (p2.length) {
    const xa = Math.max(10, ...p2.map(p => Math.abs(p.x))) * 1.1, ya = Math.max(1, ...p2.map(p => Math.abs(p.y))) * 1.15;
    const xs = niceMax(xa, 10), ys = niceMax(ya, 1);
    scatter(document.getElementById('chart-growth'), document.getElementById('readout-growth'), p2, {
      x: { min: -xs, max: xs }, y: { min: -ys, max: ys }, xTicks: Array.from({ length: xs / 10 * 2 + 1 }, (_, i) => -xs + i * 10), yTicks: Array.from({ length: ys * 2 + 1 }, (_, i) => -ys + i),
      xFmt: v => `${v > 0 ? '+' : ''}${v}%`, yFmt: v => `${v > 0 ? '+' : ''}${v}`, xLabel: 'Revenue growth, latest fiscal year', yLabel: `Share-of-voice change since ${d.previous_round}, pts`, zeroX: true, zeroY: true,
      describe: p => `${p.b.name}: share of voice ${pts(p.b.sov_change)} since ${d.previous_round} (${p.b.sov_previous.toFixed(1)}% to ${p.b.sov.toFixed(1)}%); ${p.b.revenue.measure} ${pct1(p.b.revenue.yoy_pct)} in ${p.b.revenue.fiscal_year}.`,
    });
  } else {
    document.getElementById('chart-growth').replaceChildren(el('p', { class: 'empty' }, `Share-of-voice change needs two editions. It appears with the next one; this is edition ${d.round || 'one'}.`));
  }

  // Chart 3: AI share of voice against share of top-10 finishes at the majors.
  const rc = d.races || { known: 0 };
  document.getElementById('h-races').replaceChildren(defined('span', 'sov', { text: 'Share of voice' }), ' against ', defined('span', 'top10_share', { text: 'share of top-10 finishes' }));
  const p3 = brands.filter(b => b.sov != null && b.top10_share != null).map(b => ({ label: b.name, x: b.top10_share, y: b.sov, weight: b.sov + b.top10_share, filled: true, b }));
  if (rc.known && p3.length) {
    const top = niceMax(Math.max(...p3.map(p => Math.max(p.x, p.y))) * 1.1, 5);
    const ticks = Array.from({ length: top / 5 + 1 }, (_, i) => i * 5);
    scatter(document.getElementById('chart-races'), document.getElementById('readout-races'), p3, {
      x: { min: 0, max: top }, y: { min: 0, max: top }, xTicks: ticks, yTicks: ticks, xFmt: v => `${v}%`, yFmt: v => `${v}%`, diagonal: true,
      xLabel: 'Share of top-10 finishes at the majors since 2025', yLabel: 'Share of voice',
      describe: p => `${p.b.name}: share of voice ${p.b.sov.toFixed(1)}%; ${p.b.top10} of ${rc.known} top-10 places (${p.b.top10_share.toFixed(1)}%), ${p.b.podiums} podiums, ${p.b.wins} wins.`,
    });
    document.getElementById('races-note').textContent = `${rc.races} races, ${rc.places} top-10 places; shoe brand confirmed for ${rc.known}. Above the line, AI mentions the brand more than elite results would suggest; below it, less.`;
  } else document.getElementById('chart-races').replaceChildren(el('p', { class: 'empty' }, 'Race results are being collected.'));
  if (rc.other_brands && rc.other_brands.length) document.getElementById('other-brands').textContent = `Other brands in the top 10 at the majors: ${rc.other_brands.map(o => `${o.name} ${o.top10}${o.podiums ? ` (${o.podiums} podiums)` : ''}`).join(', ')}.`;

  // Table.
  const engines = [...new Set(brands.flatMap(b => Object.keys(b.by_engine || {})))].sort();
  // Share of voice, its change and revenue first (the comparison asked for); the detail after.
  const head = el('tr', {}, el('th', {}, 'Brand'), defined('th', 'sov', { class: 'num', text: 'Share of voice' }), defined('th', 'sov_change', { class: 'num', text: 'Change' }), defined('th', 'revenue', { class: 'num', text: 'Revenue growth' }), defined('th', 'revenue_scale', { class: 'num', text: 'Revenue' }),
    defined('th', 'top10_share', { class: 'num', text: 'Top-10 share' }), defined('th', 'podiums', { class: 'num', text: 'Podiums' }),
    defined('th', 'top_pick_share', { class: 'num', text: 'Top picks' }), defined('th', 'answer_share', { class: 'num', text: 'In answers' }), ...engines.map(e => el('th', { class: 'num' }, engineName(e))));
  const f1 = v => v == null ? '—' : `${v.toFixed(1)}%`;
  const rows = brands.filter(b => b.sov != null).map((b, i) => el('tr', {},
    el('td', {}, el('span', { class: 'lane' }, String(i + 1)), el('a', { href: `/brand.html?b=${encodeURIComponent(b.slug)}` }, b.name)),
    el('td', { class: 'num' }, f1(b.sov), b.sov_margin != null ? el('span', { class: 'pm' }, ` ±${b.sov_margin.toFixed(1)}`) : ''),
    el('td', { class: 'num' }, b.sov_change == null ? '—' : pts(b.sov_change)),
    el('td', { class: 'num' }, b.revenue && b.revenue.yoy_pct != null ? pct1(b.revenue.yoy_pct) : '—'),
    el('td', { class: 'num' }, b.revenue && b.revenue.usd ? `${usd(b.revenue.usd)} · ${LEVEL_WORD[b.revenue.level] || b.revenue.level}` : '—'),
    el('td', { class: 'num' }, f1(b.top10_share)), el('td', { class: 'num' }, b.top10_share == null ? '—' : `${b.podiums}${b.wins ? ` (${b.wins})` : ''}`),
    el('td', { class: 'num' }, f1(b.top_pick_share)), el('td', { class: 'num' }, f1(b.answer_share)),
    ...engines.map(e => el('td', { class: 'num' }, f1(b.by_engine[e])))));
  document.getElementById('sov-table').replaceChildren(el('table', {}, el('thead', {}, head), el('tbody', {}, ...rows)));
}
main();
