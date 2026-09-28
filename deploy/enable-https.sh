#!/usr/bin/env bash
# Run as deploy. This adds only scratch's Nginx site and a dedicated certificate timer.
set -euo pipefail
umask 077
domain=scratch.your-domain.example
certbot=/opt/scratch-card-certbot/bin/certbot
cert_config=/etc/letsencrypt-scratch-card
cert_work=/var/lib/letsencrypt-scratch-card
cert_logs=/var/log/letsencrypt-scratch-card
webroot=/var/www/scratch-card-acme
site="/etc/nginx/sites-available/$domain"
enabled="/etc/nginx/sites-enabled/$domain"
marker='# Managed by scratch-card HTTPS setup'
if [ "$(id -un)" != deploy ]; then printf '%s\n' '请以 deploy 用户运行，不要 sudo bash 整个脚本。' >&2; exit 1; fi
test -x "$certbot"
sudo -v
sudo nginx -t
sudo systemctl is-active --quiet scratch-card.service
curl --noproxy '*' --fail --silent --header "Host: $domain" http://127.0.0.1:3000/api/health >/dev/null
if sudo test -e "$site" && ! sudo grep -qxF "$marker" "$site"; then
  printf '%s\n' '同名站点配置已存在且不属于本脚本，停止以保留它。' >&2; exit 1
fi
if [ -e "$enabled" ] || [ -L "$enabled" ]; then
  if [ ! -L "$enabled" ] || [ "$(readlink -- "$enabled")" != "$site" ]; then
    printf '%s\n' 'sites-enabled 中存在不同的同名配置，停止以保留它。' >&2; exit 1
  fi
fi
work=$(mktemp -d /tmp/scratch-card-https.XXXXXX)
cleanup() { case "$work" in /tmp/scratch-card-https.*) sudo rm -rf -- "$work" ;; esac; }
trap cleanup EXIT
sudo install -d -m 0755 "$webroot" "$webroot/.well-known" "$webroot/.well-known/acme-challenge"
sudo install -d -m 0700 "$cert_config" "$cert_work" "$cert_logs"

write_config() {
  cat > "$work/site.conf" <<NGINX
$marker
server {
    listen 80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ {
        root $webroot;
        default_type text/plain;
        try_files \$uri =404;
    }
    location / { return 308 https://$domain\$request_uri; }
}
NGINX
  if [ "$1" = https ]; then
    cat >> "$work/site.conf" <<NGINX
server {
    listen 443 ssl;
    server_name $domain;
    ssl_certificate $cert_config/live/$domain/fullchain.pem;
    ssl_certificate_key $cert_config/live/$domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 256k;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header Connection "";
        proxy_read_timeout 30s;
        proxy_cache off;
    }
}
NGINX
  fi
}

apply_config() {
  local had_site=false had_link=false
  if sudo test -f "$site"; then had_site=true; sudo cp -- "$site" "$work/previous.conf"; fi
  if [ -L "$enabled" ]; then had_link=true; fi
  sudo install -o root -g root -m 0644 "$work/site.conf" "$site"
  if [ "$had_link" = false ]; then sudo ln -s -- "$site" "$enabled"; fi
  if sudo nginx -t && sudo systemctl reload nginx; then return; fi
  printf '%s\n' 'Nginx 校验或 reload 失败，恢复此站点上一步配置。' >&2
  if [ "$had_site" = true ]; then sudo cp -- "$work/previous.conf" "$site"; else sudo rm -f -- "$site"; fi
  if [ "$had_link" = false ]; then sudo rm -f -- "$enabled"; fi
  sudo nginx -t && sudo systemctl reload nginx || true
  exit 1
}

if sudo test -f "$cert_config/live/$domain/fullchain.pem"; then write_config https; else write_config challenge; fi
apply_config
# The challenge path is public; application and MCP requests redirect to HTTPS.
probe="scratch-check-$(date +%s)-$$"
printf '%s' "$probe" > "$work/probe"
sudo install -m 0644 "$work/probe" "$webroot/.well-known/acme-challenge/$probe"
# Reload is asynchronous. Allow workers time to adopt the new site, and avoid
# environment proxies when checking the publicly resolved hostname.
probe_ok=false
for attempt in 1 2 3 4 5; do
  if response=$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 10 "http://$domain/.well-known/acme-challenge/$probe") && [ "$response" = "$probe" ]; then
    probe_ok=true
    break
  fi
  if [ "$attempt" -lt 5 ]; then sleep 2; fi
done
if [ "$probe_ok" != true ]; then
  sudo rm -f -- "$webroot/.well-known/acme-challenge/$probe"
  printf '%s\n' '验证路径无法从域名访问，请检查 DNS、80 端口及现有 Nginx 域名冲突。' >&2; exit 1
fi
sudo rm -f -- "$webroot/.well-known/acme-challenge/$probe"
common=(--config /dev/null --config-dir "$cert_config" --work-dir "$cert_work" --logs-dir "$cert_logs")
printf '%s\n' '接下来由 Certbot 询问联系邮箱和服务条款，请在此终端按提示选择。'
sudo "$certbot" certonly "${common[@]}" --webroot -w "$webroot" --cert-name "$domain" -d "$domain" --keep-until-expiring
write_config https
apply_config

cat > "$work/renew.service" <<'UNIT'
# Managed by scratch-card HTTPS setup
[Unit]
Description=Renew only the scratch-card HTTPS certificate
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=oneshot
UMask=0077
ExecStart=/opt/scratch-card-certbot/bin/certbot renew --config /dev/null --config-dir /etc/letsencrypt-scratch-card --work-dir /var/lib/letsencrypt-scratch-card --logs-dir /var/log/letsencrypt-scratch-card --cert-name scratch.your-domain.example --quiet --deploy-hook "/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx"
UNIT
cat > "$work/renew.timer" <<'UNIT'
# Managed by scratch-card HTTPS setup
[Unit]
Description=Twice-daily scratch-card certificate renewal check

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h
Persistent=true
Unit=scratch-card-cert-renew.service

[Install]
WantedBy=timers.target
UNIT
for kind in service timer; do
  unit="/etc/systemd/system/scratch-card-cert-renew.$kind"
  if sudo test -e "$unit" && ! sudo grep -qxF "$marker" "$unit"; then
    printf '%s\n' "同名续期任务已存在，未覆盖：$unit" >&2; exit 1
  fi
  sudo install -m 0644 "$work/renew.$kind" "$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable --now scratch-card-cert-renew.timer
https_ok=false
for attempt in 1 2 3 4 5; do
  if curl --noproxy '*' --fail --silent --show-error --connect-timeout 5 --max-time 10 "https://$domain/api/health"; then https_ok=true; break; fi
  if [ "$attempt" -lt 5 ]; then sleep 2; fi
done
if [ "$https_ok" != true ]; then printf '\n%s\n' 'HTTPS 健康检查未通过，请保留报错以便排查。' >&2; exit 1; fi
printf '\n%s\n' 'HTTPS 已连通，开始模拟续期验证（不会替换正式证书）。'
sudo "$certbot" renew "${common[@]}" --cert-name "$domain" --dry-run
printf '\n%s\n' "HTTPS 与自动续期验证完成：https://$domain" \
  '主域名的旧证书没有改动，它的续期需要另行处理。' \
  '查看网页口令：sudo grep ^WEB_TOKEN= /etc/scratch-card/app.env（仅自己查看，不要贴进聊天）'
