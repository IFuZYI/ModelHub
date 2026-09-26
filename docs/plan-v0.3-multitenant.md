# v0.3 多租户升级 — 实施计划

> 依据 ADR 0009–0012。本文件是落地路线图：迁移顺序、表结构、模块拆分、
> 分阶段交付与测试策略。按阶段推进，每阶段独立通过 typecheck / lint /
> test / build 后再进下一阶段。

## 0. 决策快照（全部已接受）

- DB：SQLite 默认 + Postgres 可选，查询层 **Kysely**（双 dialect）。
- 密码：`crypto.scryptSync`；会话：无状态 HMAC cookie（`user_id.role.exp`），
  吊销靠 `users.token_version`。
- URL 归一化去 `/v1`；user-provider 完整独立、`(user_id, normalized_base_url)`
  唯一。
- key 池按 base_url 归组，贡献自动、消费两开关、401/403×2 只删池。
- 注册默认关、个人页默认关、初始 admin 取 `MODELHUB_ADMIN_PASSWORD`（缺失
  走首启安装向导）。

## 1. 依赖与配置

新增依赖：
- `better-sqlite3`（pinned），`pg`（pinned），`kysely`（pinned）。
- 类型：`@types/better-sqlite3`、`@types/pg`（dev）。

env 新增（`lib/config/env.ts`）：
- `DATABASE_DRIVER`：`sqlite` | `postgres`，默认 `sqlite`。
- `DATABASE_URL`：postgres 连接串（driver=postgres 时必填）。
- SQLite 路径复用 `MODELHUB_DATA_PATH`（目录）下的 `app.db`。
- SMTP 兜底（可选）：`SMTP_HOST/PORT/USERNAME/PASSWORD/FROM`（UI 配置优先）。

## 2. 数据库 schema（DDL 概览）

```
users
  id            TEXT/UUID PK
  username      TEXT UNIQUE NOT NULL
  email         TEXT UNIQUE NULL
  password_hash TEXT NOT NULL          -- scrypt: salt$params$hash
  role          TEXT NOT NULL          -- 'admin' | 'user'
  status        TEXT NOT NULL          -- 'active' | 'disabled'
  token_version INTEGER NOT NULL DEFAULT 0
  slug          TEXT UNIQUE NULL       -- 个人页 12 位哈希
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL

user_providers
  id                  TEXT/UUID PK
  user_id             TEXT FK->users.id ON DELETE CASCADE
  name                TEXT NOT NULL
  description         TEXT NULL
  type                TEXT NOT NULL     -- native|proxy|newapi|custom
  base_url            TEXT NOT NULL     -- 原始
  normalized_base_url TEXT NOT NULL     -- 去重/聚合键
  free_tier           TEXT NOT NULL     -- full|free|none
  icon                TEXT NULL
  adapter             TEXT NOT NULL
  aff_code            TEXT NULL
  catalog_slugs       TEXT NULL         -- JSON
  key_enc             TEXT NULL         -- JSON {v,iv,ct,tag}
  manual_models       INTEGER NOT NULL DEFAULT 0
  register_methods    TEXT NULL         -- JSON
  UNIQUE(user_id, normalized_base_url)

model_caches            -- 每 user_provider 一份（模型按用户独立）
  user_provider_id TEXT PK FK->user_providers.id ON DELETE CASCADE
  models        TEXT NOT NULL           -- JSON string[]
  count         INTEGER NOT NULL
  last_fetched  TEXT NULL
  last_status   TEXT NOT NULL           -- ok|error|pending|needs_key
  last_error    TEXT NULL
  updated_at    TEXT NULL

provider_stats          -- 全服聚合，按 base_url
  normalized_base_url TEXT PK
  base_url        TEXT NOT NULL         -- 代表性原始地址
  name            TEXT NULL             -- admin 覆盖优先，否则众数
  icon            TEXT NULL
  type            TEXT NULL
  free_tier       TEXT NULL
  admin_name      TEXT NULL             -- 管理员显式设定（覆盖用）
  admin_icon      TEXT NULL
  admin_type      TEXT NULL
  admin_free_tier TEXT NULL
  type_votes      TEXT NULL             -- JSON {native:n,...}
  free_tier_votes TEXT NULL             -- JSON
  user_count      INTEGER NOT NULL DEFAULT 0
  updated_at      TEXT NOT NULL

key_pool                -- 共享 key，仅探测
  id                  TEXT/UUID PK
  normalized_base_url TEXT NOT NULL     -- INDEX
  contributor_user_id TEXT FK->users.id ON DELETE CASCADE
  key_enc             TEXT NOT NULL     -- JSON
  status              TEXT NOT NULL     -- valid|invalid|unverified
  fail_count          INTEGER NOT NULL DEFAULT 0
  updated_at          TEXT NOT NULL
  UNIQUE(normalized_base_url, contributor_user_id)

settings                -- 单行 JSON 或 kv；敏感字段加密
  key   TEXT PK
  value TEXT NOT NULL

schema_migrations
  version    INTEGER PK
  applied_at TEXT NOT NULL
```

## 3. 模块拆分

```
lib/
├─ infra/
│  ├─ db.ts              连接 + dialect 选择（Kysely + better-sqlite3 / pg）
│  ├─ migrate.ts         版本化迁移执行器（启动时按序）
│  ├─ crypto.ts          （复用，AES-256-GCM）
│  └─ repositories/
│     ├─ userRepo.ts
│     ├─ userProviderRepo.ts   （替代旧 fileRepository 的 provider 部分）
│     ├─ statsRepo.ts
│     ├─ keyPoolRepo.ts
│     └─ settingsRepo.ts
├─ domain/
│  ├─ user.ts            User/Role 类型 + zod + normalizeSlug/保留字
│  ├─ provider.ts        （扩展）normalizeBaseUrl、UserProvider 类型
│  ├─ stats.ts           统计聚合纯函数（众数、票数）
│  └─ validation.ts      （扩展）注册/登录/用户/设置 payload
├─ services/
│  ├─ authService.ts     scrypt 哈希、登录、token 签发/校验、角色
│  ├─ userService.ts     建号/改角色/禁用/重置/删号/slug 分配
│  ├─ providerService.ts （改）作用于 user_provider + 触发 stats/pool 同步
│  ├─ statsService.ts    读全服统计、admin 一键添加
│  ├─ keyPoolService.ts  贡献同步、消费抽取、失效清理
│  ├─ settingsService.ts 注册策略/SMTP/运维开关（敏感字段加解密）
│  ├─ mailer.ts          SMTP 发信（邮箱验证）
│  └─ fetcher.ts         （改）取 key = 自有→池；记录 401/403 触发清理
migrations/
│  ├─ 0001_init.ts       全部表
│  └─ 0002_seed_from_json.ts  旧 JSON 导入（幂等）
```

迁移脚本 `scripts/seed-official.mjs` 改为写 DB（或经内部 API）。

## 4. 分阶段交付

**阶段 1 — 数据层地基**（无行为变化，纯基础设施）
- 加依赖、env、`db.ts`、`migrate.ts`、`0001_init.ts`。
- Kysely 表类型定义。
- 单测：迁移在 sqlite + pg（若 CI 有）上建表成功；连接选择正确。

**阶段 2 — 仓储 + 从 JSON 迁移**
- 实现 5 个 repo。
- `0002_seed_from_json.ts`：建初始 admin、旧 provider 挂 admin、回填 stats。
- 旧 fileRepository 保留为迁移读取源，迁移后重命名 `.migrated`。
- 单测：迁移幂等、admin 生成、provider 归属、stats 回填正确。

**阶段 3 — 认证与用户系统**
- `authService`（scrypt + token 含 role + token_version）。
- `userService`；登录/登出路由改造；`requireUser`/`currentUser`。
- `/login` 支持用户名+密码；中间件按角色守卫 `/admin`、`/console`。
- 单测：哈希往返、错误密码、token 校验/过期/吊销、角色守卫。

**阶段 4 — user-provider + 统计 + 一键添加**
- providerService 作用于 user_provider，写入即同步 stats。
- `normalizeBaseUrl` + 唯一约束；重复添加=更新。
- 用户控制台 provider CRUD；管理员全服统计页 + 一键添加。
- 单测：唯一约束、归一化去 `/v1`、stats 众数/票数、admin_added 标记。

**阶段 5 — key 池**
- 贡献同步（增/改）、消费抽取（两开关 + 消费范围）、失效清理（401/403×2
  只删池）。
- fetcher 接入两级取 key。
- 单测：进池/同步、随机抽取、开关矩阵、暂时性错误不删、确定性失败删池且
  不动用户 key。

**阶段 6 — 设置、注册、SMTP、个人页**
- settingsService（敏感字段加密）；`/admin/settings` UI。
- 自助注册（受开关/邮箱验证/域白名单约束）；mailer。
- slug 分配（12 位、保留字屏蔽）；`/{slug}` 公开只读页；`personal_pages_enabled`。
- 单测：注册开关/域校验、slug 唯一/保留字、个人页可见性、设置加解密。

**阶段 7 — 收尾**
- 更新 README / .env.example / docker-compose（DB 卷、env）。
- 更新 seed 脚本写 DB。
- 端到端冒烟：迁移 → 登录 → 建用户 → 配 provider → 探测 → 统计 → 个人页。

## 5. 测试策略

- 每个 repo/service 用**独立临时 SQLite 文件**（或 `:memory:`）跑单测，
  不碰生产数据；Postgres 路径在 CI 有实例时才跑。
- 沿用 vitest；每阶段结束跑全量 `typecheck + lint + test + build`。
- 安全用例重点：token 伪造/过期/吊销、越权访问他人 provider、池 key 不泄露、
  设置敏感字段不出现在响应。

## 6. 风险与回滚

- **迁移不可逆**：迁移前备份 data 目录；`0002` 幂等且旧 JSON 保留 `.migrated`。
- **better-sqlite3 原生编译**：Dockerfile 需构建工具链；若失败可用
  `node:sqlite` 兜底（记为后备，不首选）。
- **自动删池误删**：保守判定（仅 401/403×2）+ 只删池不动用户配置，已在
  ADR-0011 固化。
- 分阶段可停：阶段 1–2 不改变对外行为，可先合入观察。

## 7. 未决 / 后续

- 忘记密码 / 找回（依赖 SMTP）——后续追加。
- 统计大数据量时改物化视图 / 定时重算。

## 8. 完成状态（v0.3.0）

全部 7 阶段已实现并验证：DB 地基、JSON 迁移、认证与用户、per-user
provider + 统计 + 一键添加、key 池、设置/注册/SMTP/个人页、收尾。
另补齐：邮箱验证码闭环（`email_verifications` 表 + `/api/auth/verify`）、
用户自助 provider 编辑页（`/console/providers/[id]`）。
