# ModelHub 设计文档

单用户私有控制台，用于集中查看多个 API 提供商的可用模型列表。

关联决策：ADR-0001 ~ 0005（见 `docs/adr/`）。

## 1. 目标与非目标

### 目标

- 一个私有控制台，只有拥有者使用。
- 添加/编辑/删除提供商（官方或中转站）。
- 每个提供商展示其可用模型列表（卡片总览 + 详情页）。
- 定时（默认 6h）+ 手动刷新模型列表，带缓存。
- API key 加密存储于后端，永不下发前端。

### 非目标

- 无多用户、无注册、无权限系统。
- 不展示价格。
- 不做 key 分享。
- 不记录历史/价格变动。

## 2. 架构

Next.js 一体化单进程：

```
┌─────────────────────────────────────────────┐
│                Next.js 进程                    │
│                                               │
│  前端 (React)                                  │
│   ├─ 主页：提供商卡片列表 (+ 添加按钮)          │
│   └─ 详情页：单个提供商的模型列表 + 刷新         │
│         ↑ 只收模型列表/元数据，永不见 key       │
│  ─────────────────────────────────────────    │
│  后端 (API routes)                             │
│   ├─ /api/providers      CRUD                  │
│   ├─ /api/providers/:id/refresh  手动刷新       │
│   ├─ crypto 模块 (AES-256-GCM)                 │
│   ├─ fetcher (调上游 /v1/models)               │
│   └─ scheduler (每 6h 全量刷新)                 │
│         ↓                                      │
│   data.json (加密 key + 模型缓存)              │
└─────────────────────────────────────────────┘
         ↓ 出站 HTTPS
   上游: 官方 API / newapi 中转站  /v1/models
```

- 默认绑定 `localhost`。
- 主密钥 `MODELHUB_MASTER_KEY` 来自环境变量，缺失则拒绝启动。

## 3. 数据模型

`data.json`：

```json
{
  "settings": { "refresh_interval_hours": 6 },
  "providers": [
    {
      "id": "uuid",
      "name": "My OpenAI",
      "type": "official",
      "base_url": "https://api.openai.com/v1",
      "key_enc": { "iv": "...", "ct": "...", "tag": "..." },
      "models": ["gpt-4o", "gpt-4o-mini"],
      "last_fetched": "2026-09-24T10:00:00Z",
      "last_status": "ok",
      "last_error": null
    }
  ]
}
```

- `key_enc`：AES-256-GCM 密文，绝不出现在任何 API 响应中。
- `type`：`official` | `relay`，仅用于卡片徽章。
- `models`：缓存，刷新时写回。

## 4. 后端接口

| 方法   | 路径                         | 说明                       | 响应含 key? |
| ------ | ---------------------------- | -------------------------- | ----------- |
| GET    | `/api/providers`             | 列出所有提供商（不含 key） | 否          |
| POST   | `/api/providers`             | 新增，立即抓一次           | 否          |
| GET    | `/api/providers/:id`         | 单个详情 + 模型列表        | 否          |
| PUT    | `/api/providers/:id`         | 编辑（改 key 则重新加密）  | 否          |
| DELETE | `/api/providers/:id`         | 删除                       | —           |
| POST   | `/api/providers/:id/refresh` | 立即重抓该提供商           | 否          |

所有响应用脱敏视图（省略 `key_enc`）。

## 5. 抓取器 (fetcher)

```
GET {base_url}/models    (即 /v1/models)
Header: Authorization: Bearer {解密后的 key}
```

- 解析响应 `data[].id` -> 归一化为 `string[]`。
- 成功：写 `models`、`last_fetched`、`last_status=ok`、清 `last_error`。
- 失败：保留旧 `models`，写 `last_status=error`、`last_error=消息`。
- 单用户环境，串行或小并发刷新均可。

## 6. 调度器

- 进程内定时器，每 `refresh_interval_hours` 触发全量刷新。
- 逐个提供商刷新，单个失败不影响其他（try/catch 隔离）。
- 启动时可选做一次全量刷新（或依赖缓存直到下个周期）。

## 7. 前端

### 主页

- 提供商卡片网格：名称、类型徽章（官方/中转）、模型数量、状态（正常/失败）、`last_fetched`。
- "添加提供商"按钮 -> 表单（name / type / base_url / key）。
- 卡片点击进入详情。

### 详情页

- 提供商信息 + 完整模型列表（可搜索/过滤）。
- "刷新"按钮 -> 调 refresh 接口。
- "编辑"/"删除"。
- 失败时显示 `last_error`，仍展示上次缓存模型。

## 8. 安全基线

- key 加密落盘（AES-256-GCM），解密仅在内存、仅用于出站请求。
- API 响应永不含 key。
- 默认绑定 localhost。
- `data.json`、`.env` 进 `.gitignore`。
- 主密钥丢失 => 需重录 key（可接受）。

## 9. 目录结构（建议）

```
ModelHub/
├─ docs/
│  ├─ design.md
│  ├─ glossary.md
│  └─ adr/0001..0005.md
├─ app/                 # Next.js app router
│  ├─ page.tsx          # 主页
│  └─ providers/[id]/   # 详情页
├─ app/api/providers/   # 后端 route
├─ lib/
│  ├─ crypto.ts
│  ├─ fetcher.ts
│  ├─ store.ts          # data.json 读写
│  └─ scheduler.ts
├─ data.json            # gitignore
└─ .env                 # gitignore, MODELHUB_MASTER_KEY
```

## 10. 未决 / 后续可扩展

- 若日后要价格：`/api/pricing` 本就带价格，增量加字段即可。
- 若要控制台口令保护：加一层简单 basic auth（当前靠 localhost 绑定）。
- 若提供商增多：JSON 可平滑迁移到 SQLite。
