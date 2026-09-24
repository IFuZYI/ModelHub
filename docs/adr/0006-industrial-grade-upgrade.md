# ADR 0006: 工业级架构升级

- 状态: 已接受
- 日期: 2026-09-24

## 背景

初版（v0.1）实现完整可用，但为达到生产/工业级标准，需在健壮性、
可测试性、可观测性、部署与安全边界上补齐。

## 决策

在不改变产品行为（ADR-0001~0005）的前提下做以下升级：

### 分层架构

- 路由（`app/api/**`）保持极薄，只做请求解析与响应。
- 业务逻辑集中到 `lib/providerService.ts`（可单测）。
- 存储 `lib/store.ts`、抓取 `lib/fetcher.ts`、加密 `lib/crypto.ts` 各司其职。

### 配置与校验

- `lib/config/env.ts`：用 zod 在启动时校验并集中所有环境变量，fail-fast。
- `lib/validation.ts`：zod 校验所有入站 payload。
- `lib/types.ts`：zod 校验持久化数据文件（防手改损坏）。

### 错误处理

- `lib/errors.ts`：类型化 `AppError`（code + status）。
- `lib/http.ts`：`withErrorHandling` 包装器 + 统一 JSON 错误信封
  `{ error: { code, message, details } }`。

### 并发与健壮性

- 存储改为 async mutex 串行化读-改-写，杜绝并发写丢失/损坏。
- 原子写（临时文件 + rename），带进程 PID 隔离临时文件。
- 抓取器：超时（AbortController）+ 429/5xx 有界重试 + 指数退避；
  crypto 失败不重试。
- 全量刷新有界并发（worker pool），单个提供商失败隔离。
- 调度器防重叠执行、`unref` 不阻塞退出。

### 可观测性

- `lib/logger.ts`：pino 结构化日志，生产 JSON、开发 pretty；
  自动脱敏 key / authorization。
- `/api/health` 健康检查端点。

### 测试

- vitest 单测：crypto（往返/篡改）、validation、store（并发/原子）、
  fetcher（成功/401 保留缓存/5xx 重试）。

### 部署

- 多阶段 Dockerfile（non-root、standalone 输出）。
- docker-compose 默认仅绑定 `127.0.0.1`、数据卷持久化、主密钥经环境注入。
- `MODELHUB_DATA_PATH` 支持将数据文件放到挂载卷。

### 工程化

- ESLint（flat config）+ Prettier + `typecheck` 脚本。

## 影响

- 数据结构：`key_enc` 增加 `v:1` 版本字段，便于未来加密方案演进。
- 代码量增加，但每层职责单一、可测试、可观测。
- 行为对用户不变；API 错误响应结构从 `{error:string}` 变为
  `{error:{code,message,details}}`（前端已相应更新）。
