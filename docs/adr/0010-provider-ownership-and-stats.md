# ADR 0010: Provider 归属模型与全服统计表

- 状态: 已接受
- 日期: 2026-09-26

## 背景

多用户后，"提供商"不再是全局单例。用户的话语里有两层需求：每个用户维护
自己的 provider 列表（且模型列表、名称、描述各自独立），同时管理员要能看到
全服所有 provider 的聚合视图。这两者必须分开建模。

## 决策

### user-provider 是完整、独立的记录

- 每条 `user_provider` 属于一个用户，携带**完整**配置：name、description、
  type、free_tier、icon、adapter、catalog_slugs、aff_code、**该用户自己的
  模型列表 + 抓取状态/缓存**、以及该用户填的 key（加密）。
- 模型列表**按用户独立**：同一 base_url，不同用户可以有不同的模型集、不同的
  名称与描述。不做跨用户的模型共享。
- **同一用户对同一 base_url 只能有一条** user-provider（唯一约束
  `(user_id, normalized_base_url)`）；重复添加即更新。
- 一个 base_url 可被**多个用户**各自配置（各是一条独立记录）。

### base_url 归一化（去重键 + 统计键）

统一函数 `normalizeBaseUrl(raw)`：
- 小写 scheme 与 host；去掉默认端口（80/443）；去掉尾部 `/`；
- **去掉尾部 `/v1`**（newapi 站有的带有的不带，视为同一端点）；
- 忽略 query 与 fragment。
- 结果存 `normalized_base_url`，用于唯一约束、统计聚合、key 池归组。
- 原始 `base_url` 也保留（展示 / 抓取时用原始）。

### 全服统计表 `provider_stats`（按 base_url 聚合）

- 主键：`normalized_base_url`。
- 字段：
  - `name`、`icon`：**管理员设定优先**；否则取所有用户配置中**使用最多**的值。
  - `type`、`free_tier`：**管理员设定优先**；否则取**选择人数最多**的值，并
    记录每个候选值的选择人数（`type_votes` / `free_tier_votes`，JSON）。
  - `user_count`：配置了该 base_url 的用户数。
  - `admin_added`：管理员是否已把该 base_url 加到自己名下（派生布尔）。
- 该表在 user_provider 增删改时**增量维护**（或按需重算）；不承载 key。
- 结构对应用户给出的样例：
  ```json
  {
    "name": "Cat API",
    "type": "newapi",
    "base_url": "https://api.catcat.top",
    "free_tier": "free",
    "icon": "https://.../logo.jpg"
  }
  ```

### 管理员全服统计页

- 列出所有 `normalized_base_url` 及聚合的 name/icon/type/free_tier + 使用人数。
- 标注**管理员未添加**的条目（`admin_added=false`）。
- 一键添加：把该 base_url 复制为 admin 名下的一条 user-provider，name/icon/
  type/free_tier 取统计派生值；key 需 admin 自备或走 key 池（ADR-0011）。

## 影响

- 数据表：`user_providers`（含唯一约束）、`provider_stats`。
- 旧全局 provider → 迁移为 admin 的 user_provider，并回填 stats。
- `normalizeBaseUrl` 落在 `lib/domain/provider.ts`，供校验、统计、key 池共用。
- 展示层：主页渲染 admin 的 user-provider；`/{slug}` 渲染该用户的。

## 后续

- 统计口径若数据量大，增量维护改为物化视图 / 定时重算。

## 修订（v0.4）

- 个人页路径由根级 `/{slug}` 改为 `/p/{slug}`（见 ADR-0013）。
