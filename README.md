# 我们的刮刮卡

你和 AI 助手各写一张卡，互相送出鼓励，花自己的积分揭晓对方留下的心意。定价权属于写卡方；积分只用来刮卡，没有惩罚、倒计时和催促。碎碎念共用一本，给彼此留一点回应。

当前为可运行的第一版：React 网页 + Node.js / TypeScript + SQLite + 五个 MCP 工具。已部署到独立子域名，HTTPS、健康检查和模拟续期通过；实际 AI 客户端接入仍待验证。

## 本地运行

需要 Node.js 24 或更新版本，以及 npm。使用 Node 内置 SQLite 和 TypeScript 支持，无需单独安装数据库。

```sh
npm ci
npm run setup
npm run build
npm start
```

打开 `http://127.0.0.1:3000`，用本地 `.env` 中的 `WEB_TOKEN` 登录，首次进入填写双方昵称。`npm run setup` 生成随机的独立网页和 MCP Token，不覆盖已有 `.env`。不要把 `.env` 提交到仓库。

`npm run dev` 监视服务端文件；修改前端后执行 `npm run build` 并刷新网页。当前未配置前端热更新。

## 样例预览

```sh
npm run build
npm run preview
```

打开 `http://127.0.0.1:3001`。样例网页口令为 `local-preview-only-do-not-deploy-12345`。这是只绑定回环地址的独立内存实例：包含样例卡片、积分和留言，重启即重置，不影响真实数据库。**不要把这个预览进程代理到公网，也不要把样例口令用于正式部署。**

## MCP 连接

正式部署后连接 `https://你的域名/mcp`，选择 Streamable HTTP，添加请求头：

```text
Authorization: Bearer <MCP_TOKEN>
```

MCP Token 与网页 Token 不通用。服务仅接受 POST，返回 JSON，不提供 SSE。使用官方 SDK 的 Streamable HTTP 客户端完成了集成测试；你实际使用的 AI 客户端还需要单独接入验证。

| 工具 | 用途 |
| --- | --- |
| `scratchcard_status` | 双方余额、当前卡、已揭晓结果、历史、流水、留言及作者读取 |
| `scratchcard_award` | 给人类加分，带理由 |
| `scratchcard_create` | 保存完整草稿、更新草稿、发布给人类的卡 |
| `scratchcard_scratch` | AI 花自己的积分刮人类写的卡 |
| `scratchcard_note` | 留下双方可见的碎碎念 |

所有写工具都要求 `request_id`（建议 UUID）。同一次操作重试必须沿用同一个编号和参数。更换编号会被视为新操作；特别是奖励积分，不能在结果不确定时换编号重发。

`scratchcard_status` 的 `section` 支持 `overview`（默认）、`results`、`authored`、`history`、`ledger`、`notes`、`catalog`（全部已发布卡目录）、`card`（指定卡的无内容摘要）。`results` / `card` 必须提供 `card_id`；`authored` 不提供卡号时返回自己的草稿。历史、流水、留言及目录支持 `cursor` 和 `limit`；留言可按 `card_id` 和 `note_author` 筛选，历史和流水可按 `owner` 筛选。

## 数据和权限

- 一个部署对应人类和助手两个固定身份，昵称仅用于展示。
- 余额来自追加式流水；只有奖励和刮卡支出，不存可随意修改的余额字段。
- 密封格子的内容不进入刮卡方摘要响应；作者接口、已揭晓结果接口分别校验可见范围。
- 刮卡校验余额、格子条件更新、支出流水、卡片完成和幂等记录在同一个事务里提交。
- 两方独立换卡；每方最多一个当前卡和一个草稿。发布后价格、内容不可修改。
- 留言与流水不可编辑或删除；留言正文、卡片内容均以纯文本展示。
- 网页会话使用 HttpOnly Cookie；生产 HTTPS 配置下附带 Secure。写请求校验 Origin，MCP 独立 Bearer Token。
- 内容不写入浏览器持久缓存，响应为 `no-store`。数据库及备份对服务器管理员可读，不是端到端加密。
- 网页空闲时每 15 秒同步状态，回到窗口也会同步。服务重启后需重新登录，数据保留。

## 配置

参考 `.env.example`。`HOST` 默认绑定 `127.0.0.1`；`PORT`、`PUBLIC_ORIGIN`、`DATABASE_PATH`、两方默认昵称、`WEB_TOKEN`、`MCP_TOKEN` 均通过环境变量设置。网页保存昵称后，持久化值优先于环境变量默认值。

`PUBLIC_ORIGIN` 必须与实际访问地址完全对应。生产设置 `NODE_ENV=production` 且使用 HTTPS 域名，由 Nginx 终止 TLS；内网回环代理不对公网开放。不要用 `localhost` 代替已配置的 `127.0.0.1`，否则 Host 校验会拒绝请求。

## 验证

```sh
npm run build
npm test
```

集成测试使用独立内存库或临时目录，不修改真实数据。覆盖密封内容隔离、入口鉴权、越权、重复奖励、请求冲突、并发扣分、重复刮格、事务回滚、草稿和留言约束、持久化，以及官方 MCP 客户端双向交互与 JSON 响应。

## 备份与部署

`npm run backup` 在线备份 `.env` 指定的数据库到 `BACKUP_DIR`（默认 `./backups`），生成经过完整性校验的快照。`npm run restore -- <备份文件> <全新数据库路径>` 恢复到新文件，拒绝覆盖原库。恢复后停服切换 `DATABASE_PATH`，再启动。

`npm run release` 生成不含口令、数据库和依赖缓存的上传包。已提供 Ubuntu 独立 Node 24 安装脚本、systemd 服务/日备份定时器与 Nginx 配置，详见 [部署说明](deploy/README.md)。本地完成了备份恢复演练，远程脚本尚未执行。

## 下一阶段

当前实现了刮动、写卡、流水、留言发送前预览/跳页/历史卡片筛选、归档筛选。下一步执行服务器部署、HTTPS 证书配置、远程恢复验收及实际助手客户端接入。

实施规则和页面结构见 [实施规格](docs/实施规格.md) 与 [页面草图](docs/页面草图.md)。MCP 传输采用[官方 TypeScript SDK 的 JSON 响应模式](https://ts.sdk.modelcontextprotocol.io/server)，SQLite 使用 [Node 官方接口](https://nodejs.org/api/sqlite.html)。

MIT License。
