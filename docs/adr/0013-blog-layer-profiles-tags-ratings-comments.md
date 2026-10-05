# ADR 0013: 博客层——个人资料、标签、评分、评论与跨站搜索

- 状态: 已接受
- 日期: 2026-10-03

## 背景

v0.3 已把项目从单用户工具升级为多租户平台：用户各自维护提供商，并可公开个人页。
但个人页只是"提供商列表的只读视图"，缺乏社区与内容属性。需求指向一个更接近
**博客**的架构：用户即博主、站点即文章——有作者资料、自定义标签、读者评分与评论，
并支持按模型或来源跨站检索"哪些站点有"。

参考 `reference/` 下的 hugo 等静态博客项目：作者资料、分类/标签、内容页与评论是
博客的四个基本要素。本 ADR 将其映射到本站领域。

## 决策

### 领域映射

| 博客概念 | ModelHub 实体 |
|---|---|
| 博主 | `users` + `user_profiles`（显示名 / 简介 / 头像） |
| 文章 | `user_providers`（一个用户的 API 站点） |
| 分类 / 标签 | `tags` + `provider_tags`（全局词库，多对多） |
| 评分 | `ratings`（0–5 星，每用户每站一条） |
| 评论 | `comments`（站点 + 作者 + 正文） |
| 作者页 | 个人分享页 `/p/{slug}` |

### 数据模型（迁移 0004）

- `user_profiles(user_id PK, display_name, bio, avatar, updated_at)`。
- `tags(id, slug UNIQUE, name)` + `provider_tags(user_provider_id, tag_id)` 复合主键。
- `ratings(id, user_provider_id, user_id, score CHECK 0–5, created_at, updated_at)`，
  `(user_provider_id, user_id)` 唯一——一人一站一票，可改可清。
- `comments(id, user_provider_id, user_id, body, created_at)`。

### 写并发

标签的"解析或创建"是典型的 check-then-insert 竞态：并发写同一新标签会撞唯一约束，
并发写反序标签会在多进程下死锁。三层防线：

1. `onConflict(slug).doNothing()` + 回读兜底（原子 upsert）。
2. 进程内串行链挂 `globalThis`（`__modelhubTagWriteChain`）——Turbopack 可能把
   tagRepo 编进多个 chunk，模块级锁不共享，必须挂全局。
3. Postgres 事务级 `pg_advisory_xact_lock`（SQLite 适配器检测后 no-op），覆盖
   多进程 / 多副本部署。

孤儿标签清理用单条 `NOT EXISTS` DELETE，并在同一把锁内执行，避免 TOCTOU。

### 权限

- 评分 / 评论：仅注册用户（匿名 401）。评分可改可清；评论作者或站点主人可删。
- 标签：站点主人可替换（每站上限 12）。
- 个人资料：本人可改；公开视图不返回 `password_hash` 等敏感字段。
- 被禁用用户从公开视图隐藏。

### 搜索（跨站）

`GET /api/search` 支持三模式：

- **模型**：按 `modelDedupeKey` 去重（取模型 id 最后路径段 + lowercase），命中站点。
- **来源**：由纯模型 id 经 `modelVendor` 推断厂商（vendor 逻辑下沉到 `lib/domain/vendor.ts`，
  服务端可用），命中含该厂商模型的站点。
- **标签**：按标签 slug / 名称匹配。

`limit` 缺省不被压缩（仅在参数存在时解析），`MAX_MATCHED_MODELS`=120 上限。

### 前端

- 主页：站点卡片显示星级评分；排序支持评分（默认）/ 模型数 / 名称；搜索防抖 +
  请求序号守卫（丢弃过期响应）。
- 详情页：评分（0–5 星）、评论、标签芯片（点击跳搜索）。
- 个人分享页 `/p/{slug}`：作者卡片 + 站点卡片（含「前往」直达链接，有邀请码带 `?aff=`）。
- 控制台改侧边栏菜单（`ConsoleShell`），新增个人资料页。

## 影响

- 新增表：`user_profiles`、`tags`、`provider_tags`、`ratings`、`comments`。
- 新增服务：`blogService`、`searchService`（`publicService` 相应扩展）。
- 新增路由：`/api/providers/:id/{ratings,comments,tags}`、`/api/comments/:id`、
  `/api/me/profile`、`/api/search`、`/api/tags`。
- 新增页面：`/console/profile`；`/p/{slug}` 由"提供商页"升级为"个人分享页"。
- 迁移 `0004_blog`，兼容 v0.3 → v0.4 增量升级（`tests/upgrade.test.ts`）。

## 后续

- 评论嵌套回复 / 点赞。
- 个人页自定义展示（排序、隐藏某些站点）。
- 标签管理与合并（同义标签）。
- 评分加权（防刷分）。

## 修订（搜索范围收窄）

- **日期**: 2026-10-05

原决策让 `GET /api/search` 跨全平台检索（`providers.listAll()`），但主页目录只
展示**首个管理员**的站点——主页搜索因此会命中其他用户的站点，与"主页只展示
admin 站点"的范围自相矛盾。

现收窄为**单主人范围**：搜索与主页目录同源（`publicService.homepageOwnerId()`），
只在该主人（首个管理员）的站点内检索，`author` 参数与命中里的 `author` 字段一并
移除。个人分享页 `/p/{slug}` 本就只列一个用户的站点、且无搜索框，故不提供按用户
的搜索变体。

同批修正一处从未成立的描述：上文「按 `modelDedupeKey` 去重」与实现不符——
`searchService` 从未使用 `modelDedupeKey`（子串匹配原始模型 id，不做去重；
`modelDedupeKey` 仅用于 `publicService.summarize()` 统计模型总数）。
