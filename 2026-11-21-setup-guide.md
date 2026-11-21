# SoleStats setup guide

One-time steps, in order. Everything is on Cloudflare's free plan plus pay-as-you-go API keys.

1. **Clone and install.** `npm ci` (the only package is the Anthropic SDK for the runner).
2. **Keys and caps.** Create personal API keys for the engines you run (Anthropic, OpenAI, Google AI Studio for
   Gemini, Perplexity if used). Set a monthly spend cap at each provider first. Put the keys in your shell for a
   run: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`. Never commit them.
3. **Model ids.** Check the current ids and set `SOLESTATS_OPENAI_MODEL` and `SOLESTATS_GEMINI_MODEL` (the
   defaults in `scripts/2026-11-21-engines.js` are placeholders to confirm). A round records the id that ran.
4. **Dry run.** `npm run run -- --round 2026-12 --dry-run` prints the first ten jobs. Then a tiny paid test:
   `npm run run -- --round test --limit 2 --repeats 1 --engines anthropic` and read `data/rounds/test/runs.jsonl`.
5. **D1.** `npx wrangler@4 d1 create solestats`, paste the id into `wrangler.toml`, then
   `npx wrangler@4 d1 migrations apply solestats --remote`.
6. **Seed.** `npm run seed > data/seed.sql` then `npx wrangler@4 d1 execute solestats --remote --file data/seed.sql`.
7. **Deploy.** `npm run deploy`. The workers.dev address works at once; add `solestats.com` as a custom domain in the
   Worker's settings once the domain is at Cloudflare (step 9).
8. **A round.** `npm run run -- --round 2026-12` (hours, resumable), then `import`, `score`, `export`, then load
   `data/rounds/2026-12/import.sql` and `scores.sql` with `wrangler d1 execute --file`.
9. **Domain.** Transfer solestats.com from Wix to Cloudflare Registrar before 2026-12-21 (unlock, transfer code,
   approve the email). DNS then lives with the other Dirtdog sites.
10. **Publish.** Only after the gate: set `PREVIEW_NOTICE = ""` in `wrangler.toml`, deploy, send brands their numbers.
