// Categories (Alex, 2026-11-23: energy gels join running shoes). A round's category is in its id: shoe rounds keep plain
// month ids ("2026-11"), other categories prefix theirs ("gels-2026-12"), so existing rounds, the live database and the
// monthly shoe run are untouched. Each category names its own data files; retailers are shared.

export const CATEGORIES = {
  shoes: {
    label: 'Running shoes', headline: 'The running shoe AI index', page: '/',
    prompts: '2026-11-21-prompts.csv', brands: '2026-11-21-brands.csv',
    models: '2026-11-21-spec-sheet.csv', aliases: '2026-11-22-model-aliases.csv', attributes: '2026-11-22-attributes.csv',
  },
  gels: {
    label: 'Energy gels', headline: 'The energy gel AI index', page: '/fuel.html',
    prompts: '2026-11-23-gel-prompts.csv', brands: '2026-11-23-gel-brands.csv',
    models: '2026-11-23-gel-products.csv', aliases: '2026-11-23-gel-products.csv', attributes: null,
  },
};

/** The category a round id belongs to: "gels-2026-12" is gels, "2026-11" is shoes. */
export function categoryOfRound(round) {
  const m = /^([a-z]+)-\d{4}-\d{2}/.exec(String(round || ''));
  return m && CATEGORIES[m[1]] ? m[1] : 'shoes';
}

/** The same rule in SQL, over the rounds table's id: "gels-2026-12" is gels, "2026-11" (no prefix) is shoes. */
export const ROUND_CATEGORY_SQL = `CASE WHEN substr(id, 1, 1) BETWEEN 'a' AND 'z' THEN substr(id, 1, instr(id, '-') - 1) ELSE 'shoes' END`;

/** The brand category value used in the brands table for a category key (shoes brands say "shoes", gels say "gels"). */
export const brandCategory = cat => cat;

/** The prompt sets that are "need" questions (one brand never named): "shoe" for shoes, "need" for later categories. */
export const NEED_SETS = ['shoe', 'need'];
export const isNeed = p => NEED_SETS.includes(p.set_name || p.set);
