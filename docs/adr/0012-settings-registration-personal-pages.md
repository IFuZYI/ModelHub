# ADR 0012: 系统设置、注册与个人页

- 状态: 已接受
- 日期: 2026-09-26

## 背景

管理员后台需要一个设置面板，控制注册策略、SMTP、以及运维开关（如是否允许
用户创建个人页）。用户可创建一个对外公开的个人 provider 页。参考 newapi 的
注册与邮件配置形态。

## 决策

### 设置存储

- 所有系统设置存 `settings` 表（key-value 或单行 JSON）。
- **敏感字段（SMTP 密码等）加密后入库**（复用 AES-256-GCM / master key），
  绝不明文、绝不出现在 API 响应中。

### 注册策略（参考 newapi）

- `registration_enabled`（默认**关**）：是否允许自助注册。
- `email_verification_required`（默认关）：注册是否需邮箱验证码。
- `email_domain_whitelist`（可选）：允许注册的邮箱域名单（空 = 不限）。
- SMTP 配置：`smtp_host` / `smtp_port` / `smtp_username` /
  `smtp_password`(加密) / `smtp_from`。
- 关闭注册时，仅管理员可在用户管理页手动建号。

### 运维配置

- `personal_pages_enabled`（默认关）：是否允许用户创建个人页。

### 个人页 slug

- 每用户可分配**一个** 12 位随机哈希 slug（字母 + 数字），**系统自动生成**、
  全局唯一。用户不可自定义，可请求重新随机。
- 屏蔽保留字与既有路由前缀：`admin`、`api`、`login`、`logout`、`providers`、
  `health`、`console`、`settings`、`users`、`_next` 等。
- 访客访问 `/{slug}` → 该用户的 provider 页（只读公开）。
- `personal_pages_enabled=false` 时，已有页返回 404 / 关闭态。

### 管理员后台三大板块

- **供应商**：全服 provider 统计（ADR-0010）+ 管理员自己的 provider。
- **用户**：用户管理（建号、改角色、禁用、重置密码、删除）。
- **设置**：注册策略 / SMTP / 运维开关 / key 共享开关（ADR-0011）。

## 影响

- 新增表：`users`、`settings`（扩展）、可能的 `email_verifications`。
- 新增路由：`/console`（用户控制台）、`/admin/users`、`/admin/settings`、
  `/{slug}`（个人页）。
- 新增服务：`userService`、`settingsService`、`mailer`（SMTP）。
- env：SMTP 也可用环境变量兜底，但 UI 配置优先。

## 后续

- 邮箱验证码有效期与频率限制。
- 忘记密码 / 找回流程（依赖 SMTP）。
- 个人页自定义展示（排序、隐藏某些 provider）——留待后续。

## 修订（v0.4）

- 个人页路径由根级 `/{slug}` 改为 `/p/{slug}`，避免与既有路由前缀冲突。见 ADR-0013。
