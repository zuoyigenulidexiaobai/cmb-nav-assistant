# 招行理财净值助手（服务器版）

把浏览器插件形态的「理财净值助手」重做成**前后端一体**的网页版：一个 Node 进程（**零 npm 依赖**）
同时托管前端页面与 `/api/*`，数据落在服务器 **SQLite**（`node:sqlite`），多设备访问同一地址共享同一份数据；
净值抓取放在服务端完成（浏览器跨域限制在服务端不再存在），并支持每天定时抓取、启动补抓与失败自动重试。

> ⚠️ **免责声明**：本项目为个人学习与自建自用工具，与任何金融机构无关，不构成投资建议。
> 数据源需要调用方自行准备接口参数（见「配置」一节），仓库内不包含任何第三方凭据。
> 抓取频率请自觉控制，勿对第三方服务造成压力。

---

## 特性

- **单端口同源**：后端同时提供静态页面与 API，无跨域、无额外 web server
- **零 npm 依赖的后端**：只用 `node:http` / `node:sqlite` / `node:crypto` / `node:https`
- **单用户口令认证**：scrypt 派生哈希 + HMAC 签名会话 Cookie + 按 IP 的登录节流
- **定时抓取**：每天固定时刻（默认 09:00 Asia/Shanghai）抓取全部监控中产品
- **启动补抓**：服务启动时若今日定时抓取还没成功跑过，立即补一轮（重启不会重复补）
- **失败自动重试**：仅对失败的产品重试，默认 5 分钟、10 分钟两轮；等待期间不占用抓取锁
- **手动与自动互不覆盖**：同日期已存在手动录入的净值点，自动抓取不会覆盖
- **年化算法纯函数化**：近 1/2/4 周年化、应披露日（上一工作日）、持仓收益与当日收益估算

---

## 快速开始

需要 **Node 22+**（`node:sqlite` 要求；Node 22 需加 `--experimental-sqlite`，Node 24 起内置稳定）。

```bash
# 1) 安装前端依赖
npm install

# 2) 准备配置（数据源参数 + 可选的服务端参数）
cp .env.example .env
#   编辑 .env，至少填 CMB_NAV_API_BASE / APP_ID / AUTH_KEY / BUSINESS_ID

# 3) 启动后端（同时托管 dist/ 与 /api）
npm run build
node server/index.js

# 开发态：前端 5173（已把 /api 代理到 127.0.0.1:9001）
npm run dev
```

打开 `http://127.0.0.1:9001`，用启动日志里打印的初始登录口令登录
（也可以先在 `.env` 里设 `CMB_NAV_PASSWORD` 指定）。首次登录后可在「数据管理」页导入内置种子数据、
批量粘贴产品代码，或直接点「抓取最新净值」。

---

## 配置

环境变量优先级：**真实进程环境 > 项目根目录 `.env` > 代码内默认值**。
`.env` 已被 `.gitignore` 排除；服务器上推荐用 systemd `Environment=` / `EnvironmentFile=` 注入，
这样配置文件不必落在仓库目录里。

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `CMB_NAV_API_BASE` | ✅ | — | 净值接口基地址 |
| `CMB_NAV_APP_ID` | ✅ | — | 接口 appId |
| `CMB_NAV_AUTH_KEY` | ✅ | — | 接口签名密钥 |
| `CMB_NAV_BUSINESS_ID` | ✅ | — | 接口业务标识 |
| `PORT` | | `9001` | HTTP 监听端口 |
| `HOST` | | `0.0.0.0` | 监听地址；前置 nginx 时应为 `127.0.0.1` |
| `TRUST_PROXY` | | 关 | 置 `1` 时信任反代写入的 `X-Real-IP`（前置 nginx 必须开） |
| `PROXY_IP_HEADER` | | `x-real-ip` | 反代传递真实客户端 IP 的请求头名 |
| `DATA_DIR` | | `<root>/data` | 运行时数据目录（SQLite 库 + `auth.json`） |
| `DIST_DIR` | | `<root>/dist` | 前端构建产物目录 |
| `CMB_NAV_PASSWORD` | | 随机生成 | 首次启动的初始登录口令，仅在无 `auth.json` 时生效 |
| `CMB_NAV_TZ` | | `Asia/Shanghai` | 定时任务时区标识（展示与日志用） |
| `CMB_NAV_SCHEDULE_HOUR` | | `9` | 定时抓取小时（0–23） |
| `CMB_NAV_SCHEDULE_MINUTE` | | `0` | 定时抓取分钟（0–59） |
| `CMB_NAV_RETRY_DELAY_MS` | | `300000,600000` | 失败重试延迟列表（毫秒，逗号分隔），长度即重试轮数 |

> 四个数据源变量缺任意一个，服务仍可启动（录入、查看、统计等本地功能正常），
> 只在触发抓取 / 产品名同步时返回可读的失败原因，提示缺哪几个变量。

---

## 技术栈

- **后端**：Node 内置模块（`node:http` / `node:sqlite` / `node:crypto` / `node:https`），零 npm 依赖
- **前端**：Vite 5 + React 18（函数组件 + Hooks）
- **MUI 5**（对话框、表单控件、Snackbar，用量克制）+ **Tailwind CSS 3**（主体布局与设计令牌）
- **Recharts**（净值走势图）

---

## 目录结构

```
cmb-nav-assistant/
├── index.html
├── package.json
├── vite.config.js                 # 含开发态 /api 代理 → 127.0.0.1:9001
├── tailwind.config.js
├── postcss.config.js
├── .env.example                   # 环境变量样例（复制为 .env）
├── seed-data.json                 # 种子数据模板（仓库内为空，可自行填写）
├── server/                        # 后端（零 npm 依赖）
│   ├── index.js                   # HTTP 服务 + 路由分发 + 静态托管（含防路径穿越）
│   ├── db.js                      # SQLite 封装（node:sqlite）+ schema 初始化与幂等迁移
│   ├── auth.js                    # scrypt 口令 + HMAC 会话 token + Cookie + 登录节流
│   ├── cmb.js                     # 数据源客户端（SM4/ECB 签名）
│   ├── scheduler.js               # 定时抓取 + 启动补抓 + 失败重试（全局互斥）
│   └── config.js                  # 环境变量 / .env 解析与路径解析
├── deploy/                        # 部署物料
│   ├── cmb-nav.service            # systemd unit
│   └── cmb-nav.nginx.conf         # nginx 反代示例（含 HTTPS 段注释）
└── src/
    ├── main.jsx                   # 入口：ThemeProvider + PortfolioProvider + LoginGate
    ├── App.jsx                    # 视图切换 + 全局提示
    ├── index.css                  # Tailwind 指令 + 基础样式
    ├── theme.js                   # MUI 主题（浅色金融风）
    ├── lib/
    │   ├── holidays.js            # 工作日 / 节假日表
    │   ├── netvalue.js            # 年化算法核心（纯函数）
    │   ├── api.js                 # 后端 API 客户端（含 AuthError）
    │   ├── storage.js             # 数据归一化 / JSON 序列化
    │   ├── parser.js              # 代码 / 净值 / 持仓输入解析
    │   └── format.js              # 展示格式化
    ├── hooks/usePortfolio.js      # 组合数据状态 + Context（数据源为后端 /api/state）
    ├── data/seed.js               # 种子数据封装（结构与填写方式见文件头注释）
    ├── components/                # LoginGate / Layout / 表格 / 各类对话框 / 走势图
    └── views/                     # Dashboard / NavManager / TrendView / HoldingsView / DataManager
```

运行时目录（`data/`、`dist/`、`logs/`）与 `.env` 均不进版本库。

---

## 页面功能

1. **概览** — 顶部警示条（低于阈值 / 未更新 / 空状态）；4 张指标卡（监控产品数 / 已更新到披露日 / 低于阈值 / 未更新）；产品收益卡片网格（最新净值与日期、近 1/2/4 周年化含基准日与天数、状态标签）。
2. **净值管理** — 表格（代码 / 名称 / 最新净值 / 净值日期 / 近 1/2/4 周 / 状态 / 操作）；批量勾选删除、归档与恢复；按状态筛选、按代码或名称搜索；页头可「抓取最新净值」（全部监控中）/「抓取选中」/「同步产品名」，行内可单独抓取。
3. **净值走势** — 多产品叠加折线图，图例可点选，区间切换（近 1 月 / 3 月 / 6 月 / 全部）。**配色遵守国内习惯：区间内上涨为红色、下跌为绿色。**
4. **持仓收益** — 录入每只产品的份额与成本净值，展示市值、持有收益、持有收益率、持有期年化、当日收益估算。
5. **数据管理** — 立即抓取 / 导入导出 JSON / 导入种子数据 / 清空全部 / 阈值与提醒设置 / 退出登录。

---

## 数据结构（`GET /api/state`）

SQLite 表：`products` / `nav_points` / `holdings` / `settings` / `sync_log`（详见 `server/db.js`）。

```ts
type NavPoint = { date: string /* YYYY-MM-DD */; nav: number };

type Product = {
  code: string;              // 唯一，统一大写
  name: string;              // 可为空
  note: string;
  active: boolean;           // true = 监控中；false = 归档
  holding: null | { shares: number; costNav: number };
  history: NavPoint[];       // 按 date 升序、date 唯一
  createdAt: string;
  updatedAt: string;
};

type AppState = {
  version: 1;
  products: Product[];
  settings: {
    threshold: number;            // 默认 0.03
    staleReminder: boolean;
    alertBelowThreshold: boolean;
  };
};
```

`sync_log` 记录每次抓取：`trigger_kind` 区分 `manual`（手动）/ `schedule`（定时）/ `catchup`（启动补抓）/ `retry`（失败重试）。

---

## 算法约定

年化计算集中在 `src/lib/netvalue.js`（纯函数，可直接在 Node 里单测）：

| 函数 | 规则 |
| --- | --- |
| `daysBetween(a, b)` | `(a - b)` 的整天数（`Date.UTC` 归一化后四舍五入） |
| `findBasePoint(points, latest, days)` | `target = latest.date - days`，取 `date <= target` 中日期最大的点，返回 `{ base, actualDays }` |
| `annualized(latest, base, actualDays)` | `Math.pow(latest / base, 365 / actualDays) - 1`；`actualDays <= 0` → `NaN` |
| `PERIODS` | 近 1 周 / 2 周 / 4 周 = 7 / 14 / 28 天 |
| `isBusinessDay` / `previousBusinessDay` | 非周六日且不在节假日表；**应披露日 = 上一工作日** |

自检样例（可直接对照）：

```
latestNav = 1.0399 @ 2026-07-23
baseNav   = 1.0388 @ 2026-07-09
actualDays = 14
→ annualized = 0.02797700440093087
```

非工作日不再「跳过查询」：始终计算并展示，只用 `businessDay` 标记今日是否为工作日，
应披露日仍取上一工作日，因此任意时间打开都能看到数据。

---

## 输入格式

- **产品代码**：按 `[,\uFF0C\n\r\t;；\s]+` 切分 → 去空格 → 转大写 → 去重 → 过滤已存在。
- **批量净值**：每行一条，支持 `<tab>` `,` `，` 空格；格式 `日期 净值`（兼容 `代码 日期 净值`）。
  - 日期接受 `YYYY-MM-DD`、`YYYYMMDD`、`YYYY/MM/DD`；净值接受小数。
  - 解析失败的行**逐行报错**，有效行照常保存，不整体失败。
- **同一产品同日期 → 覆盖旧值**；历史始终按日期升序保存。
- 删除、清空等危险操作均需二次确认。

---

## 部署

`deploy/` 下提供了 systemd unit 与 nginx 反代示例，典型拓扑：

```
浏览器 → nginx(80/443) → 127.0.0.1:9001 (Node，只监听回环)
```

要点：

1. Node 只监听回环（`HOST=127.0.0.1`），对外统一经 nginx；
2. 必须开启 `TRUST_PROXY=1`，否则登录节流会把所有请求当成同一个来源；
3. nginx 用 `proxy_set_header X-Real-IP $remote_addr` **覆写**该头（`deploy/cmb-nav.nginx.conf` 已写好），客户端自带的同名头会被丢弃，无法伪造；
4. 数据目录 `DATA_DIR` 建议放在独立磁盘/备份目录，定期 `sqlite3 .backup`；
5. 纯 HTTP 部署时会话 Cookie 不带 `Secure`；上 HTTPS 后可自行在 `server/auth.js` 的 `buildSessionCookie` 中加上。

---

## 常见问题

**1. `npm run build` 报 `Cannot find module @rollup/rollup-win32-x64-msvc`**

npm 对 optionalDependencies 的已知缺陷（[npm/cli#4828](https://github.com/npm/cli/issues/4828)），由安装中断后残留半成品触发：
`rm -rf node_modules package-lock.json && npm install`。

**2. 为什么不直接在浏览器里抓净值？**

数据源禁止浏览器跨域（预检返回 405 且无 `Access-Control-*` 响应头），因此抓取必须放到服务端。

**3. 抓取提示缺少环境变量？**

按提示补齐 `CMB_NAV_API_BASE` / `APP_ID` / `AUTH_KEY` / `BUSINESS_ID` 后重启。这四个参数需自行向数据源方获取，仓库不提供。

**4. 数据存在哪里？换设备会丢吗？**

存在服务器 SQLite（`DATA_DIR/cmb.db`），手机与电脑访问同一地址共享同一份数据。定期用「数据管理 → 导出 JSON」或 `sqlite3 .backup` 备份。

**5. 为什么有的产品显示「未更新」？**

其最新净值日期早于「应披露日」（上一工作日）。点「抓取最新净值」补数据，或手动录入。

**6. `src/hooks/usePortfolio.js` 里为什么有 JSX？**

该文件包含返回 JSX 的 `PortfolioProvider`，故 `vite.config.js` 显式配了 `esbuild.loader = 'jsx'`，让 `.js` 也能写 JSX。

---

## 数据来源

净值来自**服务端定时/手动抓取**（`source='cmb'`）或**用户手动录入/批量粘贴**（`source='manual'`）。
同日期已存在手动点时，自动抓取不覆盖。种子数据（`seed-data.json`）默认为空模板，由使用者自行决定是否预置。

## License

MIT
