# 招行理财净值助手（服务器版）部署手册

把本项目部署到腾讯云轻量应用服务器（OpenCloudOS 9.4 / Node v24.13.0），
实现「nginx 前置反代 + Node 后端 + SQLite 数据库 + 每日自动抓取招行净值」。

---

## 1. 架构与目录规划

**对外只暴露 nginx 的 80/443，Node 只监听回环地址，不直接对外。**

```
浏览器/手机 ──HTTP:80──► nginx ──proxy_pass──► 127.0.0.1:9001
                          │                     node server/index.js
                          │                       ├── /api/*  → SQLite（node:sqlite 内置）
                          │                       ├── /*       → dist/（前端构建产物）
                          │                       └── 每天 09:00 → 招行接口 → 写库
                          └── gzip / 访问日志 / 将来的 TLS 终止
```

这样做的三点理由：

1. **Node 不必以 root 身份占用特权端口**；
2. **将来加域名 + HTTPS 只需在 nginx 上加 server 块**，应用侧零改动；
3. gzip、访问日志、限流、TLS 等通用能力收敛到 nginx 一层。

服务器上的目录：

```
/opt/cmb-nav/
├── server/            # 后端源码（server/*.js）
├── dist/              # 前端构建产物
├── seed-data.json     # 插件历史数据（可选，用于首次导入）
├── package.json
├── deploy/            # 本目录（systemd unit + nginx 站点配置 + 本文档）
├── data/              # 运行时数据库（自动创建）
│   ├── cmb.db
│   ├── cmb.db-wal
│   └── auth.json      # 口令哈希与签名密钥
└── logs/              # app.log
```

> **后端零 npm 依赖**（只用 `node:http` / `node:sqlite` / `node:crypto` / `node:https` /
> `node:fs` / `node:path` / `node:url`）。服务器侧**不需要** `npm install` 后端依赖。
> 前端是已经在本地构建好的 `dist/`，服务器也**不需要**装 vite。

实际生效的文件位置（`deploy/` 下是本仓库里的副本，仅作参考）：

| 用途 | 服务器实际路径 |
|---|---|
| 后端 systemd 单元 | `/etc/systemd/system/cmb-nav.service` |
| nginx systemd 单元 | `/etc/systemd/system/nginx.service` |
| nginx 站点配置 | `/www/server/panel/vhost/nginx/cmb-nav.conf` |
| nginx 主配置（勿手改） | `/www/server/nginx/conf/nginx.conf` |

---

## 2. 需要上传哪些文件

在**本地**执行：

```bash
npm install          # 首次
npm run build        # 产出 dist/

# 上传后端 + 前端产物 + 种子数据
scp -r server dist seed-data.json package.json deploy \
    root@<服务器IP>:/opt/cmb-nav/
```

- `dist/` 虽被 `.gitignore` 忽略，但**部署时必须上传**。
- `node_modules/`、`data/` **不要上传**。

---

## 3. 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `CMB_NAV_API_BASE` | **必填**。数据源接口基地址 | — |
| `CMB_NAV_APP_ID` | **必填**。接口 appId | — |
| `CMB_NAV_AUTH_KEY` | **必填**。接口签名密钥 | — |
| `CMB_NAV_BUSINESS_ID` | **必填**。接口业务标识 | — |
| `HOST` | 监听地址。**前面挂 nginx 时必须设 `127.0.0.1`** | `0.0.0.0` |
| `PORT` | 监听端口 | `9001` |
| `TRUST_PROXY` | 置 `1` 时信任反向代理传入的客户端 IP。**前面挂 nginx 时必须开启**，否则登录节流会把所有请求当成同一个来源 | 关闭 |
| `PROXY_IP_HEADER` | 反代写入真实客户端 IP 的请求头名 | `x-real-ip` |
| `DATA_DIR` | 数据目录（SQLite + auth.json） | `<项目根>/data` |
| `DIST_DIR` | 前端产物目录 | `<项目根>/dist` |
| `CMB_NAV_PASSWORD` | **首次启动**时的初始登录口令 | 未设置则随机生成 |
| `CMB_NAV_TZ` | 定时任务展示用时区 | `Asia/Shanghai` |
| `CMB_NAV_SCHEDULE_HOUR` | 每日自动抓取的小时（24 小时制，0–23，越界回退默认） | `9` |
| `CMB_NAV_SCHEDULE_MINUTE` | 每日自动抓取的分钟（0–59，越界回退默认） | `0` |
| `CMB_NAV_RETRY_DELAY_MS` | 定时/补抓失败后每一轮重试前的等待毫秒数（逗号分隔，元素个数即重试轮数上限） | `300000,600000` |

### 数据源参数的注入方式

四个 `CMB_NAV_*` 数据源参数都是**必填**（仓库内不含明文凭据）。两种注入方式任选其一：

**方式 A（推荐）**：写进独立的 env 文件，systemd 只读这一个文件，仓库目录里不落配置：

```bash
install -m 600 /dev/null /etc/cmb-nav.env
cat > /etc/cmb-nav.env <<'EOF'
CMB_NAV_API_BASE=<接口基地址>
CMB_NAV_APP_ID=<appId>
CMB_NAV_AUTH_KEY=<签名密钥>
CMB_NAV_BUSINESS_ID=<业务标识>
EOF
# 然后在 unit 的 [Service] 段加一行：
#   EnvironmentFile=/etc/cmb-nav.env
```

**方式 B**：在项目根目录放 `.env`（已被 `.gitignore` 排除，不会进仓库）。
真实进程环境变量优先级高于 `.env`，因此方式 A 的值不会被文件覆盖。

缺任意一个时服务仍能启动（录入、查看、统计正常），只在抓取/产品名同步时
返回「缺少环境变量 …」的可读错误。

### 关于 `TRUST_PROXY` 的安全前提

`TRUST_PROXY=1` 时，客户端 IP 取自请求头（默认 `X-Real-IP`）。**只有在下面两个条件同时满足时才可开启**：

1. 前面那层反代由你自己控制，且该头**由反代覆写**（本项目 nginx 配置里写了
   `proxy_set_header X-Real-IP $remote_addr;`，客户端自带的同名头会被丢弃）；
2. 后端端口**只监听回环**（`HOST=127.0.0.1`），外部无法绕过 nginx 直连后端。

只要满足这两条，客户端就无法伪造 IP 绕过节流。头缺失或格式非法时，
代码会回落到 socket 对端地址，不会因为"少了头"就放行。

### 手动试跑（前台，便于看日志与初始口令）

```bash
cd /opt/cmb-nav
HOST=127.0.0.1 PORT=9001 TRUST_PROXY=1 node server/index.js
```

> ⚠️ **Node 版本差异**
> - **服务器 Node 24.13.0**：`node:sqlite` 已内置，直接跑即可。
> - **本地 Node 22.x**：需加 `node --experimental-sqlite`（`npm run start:exp` 已封装）。

### 关于登录口令

- **首次启动**若 `data/auth.json` 不存在：设置了 `CMB_NAV_PASSWORD` 就用它，
  否则随机生成 12 位口令并打印到 stdout（即 `logs/app.log`）：
  `[cmb-nav] 初始登录口令: Ab3xK9mPq2Zt`
- 口令用 `crypto.scryptSync(password, salt, 64)` 存储哈希，明文不落盘。
- 查看初始口令：`grep '初始登录口令' /opt/cmb-nav/logs/app.log`
- **修改口令**：重新生成 `data/auth.json`（`{salt, hash, secret}`，
  `hash = scryptSync(口令, Buffer.from(salt,'hex'), 64).toString('hex')`）后重启服务；
  保留原 `secret` 则已签发的会话继续有效。

---

## 4. 端口与防火墙

对外只需要 **80**（将来加 HTTPS 再用 **443**）。**9001 不对公网开放**。

腾讯云轻量有**两层**防火墙，只在控制台放行是不够的：

```bash
# ① 系统层（OpenCloudOS 用 firewalld；80/443 通常已放通）
firewall-cmd --list-ports
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --reload
```

② 控制台「防火墙」页确认 TCP **80** 已放行。

> 应用是**纯 HTTP**，Cookie 未加 `Secure`。启用 HTTPS 后请在
> `server/auth.js` 的 `buildSessionCookie` 中加上 `Secure`。

---

## 5. nginx 前置反代

宝塔面板自带的 nginx（prefix `/www/server/nginx`）主配置末尾有一行
`include /www/server/panel/vhost/nginx/*.conf;`，所以**站点配置直接放那个目录即可，
不需要改动 nginx.conf**。

```bash
cp /opt/cmb-nav/deploy/cmb-nav.nginx.conf \
   /www/server/panel/vhost/nginx/cmb-nav.conf
chmod 600 /www/server/panel/vhost/nginx/cmb-nav.conf
nginx -t && nginx -s reload
```

### ⚠️ 宝塔的 nginx 启动脚本有坑（本机已绕过）

宝塔的 `/etc/init.d/nginx` 用 `ps` 扫描判断"nginx 是否已在运行"，
而本机还有一个**docker 容器里的 nginx**（`master process nginx -g daemon off`，
与宿主端口不冲突），会导致该脚本误判为"already running"而拒绝启动，
于是 `systemctl restart nginx` 永远失败、**开机也不会自启**。

解决办法：改用原生 systemd 单元（已安装为 `/etc/systemd/system/nginx.service`，
同名单元比 sysv 生成的优先级更高）：

```bash
systemctl daemon-reload
systemctl enable nginx
systemctl restart nginx      # 确认能成功重启（关键验证）
systemctl is-active nginx    # active
```

升级 nginx 或宝塔改配置后，建议复跑一次 `systemctl restart nginx` 确认自愈能力。

### 另一个坑：宝塔默认的 php-fpm 状态块会泄露

`/www/server/panel/vhost/nginx/phpfpm_status.conf` 里有 `listen 80; server_name 127.0.0.1;`，
且只有 `allow 127.0.0.1;` 而**没有 `deny all;`**。nginx 的规则是"无匹配即放行"，
所以任何外部请求只要伪造 `Host: 127.0.0.1` 就能读到 `/nginx_status`。
本机已在该行后补上 `deny all;`（原始文件备份在 `/root/retired/phpfpm_status.conf.bak`）。
若日后面板重新生成该文件，需要复查一次：

```bash
curl -s -H "Host: 127.0.0.1" -o /dev/null -w '%{http_code}\n' http://<IP>/nginx_status
# 期望 403
```

---

## 6. systemd 安装与开机自启

```bash
mkdir -p /opt/cmb-nav/logs

which node       # 本机是 /usr/local/bin/node → node-v24.13.0-linux-x64
# 若与 unit 中的 ExecStart 不一致，请改 /etc/systemd/system/cmb-nav.service

cp /opt/cmb-nav/deploy/cmb-nav.service /etc/systemd/system/cmb-nav.service
systemctl daemon-reload
systemctl enable cmb-nav
systemctl start cmb-nav
systemctl status cmb-nav
```

单元要点：

```ini
Environment=HOST=127.0.0.1
Environment=PORT=9001
Environment=TRUST_PROXY=1
ExecStart=/usr/local/bin/node server/index.js
Restart=always
NoNewPrivileges=true
PrivateTmp=true
```

> 注意 `PrivateTmp=true` 与 Node 二进制放在 `/root` 下不冲突，但**不要**加
> `ProtectHome=true`——本机 node 就装在 `/root/node-v24.13.0-linux-x64/` 下。

---

## 7. 查看日志

```bash
journalctl -u cmb-nav -f                 # 应用
tail -f /opt/cmb-nav/logs/app.log        # 应用（unit 里同时追加写到文件）
tail -f /www/wwwlogs/cmb-nav.access.log  # nginx 访问日志（含真实客户端 IP）
tail -f /www/wwwlogs/cmb-nav.error.log   # nginx 错误日志
```

---

## 8. 日常运维

| 操作 | 命令 |
|---|---|
| 应用 启/停/重启 | `systemctl {start,stop,restart} cmb-nav` |
| 应用 开机自启 | `systemctl enable cmb-nav` |
| nginx 启/停/重启 | `systemctl {start,stop,restart} nginx` |
| nginx 配置重载 | `nginx -t && nginx -s reload` |
| 应用健康检查（本机） | `curl http://127.0.0.1:9001/api/health` |
| 应用健康检查（经反代） | `curl http://127.0.0.1/api/health` |

> 用 `curl http://127.0.0.1/...` 时 Host 为 `127.0.0.1`，会命中宝塔那个 php-fpm 状态块而返回 403。
> 本机自检请用 `curl -H 'Host: <公网IP或域名>' http://127.0.0.1/api/health`，
> 或直接打后端 `127.0.0.1:9001`。

数据库位置：`/opt/cmb-nav/data/cmb.db`（另有 `-wal` / `-shm`，属正常）。

---

## 9. 备份与恢复

```bash
# 热备份（WAL 模式下用 .backup 最稳妥）
sqlite3 /opt/cmb-nav/data/cmb.db ".backup '/opt/cmb-nav/backup/cmb-$(date +%F).db'"

# 冷备份
systemctl stop cmb-nav
cp /opt/cmb-nav/data/cmb.db /opt/cmb-nav/backup/cmb-$(date +%F).db
systemctl start cmb-nav

# 恢复
systemctl stop cmb-nav
cp /opt/cmb-nav/backup/cmb-2026-10-12.db /opt/cmb-nav/data/cmb.db
rm -f /opt/cmb-nav/data/cmb.db-wal /opt/cmb-nav/data/cmb.db-shm
systemctl start cmb-nav
```

> `auth.json` 存口令哈希与签名密钥。一并备份则恢复后旧 Cookie 仍有效；
> 不备份则需重新登录（口令不变）。

---

## 10. 升级步骤

```bash
# 本地
npm run build

# 上传（server/ 与 dist/ 为最新，data/ 与 logs/ 保留）
scp -r server dist root@<IP>:/opt/cmb-nav/

# 服务器
systemctl restart cmb-nav
```

只改了后端时无需重建 `dist/`。数据库结构变更由 `server/db.js` 的
`CREATE TABLE IF NOT EXISTS` 幂等处理；如需新增列，请先备份数据库。

---

## 11. 首次导入历史数据

浏览器登录后，在「数据管理」页点击「导入插件历史数据」即可导入内置
`seed-data.json`（21 只产品 / 780 个净值点）；该操作幂等，重复点击不会产生重复数据。

也可直接调 API（经反代，注意带上正确的 Host）：

```bash
curl -c cookie.txt -X POST http://<IP>/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"<你的口令>"}'

curl -b cookie.txt -X POST http://<IP>/api/import \
  -H 'Content-Type: application/json' --data-binary @/opt/cmb-nav/seed-data.json
```

---

## 12. 自动抓取

- 每天 **09:00（Asia/Shanghai，可经 `CMB_NAV_SCHEDULE_HOUR` / `CMB_NAV_SCHEDULE_MINUTE` 覆盖）**
  抓取全部 `active=1` 的产品，默认回看最近 **90 天**。
- 产品之间间隔 400ms 串行请求；单产品失败重试 2 次（退避 1s / 3s），失败不影响其他产品。
- 抓取的点 `source='cmb'`，手动录入的点 `source='manual'`。
  **同日期已有手动录入点时，自动抓取不会覆盖它**（upsert 条件只更新 `source='cmb'` 的行）。
- 「数据管理」页可点击「立即抓取最新净值」手动触发（全局互斥，同一时刻只跑一个）。
- 「净值管理」页也可直接抓取（2026-10-15 新增，见下）。
- 全量抓取 15 只活跃产品约 **9~10 秒**；nginx 的 `proxy_read_timeout` 已放宽到 300s。

### 三种触发来源（2026-10-16 新增）

`sync_log.trigger_kind` 记录每条抓取日志的来源，`message` 里也用中文标签展示：

| trigger | 标签 | 含义 |
| --- | --- | --- |
| `manual` | 手动 | 页面按钮触发 |
| `schedule` | 定时 | 每天 09:00 的定时任务 |
| `catchup` | 启动补抓 | 服务启动时发现「今日该抓但没抓」而补的一轮 |
| `retry` | 失败重试 | 定时/补抓有产品失败后自动重试的那一轮 |

### 启动补抓（catch-up）

服务启动时若同时满足下面两点，立即补抓一轮（**不阻塞服务启动**），随后定时器指向明天的 09:00：

1. 当前上海挂钟时间已过今日的抓取时刻；
2. `sync_log` 中最近一条「成功的自动抓取」（`trigger_kind ∈ schedule/catchup/retry` 且 `ok=1`）
   的 `started_at` **不在今日**。

这样即使服务器在 09:00 那一刻没运行，当天数据也不会永久缺失。补抓成功后再次重启不会重复补抓。

> 迁移提示：本次升级给 `sync_log` 加了 `trigger_kind` 列（启动时自动幂等 `ALTER TABLE`），
> 历史行的该列为空串，因此不计入「成功的自动抓取」——升级后首次启动通常会触发一次补抓，属预期行为。

### 失败自动重试

- 仅 **`schedule` / `catchup`** 触发时启用；**手动触发不自动重试**（人在跟前，直接再点一次）。
- 后台按 `CMB_NAV_RETRY_DELAY_MS` 逐个等待（默认 5 分钟、10 分钟，共 2 轮），每轮只重抓失败的产品。
- **等待期间不占用全局互斥标志**，因此不会卡住你在页面上点的手动抓取。
- 某轮若恰逢别的抓取任务在跑，该轮跳过并继续下一轮。
- 每轮各写一条独立的 `sync_log`（`trigger_kind='retry'`），最后一轮的 `message` 会列出仍失败的产品代码与原因。

### 净值管理页的直接抓取入口

| 入口 | 范围 | 位置 |
| --- | --- | --- |
| 「抓取最新净值」 | 全部**监控中**产品（与每天 09:00 自动抓取口径一致） | 页头右侧 |
| 「抓取选中」 | 勾选的产品（含已归档的，按传入代码抓取） | 工具栏勾选后出现 |
| 行内「抓取」 | 单只产品 | 每行「操作」列第一个按钮 |

实现要点：
- 前端调 `POST /api/sync`（传 `codes` 即只抓指定产品），随后轮询 `GET /api/sync/log`
  直到 `running=false`，再刷新 `/api/state`；轮询逻辑收敛在 `usePortfolio.syncAndWait()`。
- 抓取是后端**全局互斥**任务：已有任务在跑时，新请求返回 `started:false`，
  前端把它作为提示展示（而不是报错）。
- 完成后按 lastRun 的 `updated / failed` 给出成功或警告提示。

### 产品名同步（2026-10-15 新增）

产品名（`products.name`）以招行返回的 `prdName`（缺失时 `prdBrief`）为权威来源，共三条路径：

| 路径 | 行为 | 覆盖已有名称？ |
| --- | --- | --- |
| 抓取净值时顺带回填 | `fetchNavPoints` 本就查询产品信息，名称零开销获得；本地为空才写入 | 否（只补空名） |
| 批量录入 / 新增产品后自动补名 | 前端新增成功后自动调 `POST /api/sync/names`（`overwrite=false`） | 否（只补空名） |
| 页头「同步产品名」按钮 | 全量（含已归档）、`overwrite=true`，先弹确认 | 是（以招行为准） |

接口：`POST /api/sync/names`，body `{ codes?: string[], overwrite?: boolean }`（codes 省略 = 全部产品）。
返回 `{ started, total, updated, unchanged, missing, failed, codes, errors }`。
与净值抓取**互不阻塞**（各自独立的互斥标志），单产品失败继续处理其余产品。
历史背景：批量录入的产品此前名称恒为空（`insertProduct` 不写 name、抓取丢弃返回的 name），
导致列表长期显示「未命名产品」，本节功能即为修复该问题。

---

## 13. 常见问题

- **打不开页面**：`systemctl is-active nginx cmb-nav` 都应为 active；
  `curl -H 'Host: <IP>' http://127.0.0.1/api/health` 应返回 200；
  确认云控制台与 firewalld 都放行了 80。
- **502 Bad Gateway**：nginx 起来了但后端没起，或后端不在 `127.0.0.1:9001`。
  看 `systemctl status cmb-nav` 与 `/opt/cmb-nav/logs/app.log`。
- **改了配置不生效**：nginx 用 `nginx -s reload`；应用用 `systemctl restart cmb-nav`。
- **`systemctl restart nginx` 失败并提示 already running**：见第 5 节，宝塔 sysv 脚本的
  误判问题；确认用的是原生单元 `systemctl show -p FragmentPath nginx.service`。
- **提示「未登录或会话已过期」**：正常，去登录页输口令；会话有效期 30 天。
- **忘记口令**：见第 3 节。
- **抓取失败**：检查服务器能否出网访问 `cfweb.paas.cmbchina.com`，看 `logs/app.log`。
- **本地跑报找不到 `node:sqlite`**：本地 Node 22 需加 `--experimental-sqlite`。
