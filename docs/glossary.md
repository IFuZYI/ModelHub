# ModelHub 术语表

> v0.3 起从单用户工具升级为多租户平台（见 ADR 0009–0012）。下方标注
> **[v0.3]** 的条目为大版本新增/变更。

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

- **个人页 slug**：每用户一个 12 位随机字母数字路径，系统自动生成、全局唯一、屏蔽保留字。访客可只读访问 `/{slug}` 看该用户的提供商页。受 `personal_pages_enabled` 开关控制。[v0.3]

- **官方 (official)**：提供商类型标签之一，指官方 API（如 OpenAI）。仅为卡片徽章，不改变取数逻辑。

- **中转站 (relay)**：提供商类型标签之一，指 newapi 类中转服务。仅为卡片徽章，不改变取数逻辑。

- **base_url**：提供商 API 的基础地址，如 `https://api.openai.com/v1`。抓取时拼接 `/models`。

- **邀请码 (aff_code)**：newapi 类中转站的推荐/邀请码，可选。展示时拼接为 `站点origin?aff=<code>`（见 invite_url），用于前台"前往注册"链接。

- **invite_url**：由 base_url 的 origin（去掉 /v1 等路径）加上 `?aff=<aff_code>` 生成；无邀请码时为站点 origin。仅前台展示用，随脱敏视图下发。

- **模型列表 (models)**：从 `/v1/models` 抓取并归一化后的模型 ID 数组。缓存于 `data.json`。系统只展示模型，不展示价格。

- **抓取器 (fetcher)**：后端模块，携带解密后的 key 调用上游 `/v1/models`，归一化返回的模型列表。

- **调度器 (scheduler)**：进程内定时任务，默认每 6 小时全量刷新一次所有提供商的模型列表。

- **手动刷新 (refresh)**：用户在卡片/详情页触发，立即重抓单个提供商。

- **缓存 (cache)**：存于 `data.json` 的 `models` 字段。前端渲染只读缓存，不实时打上游。抓取失败时保留旧缓存。

- **主密钥 (master key)**：环境变量 `MODELHUB_MASTER_KEY`，用于 AES-256-GCM 加解密提供商 key。不落盘、不进 git，丢失则需重录 key。

- **key_enc**：提供商 API key 的加密形态（iv + 密文 + authTag），存于 `data.json`，绝不出现在任何 API 响应中。

- **脱敏视图**：API 返回给前端的提供商对象，省略 `key_enc`，只含名称、类型、base_url、模型、状态等。

- **抓取状态 (last_status)**：每个提供商记录 `ok` / `error`，配合 `last_fetched`、`last_error`，用于卡片状态徽章与详情页错误展示。
