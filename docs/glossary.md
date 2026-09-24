# ModelHub 术语表

- **ModelHub**：本项目。单用户私有控制台，集中查看多个 API 提供商的可用模型列表。

- **控制台 (Console)**：唯一的使用界面，仅拥有者使用。含主页与详情页。

- **提供商 (Provider)**：一个可调用的 API 端点配置，含 name、type、base_url、加密 key、模型缓存。是系统的核心实体。

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
