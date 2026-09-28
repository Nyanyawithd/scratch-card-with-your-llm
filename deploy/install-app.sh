#!/usr/bin/env bash
# Initial installation only. Runs as deploy; uses sudo for dedicated directories/units.
set -euo pipefail
umask 077
if [ "$(id -un)" != deploy ]; then
  printf '%s\n' '请以 deploy 用户运行本脚本（不要 sudo bash 整个脚本）。' >&2
  exit 1
fi
for command in curl tar xz sha256sum sudo ss; do
  command -v "$command" >/dev/null || { printf '缺少命令：%s\n' "$command" >&2; exit 1; }
done
app_root=/opt/scratch-card
package_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
test -f "$package_root/dist/index.html"
test -f "$package_root/server/index.ts"
test -f "$package_root/package-lock.json"
if [ -e "$app_root/current" ] || [ -L "$app_root/current" ]; then
  printf '%s\n' '已存在本应用的 current 发布，不自动覆盖；请使用单独的升级流程。' >&2
  exit 1
fi
if [ -e "$app_root" ] && [ ! -f "$app_root/.scratch-card-managed" ]; then
  printf '%s\n' '/opt/scratch-card 已存在且没有本应用标记，停止以保留原有文件。' >&2
  exit 1
fi
if ss -H -lnt 'sport = :3000' | grep -q .; then
  printf '%s\n' '3000 端口已被占用，请先调整本应用配置。' >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64) architecture=x64; checksum=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6 ;;
  aarch64) architecture=arm64; checksum=6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2 ;;
  *) printf '%s\n' '此脚本仅支持 x86_64 / aarch64。' >&2; exit 1 ;;
esac
# Hashes checked against https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.
node_archive="node-v24.21.0-linux-${architecture}.tar.xz"
work=$(mktemp -d /tmp/scratch-card-install.XXXXXX)
cleanup() { case "$work" in /tmp/scratch-card-install.*) rm -rf -- "$work" ;; esac; }
trap cleanup EXIT
curl --fail --show-error --location --proto '=https' --tlsv1.2 --retry 3 \
  "https://nodejs.org/dist/v24.21.0/$node_archive" --output "$work/$node_archive"
printf '%s  %s\n' "$checksum" "$work/$node_archive" | sha256sum --check --status
sudo -v
app_group=$(id -gn deploy)
sudo install -d -o deploy -g "$app_group" -m 0755 "$app_root" "$app_root/releases" "$app_root/runtime"
touch "$app_root/.scratch-card-managed"
tar -xJf "$work/$node_archive" -C "$app_root/runtime" --strip-components=1
export PATH="$app_root/runtime/bin:$PATH"
test "$(node --version)" = v24.21.0
sudo install -d -o deploy -g "$app_group" -m 0700 /var/lib/scratch-card /var/backups/scratch-card
sudo install -d -o root -g "$app_group" -m 0750 /etc/scratch-card
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_path="$app_root/releases/$release_id"
mkdir -m 0755 "$release_path"
tar -C "$package_root" -cf - dist server scripts deploy package.json package-lock.json .env.example README.md LICENSE | tar -C "$release_path" -xf -
(cd "$release_path" && npm ci --omit=dev --ignore-scripts --cache "$app_root/npm-cache")
if ! sudo test -e /etc/scratch-card/app.env; then
  node --input-type=module - "$package_root/deploy/app.env.example" "$work/app.env" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const [source, destination] = process.argv.slice(2);
const content = readFileSync(source, 'utf8')
  .replace(/^WEB_TOKEN=.*$/m, `WEB_TOKEN=${randomBytes(32).toString('hex')}`)
  .replace(/^MCP_TOKEN=.*$/m, `MCP_TOKEN=${randomBytes(32).toString('hex')}`);
writeFileSync(destination, content, { mode: 0o600, flag: 'wx' });
NODE
  sudo install -o root -g "$app_group" -m 0640 "$work/app.env" /etc/scratch-card/app.env
fi
ln -s "$release_path" "$app_root/current"
sudo install -m 0644 "$release_path/deploy/scratch-card.service" /etc/systemd/system/scratch-card.service
sudo install -m 0644 "$release_path/deploy/scratch-card-backup.service" /etc/systemd/system/scratch-card-backup.service
sudo install -m 0644 "$release_path/deploy/scratch-card-backup.timer" /etc/systemd/system/scratch-card-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now scratch-card.service
healthy=false
for attempt in 1 2 3 4 5; do
  if curl --fail --silent --header 'Host: scratch.your-domain.example' http://127.0.0.1:3000/api/health >/dev/null; then healthy=true; break; fi
  sleep 1
done
if [ "$healthy" != true ]; then
  printf '%s\n' '服务健康检查未通过，请执行 sudo journalctl -u scratch-card.service -n 40 --no-pager' >&2
  exit 1
fi
sudo systemctl start scratch-card-backup.service
sudo systemctl enable --now scratch-card-backup.timer
printf '%s\n' '应用和日备份已安装。原有 /usr/bin/node 保持不变。' \
  '本步骤没有修改 Nginx 或证书，尚未开通公网访问。' \
  '口令保存在 /etc/scratch-card/app.env，不要把该文件内容贴进聊天。'
