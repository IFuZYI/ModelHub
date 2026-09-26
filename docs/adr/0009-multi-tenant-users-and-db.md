# ADR 0009: 多租户与角色（数据库、认证、角色分级）

- 状态: 已接受
- 日期: 2026-09-26

## 背景

v0.2 是单管理员私有工具（ADR-0001）：一个口令 + 无状态 HMAC cookie，
provider 全局单例、无归属人。大版本要引入用户系统——管理员 / 用户 /
访客（无需登录）三种角色，管理员与用户各有控制台。这要求把持久化从
JSON 文件迁移到关系数据库，并把单口令认证升级为多用户认证。

## 决策

### 数据库引擎：SQLite 默认 + Postgres 可选

- 默认 **SQLite**（`better-sqlite3`）：单文件、零运维、Docker 友好，
  同步 API 与现有 async mutex 自然契合。
- 同时支持 **Postgres**（`pg`），供多实例 / 高并发部署。
- 通过环境变量选择：`DATABASE_DRIVER=sqlite|postgres`（默认 sqlite），
  `DATABASE_URL` 提供连接串。
- **查询层用 Kysely**（TS-first、轻量、类型安全，同时支持 better-sqlite3
  与 pg 两种 dialect），避免为两种库各写一套裸 SQL。
  - [已接受] Kysely 作为查询层，跨 SQLite/Postgres 双方言；备选（接口后写两套
    裸 SQL）被否决因维护成本高、易漂移。

现有 `ProviderRepository` 接口（ADR-0008 的存储缝隙）扩展为覆盖
users / user_providers / provider_stats / key_pool / settings 的仓储集合，
services 与路由只依赖接口，不依赖具体库。

### 数据迁移

- 引入版本化 migration（`migrations/` 目录，启动时按序执行、记录已应用版本）。
- 从旧 JSON 一次性导入：
  - 建一个**初始 admin 用户**（用户名 `admin`，密码取
    `MODELHUB_ADMIN_PASSWORD` 的哈希；缺失则首启走安装向导设密码）。
  - 现有 `providers.*.json` 全部作为 user-provider 挂到该 admin 名下。
  - 回填 `provider_stats` 聚合表（见 ADR-0010）。
  - 旧 JSON 重命名为 `.migrated` 留档。

### 认证与角色

- 角色枚举：`admin` | `user` | `guest`。guest 不是数据库记录，指未登录访问。
- 密码哈希：**Node 内置 `crypto.scryptSync`**（盐 + 成本参数入库），零新依赖。
  [已接受] 未选 argon2/bcrypt，避免原生依赖；scrypt 是内置且抗暴力。
- 会话：沿用**无状态 HMAC cookie**，载荷编码 `user_id.role.expiry`，签名密钥
  仍派生自 master key。不引入服务端 session 表。[已接受] 吊销靠 users 表
  `token_version` 递增。
- `requireAdmin()` 保留，新增 `requireUser()`（admin 或 user 均可）与
  `currentUser()`（解析 cookie 得到 user_id + role，未登录返回 guest）。
- 权限矩阵：
  - 访客：只读公开页（主页 = admin 的 provider 页；`/{slug}` = 某用户页）。
  - 用户：管理自己的 user-provider、自己的个人页；有个人控制台。
  - 管理员：用户管理、全服 provider 统计、系统设置；含用户的一切能力。

## 影响

- 新增依赖：`better-sqlite3`、`pg`、`kysely`。
- `lib/infra/repository.ts` 从 JSON 实现改为 DB 实现（接口稳定）。
- `lib/services/auth.ts` 扩展多用户 + 角色；cookie 载荷结构变化。
- 新增 `lib/infra/db.ts`（连接 + dialect 选择）、`migrations/`。
- env 新增 `DATABASE_DRIVER`、`DATABASE_URL`；`MODELHUB_DATA_PATH` 对 SQLite
  仍指向数据目录（放 `app.db`）。

## 后续

- 安装向导（首启无 admin 时引导建号）。
- 会话吊销（改密后使旧 cookie 失效）——可用 users 表的 `token_version` 递增实现。
