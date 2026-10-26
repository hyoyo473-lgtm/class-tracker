'use strict';
// 忘記管理者密碼時使用：清除管理者密碼，下次開網站會重新要求設定。資料不會被刪除。
const db = require('./db');
db.exec("DELETE FROM config WHERE key IN ('admin','adminSalt'); DELETE FROM sessions WHERE role='admin';");
console.log('已清除管理者密碼，請重新開啟網站設定新密碼');
