'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'class.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS teachers(id TEXT PRIMARY KEY, name TEXT, cls TEXT, salt TEXT, hash TEXT, lim INTEGER DEFAULT 15, pw TEXT);
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, tid TEXT, seat INTEGER, name TEXT, code TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, tid TEXT, type TEXT, label TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, sid TEXT, tid TEXT, type TEXT, label TEXT, note TEXT, date TEXT, ts INTEGER, subject TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS periods(id TEXT PRIMARY KEY, tid TEXT, label TEXT, pstart TEXT, pend TEXT);
CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY, tid TEXT, label TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, role TEXT, tid TEXT, exp INTEGER);
CREATE INDEX IF NOT EXISTS i_st ON students(tid);
CREATE INDEX IF NOT EXISTS i_rs ON records(sid);
CREATE INDEX IF NOT EXISTS i_rt ON records(tid);
`);

/* ── 舊資料庫升級（只新增，不刪除任何資料）── */
const cols = t => db.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name);
if (!cols('records').includes('subject')) db.exec("ALTER TABLE records ADD COLUMN subject TEXT DEFAULT ''");
if (!cols('items').includes('sort')) { db.exec('ALTER TABLE items ADD COLUMN sort INTEGER DEFAULT 0'); db.exec('UPDATE items SET sort=rowid'); }
/* 預設課程科目：全校預設（tid=''）＋ 每個班級各複製一份，之後各班可自行調整 */
const crypto = require('crypto');
const uid = () => crypto.randomBytes(5).toString('hex');
const flag = k => (db.prepare('SELECT value FROM config WHERE key=?').get(k) || {}).value;
const setFlag = k => db.prepare('INSERT OR REPLACE INTO config VALUES(?,?)').run(k, '1');
if (!flag('subjSeeded')) {
  ['國文','英文','數學','自然','社會','體育','藝能','綜合','早自習','午休','打掃','其他']
    .forEach((l, i) => db.prepare('INSERT INTO subjects(id,tid,label,sort) VALUES(?,?,?,?)').run(uid(), '', l, i + 1));
  setFlag('subjSeeded');
}
db.prepare('SELECT id FROM teachers').all().forEach(t => {
  if (flag('subj:' + t.id)) return;
  db.prepare("SELECT label FROM subjects WHERE tid='' ORDER BY sort,rowid").all().forEach((g, i) =>
    db.prepare('INSERT INTO subjects(id,tid,label,sort) VALUES(?,?,?,?)').run(uid(), t.id, g.label, i + 1));
  setFlag('subj:' + t.id);
});
module.exports = db;
