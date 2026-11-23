// Local preview of the real site: the Worker's fetch handler over an in-memory SQLite that holds the schema, the
// CSV seed and every round folder's import.sql and scores.sql. No Cloudflare account needed.
//   npm run preview            then open http://localhost:8788
//   PORT=8080 npm run preview
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/2026-11-21-worker.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const db = new DatabaseSync(':memory:');
for (const f of readdirSync(join(root, 'migrations')).sort()) db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
db.exec(execFileSync(process.execPath, [join(root, 'scripts/2026-11-21-seed.js')], { encoding: 'utf8' }));
db.exec(execFileSync(process.execPath, [join(root, 'scripts/2026-11-21-financials.js')], { encoding: 'utf8' }));
db.exec(execFileSync(process.execPath, [join(root, 'scripts/2026-11-22-races.js')], { encoding: 'utf8' }));
const roundsDir = join(root, 'data/rounds');
let rounds = 0;
if (existsSync(roundsDir)) for (const r of readdirSync(roundsDir).sort()) {
  for (const f of ['import.sql', 'scores.sql']) {
    const p = join(roundsDir, r, f);
    if (existsSync(p)) { db.exec(readFileSync(p, 'utf8')); if (f === 'import.sql') rounds++; }
  }
}

// The slice of D1's API the Worker uses, over node:sqlite.
const DB = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    let params = [];
    const api = {
      bind(...args) { params = args.map(a => a === undefined ? null : a); return api; },
      async all() { return { results: stmt.all(...params) }; },
      async first() { return stmt.get(...params) ?? null; },
    };
    return api;
  },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const ASSETS = {
  async fetch(request) {
    let path = decodeURIComponent(new URL(request.url).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, 'public', path);
    if (!file.startsWith(join(root, 'public')) || !existsSync(file) || !statSync(file).isFile()) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } });
  },
};
const env = { DB, ASSETS, PREVIEW_NOTICE: process.env.PREVIEW_NOTICE ?? 'Preview · sample data · not published', PREVIEW_NOTICE_GELS: process.env.PREVIEW_NOTICE_GELS ?? 'Unlisted preview · first energy gel edition, November 2026' };

const port = Number(process.env.PORT || 8788);
createServer(async (req, res) => {
  const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers });
  const out = await worker.fetch(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`SoleStats preview at http://localhost:${port} (${rounds} round${rounds === 1 ? '' : 's'} loaded)`));
