'use strict';
// 把 Google 試算表匯出的 CSV 匯入資料庫。用法：node import.js [CSV 資料夾]（預設 /data/import）
const fs = require('fs'), path = require('path');
const db = require('./db');
const dir = process.argv[2] || path.join(process.env.DATA_DIR || '/data', 'import');
function parse(t) {
  t = t.replace(/^\uFEFF/, ''); const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); rows.push(r); r = []; f = ''; }
    else f += c;
  }
  if (f !== '' || r.length) { r.push(f); rows.push(r); }
  return rows.filter(x => x.length > 1 || x[0] !== '');
}
function load(name) {
  const f = path.join(dir, name + '.csv'); if (!fs.existsSync(f)) { console.log('略過（找不到）', name + '.csv'); return []; }
  const [h, ...rows] = parse(fs.readFileSync(f, 'utf8'));
  return rows.map(r => Object.fromEntries(h.map((k, i) => [k.trim(), r[i] ?? ''])));
}
const ins = (sql, ...a) => db.prepare(sql).run(...a);
db.exec('BEGIN');
try {
  load('Config').forEach(r => ins('INSERT OR REPLACE INTO config VALUES(?,?)', r.key, r.value));
  load('Teachers').forEach(r => ins('INSERT OR REPLACE INTO teachers VALUES(?,?,?,?,?,?,?)', r.id, r.name, r.cls, r.salt, r.hash, Number(r.limit) || 15, r.pw || ''));
  load('Students').forEach(r => ins('INSERT OR REPLACE INTO students VALUES(?,?,?,?,?)', r.id, r.tid, Number(r.seat), r.name, r.code));
  load('Items').forEach(r => ins('INSERT OR REPLACE INTO items(id,tid,type,label,sort) VALUES(?,?,?,?,?)', r.id, r.tid, r.type, r.label, Number(r.sort) || 0));
  load('Records').forEach(r => ins('INSERT OR REPLACE INTO records(id,sid,tid,type,label,note,date,ts,subject) VALUES(?,?,?,?,?,?,?,?,?)', r.id, r.sid, r.tid, r.type, r.label, r.note, r.date, Number(r.ts), r.subject || ''));
  load('Periods').forEach(r => ins('INSERT OR REPLACE INTO periods VALUES(?,?,?,?,?)', r.id, r.tid, r.label, r.start, r.end));
  db.exec('COMMIT'); console.log('匯入完成');
} catch (e) { db.exec('ROLLBACK'); console.error('匯入失敗：', e.message); process.exit(1); }
