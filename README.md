# ModelHub

单用户私有控制台，集中查看多个 API 提供商（官方 / newapi 类中转站）的可用模型列表。

设计文档见 `docs/design.md`，决策记录见 `docs/adr/`，术语表见 `docs/glossary.md`。

## 特性

- 提供商卡片总览 + 详情页（可用模型列表，可搜索）
- 添加/编辑/删除提供商，支持官方/中转徽章
- 模型每 6 小时自动刷新，也可手动刷新；失败保留上次缓存
- API key 用 AES-256-GCM 加密存储，永不下发前端

## 架构（v0.2 工业级）

- 分层：薄路由（`app/api`）→ 业务层（`lib/providerService`）→ 存储/抓取/加密
- 配置集中校验（zod，fail-fast）：`lib/config/env.ts`
- 入站校验 + 持久化数据校验（zod）：`lib/validation.ts` / `lib/types.ts`
- 类型化错误 + 统一错误信封：`lib/errors.ts` / `lib/http.ts`
- 存储用 async mutex 串行化 + 原子写，杜绝并发损坏
- 抓取带超时、429/5xx 有界重试、指数退避；全量刷新有界并发
- 结构化日志（pino，自动脱敏 key）：`lib/logger.ts`
- 健康检查：`GET /api/health`
- 单元测试（vitest）：crypto / validation / store / fetcher
- 多阶段 Docker 镜像（non-root、standalone）

## 快速开始

```bash
npm install

# 生成主密钥并写入 .env
node -e "console.log('MODELHUB_MASTER_KEY=' + require('crypto').randomBytes(32).toString('base64'))" > .env
# 设置后台管理员密码
echo "MODELHUB_ADMIN_PASSWORD=你的密码" >> .env

npm run build
npm start        # 默认监听所有接口；私有使用建议: npx next start -H 127.0.0.1
# 开发: npm run dev
```

- 前台目录：http://localhost:3000 （公开浏览，无需登录）
- 管理后台：http://localhost:3000/admin （用 `MODELHUB_ADMIN_PASSWORD` 登录后配置提供商）

## 脚本

```bash
npm run dev          # 开发服务器
npm run build        # 生产构建（standalone）
npm start            # 启动生产服务
npm run typecheck    # tsc 类型检查
npm run lint         # ESLint
npm run format       # Prettier 格式化
npm test             # vitest 单元测试
```

## Docker 部署

```bash
export MODELHUB_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
docker compose up --build -d
```

compose 默认仅绑定 `127.0.0.1:3000`，数据存于命名卷 `modelhub-data`（`/data/data.json`）。

## 配置

所有环境变量见 `.env.example`。必填 `MODELHUB_MASTER_KEY`；其余（数据路径、
刷新间隔、抓取超时/重试/并发、日志级别）均有默认值。

## 安全说明

- `data.json` 与 `.env` 已在 `.gitignore` 中，绝不提交。
- key 以 AES-256-GCM 加密落盘，解密仅在内存、仅用于服务端出站请求，永不进入 API 响应或日志。
- 主密钥丢失后已存 key 无法解密，需重新录入。
- 私有工具，建议仅绑定 `localhost`，不要暴露到公网。控制台本身无鉴权，依赖网络边界保护。
