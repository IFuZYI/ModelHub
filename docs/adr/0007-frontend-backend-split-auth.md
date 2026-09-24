# ADR 0007: 前台/后台分离与管理鉴权

- 状态: 已接受
- 日期: 2026-09-24

## 背景

初版是单一控制台（谁能访问就能配置）。需求变更为：

- **前台**：给用户浏览，公开只读，展示提供商卡片与可用模型。
- **后台**：管理员登录后配置提供商（增删改、手动刷新）。
  参考站点 anziyou.cc.cd 的玻璃拟态卡片导航风格。

## 决策

### 页面结构

- `/`：前台目录。卡片网格 + 搜索 + 类型筛选（全部/官方/中转）+ 排序。
- `/providers/[id]`：前台详情，展示模型列表（可过滤）。
- `/admin`：后台。未登录显示登录页；登录后显示提供商管理台。

### 接口鉴权

- **公开**（无需登录）：`GET /api/providers`、`GET /api/providers/:id`。
  响应始终为脱敏视图（无 key）。
- **仅管理员**：`POST/PUT/DELETE /api/providers*`、`POST .../refresh`。
- 鉴权接口：`POST /api/auth/login`、`POST /api/auth/logout`、
  `GET /api/auth/status`。

### 认证方案（单管理员）

- 密码来自环境变量 `MODELHUB_ADMIN_PASSWORD`（不落盘、不进 git）。
- 登录时用 `crypto.timingSafeEqual` 常量时间比较密码。
- 会话用 HMAC 签名的 cookie：payload = `expiry.signature`，
  signature = HMAC(expiry, 派生自 master key)。无需服务端会话存储。
- Cookie：`httpOnly`、`sameSite=lax`、生产环境 `secure`、7 天有效期。
- 未设置 `MODELHUB_ADMIN_PASSWORD` 时后台禁用（前台浏览不受影响）。

### 界面风格

- 玻璃拟态（backdrop-filter）+ 梦幻渐变背景，暗/亮主题切换（localStorage 持久化）。
- 参考 anziyou.cc.cd 的卡片、筛选 chip、搜索栏布局，自研实现（未复制其代码/资源）。

## 影响

- 新增 `lib/auth.ts`、`app/api/auth/*`、`app/admin`、`app/components/SiteHeader`、`app/theme.ts`。
- `AppError` 增加 `UNAUTHORIZED`（401）。
- 新增环境变量 `MODELHUB_ADMIN_PASSWORD`。
- 单测新增 auth（密码校验、token 签名/过期/篡改）。
- 安全边界：写操作全部需登录；key 仍加密落盘且永不下发前端。
- 局限：单管理员、无多用户/无角色；会话失效仅靠过期（无主动吊销列表）。
