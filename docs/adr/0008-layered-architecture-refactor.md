# ADR 0008: 分层架构重构（domain / infra / services / upstream）

- 状态: 已接受
- 日期: 2026-09-24

## 背景

v0.2 的 `lib/` 是扁平的单文件堆叠（crypto/store/fetcher/...），职责边界靠
文件名区分。随着功能增加（邀请码、未来多协议中转），需要更清晰的分层与
扩展点，降低耦合、提升可测试性。

## 决策

将 `lib/` 重构为分层结构，依赖方向单向向内（app → services → domain）：

```
lib/
├─ domain/          纯领域：类型、zod schema、错误、纯函数（无 IO）
│  ├─ provider.ts   StoredProvider/ProviderView/toView/buildInviteUrl + schema
│  ├─ errors.ts     AppError（含 unauthorized 工厂）
│  └─ validation.ts 入站 payload 校验（含 adapter 校验）
├─ infra/           基础设施：与外部世界的边界
│  ├─ crypto.ts     AES-256-GCM
│  ├─ logger.ts     pino
│  └─ repository.ts ProviderRepository 接口 + fileRepository 实现
├─ services/        用例层（可注入 repo，单测友好）
│  ├─ providerService.ts  ProviderService 类（依赖注入 repo）
│  ├─ fetcher.ts    fetchProviderModels（纯）+ refreshProvider/All（持久化）
│  ├─ scheduler.ts  定时刷新
│  └─ auth.ts       会话鉴权
├─ upstream/        上游适配器（扩展点）
│  ├─ types.ts      UpstreamAdapter 接口
│  ├─ openaiCompatible.ts  /v1/models 适配器
│  └─ index.ts      注册表：registerAdapter/getAdapter/listAdapters
├─ http/handler.ts  路由包装：withErrorHandling/parseJson/errorResponse
├─ config/env.ts    集中配置
└─ index.ts         桶文件，app 层只从 "@/lib" 导入
```

### 关键扩展点

1. **ProviderRepository 接口**：存储的唯一抽象。file → SQLite/Postgres 只需
   实现该接口，services 与 routes 零改动。

2. **UpstreamAdapter 注册表**：新的中转协议 = 新增一个 adapter 文件 + 注册。
   `StoredProvider.adapter` 字段（默认 `openai-compatible`）选择适配器。
   fetcher 的超时/重试/持久化管线与协议解耦。

3. **ProviderService 依赖注入**：构造函数接收 repo，默认用 fileRepository。
   测试用内存 repo，无需碰文件系统或网络。

### fetcher 拆分

- `fetchProviderModels(provider)`：纯抓取+归一化，返回下一状态，不落盘。
- `refreshProvider(provider, repo)`：抓取 + 持久化。
- 便于单测抓取逻辑，也让"抓取"与"存储"关注点分离。

## 影响

- 路由从 `@/lib` 桶文件统一导入，代码更薄。
- 数据结构新增 `adapter` 字段（schema 默认值，老数据自动兼容）。
- 测试重组：新增 repository、providerService（含内存 repo 演示可替换性）、
  沿用 crypto/auth/validation/fetcher/inviteUrl，共 31 项。
- 行为对用户零变化；纯结构性重构。

## 后续

- 加 SQLite：实现 ProviderRepository + 在组合根切换默认实例。
- 加中转协议（如非 OpenAI 形状的 /models）：新增 adapter 并注册，
  后台表单已可通过 adapter 字段选择（listAdapters 提供选项）。
