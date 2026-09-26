# ADR 0011: Key 池（共享 key 用于模型探测）

- 状态: 已接受
- 日期: 2026-09-26

## 背景

Key 只用来**探测模型列表**（调上游 `/models` 等），不用于代理真实推理。
用户默认只用自己的 key；管理员可开启共享，让缺 key 的用户借池中他人的 key
完成探测，也方便管理员统一调用。需明确贡献、消费、失效清理三侧语义。

## 决策

### 池按 base_url 归组

- Key 池键 = `normalized_base_url`（ADR-0010 的归一化）。key 只对同一端点有效。
- 一条池记录 = `(normalized_base_url, contributor_user_id, key_enc, status)`。

### 贡献侧：随 user-provider 生命周期自动同步

- 用户**添加** user-provider 且填了 key → 该 key **自动加入公共池**。
- 用户**更新** key → 池中对应记录**同步更新**。
- 无需用户逐条同意；贡献是随配置自动发生的（与 ADR-0009 的"全体贡献"一致）。
- 说明：这是刻意选择——共享的目的是让管理员/全员能借用；因此只要用户配了
  key，就进池。是否**放开消费**由下面的开关控制。

### 消费侧：全局两个开关

- `key_share_enabled`（默认**关**）：总开关。关闭时池不可被任何人消费，
  用户只能用自己的 key。
- `key_share_consumers`（`admin` | `everyone`，默认 `admin`）：谁能从池抽 key。
  - `admin`：仅管理员的探测可借池。
  - `everyone`：任何登录用户缺 key 时都可借池。

### 探测取 key 的顺序

1. 用户对该 base_url 有自己的有效 key → 用自己的。
2. 否则，若 `key_share_enabled` 且当前用户在可消费范围内 → 从该
   base_url 的池中**随机抽一条 status=valid 的 key**。
3. 否则 → 标记该 user-provider 为 `needs_key`，不探测。

### 失效清理：只删池，不删用户配置

- 判定保守，避免误删：
  - **确定性鉴权失败（401/403）**才计失效；超时 / 429 / 5xx 视为暂时性，不计。
  - 连续 **2 次** 401/403 → 将**池中该条记录**标记 invalid 并删除。
- **只删池记录，绝不删除用户自己配置的 key 或 user-provider。** 用户的
  user_provider 保留其 key_enc；若那把 key 也失效，用户侧照常显示 needs_key，
  由用户自行更新。
- 用户更新 key 后重新入池（贡献侧同步），status 重置为待验证。

## 影响

- 数据表：`key_pool`（含 `normalized_base_url` 索引、`status`、`fail_count`、
  `contributor_user_id`）。
- 设置项：`key_share_enabled`、`key_share_consumers` 入 settings 表。
- fetcher 取 key 逻辑改为"自有 → 池"两级；记录 401/403 计数并触发池清理。
- 安全：池 key 仍以 AES-256-GCM 加密存储；日志脱敏；池 key 仅用于探测请求，
  不经由任何用户可控的代理路径。

## 后续

- 池 key 定期健康巡检（调度器顺带验证 valid/invalid）。
- 观测：每 base_url 池大小、命中率、清理次数。
