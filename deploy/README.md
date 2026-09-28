# 独立子域名部署

> 说明：本公开版本中，域名与服务器地址已用占位符 `your-domain.example` 与 `203.0.113.10`（RFC 5737 文档地址）替换；实际部署时请替换为你自己的域名与服务器地址。

目标地址：`https://scratch.your-domain.example`，服务器 `203.0.113.10`，登录用户 `deploy`。DNS 添加 A 记录 `scratch` 指向该 IP。应用和 MCP 共用子域名，MCP 路径 `/mcp`。

部署状态：用户已执行应用与 HTTPS 安装。子域名证书签发成功（到期 2026-12-26），专用续期 timer 已启用，模拟续期成功。外部检查首页/健康接口返回 200，未认证数据和 MCP 接口返回 401。下方说明保留供重新部署或维护参考。

已确认 Ubuntu 22.04.5、系统 Node 20.20.2、Nginx 1.18、systemd 249、Certbot 已安装、3000 端口空闲。通过 PuTTY 密码登录，用户在 SSH 窗口执行命令。证书覆盖范围与现有站点文件名待确认。本地只准备文件，不代表远程已部署。

## 1. 先检查服务器

在已有 SSH 会话执行以下只读命令，确认系统、运行时、现有服务和空闲端口：

```sh
cat /etc/os-release
command -v node
node --version
command -v nginx
nginx -v
command -v certbot
ss -lnt
systemctl --version
```

本应用使用独立的 `/opt/scratch-card/runtime/bin/node`，固定 Node 24.21.0，不替换 `/usr/bin/node`。安装脚本自动识别 x86_64 / aarch64，并核对从 Node 官方发行站确认的 SHA-256。

## 2. 构建和上传

本地执行 `npm run release`，得到 `release/scratch-card-日期.tar.gz`。打包使用明确文件白名单，不包含 `.env`、数据库、备份、依赖缓存或本地样例记录。使用 scp 上传选定压缩包到 `/tmp/`。

首次安装在解压后的发布包目录执行（以 deploy 用户运行，不要 `sudo bash` 整个脚本）：

```sh
bash -n deploy/install-app.sh
bash deploy/install-app.sh
```

脚本检查空闲端口、安装独立运行时、创建本应用目录、安装生产依赖、生成随机口令、启动 systemd 服务并执行第一次在线备份，最后启用日备份。前端已本地编译。它不会修改 Nginx 或证书，也不会覆盖已有 current 发布；本脚本仅用于首次安装，更新需另走保留旧版的发布流程。脚本在 Windows 端尚未运行 Linux 环境测试，服务是否正常以服务器健康检查为准。

## 3. 配置与认证

安装脚本从 `app.env.example` 自动生成 `/etc/scratch-card/app.env`，写入两个独立随机 Token，已有配置会保留。如需手动部署，可用 Node crypto 生成，每个各生成一次，在自己的终端妥善保存，不发进聊天：

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

环境文件只供服务管理器和 deploy 读取，不要放到网站静态目录。推荐 root 所有、deploy 所属组、权限 `0640`（先确认 deploy 的实际主组）。`DATABASE_PATH` 和 `BACKUP_DIR` 必须与 service 的可写目录一致。

## 4. HTTPS 和独立 Nginx 配置

服务器系统 Certbot 1.21 的 pyOpenSSL 加载失败，已另装 `/opt/scratch-card-certbot` 虚拟环境，保留系统包。主域名原来的手工 DNS-01 证书不能无人值守续期，现已迁移为 HTTP-01，并与 scratch 子域名证书共用独立配置目录。

应用安装成功且 DNS 生效后，上传新版 `enable-https.sh`，以 deploy 用户执行 `bash -n enable-https.sh && bash enable-https.sh`。脚本创建独立 scratch 站点，先校验 Nginx 再 reload；签发证书和模拟续期需要联网，邮箱及服务条款由用户在终端交互选择。

仅证书验证路径通过 80 提供，其他路径跳转 HTTPS，应用和 MCP 均通过 443。主域名访问会使用匹配证书跳转到 `mcp.your-domain.example`。证书、运行状态和日志分别保存在 `/etc/letsencrypt-scratch-card`、`/var/lib/letsencrypt-scratch-card`、`/var/log/letsencrypt-scratch-card`。`scratch-card-cert-renew.timer` 每天检查两次并续期该目录中的两张证书，成功换证后校验并 reload Nginx；两张证书的 dry-run 已通过。

若采用上述脚本，无需重复手动安装下面的 Nginx 模板。

DNS 生效后，用服务器现有证书管理方式为此子域名签发证书。最终应用只在 443 提供 HTTPS。若严格不开放 80，使用 DNS-01 验证；手工 DNS 验证的证书不能无人值守续期，部署时应确定 DNS 提供商和自动续期方式。

把 `nginx.conf.example` 作为一个新站点文件安装，核对证书路径。此配置仅使用回环 HTTP 代理到 Node，不向公网暴露应用端口，不使用 SSE。

先执行 `sudo nginx -t`，成功后才 reload。不要覆盖现有主站配置，也不要开启全域名 `includeSubDomains` HSTS。

## 5. systemd 与备份

安装脚本已经处理此步骤。手动部署时，确认 `/opt/scratch-card/runtime/bin/node` 是所需版本后，将三个 `scratch-card*.service/timer` 文件安装到 `/etc/systemd/system/`，执行：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now scratch-card.service
sudo systemctl start scratch-card-backup.service
sudo systemctl enable --now scratch-card-backup.timer
```

日备份使用服务器本地时区凌晨 03:15，随机延迟最多 5 分钟。备份通过 SQLite 在线备份 API 生成快照，再做完整性、外键和表结构版本检查；失败退出非零，可在 systemd 查看。第一版保留所有备份，不自动删除；上线后需观察磁盘容量并约定保留策略及异机存储位置。

## 6. 恢复与回退

恢复工具始终写到全新路径，拒绝覆盖现有数据库及 WAL 文件。先停服务，执行恢复，再修改 `/etc/scratch-card/app.env` 的 `DATABASE_PATH` 指向新文件，最后启动：

```sh
sudo systemctl stop scratch-card.service
cd /opt/scratch-card/current
/opt/scratch-card/runtime/bin/node scripts/restore.ts /var/backups/scratch-card/<备份文件>.sqlite /var/lib/scratch-card/restored-<日期>.sqlite
```

修改路径后启动服务。原库保留；需要回退时停服，将路径改回原库，再启动。恢复后重新登录并检查卡片、余额、流水及留言。恢复旧备份会回到那个时间点，此后的数据仍保留在原库中，不能将两库直接合并。

本地自动化已经覆盖在线 WAL 快照、还原、余额和幂等保留、损坏备份拒绝及原文件不被覆盖。服务器也已从正式备份恢复到全新文件，并通过临时实例完成健康检查、真实 WEB Token 登录和状态读取；演练文件清理后正式服务继续正常运行。

## 7. 上线验收

检查 HTTPS 证书、网页登录、两个 Token 不能互换、双方各完成一次写卡/奖励/刮卡/留言、已揭晓内容刷新可见、重启记录保留、备份成功、实际 AI 客户端 MCP 连接。

服务端不会在日志打印 Token 和卡片正文。不要给 Nginx 增加记录 Authorization 或请求正文的日志格式。

参考：[SQLite 在线备份](https://nodejs.org/api/sqlite.html)、[Nginx 代理头配置](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[systemd 运行环境和文件权限](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml)。
