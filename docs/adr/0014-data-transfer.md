# ADR-0014：数据导入导出（服务器迁移）

## 背景

ModelHub 的数据全部在本地数据库里（SQLite 默认，PostgreSQL 可选）。运营者需要把整站搬到另一台服务器：用户、站点、模型缓存、标签、评分、评论、全服统计与系统设置，一项都不能丢。

直接拷贝 `app.db` 是可行的，但有几个问题：

1. **PostgreSQL ↔ SQLite 无法直接拷文件**，两种驱动之间迁移就断了。
2. **密钥加密绑定主密钥**。API Key、密钥池、SMTP 密码用 `MODELHUB_MASTER_KEY` 做 AES-256-GCM 加密。换了服务器通常也换主密钥，此时密文原样搬过去只会解密失败。
3. **无法只搬一部分**，也无法在导入前审查内容。

## 决策

提供一个**基于 JSON 的整库导出/导入**（`/api/admin/transfer/*`，仅管理员），而不是依赖数据库文件拷贝。

### 导出格式

```jsonc
{
  "format": "modelhub-export",
  "version": 1,
  "exported_at": "2026-10-03T…",
  "counts": { "users": 3, "comments": 12, … },
  "includes_secrets": false,
  "data": { "users": [ … ], "user_providers": [ … ], … }
}
```

`data` 按**依赖顺序**包含全部 11 张表：`users → user_profiles → tags → user_providers → model_caches → provider_tags → ratings → comments → provider_stats → key_pool → settings`。

### 密钥处理（关键）

| 选项 | 行为 |
|---|---|
| `includeSecrets: false`（默认） | 丢掉全部密钥材料：`key_enc` 置空、`key_pool` 整行剔除、`smtp_password` 不导出。文件可以随便传。 |
| `includeSecrets: true` | 用**本服务器**主密钥解密，放进 `key_plain` / `value` 字段。目标服务器导入时用**自己的**主密钥重新加密。 |

因此「换服务器且换主密钥」也能把 API Key 带走。代价是文件里有明文密钥，导出页明确警告、需手动勾选。

`key_pool` 行在 `includeSecrets: false` 时**整行剔除**而非留空壳——密钥池条目存在的意义就是那把密钥，没有密钥的行搬过去只会变成垃圾数据。

### 导入语义

- `mode=merge`（默认）：按主键 upsert。可重复执行，第二次不会产生重复行。
- `mode=replace`：先按**反依赖顺序**清空这些表，再写入。导入前校验文件里至少有一个 `active` 管理员，否则拒绝——避免把服务器搞成没人能登录。
- 全程**单个事务**：任何一步失败则整体回滚，不会留下半套数据。
- **孤儿行跳过**：子表行若其父行（用户/站点/标签）不在文件里，跳过并计入 `skipped`，而不是让外键报错中断整个导入。
- 未知列忽略：从更新的版本导出的文件，多出来的字段会被丢弃而不是报错。
- **导入后自动清扫统计**：`provider_stats` 随文件原样带入（其 `admin_*` 是撰写数据），派生列可能与导入后的 providers 不一致。导入提交后立即执行一次 `statsService.recomputeAll()`，按 providers 重算每个存活行（保留 admin 覆盖）并删除孤儿行。清扫是**尽力而为**的：失败只记日志，不会把已提交的导入变成 500（周期性的统计 hygiene 会在一小时内再次修复）。

### ID 重映射（换服务器必踩）

新服务器首启会**自建一个 `admin`**（`MODELHUB_ADMIN_PASSWORD`）。导出文件里也有一份 `admin`，但 id 不同。若只按主键 upsert，插入时会撞 `users.username` 唯一索引，整个迁移失败。

因此导入时会检查**所有唯一约束**（不只是主键）：

| 表 | 唯一键 |
|---|---|
| `users` | `username`、`email`、`slug` |
| `tags` | `slug` |
| `user_providers` | **(`user_id`, `normalized_base_url`) 成对** |
| `ratings` | **(`user_provider_id`, `user_id`) 成对** |
| `key_pool` | **(`normalized_base_url`, `contributor_user_id`) 成对** |
| `provider_stats` / `settings` | 主键本身即自然键 |

命中时**采用已存在行的 id**，把导入行的数据更新上去，并记录 `旧id → 存活id` 的映射；后续所有子表（`user_profiles`、`user_providers`、`model_caches`、`provider_tags`、`ratings`、`comments`、`key_pool`）都按该映射改写外键，因此不会产生指向不存在父行的孤儿数据。命中的行数记在 `remapped` 里。

成对唯一键必须**整体匹配**，不能逐列匹配——否则同一个用户的第一个站点会被错误地合并进另一个站点。

### 为什么导出 `provider_stats`

`provider_stats` 里 `admin_*` 四列是**管理员手工撰写的覆盖值**（`statsService.setAdminOverride`），无法从 providers 重新推导出来。只导出派生列（`name`/`type`/`votes`）会在迁移后丢失管理员的命名与分类决定。

## 后果

- 跨数据库驱动迁移成为可能（SQLite ↔ PostgreSQL）。
- 迁移后用户密码仍然可用（scrypt 哈希原样携带），无需重置。
- 导入是**全有或全无**，且 `replace` 有管理员保底校验。
- 导出文件包含全站数据，属于敏感文件；含密钥时更是如此。接口仅管理员可访问，且响应带 `Cache-Control: no-store`。
- 目前不支持选择性导出（如只导某个用户）。数据量级（单机 SQLite）下没必要；将来若需要，可在 bundle 上加过滤器。

## 验证

`tests/transfer.test.ts`（8 项）：

- 11 张表全量往返，内容抽查（模型列表 JSON、评论正文、管理员覆盖值）。
- 密码哈希迁移后仍能通过 `verifyPassword` 校验。
- 默认导出不含任何密钥材料（断言 JSON 里搜不到密文片段）。
- `includeSecrets` 导出后，目标库里的密文能用目标主密钥解回原始明文。
- `replace` 清掉旧数据；无管理员的文件被拒绝。
- 畸形文件（格式错、缺字段、版本过高）被拒绝且**不改动数据库**。
- `merge` 幂等，且能应用字段更新。
- 孤儿评论行被跳过，其余数据正常导入。
