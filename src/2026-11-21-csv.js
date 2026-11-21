// A small CSV reader and writer (RFC 4180 quoting). Shared by the scripts and the tests. No dependencies.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter(r => r.length > 1 || r[0] !== '').map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function toCsv(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {});
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n') + '\n';
}

// SQL string literal for the D1 seed files.
export const sql = v => v == null || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
