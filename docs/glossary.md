# ModelHub 术语表

> v0.3 起从单用户工具升级为多租户平台（见 ADR 0009–0012）；v0.4 起引入博客层
> （个人资料 / 标签 / 评分 / 评论，见 ADR 0013）。下方标注 **[v0.3]** / **[v0.4]**
> 的条目为大版本新增/变更。

- **ModelHub**：本项目。多用户 API 提供商模型目录平台，用户各自维护自己的
  提供商与模型列表，并可对外公开个人页。[v0.3：从单用户升级为多租户]

- **控制台 (Console)**：登录后的管理界面。管理员控制台含供应商 / 用户 / 设置；
  用户控制台含自己的供应商与个人页。[v0.3]

- **角色 (Role)**：`admin` | `user` | `guest`。guest 指未登录访问，非数据库记录。
  访客可只读浏览主页与个人页。[v0.3]

- **提供商 (Provider)**：一个可调用的 API 端点配置，含 name、type、base_url、加密 key、模型缓存。是系统的核心实体。

- **user-provider（用户挂载）**：某用户对某 base_url 的一条完整、独立的提供商配置——含名称、描述、type、free_tier、icon、adapter、该用户自己的模型列表与抓取状态、以及该用户填的加密 key。同一用户对同一 base_url 只能有一条（唯一约束）；一个 base_url 可被多个用户各自配置。[v0.3]

- **规范地址 (normalized_base_url)**：`normalizeBaseUrl(base_url)` 的结果——小写 scheme/host、去默认端口、去尾部 `/`、去尾部 `/v1`、忽略 query/fragment。用作 user-provider 去重键、统计聚合键、key 池归组键。[v0.3]

- **全服统计 (provider_stats)**：按 `normalized_base_url` 聚合的全服提供商视图。name/icon 取管理员设定优先、否则用得最多；type/free_tier 取管理员设定优先、否则选择人数最多（并记录各候选票数）。含使用人数与"管理员是否已添加"标记。不含 key。[v0.3]

- **key 池 (key_pool)**：按 `normalized_base_url` 归组的共享 key 集合，仅用于模型探测。用户添加/更新带 key 的 user-provider 时自动进池/同步；探测顺序为"先用自己的 key，缺失且共享开启且在消费范围内则从池随机抽一条有效 key"。[v0.3]

- **key 共享开关**：`key_share_enabled`（总开关，默认关）+ `key_share_consumers`（`admin` | `everyone`，谁能从池消费，默认 admin）。贡献是全体自动，消费才分级。[v0.3]

- **无效 key 清理**：仅确定性鉴权失败（401/403）计失效，连续 2 次即从**池中**删除该条；超时/429/5xx 不计。绝不删除用户自己配置的 key 或 user-provider。[v0.3]

- **个人页 slug**：每用户一个 12 位随机字母数字路径，系统自动生成、全局唯一、屏蔽保留字。访客可只读访问 `/p/{slug}` 看该用户的个人分享页。受 `personal_pages_enabled` 开关控制。[v0.3]

- **官方 (official)**：提供商类型标签之一，指官方 API（如 OpenAI）。仅为卡片徽章，不改变取数逻辑。

- **中转站 (relay)**：提供商类型标签之一，指 newapi 类中转服务。仅为卡片徽章，不改变取数逻辑。

- **base_url**：提供商 API 的基础地址，如 `https://api.openai.com/v1`。抓取时拼接 `/models`。

- **邀请码 (aff_code)**：newapi 类中转站的推荐/邀请码，可选。展示时拼接为 `站点origin?aff=<code>`（见 invite_url），用于前台"前往注册"链接。

- **invite_url**：由 base_url 的 origin（去掉 /v1 等路径）加上 `?aff=<aff_code>` 生成；无邀请码时为站点 origin。仅前台展示用，随脱敏视图下发。

- **模型列表 (models)**：从 `/v1/models` 抓取并归一化后的模型 ID 数组。缓存于 `model_caches` 表。系统只展示模型，不展示价格。

- **抓取器 (fetcher)**：后端模块，携带解密后的 key 调用上游 `/v1/models`，归一化返回的模型列表。

- **调度器 (scheduler)**：进程内定时任务，默认每 6 小时全量刷新一次所有提供商的模型列表。

- **手动刷新 (refresh)**：用户在卡片/详情页触发，立即重抓单个提供商。

- **缓存 (cache)**：存于 `model_caches` 表的 `models` 字段。前端渲染只读缓存，不实时打上游。抓取失败时保留旧缓存。

- **主密钥 (master key)**：环境变量 `MODELHUB_MASTER_KEY`，用于 AES-256-GCM 加解密提供商 key。不落盘、不进 git，丢失则需重录 key。

- **key_enc**：提供商 API key 的加密形态（iv + 密文 + authTag），存于 `user_providers` 表，绝不出现在任何 API 响应中。

- **脱敏视图**：API 返回给前端的提供商对象，省略 `key_enc`，只含名称、类型、base_url、模型、状态等。

- **抓取状态 (last_status)**：每个提供商记录 `ok` / `error`，配合 `last_fetched`、`last_error`，用于卡片状态徽章与详情页错误展示。

- **邮箱验证 (email verification)**：当开启注册且要求邮箱验证时，注册请求不立即建号，而是发送 6 位验证码（`email_verifications` 表，15 分钟有效），确认后才创建账号并登录。SMTP 密码加密存于 settings。[v0.3]

- **数据库 (database)**：v0.3 起持久化改为 SQLite（默认，`data/app.db`）或 PostgreSQL（`DATABASE_DRIVER=postgres` + `DATABASE_URL`），经 Kysely 双方言与版本化迁移（`migrations/`）管理。旧 JSON 存储在首启时一次性导入。[v0.3]

## 博客层术语（v0.4）

- **博客层 (blog layer)**：v0.4 引入的一组社区与内容特性——个人资料、标签、评分、
  评论、跨站搜索。领域映射为「用户即博主、站点即文章」。见 ADR-0013。[v0.4]

- **个人资料 (user_profiles)**：用户的公开信息——显示名（`display_name`）、简介
  （`bio`）、头像（`avatar`）。展示在个人分享页与站点卡片上。头像仅接受 http(s) URL。
  公开视图不返回账号敏感字段。[v0.4]

- **标签 (tag)**：全局词库中的一项，含 `slug`（唯一，规范化）与 `name`。用户可为
  自己的站点打标签，每站上限 12 个。与站点多对多（`provider_tags`）。[v0.4]

- **评分 (rating)**：注册用户对站点打 0–5 星。`(user_provider_id, user_id)` 唯一，
  一人一站一票，可修改或清除。`score` 带 `CHECK(0–5)` 约束。匿名评分返回 401。[v0.4]

- **评论 (comment)**：注册用户在站点下发表的文本。作者本人或站点主人可删除。
  匿名评论返回 401。[v0.4]

- **个人分享页 (personal page)**：`/p/{slug}` 展示该用户的公开资料与其站点卡片，
  含总评分与评论数。每张卡片带「前往」按钮直达站点（有邀请码时带 `?aff=`）。[v0.4]

- **跨站搜索 (cross-site search)**：`GET /api/search`，支持按**模型**（`modelDedupeKey`
  去重）、**来源**（`modelVendor` 从模型 id 推断厂商）、**标签**检索，回答"哪些站点
  有该模型/厂商"。[v0.4]

- **modelDedupeKey**：模型去重键——取模型 id 的最后路径段并小写。用于跨站模型命中
  去重与展示。[v0.4]

- **modelVendor**：从纯模型 id 推断厂商的函数（如 `gpt-*` → OpenAI）。逻辑位于
  `lib/domain/vendor.ts`，服务端搜索可用；前端经 `app/lib/display.ts` re-export。[v0.4]

- **tag 写锁**：标签写操作的三层并发防线——①`onConflict(slug).doNothing()` 原子
  upsert + 回读兜底；②挂 `globalThis` 的进程内串行链（防 Turbopack 多 chunk 模块
  实例）；③Postgres 事务级 `pg_advisory_xact_lock`（SQLite no-op），覆盖多进程。[v0.4]
