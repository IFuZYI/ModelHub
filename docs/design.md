# ModelHub 设计文档

多租户 AI API 站点目录平台。用户各自维护自己的站点与实时模型清单，并可对外发布
个人分享页（博客式：用户即博主、站点即文章）。访客可只读浏览、检索、评分评论。

关联决策：ADR 0001 ~ 0015（见 `docs/adr/`）。术语见 `docs/glossary.md`。
v0.3 多租户落地路线见 `docs/plan-v0.3-multitenant.md`。

## 1. 目标与非目标

### 目标

- 多用户平台：每个用户维护自己的 API 站点（user-provider）与模型列表。
- 访客无需登录即可浏览目录、检索、查看个人分享页。
- 注册用户可对站点 0–5 星评分、发表评论、为站点打自定义标签。
- 每个用户有公开个人页（`/p/<slug>`）与公开资料（显示名 / 简介 / 头像）。
- 模型定时（默认 6h）+ 手动刷新，带缓存，失败保留旧值。
- API key 加密存储于后端，永不下发前端。

### 非目标

- 不展示价格（只展示模型可用性）。
- 不做历史/价格变动记录。
- 不做评论嵌套回复、私信等社交功能。

## 2. 架构

Next.js 一体化单进程（App Router）：

```
┌────────────────────────────────────────────────────────────┐
│                        Next.js 进程                          │
│                                                             │
│  前端 (React 19)                                             │
│   ├─ /                 目录 + 搜索 + 排序（公开）             │
│   ├─ /providers/:id    站点详情 + 评分 / 评论 / 标签（公开）   │
│   ├─ /p/:slug          个人分享页（公开）                     │
│   ├─ /login            登录 / 注册（含邮箱验证步骤）           │
│   └─ /console/*        控制台（侧边栏：概览 / 我的站点 /       │
│                        个人资料 / 账号安全 / 管理项）          │
│         ↑ 只收脱敏视图，永不见 key                            │
│  ────────────────────────────────────────────────────────  │
│  后端 (API routes, 薄路由)                                    │
│   ├─ /api/providers       站点 CRUD / 详情                    │
│   ├─ /api/providers/:id/{refresh,ratings,comments,tags}       │
│   ├─ /api/search  /api/tags  /api/pages/:slug                 │
│   ├─ /api/me/{providers,profile,password,slug}                │
│   ├─ /api/auth/{login,register,verify,logout,status}          │
│   └─ /api/admin/{users,settings,stats}                        │
│         ↓                                                     │
│  services 层（用例） → infra（db / repositories / crypto）      │
│         ↓                                                     │
│  SQLite（默认）或 PostgreSQL，经 Kysely + 版本化迁移           │
└────────────────────────────────────────────────────────────┘
         ↓ 出站 HTTPS（携带解密后的 key）
   上游: 官方 API / NewAPI 中转站 /v1/models
        或目录适配器（spullara / models.dev / LiteLLM，无需 key）
```

- `npm start`（`next start`）默认监听所有接口（0.0.0.0）；私有部署建议 `-H 127.0.0.1`。
- 主密钥 `MODELHUB_MASTER_KEY` 来自环境变量；在录入 / 更新站点 key 时经
  `assertMasterKey()` 校验（未设置则拒绝该操作），进程本身不 fail-fast。

## 3. 数据模型

迁移 `migrations/0001..0005` 定义（SQLite / Postgres 双方言）：

| 表 | 用途 |
|---|---|
| `users` | 账号：username、email、password_hash(scrypt)、role、status、token_version、slug |
| `user_providers` | 用户挂载的站点：name/description/type/base_url/free_tier/icon/adapter/aff_code/catalog_slugs/key_enc/register_methods |
| `model_caches` | 每个 user-provider 的模型列表缓存 + last_fetched/last_status/last_error |
| `provider_stats` | 按 `normalized_base_url` 聚合的全服统计（名称/类型/票数/人数） |
| `key_pool` | 按 `normalized_base_url` 归组的共享 key（仅用于模型探测） |
| `settings` | key-value 系统设置（SMTP 密码等敏感项加密存储） |
| `email_verifications` | 注册邮箱验证码（6 位，15 分钟有效） |
| `user_profiles` | 公开资料：display_name / bio / avatar |
| `tags` | 全局标签词库：slug（唯一）/ name |
| `provider_tags` | 站点 ↔ 标签多对多 |
| `ratings` | 评分：`(user_provider_id, user_id)` 唯一，score 0–5（CHECK 约束） |
| `comments` | 评论：站点 + 作者 + body |
| `invite_codes` | 平台邀请码池：来源（user/admin）、码值、按 `normalized_base_url` 隔离（0005） |

- `key_enc`：AES-256-GCM 密文（iv + ct + tag），绝不出现在任何 API 响应中。
- `normalized_base_url`：`normalizeBaseUrl()` 结果（小写、去默认端口、去尾部 `/`、
  去尾部 `/v1`、忽略 query/fragment），用作去重键 / 聚合键 / 归组键。

## 4. 后端接口

薄路由：`withErrorHandling` 包裹 → 鉴权守卫（`requireUser` / `requireAdmin`）→
`parseJson(schema)` 校验 → 调 service。错误统一信封
`{ error: { code, message, details? } }`。

| 分组 | 端点 |
|---|---|
| 公开 | `GET /api/providers`、`/api/providers/:id`、`/:id/{ratings,comments,tags}`、`/api/search`、`/api/tags`、`/api/pages/:slug`、`/api/health` |
| 认证 | `POST /api/auth/{login,register,verify,logout}`、`GET /api/auth/status` |
| 站点 | `POST /api/providers`、`PUT/DELETE /api/providers/:id`、`POST /api/providers/:id/refresh`、`POST /api/providers/import` |
| 社区 | `PUT /api/providers/:id/ratings`、`POST /api/providers/:id/comments`、`PUT /api/providers/:id/tags`、`DELETE /api/comments/:id` |
| 个人 | `GET /api/me/providers`、`GET/PUT /api/me/profile`、`POST /api/me/password`、`POST /api/me/slug` |
| 管理 | `GET/POST /api/admin/users`、`PUT/DELETE /api/admin/users/:id`、`GET/PUT /api/admin/settings`、`GET/POST /api/admin/stats`、`GET/POST /api/admin/invite-codes`、`DELETE /api/admin/invite-codes/:id` |
| 迁移 | `GET /api/admin/transfer/export`、`POST /api/admin/transfer/import`（`?mode=merge\|replace`） |

完整端点表见 README「API」一节。

## 5. 模型抓取

来源优先级（`lib/upstream/`）：

1. **实时 API**（`lib/upstream/openaiCompatible.ts`）：按以下顺序尝试，取第一个
   非空结果——① `GET {base}/api/pricing`（NewAPI 定价端点，无需 key）；
   ② `GET {base}/v1/models`（OpenAI 标准列表，带 key）；③ `GET {base}/models`
   （版本段已在 base_url 中的厂商，如 `.../v4`、`.../v3`）。
2. **目录适配器**（无需 key，仅官方原生 / 中转）：按内置适配器优先级
   `spullara → models-dev → litellm` 兜底，第一个返回非空列表的胜出：
   - `spullara` — 官方一手模型列表（spullara/models）
   - `models-dev` — models.dev `api.json`
   - `litellm` — LiteLLM 价格目录

NewAPI 站点可走公开 `/api/pricing` 探测，无需 key。

- 成功：写 `models`、`last_fetched`、`last_status=ok`、清 `last_error`。
- 失败：保留旧 `models`，写 `last_status=error`、`last_error`。
- 抓取带超时；429/5xx 与网络错误有界重试（`MODELHUB_FETCH_RETRIES` 次，线性退避
  `250ms × 尝试序号`）；全量刷新有界并发（`MODELHUB_REFRESH_CONCURRENCY`）。
- `manual_models=true` 的站点不参与自动抓取（固定列表）。

## 6. 调度器

进程内定时器（`lib/services/scheduler.ts`）：

- 每 `refresh_interval_hours`（默认 6h）全量刷新；启动 5s 后先跑一次。
- 逐个站点刷新，单个失败 try/catch 隔离。
- 同周期另跑标签卫生清扫（`pruneWithLock`），清理无引用的孤儿标签。

## 7. 前端

### 公开页面

- **主页 `/`**：站点卡片网格（含评分星级）；搜索（防抖 + 请求序号守卫，
  避免过期响应覆盖）；按评分（默认）/ 模型数 / 名称排序；分类筛选。
- **站点详情 `/providers/:id`**：模型列表（按厂商分组、可过滤）；评分（0–5 星，
  登录后可评可清）；评论（登录后可发，作者或站点主人可删）；标签芯片（点击跳搜索）；
  作者信息与「前往」站点链接。
- **个人分享页 `/p/:slug`**：作者卡片（头像/昵称/简介/统计）+ 该用户的站点卡片，
  每张卡片含「前往」直达站点（有邀请码时带 `?aff=`）。

### 控制台 `/console/*`

统一侧边栏（`ConsoleShell`）：身份卡片 + 纵向菜单，当前项高亮；≤860px 折叠为抽屉。
管理员专属菜单项对普通用户隐藏，直访受 `requireAdmin` 守卫。

- **概览**：博客式仪表盘（统计磁贴 + 个人主页卡 + 我的站点预览）。
- **我的站点**：站点 CRUD、NewAPI 一键导入、标签编辑、手动刷新。
- **个人资料**：显示名 / 头像 / 简介 + 个人页 slug 管理。
- **账号安全**：修改密码（成功后重新登录）。
- **用户管理 / 全服统计 / 系统设置**：管理员。

## 8. 安全基线

- key 加密落盘（AES-256-GCM），解密仅在内存、仅用于出站请求。
- API 响应永不含 key（脱敏视图）。
- 密码 scrypt 哈希；会话为无状态 HMAC cookie，吊销靠 `users.token_version`。
- 评论删除校验「作者或站点主人」；站点写操作校验属主。
- 匿名用户评分 / 评论返回 401。
- 头像仅接受 http(s) URL（防 `javascript:` / `data:` 注入到 `<img src>`）。
- `npm start` 默认监听所有接口（0.0.0.0）；`.env` 与 `data/` 进 `.gitignore`。
- 主密钥丢失 => 需重录 key（可接受）。

## 9. 目录结构

```
ModelHub/
├─ docs/
│  ├─ design.md            # 本文档
│  ├─ glossary.md          # 术语表
│  ├─ PROVIDER_FORM.md     # 提供商表单字段
│  ├─ plan-v0.3-multitenant.md
│  └─ adr/0001..0015.md    # 架构决策记录
├─ app/
│  ├─ page.tsx             # 主页（目录 + 搜索）
│  ├─ providers/[id]/      # 站点详情
│  ├─ p/[slug]/            # 个人分享页
│  ├─ login/               # 登录 / 注册
│  ├─ console/             # 控制台（概览 / 站点 / 资料 / 账号 / 管理项）
│  ├─ admin/               # 旧路径 → 307 跳 /console/*
│  ├─ components/          # SiteHeader / ConsoleShell / badges / Select …
│  └─ api/**               # 薄路由
├─ lib/
│  ├─ domain/              # 纯领域（provider / user / blog / vendor / stats / …）
│  ├─ infra/               # db / migrate / crypto / password / logger / repositories
│  ├─ services/            # 用例层
│  ├─ upstream/            # 模型来源适配器
│  ├─ config/env.ts        # 环境配置（zod fail-fast）
│  └─ http/handler.ts      # 错误信封 + parseJson
├─ migrations/0001..0005
├─ tests/                  # vitest（29 文件 / 199 用例）
├─ data/                   # SQLite（gitignore）
└─ .env                    # gitignore
```

## 10. 未决 / 后续可扩展

- 忘记密码 / 找回流程（依赖 SMTP，尚未实现）。
- 评论嵌套回复、点赞。
- 个人页自定义展示（排序、隐藏某些站点）。
- 站点历史与价格（若日后需要，`/api/pricing` 本就带价格）。
- 多进程部署下的标签写：已加 Postgres advisory lock；若改用多副本需确认所有写路径都走该锁。
