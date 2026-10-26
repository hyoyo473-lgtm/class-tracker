# 班級常規登記系統（NAS 版）安裝與更新教學

整體流程：**GitHub 存放程式碼 → 自動打包成映像檔 → NAS 自動抓新版 → 透過 Cloudflare Tunnel 對外**。
資料庫是 NAS 裡的一個檔案（SQLite），更新程式不會影響資料。

資料夾內容：

```
Dockerfile                 打包設定
docker-compose.yml         NAS 上要用的設定（網站＋Cloudflare＋自動更新）
.github/workflows/docker.yml   推送程式碼後自動打包
app/                       網站程式（server.js、db.js、import.js、public/index.html）
```

---

## 第一步：把程式放上 GitHub

1. 到 github.com 註冊帳號（免費）。
2. 右上角「＋」→ **New repository**。名稱填 `class-tracker`，選 **Private**，按 Create。
3. 進入新儲存庫，點 **uploading an existing file**，把這個資料夾裡的**所有檔案與資料夾**拖進去（包含 `app`、`.github`、`Dockerfile`、`docker-compose.yml`、`.gitignore`、`.dockerignore`），按 **Commit changes**。
   - 如果拖曳後看不到 `.github` 資料夾，請改用「Add file → Create new file」，檔名輸入 `.github/workflows/docker.yml`，把檔案內容貼進去再 Commit。
4. 點上方 **Actions** 分頁，會看到 `build-and-push` 正在執行。等它變成綠色勾勾（約 2～4 分鐘）。如果是紅色叉叉，點進去把錯誤訊息貼給我。

## 第二步：讓 NAS 能下載映像檔

打包好的映像檔會放在 GitHub 的套件庫，預設是私人的，NAS 抓不到，要改成公開（程式碼本身仍然是私人的，資料也不在裡面）：

1. GitHub 右上角頭像 → **Your profile** → **Packages** 分頁 → 點 `class-tracker`。
2. 右側 **Package settings** → 最下面 **Change visibility** → 選 **Public** → 輸入名稱確認。

## 第三步：在 NAS 換成正式系統

1. 用 File Station 打開 `docker/class-tracker/`，確認有 `.env`（內含 Cloudflare token），並新增一個資料夾 `data`。
2. 打開 `docker-compose.yml`，把裡面的 `你的GitHub帳號` 改成你的 GitHub 使用者名稱，**全部小寫**。
3. 打開 Container Manager → 專案 → `class-tracker` → 編輯（或設定），把整份內容換成這個 `docker-compose.yml`，儲存後重新建置／啟動。
4. 等 3 個容器（`class-app`、`class-cloudflared`、`class-watchtower`）都顯示執行中。
5. 用手機開 `https://class.你的網域`，應該會看到新的登入畫面。

## 第四步：第一次使用1234

1. 點底部「校務管理者登入」，因為資料庫是空的，會要求你**設定管理者密碼**。
2. 登入後到「班級與老師總覽」→「新增老師與班級」，建立老師帳號與密碼（可按 🎲 隨機產生）。
3. 把密碼交給各班導師，導師只要輸入密碼就能登入自己的班級。

### 如果要匯入原本 Google 試算表的資料（沒有舊資料可以跳過）

1. 在 Google 試算表，對 `Config`、`Teachers`、`Students`、`Items`、`Records`、`Periods` 每個工作表各做一次：檔案 → 下載 → 逗號分隔值 (.csv)，並把檔名改成工作表名稱，例如 `Teachers.csv`。
2. 在 NAS 的 `docker/class-tracker/data/` 底下新增資料夾 `import`，把這些 CSV 放進去。
3. Container Manager → 容器 → `class-app` → 詳細資料 → 終端機 → 新增 → 選 `sh` → 執行：
   ```
   node import.js
   ```
   看到「匯入完成」即可。舊的導師密碼、家長代碼都會保留。
4. 匯入完成後，建議把 `import` 資料夾裡的 CSV 刪除，因為裡面有明文密碼。

## 之後怎麼更新（改完立刻上線）

1. 在 GitHub 修改檔案並 Commit（或我給你新檔案，你覆蓋上去）。
2. GitHub Actions 自動打包，約 2～4 分鐘。
3. NAS 上的自動更新程式每 5 分鐘檢查一次，發現新版就自動換上。
4. **資料庫在 `data/` 資料夾裡，更新時不會受影響。**

想立刻更新：Container Manager → 專案 → `class-tracker` → 操作 → 重新建置（會重新下載最新映像檔）。

## 備份（請務必設定）

1. DSM 開啟 **Hyper Backup**，新增備份任務，來源選 `docker/class-tracker/data`，目的地選外接硬碟或雲端，排程每天一次。
2. 若儲存空間是 Btrfs，可再用 **Snapshot Replication** 對 `docker` 共用資料夾做每日快照。
3. 資料庫檔案是 `data/class.db`（另外會有 `-wal`、`-shm` 檔，一起備份）。

## 常見問題

| 狀況 | 處理 |
|---|---|
| Actions 紅色叉叉 | 點進去看錯誤，貼給我 |
| NAS 拉不到映像檔 | 確認第二步套件已改成 Public，且 compose 裡的帳號全小寫、拼字正確 |
| 開網址顯示 502 | 確認 `class-app` 容器是執行中，Tunnel 的 Public Hostname 服務網址是 `http://app:3000`（**注意：新系統是 3000，不是 80**） |
| 忘記管理者密碼 | Container Manager → 容器 → `class-app` → 詳細資料 → 終端機 → 新增 → `sh`，執行 `node reset-admin.js`。只會清除管理者密碼，學生與紀錄都不會動。**不要刪除 `class.db`，那會清空全部資料** |
| 導師忘記密碼 | 管理者頁面可直接看到，或重設一組新的 |

> **重要：** 第三步換成正式系統後，請到 Cloudflare 的 Tunnel → Public Hostname，把服務網址由 `http://app:80` 改成 `http://app:3000`，否則會顯示 502。
