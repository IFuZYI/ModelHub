# ModelHub

AI API 站点目录平台。用户各自维护自己的 API 站点与实时模型清单，并可对外发布
个人分享页——形态类似博客：**用户即博主，站点即文章**。访客无需登录即可浏览、
按模型或来源跨站检索、对站点评分与评论。主页目录由首个管理员维护，各用户的站点
展示在各自的个人分享页（`/p/<slug>`）。

## 特性

### 浏览与检索

- 站点卡片总览（主页 = 首个管理员的站点）+ 详情页（完整模型清单，可按厂商分组与过滤）
- 跨站搜索：按**模型名**或**来源（厂商）**检索，也可按站点名与标签检索
- 主页支持按评分 / 模型数 / 名称排序（默认按评分）
- 深色 / 浅色主题

### 社区（v0.4 博客层）

- **评分**：每个站点 0–5 星，仅注册用户可评分，可修改或清除
- **评论**：站点下方评论，仅注册用户可发表；作者或站点主人可删除
- **标签**：全局标签词库，用户可为站点自定义标签（每站最多 12 个）
- **个人分享页**：`/p/<slug>` 展示该用户的公开资料与站点，含总评分、评论数
- **个人资料**：显示名称、简介、头像，展示在个人页与站点卡片上

### 站点管理

- 添加 / 编辑 / 删除站点，支持官方（原生 / 中转）与 NewAPI / 自建
- NewAPI 站点支持一键导入（探测 `/api/status` 预填名称与图标；邀请码取自粘贴 URL 的 `?aff=`）
- 模型默认每 6 小时自动刷新，也可手动刷新；失败保留上次缓存
- API key 以 AES-256-GCM 加密存储，永不下发前端

### 管理

- 用户管理：建号、改角色、禁用 / 启用、删除
- 系统设置：注册开关、邮箱验证、SMTP、个人页开关、key 共享、邀请码留空策略
- 邀请码池：自动汇总「用户站点上填的邀请码 + 管理员登记的邀请码」，主页与详情页随机抽取展示，
  个人分享页始终展示站点主人自己的码。站点侧填 `RANDOM` 即从池中随机。
  见 [ADR-0015](docs/adr/0015-invite-code-pool.md)
- 全服统计：按 `normalized_base_url` 聚合的全服站点视图，可一键收编
- 数据迁移：整站导出 / 导入（12 张表：用户、个人资料、站点、模型缓存、标签、站点标签关联、
  评分、评论、全服统计、key 池、邀请码池、设置），用于换服务器；用户密码以哈希携带，
  迁移后无需重置。见 [ADR-0014](docs/adr/0014-data-transfer.md)

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router）+ React 19 |
| 语言 | TypeScript 5.7（strict） |
| 数据库 | SQLite（默认，`better-sqlite3`）/ PostgreSQL 可选，查询层 Kysely（双 dialect） |
| 校验 | zod（入站 + 持久化） |
| 日志 | pino（自动脱敏） |
| 测试 | vitest |

## 快速开始

```bash
npm install

# 生成主密钥（AES-256-GCM，用于加密站点 API key）
node -e "console.log('MODELHUB_MASTER_KEY=' + require('crypto').randomBytes(32).toString('base64'))" > .env
# 初始管理员密码（首启创建 admin 账号）
echo "MODELHUB_ADMIN_PASSWORD=你的密码" >> .env

npm run build
npm start
# 开发：npm run dev
```

- 前台目录：http://localhost:3000 （公开浏览，无需登录）
- 控制台：http://localhost:3000/console （登录后：概览 / 我的站点 / 个人资料 / 账号安全；
  管理员另见用户管理 / 全服统计 / 系统设置）
- 旧路径 `/admin/*` 会 307 跳转到 `/console/*`

`npm start`（`next start`）默认监听所有接口。私有部署建议只绑回环：
`npx next start -H 127.0.0.1`。

首次启动会自动建库、跑迁移，并用 `MODELHUB_ADMIN_PASSWORD` 创建 `admin` 账号
（未设置则生成随机密码，仅记录一条警告、不打印密码值）。注册默认关闭，可在
「系统设置」中开启。

## 控制台结构

登录后统一走 `/console` 侧边栏：

| 路径 | 名称 | 权限 |
|---|---|---|
| `/console` | 概览（博客式仪表盘） | 登录用户 |
| `/console/providers` | 我的站点 | 登录用户 |
| `/console/profile` | 个人资料 | 登录用户 |
| `/console/account` | 账号安全（改密码） | 登录用户 |
| `/console/users` | 用户管理 | 管理员 |
| `/console/stats` | 全服统计 | 管理员 |
| `/console/settings` | 系统设置 | 管理员 |

公开页面：`/`（目录 + 搜索，展示首个管理员的站点）、`/providers/<id>`（站点详情）、
`/p/<slug>`（个人分享页）。

旧的 `/admin/*` 路径保留为 307 重定向到对应的 `/console/*`，兼容旧书签。

## 架构

分层，路由只做编排：

```
app/api/**            薄路由：鉴权守卫 + 入站校验 + 错误信封
  ↓
lib/services/**       用例层：authService / userProviderService / blogService /
                      searchService / publicService / statsService / keyPoolService /
                      settingsService / userService / inviteCodeService /
                      transferService / scheduler / importer / mailer / probe
  ↓
lib/infra/**          db（Kysely 双方言 + 迁移）、repositories（数据访问）、
                      crypto（AES-256-GCM）、password（scrypt）、logger（pino）
lib/domain/**         纯领域：provider / user / blog（标签·评分·评论）/ vendor /
                      stats / presets / validation / errors
lib/upstream/**       模型来源适配器：openaiCompatible / spullara / models-dev / litellm
```

- 配置集中校验（zod，fail-fast）：`lib/config/env.ts`
- 版本化迁移：`migrations/0001..0005`，按 version 幂等应用
- 结构化日志（pino，自动脱敏 key）：`lib/infra/logger.ts`
- 健康检查：`GET /api/health`
- 测试：29 个文件 / 199 用例（`tests/`）

### 数据模型（迁移 0001–0005）

`users`、`user_providers`、`model_caches`、`provider_stats`、`key_pool`、`settings`
（以上 0001）；`email_verifications`（0002）；`user_profiles`、`tags` + `provider_tags`、
`ratings`、`comments`（0004）；`invite_codes`（0005）。0003 仅新增性能索引，不建表。

标签写操作在进程内串行（`globalThis` 锁链）并在 Postgres 上取事务级 advisory
lock，避免并发写死锁或静默丢链。

## API

### 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/providers` | 主页站点列表（含作者 / 标签 / 评分 / 评论数） |
| GET | `/api/providers/:id` | 站点详情 + 模型 + 评论 |
| GET | `/api/providers/:id/ratings` | 评分汇总 + 列表（登录时含 `my_score`） |
| GET | `/api/providers/:id/comments` | 评论列表 |
| GET | `/api/providers/:id/tags` | 站点标签 |
| GET | `/api/search` | 跨站搜索（`q` / `author` / `tag` / `type` / `limit`） |
| GET | `/api/tags` | 标签词库（含使用数） |
| GET | `/api/pages/:slug` | 个人分享页数据 |
| GET | `/api/health` | 健康检查 |

### 需登录

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` · `/register` · `/verify` · `/logout` | 认证 |
| GET | `/api/auth/status` | 会话与站点开关状态 |
| POST | `/api/providers` | 新建站点（属主） |
| PUT/DELETE | `/api/providers/:id` | 编辑 / 删除（属主） |
| POST | `/api/providers/:id/refresh` | 立即重抓 |
| GET/PUT/DELETE | `/api/providers/:id/ratings` | 查看 / 评分（0–5）/ 撤销评分 |
| POST | `/api/providers/:id/comments` | 发表评论 |
| PUT | `/api/providers/:id/tags` | 替换站点标签（属主） |
| DELETE | `/api/comments/:id` | 删除评论（作者或站点主人） |
| GET/PUT | `/api/me/profile` | 个人资料 |
| POST | `/api/me/password` | 修改密码 |
| POST/DELETE | `/api/me/slug` | 生成 / 撤销个人页 slug |
| GET | `/api/me/providers` | 我的站点（含状态诊断） |
| POST | `/api/providers/import` | NewAPI 站点探测导入 |

### 管理员

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/users` | 用户列表 / 建号 |
| PUT/DELETE | `/api/admin/users/:id` | 改角色·状态 / 删除 |
| GET/PUT | `/api/admin/settings` | 系统设置 |
| GET/POST | `/api/admin/stats` | 全服统计 / 一键收编 |
| GET | `/api/admin/transfer` | 各表行数（迁移面板用） |
| GET | `/api/admin/transfer/export` | 导出整站数据（`?secrets=1` 含密钥） |
| POST | `/api/admin/transfer/import` | 导入（`?mode=merge\|replace`） |
| GET/POST | `/api/admin/invite-codes` | 邀请码池列表 / 登记邀请码 |
| DELETE | `/api/admin/invite-codes/:id` | 删除管理员登记的邀请码 |

所有错误响应统一信封：`{ error: { code, message, details? } }`；校验失败时
`message` 会带具体字段原因（如「密码：密码至少 8 位」）。

## 配置

见 `.env.example`。`MODELHUB_MASTER_KEY` 用于 AES-256-GCM 加密站点 API key，
在录入 / 更新 key 时校验（未设置则拒绝该操作）；`MODELHUB_ADMIN_PASSWORD` 用于
首启创建管理员（缺失则生成随机密码，仅记录一条警告、不打印密码值）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `MODELHUB_MASTER_KEY` | — | 32 字节（base64/hex），AES-256-GCM 主密钥；录入 key 时必需 |
| `MODELHUB_ADMIN_PASSWORD` | — | 首启管理员密码 |
| `MODELHUB_DATA_PATH` | `./data` | SQLite 数据目录（或 `.db` 路径） |
| `DATABASE_DRIVER` | `sqlite` | `sqlite` \| `postgres` |
| `DATABASE_URL` | — | postgres 连接串（driver=postgres 时必填） |
| `MODELHUB_ADMIN_PATH` | `/admin` | 自定义后台路径（仅混淆 URL，非鉴权）。**构建期变量**：Next 的 rewrites 在 `next build` 时烘进 routes-manifest，运行时设置无效，需重新构建（Docker 场景：改 `.env` 后 `docker compose up --build -d`） |
| `MODELHUB_REFRESH_INTERVAL_HOURS` | `6` | 自动刷新间隔 |
| `MODELHUB_FETCH_TIMEOUT_MS` / `MODELHUB_FETCH_RETRIES` / `MODELHUB_REFRESH_CONCURRENCY` | `15000` / `2` / `4` | 抓取超时 / 重试 / 并发调优 |
| `MODELHUB_ALLOW_PRIVATE_FETCH` | 关 | 允许探测回环 / 内网地址（自托管场景探测 LAN 上的中转站时才开）。默认关闭，因为任何登录用户都能借站点导入 / 刷新触发服务端请求，开放后会成为 SSRF 通道（可探 169.254.169.254 等） |
| `LOG_LEVEL` | `debug`（生产 `info`） | 日志级别 |

## 脚本

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建（standalone）
npm start            # 启动生产服务
npm run typecheck    # tsc 类型检查
npm run lint         # ESLint
npm run format       # Prettier 格式化
npm run format:check # 只检查格式不写入（CI 用）
npm run test         # vitest 单元测试（29 文件 / 199 用例）
npm run test:watch   # vitest 监听模式
```

运维 / 审计辅助脚本（`scripts/`）：

| 脚本 | 用途 |
|---|---|
| `api-sweep.mjs` | 43 项 API 探针：鉴权、入参校验、错误码（`node scripts/api-sweep.mjs <url> <user> <pass>`） |
| `ui_checks.py` | UI 布局 / 对比度 / 表单标签测量 |
| `ui_theme_responsive.py` | 浅色主题 AA + 导航可达性 |
| `ui_interactions.py` | 焦点 / 键盘 / 删除确认 |
| `ui_probe.py` | 单页 UI 探针（调试用） |
| `associate_labels.py` | 批量给 JSX 补 `htmlFor`+`id` |
| `seed-official.mjs` | 把内置官方站点预设写入运行中的实例（幂等） |
| `run-test-env.sh` | 启动本地测试实例（端口 9000） |

## Docker 部署

```bash
# 方式一：环境变量
export MODELHUB_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export MODELHUB_ADMIN_PASSWORD=你的密码
docker compose up --build -d

# 方式二：在项目根写 .env（compose 自动读取），然后
docker compose up --build -d
```

- 默认 **SQLite**，数据存于命名卷 `modelhub-data`（容器内 `/data/app.db`）。
- 默认仅绑定回环 `127.0.0.1:3000`；改端口用 `MODELHUB_PORT=8080`。
- 容器以非 root 用户（uid 1001）运行；入口脚本以 root 启动仅用于修正 `/data`
  属主后立即降权，因此从旧卷（root 属主）升级也能正常启动。
- 内置健康检查 `GET /api/health`，会探活数据库；库不可用返回 503 并置容器 unhealthy。

**PostgreSQL 后端**（可选，compose profile）：

```bash
export POSTGRES_PASSWORD=改成强密码            # 可选，默认 modelhub
DATABASE_DRIVER=postgres docker compose --profile postgres up --build -d
```

postgres 服务不对外发布端口，仅在 compose 网络内可达；`modelhub` 会等它 healthy
后再启动。改了 `POSTGRES_PASSWORD` 时，同时设置 `DATABASE_URL` 保持一致。

> 注意：Dockerfile 会在 `deps` 阶段安装 `python3/make/g++` 以编译
> `better-sqlite3`（alpine 无 musl 预编译包），运行镜像不含工具链。
> 手动运行 `node .next/standalone/server.js` 时，需先
> `cp -r .next/static .next/standalone/.next/static`，否则页面 chunk 404。

## 安全说明

- `.env` 与 `data/`（含数据库）在 `.gitignore` 中，绝不提交。
- 站点 API key 以 AES-256-GCM 加密落盘，解密仅在内存、仅用于服务端出站请求，
  永不进入 API 响应或日志。
- 主密钥丢失后已存 key 无法解密，需重新录入。
- 密码用 scrypt 哈希；会话为无状态 HMAC cookie，吊销靠 `users.token_version`。
- **SSRF 防护**：站点导入与刷新会请求用户填写的 URL，因此默认拒绝回环 / 内网 /
  链路本地地址（含云元数据 `169.254.169.254`）。自托管需要探测 LAN 中转站时用
  `MODELHUB_ALLOW_PRIVATE_FETCH=true` 显式放行。
- 登录对不存在的用户名也执行一次哈希校验，避免用响应时间枚举账号。
- 导入整站数据时，`smtp_password` 等密钥列一律重新加密落盘（即便文件里是明文）；
  覆盖导入前校验文件中至少存在一个密码哈希可用的管理员，避免导入后无人能登录。
- 默认监听所有接口；私有部署建议 `npx next start -H 127.0.0.1`（compose 已绑 127.0.0.1），
  不要暴露到公网。

## 文档

- 设计文档：`docs/design.md`
- 架构决策记录：`docs/adr/0001..0015`
- 术语表：`docs/glossary.md`
- 提供商表单字段：`docs/PROVIDER_FORM.md`
- v0.3 多租户升级计划：`docs/plan-v0.3-multitenant.md`

## UI 质量

UI 有一组可复跑的测量式检查（不是截图目测），改动界面后建议跑一遍：

```bash
python3 scripts/ui_checks.py            # 布局 / 对比度 / 表单标签（12 页 × 5 视口）
python3 scripts/ui_theme_responsive.py  # 浅色主题 WCAG AA + 320→1440 导航可达性
python3 scripts/ui_interactions.py      # 焦点可见性 / 键盘 / 删除确认
```

源码级回归由 `tests/a11yLabels.test.ts`（每个 label 必须关联控件）和
`tests/confirmDialog.test.ts`（禁止原生 `confirm`/`alert`）覆盖。
