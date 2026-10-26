'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const db = require('./db');
const PORT = Number(process.env.PORT) || 3000, TZ = 'Asia/Taipei';
const DEFAULT_ITEMS = [['good','主動幫忙'],['good','認真聽講'],['good','作業準時'],['good','有禮貌'],
                       ['bad','遲到'],['bad','未交作業'],['bad','上課說話'],['bad','忘記帶物品']];

/* ── 資料庫小工具 ── */
const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const tx = f => { db.exec('BEGIN'); try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const cfg = k => (get('SELECT value FROM config WHERE key=?', k) || {}).value || null;
const setCfg = (k, v) => run('INSERT OR REPLACE INTO config VALUES(?,?)', k, v);

/* ── 工具 ── */
const uid = () => crypto.randomBytes(5).toString('hex');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const hash = (salt, pw) => crypto.createHash('sha256').update(salt + ':' + pw).digest('base64');
const checkPw = pw => { if (!pw || pw.length < 4 || pw.length > 64) throw new Error('密碼長度需為 4～64 個字元'); };
const pwTaken = (pw, except) => all('SELECT id,salt,hash FROM teachers').some(t => t.id !== except && hash(t.salt, pw) === t.hash);
const text = (v, max) => { v = String(v || '').trim(); if (!v || v.length > max) throw new Error('內容不可空白，且不超過 ' + max + ' 字'); return v; };
function newCode(used) {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let c;
  do { c = ''; for (let i = 0; i < 6; i++) c += a[crypto.randomInt(a.length)]; } while (used.has(c));
  used.add(c); return c;
}
const fails = new Map();
function throttle(key, max = 5) {
  const now = Date.now(); let f = fails.get(key);
  if (!f || f.exp < now) { f = { n: 0, exp: now + 600000 }; fails.set(key, f); }
  if (f.n >= max) throw new Error('嘗試次數過多，請 10 分鐘後再試');
  return () => { f.n++; };
}
function newToken(s) {
  const t = crypto.randomBytes(24).toString('hex');
  const ttl = s.role === 'admin' ? 12 * 3600e3 : 7 * 24 * 3600e3;
  run('DELETE FROM sessions WHERE exp<?', Date.now());
  run('INSERT INTO sessions VALUES(?,?,?,?)', t, s.role, s.tid || null, Date.now() + ttl);
  return t;
}
function sess(t) {
  const r = t && get('SELECT * FROM sessions WHERE token=?', t);
  if (!r || r.exp < Date.now() || (r.role === 'teacher' && !get('SELECT id FROM teachers WHERE id=?', r.tid))) throw new Error('登入已逾時，請重新登入');
  return { role: r.role, tid: r.tid || undefined };
}

/* ── 資料包 ── */
function bundle(s) {
  const admin = s.role === 'admin', w = admin ? '' : ' WHERE tid=?', a = admin ? [] : [s.tid];
  return {
    role: s.role, tid: s.tid || null, today: today(),
    teachers: all('SELECT * FROM teachers' + (admin ? '' : ' WHERE id=?'), ...a)
      .map(t => ({ id: t.id, name: t.name, cls: t.cls, limit: t.lim || 15, pw: admin ? (t.pw || '') : undefined })),
    students: all('SELECT id,tid,seat,name,code FROM students' + w + ' ORDER BY seat', ...a),
    items: all('SELECT id,tid,type,label FROM items' + w, ...a),
    records: all('SELECT id,sid,tid,type,label,note,date,ts FROM records' + w, ...a),
    periods: all('SELECT id,tid,label,pstart AS start,pend AS "end" FROM periods' + w, ...a)
  };
}

/* ── 動作 ── */
function run_(a, p, tk) {
  if (a === 'status') return { hasAdmin: !!cfg('admin') };
  if (a === 'setAdmin') {
    if (cfg('admin')) throw new Error('管理者密碼已設定');
    checkPw(p.pw);
    const salt = uid(); setCfg('adminSalt', salt); setCfg('admin', hash(salt, p.pw));
    const s = { role: 'admin' }; return { token: newToken(s), b: bundle(s) };
  }
  if (a === 'login') {
    if (p.role === 'admin') {
      const bump = throttle('admin'), h = cfg('admin');
      if (!h || hash(cfg('adminSalt'), String(p.pw || '')) !== h) { bump(); throw new Error('密碼錯誤'); }
      const s = { role: 'admin' }; return { token: newToken(s), b: bundle(s) };
    }
    const bump = throttle('teacher', 30), pw = String(p.pw || '');
    const t = pw && all('SELECT * FROM teachers').find(x => hash(x.salt, pw) === x.hash);
    if (!t) { bump(); throw new Error('密碼錯誤'); }
    const s = { role: 'teacher', tid: t.id }; return { token: newToken(s), b: bundle(s) };
  }
  if (a === 'parent') {
    const bump = throttle('parent', 20), code = String(p.code || '').trim().toUpperCase().split('-').pop().trim();
    const st = get('SELECT * FROM students WHERE code=?', code);
    if (!st) { bump(); throw new Error('找不到此代碼'); }
    const t = get('SELECT * FROM teachers WHERE id=?', st.tid) || {};
    return { b: {
      role: 'parent', today: today(),
      teachers: [{ id: 't', name: t.name || '', cls: t.cls || '', limit: t.lim || 15 }],
      students: [{ id: 's', tid: 't', seat: st.seat, name: st.name, code: '' }], items: [],
      records: all('SELECT id,type,label,note,date,ts FROM records WHERE sid=?', st.id).map(r => ({ ...r, sid: 's', tid: 't' })),
      periods: all('SELECT id,label,pstart AS start,pend AS "end" FROM periods WHERE tid=?', st.tid).map(x => ({ ...x, tid: 't' }))
    } };
  }
  const s = sess(tk);
  if (a === 'load') return { b: bundle(s) };
  const msg = tx(() => write(a, p, s));
  return { b: bundle(s), msg };
}

function write(a, p, s) {
  const admin = s.role === 'admin', tid = admin ? p.tid : s.tid;
  const adminOnly = () => { if (!admin) throw new Error('沒有權限'); };
  const needT = () => { if (!get('SELECT id FROM teachers WHERE id=?', tid)) throw new Error('找不到班級'); };
  const mine = (table, id) => {
    const r = get('SELECT * FROM ' + table + ' WHERE id=?', String(id));
    if (!r || (!admin && r.tid !== s.tid)) throw new Error('找不到資料'); return r;
  };
  switch (a) {
    case 'addTeacher': {
      adminOnly(); checkPw(p.pw);
      if (pwTaken(p.pw)) throw new Error('此密碼已被其他老師使用，請換一個');
      const name = text(p.name, 20), cls = String(p.cls || '').trim().slice(0, 20), id = uid(), salt = uid();
      run('INSERT INTO teachers VALUES(?,?,?,?,?,?,?)', id, name, cls, salt, hash(salt, p.pw), 15, p.pw);
      DEFAULT_ITEMS.forEach(x => run('INSERT INTO items VALUES(?,?,?,?)', uid(), id, x[0], x[1]));
      return '已新增老師';
    }
    case 'resetPw': {
      adminOnly(); checkPw(p.pw);
      if (!get('SELECT id FROM teachers WHERE id=?', p.id)) throw new Error('找不到老師');
      if (pwTaken(p.pw, p.id)) throw new Error('此密碼已被其他老師使用，請換一個');
      const salt = uid();
      run('UPDATE teachers SET salt=?,hash=?,pw=? WHERE id=?', salt, hash(salt, p.pw), p.pw, p.id);
      run('DELETE FROM sessions WHERE tid=?', p.id);
      return '已重設該老師密碼';
    }
    case 'delTeacher': {
      adminOnly();
      ['students', 'items', 'records', 'periods', 'sessions'].forEach(t => run('DELETE FROM ' + t + ' WHERE tid=?', String(p.id)));
      run('DELETE FROM teachers WHERE id=?', String(p.id));
      return '已刪除';
    }
    case 'setPw': {
      checkPw(p.pw); const salt = uid();
      if (admin) { setCfg('adminSalt', salt); setCfg('admin', hash(salt, p.pw)); }
      else {
        if (pwTaken(p.pw, s.tid)) throw new Error('此密碼已被其他老師使用，請換一個');
        run('UPDATE teachers SET salt=?,hash=?,pw=? WHERE id=?', salt, hash(salt, p.pw), p.pw, s.tid);
      }
      return '密碼已修改';
    }
    case 'setLimit': {
      needT(); const n = Math.round(Number(p.limit));
      if (!(n >= 1 && n <= 999)) throw new Error('上限請輸入 1～999');
      run('UPDATE teachers SET lim=? WHERE id=?', n, tid); return '缺點上限已儲存';
    }
    case 'addPeriod': {
      needT(); const label = text(p.label, 20);
      if (!isDate(p.start) || !isDate(p.end) || p.start > p.end) throw new Error('請輸入正確的起訖日期');
      const hit = get('SELECT label FROM periods WHERE tid=? AND ?<=pend AND ?>=pstart', tid, p.start, p.end);
      if (hit) throw new Error('與「' + hit.label + '」的日期重疊');
      run('INSERT INTO periods VALUES(?,?,?,?,?)', uid(), tid, label, p.start, p.end); return '已新增計算區間';
    }
    case 'delPeriod': { mine('periods', p.id); run('DELETE FROM periods WHERE id=?', p.id); return '已刪除區間'; }
    case 'addStudents': {
      needT();
      const used = new Set(all('SELECT code FROM students').map(x => x.code));
      const ms = all('SELECT * FROM students WHERE tid=?', tid);
      let next = ms.reduce((m, x) => Math.max(m, x.seat), 0) + 1, added = 0, upd = 0;
      String(p.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).forEach(line => {
        const m = line.match(/^(\d{1,3})[\s,，、.．\-]+(.+)$/);
        const seat = m ? Number(m[1]) : next++, name = (m ? m[2] : line).trim().slice(0, 20);
        const ex = ms.find(x => x.seat === seat);
        if (ex) { if (ex.name !== name) { run('UPDATE students SET name=? WHERE id=?', name, ex.id); ex.name = name; upd++; } }
        else { const st = { id: uid(), tid, seat, name, code: newCode(used) };
               run('INSERT INTO students VALUES(?,?,?,?,?)', st.id, tid, seat, name, st.code); ms.push(st); added++; }
      });
      return '新增 ' + added + ' 位，更新 ' + upd + ' 位';
    }
    case 'delStudent': { mine('students', p.id); run('DELETE FROM records WHERE sid=?', p.id); run('DELETE FROM students WHERE id=?', p.id); return '已刪除學生'; }
    case 'addItem': {
      needT(); if (p.type !== 'good' && p.type !== 'bad') throw new Error('類型錯誤');
      run('INSERT INTO items VALUES(?,?,?,?)', uid(), tid, p.type, text(p.label, 20)); return '已新增項目';
    }
    case 'delItem': { mine('items', p.id); run('DELETE FROM items WHERE id=?', p.id); return '已刪除項目'; }
    case 'addRecords': {
      const it = mine('items', p.itemId), sids = Array.isArray(p.sids) ? p.sids : [];
      if (!sids.length) throw new Error('請先選擇學生');
      const n = Math.max(1, Math.min(10, Math.round(Number(p.count)) || 1));
      const date = isDate(p.date) ? p.date : today(), note = String(p.note || '').trim().slice(0, 100);
      let people = 0;
      sids.forEach(id => {
        const st = get('SELECT * FROM students WHERE id=?', String(id));
        if (!st || st.tid !== it.tid || (!admin && st.tid !== s.tid)) return;
        people++;
        for (let k = 0; k < n; k++) run('INSERT INTO records VALUES(?,?,?,?,?,?,?,?)', uid(), st.id, st.tid, it.type, it.label, note, date, Date.now() + k);
      });
      if (!people) throw new Error('找不到學生');
      return (it.type === 'good' ? '優點' : '缺點') + '已登記：' + people + ' 位學生' + (n > 1 ? '，每人 ' + n + ' 次' : '');
    }
    case 'delRecord': { mine('records', p.id); run('DELETE FROM records WHERE id=?', p.id); return '已刪除紀錄'; }
  }
  throw new Error('未知的操作');
}

/* ── HTTP ── */
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const sec = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' };
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/') { res.writeHead(200, { ...sec, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  if (req.method === 'GET' && url === '/healthz') { try { get('SELECT 1'); res.writeHead(200); res.end('ok'); } catch (e) { res.writeHead(500); res.end('db'); } return; }
  if (req.method === 'POST' && url === '/api') {
    let body = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 1e6) req.destroy(); else body += c; });
    req.on('end', () => {
      let out;
      try { const j = JSON.parse(body || '{}'); out = { ok: true, data: run_(String(j.a || ''), j.p || {}, j.t) }; }
      catch (e) { out = { ok: false, error: String(e.message || e) }; }
      res.writeHead(200, { ...sec, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404, sec); res.end('Not found');
}).listen(PORT, () => console.log('班級系統已啟動，port ' + PORT));
