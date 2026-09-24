# ADR 0004: 技术栈与 Key 安全

- 状态: 已接受
- 日期: 2026-09-24

## 背景

需确定实现栈与 API key 的存储安全方式（ADR-0001 私有工具、ADR-0003 JSON 存储）。

## 决策

### 技术栈

- **Next.js 一体化**（React 前端 + API route 后端）。
- 单进程运行，WSL 本地启动。
- 后端负责：存/读提供商配置、调用 `/v1/models` 代理、持有 key。
- 前端：卡片列表 + 详情页，只接收模型列表，永不接触 key。

### Key 安全

- **Key 加密存储于后端 JSON 文件**（不明文落盘）。
- 加密方案：对称加密 AES-256-GCM。
  - 主密钥来自环境变量 `MODELHUB_MASTER_KEY`（不写入文件、不进 git）。
  - 每条 key 独立随机 IV，密文 + IV + authTag 一并存入 JSON。
- 运行时后端用主密钥解密后调用上游，**解密后的 key 只驻留内存、只用于服务端出站请求**。
- API 响应绝不含 key（哪怕加密后的）。前端只得到模型列表与提供商元数据。

## 影响

- 需要一个 `crypto` 封装模块：`encrypt(plain)->{iv,ct,tag}`、`decrypt(...)`。
- 启动时校验 `MODELHUB_MASTER_KEY` 是否存在，缺失则拒绝启动并提示。
- 数据文件 + `.env` 均加入 `.gitignore`。
- 控制台默认绑定 `localhost`。
- 主密钥丢失 => 已存 key 无法解密，需重新录入（可接受，私有工具）。
