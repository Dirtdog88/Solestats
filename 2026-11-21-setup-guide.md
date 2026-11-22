# SoleStats setup guide

One-time steps, in order. Everything is on Cloudflare's free plan plus pay-as-you-go API keys.

1. **Clone and install.** `npm ci` (the only package is the Anthropic SDK for the runner).
2. **Keys and caps.** Create personal API keys for the engines you run (Anthropic, OpenAI, Google AI Studio for
   Gemini, Perplexity if used). Set a monthly spend cap at each provider first. Put the keys in your shell for a
   run: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`. Never commit them.
   In a Claude Code cloud session, name the Anthropic one `SOLESTATS_ANTHROPIC_KEY` instead: the cloud refuses to
   pass a variable called `ANTHROPIC_API_KEY` into sessions (it would collide with Claude Code's own sign-in).
   In a cloud session the Cloudflare token lives in the environment's network secrets and the proxy injects it, so D1
   commands run as `CLOUDFLARE_API_TOKEN=proxy-injected NODE_USE_ENV_PROXY=1 npx wrangler@4 d1 ...` (see step 8 for deploys).
3. **Model ids.** Check the current ids and set `SOLESTATS_OPENAI_MODEL` and `SOLESTATS_GEMINI_MODEL` (the
   defaults in `scripts/2026-11-21-engines.js` are placeholders to confirm). A round records the id that ran.
4. **Always start the runner with `npm run run -- ...`**, not `node scripts/...` directly: the npm script passes Node the
   flag that routes `fetch` through a cloud session's proxy (`--use-env-proxy`); on a PC it changes nothing. A cloud
   session also needs each engine's host on the environment's allowed list (OpenAI and Gemini were added 2026-11-21).
5. **Dry run.** `npm run run -- --round 2026-12 --dry-run` prints the first ten jobs. Then a tiny paid test:
   `npm run run -- --round test --limit 2 --repeats 1 --engines anthropic` and read `data/rounds/test/runs.jsonl`.
6. **D1.** `npx wrangler@4 d1 create solestats`, paste the id into `wrangler.toml`, then
   `npx wrangler@4 d1 migrations apply solestats --remote`.
7. **Seed.** `npm run seed > data/seed.sql` then `npx wrangler@4 d1 execute solestats --remote --file data/seed.sql`.
8. **Deploy.** The Worker is connected to this GitHub repo in the Cloudflare dashboard (Workers & Pages, Create, Import a
   repository, Dirtdog88/solestats; no build command, deploy command `npx wrangler deploy`), so every push to main
   deploys. `npm run deploy` does the same from a PC. `wrangler deploy` does not work from a cloud session (the
   static-asset upload is refused with 401). The workers.dev address works at once; the public address comes from the
   `routes` in `wrangler.toml` (step 10).
9. **A round.** `npm run run -- --round 2026-12` (hours, resumable), then `import`, `score`, `export`, then load
   `data/rounds/2026-12/import.sql` and `scores.sql` with `wrangler d1 execute --file`.
   An engine can join a round later: run it alone with `--engines gemini` into the same round id, then import, score
   and load again (every statement is INSERT OR REPLACE). Until then list it in `PENDING_ENGINES` in `wrangler.toml`
   so the site marks it pending; clear the entry and redeploy when it is in.
10. **Domain.** solestats.net, registered at Cloudflare Registrar on 2026-11-22 (solestats.com was left to lapse at
   Wix). The `routes` in `wrangler.toml` attach solestats.net and www.solestats.net to the Worker as Custom Domains on
   deploy; Cloudflare makes the DNS records and certificates. The Worker redirects www to the bare domain.
11. **Publish.** Only after the gate: set `PREVIEW_NOTICE = ""` in `wrangler.toml`, deploy, send brands their numbers.
12. **Demand signals (PC, once a quarter; added 2026-11-22).** Google Trends and Reddit refuse cloud addresses, so on a PC:
   `npm run demand-signals -- --all` (about ten minutes: Trends in batches with pauses, Reddit at ten requests a minute;
   resumable, a 429 just means run it again later). For the conversation corpora make a free Hugging Face account, accept
   the terms on the WildChat-1M and LMSYS-Chat-1M dataset pages, create a read token and set `HF_TOKEN` first; without it
   that signal is skipped. Then `npm run demand` writes `data/2026-11-22-demand.csv` (check the table it prints),
   `npm run score -- --round <current>` and load `scores.sql` as in step 9. Commit the signals, the Reddit titles and the
   weights CSV: they are part of the open data.
