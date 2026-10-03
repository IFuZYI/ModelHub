# 提供商表单字段说明（Provider Form）

控制台「我的站点 → 添加 / 编辑站点」表单各字段的含义与填写规则。前端表单只保留控件本身，说明集中在此文档，避免界面堆叠大量提示文字。

## 基础字段

| 字段 | 说明 |
|---|---|
| 名称 | 提供商显示名。 |
| 描述 | 可选。一句话介绍该提供商，展示在详情页标题下方。 |
| 类型 | `官方·原生` / `官方·中转` / `NewAPI` / `其他 / 自建`。仅编辑时可改；新建时由添加流程决定。 |
| 免费额度 | 三档下拉分级：`NO（付费）` / `FREE（有免费额度）` / `ALL FREE（完全免费）`，默认 NO。选 FREE 或 ALL FREE 后在首页卡片与详情页展示对应标签；NO 不显示标签。 |
| 官网地址 | 提供商的唯一 URL：既是「前往官网」跳转地址，也是模型抓取的 base。必填。 |
| 邀请码 aff | 仅 NewAPI 类型显示。填写后跳转链接会拼接为 `站点?aff=XXX`。填 `RANDOM` 表示从平台邀请码池随机抽取（见 [ADR-0015](adr/0015-invite-code-pool.md)）；留空则按「系统设置 → 邀请码」的留空策略处理（不带码 / 随机）。 |
| 自定义模型 | 仅 `其他 / 自建`、`NewAPI` 显示。每行一个模型 id；填写后视为固定列表，刷新不再自动抓取覆盖。 |

## 高级设置（默认折叠）

### API Key

- 原生 / 中转：通常必填。
- NewAPI：公开 `/api/pricing` 的站点可不填。
- 编辑时留空表示不修改已存密钥；填入空串才会清除。

### 模型同步来源（无需 API Key，仅官方原生 / 中转显示）

按优先级从上到下作为兜底源，第一个返回非空列表的胜出。实时 API（有 key 时）永远优先于这些目录。

| 字段 | 适配器 | 填写 | 说明 |
|---|---|---|---|
| 模型接口 | `spullara` | 厂商名（如 `openai`）或任意 txt 列表完整链接 | 官方一手模型列表（spullara/models），最优先。填厂商名会拼成 `https://raw.githubusercontent.com/spullara/models/refs/heads/main/<名>.txt`；也可直接填任意兼容的 txt 列表 URL。 |
| models.dev 目录 slug | `models-dev` | models.dev 的 provider key（如 `openai`、`anthropic`、`google`、`openrouter`） | 从 models.dev `api.json` 同步。 |
| LiteLLM 目录 slug | `litellm` | LiteLLM 的 `litellm_provider`（如 `openai`、`together_ai`、`vercel_ai_gateway`） | 从 LiteLLM 价格目录同步。 |

> 注意各数据源的 slug 命名可能不同，例如 Google：models.dev 用 `google`、spullara 用 `gemini`；智谱：models.dev 用 `zhipuai`、spullara/litellm 用 `zai`；火山：models.dev/litellm 用 `volcengine`。

数据结构上这些值统一存在 provider 的 `catalog_slugs`（adapter id → slug）映射里，见 `lib/domain/provider.ts`。
