#!/usr/bin/env bash
# ============================================================================
# 活动报名站 · 一键部署 / 更新（在服务器上用 root 运行）
#
#   bash install.sh
#
# 第一次运行：装好运行环境、下载代码、生成密钥、启动服务、接上 nginx。
# 域名已经解析到这台服务器时，顺便申请 HTTPS 证书；还没解析就先用 HTTP，解析好后再运行一次即可。
# 以后更新代码：再运行一次（数据和密钥保留）。
#
# 只新增，不改动已有项目：
#   - 代码 /opt/yiwu-ai-circle，数据 /var/lib/yiwu-ai-circle，配置 /etc/yiwu-ai-circle/env
#   - 独立的运行用户 yiwu、独立的 systemd 服务 yiwu-ai-circle、自带的 Node.js（不动系统里的 node）
#   - nginx 里只加一个只匹配本域名的站点文件；改之前和改之后对比已有站点的访问结果，有变化就自动撤回
#
# 可选环境变量：DOMAIN（默认 yiwuai.homes）、REF（代码分支，默认 main）、CODE_URL（代码包地址）
# ============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-yiwuai.homes}"
WWW="www.${DOMAIN}"
REPO="${REPO:-rfdiosuao/yiwu-ai-circle}"
REF="${REF:-main}"
CODE_URL="${CODE_URL:-https://codeload.github.com/${REPO}/tar.gz/${REF}}"

APP=yiwu-ai-circle
BASE=/opt/$APP
DATA=/var/lib/$APP
ETC=/etc/$APP
ENVF=$ETC/env
RUNUSER=yiwu
ACME=/var/www/yiwuai-acme
UNIT=/etc/systemd/system/$APP.service
CONF_NAME="zz-${DOMAIN}.conf"

NODE_VERSION=22.11.0
NODE_SHA_X64=4f862bab52039835efbe613b532238b6e4dde98d139a34e6923193e073438b13
NODE_SHA_ARM64=27453f7a0dd6b9e6738f1f6ea6a09b102ec7aa484de1e39d6a1c3608ad47aa6a

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "请用 root 运行：sudo bash install.sh"
command -v systemctl >/dev/null || die "这台服务器没有 systemd，脚本不支持"
for c in curl tar sha256sum ss; do command -v "$c" >/dev/null || die "缺少命令：$c"; done

# ---------------------------------------------------------------- nginx 在哪
NGINX="$(command -v nginx || true)"
for p in /www/server/nginx/sbin/nginx /usr/local/nginx/sbin/nginx /usr/sbin/nginx; do
  [ -z "$NGINX" ] && [ -x "$p" ] && NGINX="$p"
done
[ -n "$NGINX" ] || die "没找到 nginx（这台服务器上已有的网站应该是用 nginx 跑的，请确认）"

# ---------------------------------------------------------------- 1. 端口
say "1/7 选一个本机端口（只监听 127.0.0.1，不对外开放）"
PORT=""
if [ -f "$ENVF" ]; then PORT="$(sed -n 's/^PORT=//p' "$ENVF" | head -1)"; fi
if [ -z "$PORT" ]; then
  for p in $(seq 8787 8899); do
    if ! ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | grep -qE "[:.]${p}\$"; then PORT=$p; break; fi
  done
fi
[ -n "$PORT" ] || die "8787–8899 之间没有空闲端口"
ok "端口 $PORT"

# ---------------------------------------------------------------- 2. Node.js
say "2/7 准备 Node.js $NODE_VERSION（装在 $BASE/runtime，不影响系统里的 node）"
case "$(uname -m)" in
  x86_64|amd64) NARCH=x64; NSHA=$NODE_SHA_X64 ;;
  aarch64|arm64) NARCH=arm64; NSHA=$NODE_SHA_ARM64 ;;
  *) die "不支持的 CPU 架构：$(uname -m)" ;;
esac
NODE_DIR="$BASE/runtime/node-v${NODE_VERSION}-linux-${NARCH}"
NODE="$NODE_DIR/bin/node"
if [ ! -x "$NODE" ]; then
  mkdir -p "$BASE/runtime"
  NAME="node-v${NODE_VERSION}-linux-${NARCH}.tar.gz"
  got=""
  for mirror in "https://nodejs.org/dist" "https://npmmirror.com/mirrors/node"; do
    if curl -fsSL --retry 2 -m 300 -o "$TMP/$NAME" "$mirror/v${NODE_VERSION}/$NAME"; then
      if [ "$(sha256sum "$TMP/$NAME" | awk '{print $1}')" = "$NSHA" ]; then got=1; break; fi
      warn "从 $mirror 下载的文件校验不通过，换一个地址"
    fi
  done
  [ -n "$got" ] || die "Node.js 下载失败"
  tar -xzf "$TMP/$NAME" -C "$BASE/runtime"
fi
"$NODE" -v >/dev/null || die "Node.js 无法运行"
ok "$("$NODE" -v)"

# ---------------------------------------------------------------- 3. 代码
say "3/7 下载代码（$REPO @ $REF）"
TS="$(date +%Y%m%d%H%M%S)"
REL="$BASE/releases/$TS"
mkdir -p "$REL"
curl -fsSL --retry 2 -m 300 -o "$TMP/code.tar.gz" "$CODE_URL" || die "代码下载失败：$CODE_URL"
tar -xzf "$TMP/code.tar.gz" -C "$REL" --strip-components=1
[ -f "$REL/server.js" ] || die "代码包不完整（没有 server.js）"
rm -rf "$REL/data" "$REL/.github" "$REL/test"
chmod -R a+rX "$REL"
ln -sfn "$REL" "$BASE/current"
# 只留最近 3 个版本
ls -1dt "$BASE"/releases/* 2>/dev/null | tail -n +4 | xargs -r rm -rf
ok "代码在 $BASE/current"

# ---------------------------------------------------------------- 4. 用户、数据、配置
say "4/7 运行用户、数据目录和配置"
if ! id "$RUNUSER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA" --no-create-home --shell "$(command -v nologin || echo /bin/false)" "$RUNUSER"
  ok "新建运行用户 $RUNUSER"
fi
mkdir -p "$DATA" "$ETC" "$ACME/.well-known/acme-challenge"
chown "$RUNUSER:$RUNUSER" "$DATA"
chmod 750 "$DATA"
chmod 755 "$ACME" "$ACME/.well-known" "$ACME/.well-known/acme-challenge"

NEW_ADMIN_PASS=""
if [ ! -f "$ENVF" ]; then
  SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  NEW_ADMIN_PASS="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
  umask 077
  cat > "$ENVF" <<EOF
# 活动报名站 · 生产配置（只有 root 能读）。改完执行：systemctl restart $APP
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
PUBLIC_URL=https://$DOMAIN
DATA_DIR=$DATA
COOKIE_SECURE=1
TRUST_PROXY=1
TRUSTED_PROXY_IPS=127.0.0.1,::1
SESSION_SECRET=$SECRET
ADMIN_USER=admin
ADMIN_PASS=$NEW_ADMIN_PASS

# 会员登录：短信没开通前用 off。开通后改成 api 并填两个接口地址
SMS_MODE=off
SMS_SEND_URL=
SMS_VERIFY_URL=

# 报名后发邀请函邮件（不填就不发）。QQ / 企业邮箱用「授权码」当密码
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=ssl
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
  umask 022
  chmod 600 "$ENVF"
  ok "生成配置和密钥：$ENVF"
else
  ok "沿用已有配置：$ENVF"
fi

# ---------------------------------------------------------------- 5. systemd
say "5/7 启动服务 $APP"
cat > "$UNIT" <<EOF
[Unit]
Description=$APP (活动报名站)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUNUSER
Group=$RUNUSER
WorkingDirectory=$BASE/current
EnvironmentFile=$ENVF
ExecStart=$NODE server.js
Restart=always
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$APP" >/dev/null 2>&1
systemctl restart "$APP"
up=""
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/site" >/dev/null 2>&1; then up=1; break; fi
  sleep 1
done
if [ -z "$up" ]; then
  journalctl -u "$APP" -n 40 --no-pager || true
  die "服务没有起来，上面是日志"
fi
ok "服务已启动：http://127.0.0.1:$PORT"

# ---------------------------------------------------------------- nginx 工具
NGINX_T="$("$NGINX" -T 2>/dev/null || true)"
[ -n "$NGINX_T" ] || die "nginx -T 读不到配置"

# 已有站点的域名（不含本域名、通配和正则），用来对比改动前后
existing_names() {
  printf '%s\n' "$NGINX_T" | sed -n 's/^[[:space:]]*server_name[[:space:]]\+\(.*\);.*/\1/p' | tr ' ' '\n' |
    grep -v -E '^$|^_$|^localhost$|^~|\*|^'"${DOMAIN//./\\.}"'$|^'"${WWW//./\\.}"'$' | sort -u | head -15
}

# 对一个站点取「状态码 + 标题 + 证书」，作为改动前后的指纹
probe() { # scheme host
  local scheme="$1" host="$2" port=80 code title cert=""
  [ "$scheme" = https ] && port=443
  code="$(curl -sk -m 8 -o "$TMP/probe.html" -w '%{http_code}' --resolve "$host:$port:127.0.0.1" "$scheme://$host/" 2>/dev/null || true)"
  title="$(grep -o -i '<title>[^<]*</title>' "$TMP/probe.html" 2>/dev/null | head -1 || true)"
  if [ "$scheme" = https ]; then
    cert="$(curl -skv -m 8 --resolve "$host:443:127.0.0.1" "https://$host/" -o /dev/null 2>&1 | sed -n 's/^\*[[:space:]]*subject:[[:space:]]*//p' | head -1 || true)"
  fi
  printf '%s %s %s|%s|%s\n' "$scheme" "$host" "$code" "$title" "$cert"
}

snapshot() {
  local h
  probe http default-check.invalid
  if printf '%s\n' "$NGINX_T" | grep -q -E 'listen[[:space:]]+[^;]*443'; then probe https default-check.invalid; fi
  for h in $(existing_names); do
    probe http "$h"
    printf '%s\n' "$NGINX_T" | grep -q -E 'listen[[:space:]]+[^;]*443' && probe https "$h"
  done
}

# 站点文件放在已有站点所在的 include 目录里，文件名以 zz- 开头排在最后，不会变成默认站点
pick_conf_dir() {
  local d
  for d in $(printf '%s\n' "$NGINX_T" | sed -n 's/^[[:space:]]*include[[:space:]]\+\([^;]*\*[^;]*\);.*/\1/p' | sed 's#/[^/]*$##' | awk '!seen[$0]++'); do
    case "$d" in */mime*|*/modules*|*/snippets*) continue ;; esac
    if [ -d "$d" ] && grep -l -s 'server_name' "$d"/* >/dev/null 2>&1; then echo "$d"; return; fi
  done
  for d in /etc/nginx/conf.d /etc/nginx/sites-enabled /www/server/panel/vhost/nginx; do
    if [ -d "$d" ] && printf '%s\n' "$NGINX_T" | grep -q "include[[:space:]]\+$d/"; then echo "$d"; return; fi
  done
}

nginx_reload() { "$NGINX" -t >/dev/null 2>&1 && "$NGINX" -s reload; }

V6_80=""; V6_443=""
printf '%s\n' "$NGINX_T" | grep -q -E 'listen[[:space:]]+\[::\]:80' && V6_80="    listen [::]:80;"
printf '%s\n' "$NGINX_T" | grep -q -E 'listen[[:space:]]+\[::\]:443' && V6_443="    listen [::]:443 ssl;"

proxy_block() {
  cat <<EOF
    client_max_body_size 50m;
    location ^~ /.well-known/acme-challenge/ {
        root $ACME;
        default_type text/plain;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
EOF
}

write_http_conf() {
  cat <<EOF
# $DOMAIN → 活动报名站（由 $BASE/current/deploy/install.sh 生成，只匹配本域名）
server {
    listen 80;
$V6_80
    server_name $DOMAIN $WWW;
$(proxy_block)
}
EOF
}

write_https_conf() { # cert key
  cat <<EOF
# $DOMAIN → 活动报名站（由 $BASE/current/deploy/install.sh 生成，只匹配本域名）
server {
    listen 80;
$V6_80
    server_name $DOMAIN $WWW;
    location ^~ /.well-known/acme-challenge/ {
        root $ACME;
        default_type text/plain;
    }
    location / { return 301 https://$DOMAIN\$request_uri; }
}
server {
    listen 443 ssl;
$V6_443
    server_name $DOMAIN $WWW;
    ssl_certificate $1;
    ssl_certificate_key $2;
    ssl_protocols TLSv1.2 TLSv1.3;
$(proxy_block)
}
EOF
}

# 换上新的站点文件；已有站点的访问结果有任何变化就撤回
apply_conf() { # content-file label
  local before after backup="$TMP/prev.conf"
  before="$(snapshot)"
  [ -f "$CONF" ] && cp "$CONF" "$backup" || rm -f "$backup"
  cp "$1" "$CONF"
  if ! "$NGINX" -t >/dev/null 2>&1; then
    "$NGINX" -t || true
    if [ -f "$backup" ]; then cp "$backup" "$CONF"; else rm -f "$CONF"; fi
    die "nginx 配置检查没通过，已撤回（$2）"
  fi
  "$NGINX" -s reload
  sleep 2
  after="$(snapshot)"
  if [ "$before" != "$after" ]; then
    if [ -f "$backup" ]; then cp "$backup" "$CONF"; else rm -f "$CONF"; fi
    nginx_reload || true
    printf '改动前：\n%s\n改动后：\n%s\n' "$before" "$after"
    die "已有站点的访问结果变了，已撤回 nginx 改动（$2）。请把上面的输出发给开发者"
  fi
  ok "已有站点访问结果没有变化（$2）"
}

# ---------------------------------------------------------------- 6. nginx（HTTP）
say "6/7 接上 nginx：$DOMAIN"
CONF_DIR="$(pick_conf_dir)"
[ -n "$CONF_DIR" ] || die "没找到 nginx 的站点目录（include 的目录）"
CONF="$CONF_DIR/$CONF_NAME"
ok "站点文件：$CONF"

CERT=""; KEY=""
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
elif [ -f "$ETC/tls/fullchain.pem" ]; then
  CERT="$ETC/tls/fullchain.pem"; KEY="$ETC/tls/key.pem"
fi

if [ -n "$CERT" ]; then
  write_https_conf "$CERT" "$KEY" > "$TMP/site.conf"
  apply_conf "$TMP/site.conf" "HTTPS"
else
  write_http_conf > "$TMP/site.conf"
  apply_conf "$TMP/site.conf" "HTTP"
fi

# ---------------------------------------------------------------- 7. HTTPS
say "7/7 HTTPS 证书"
points_here() { # host：域名是不是已经解析到这台服务器
  local tok="yiwu-check-$RANDOM$RANDOM"
  echo "$tok" > "$ACME/.well-known/acme-challenge/$tok"
  chmod 644 "$ACME/.well-known/acme-challenge/$tok"
  local got
  got="$(curl -fsS -m 8 "http://$1/.well-known/acme-challenge/$tok" 2>/dev/null || true)"
  rm -f "$ACME/.well-known/acme-challenge/$tok"
  [ "$got" = "$tok" ]
}

HTTPS_STATE=""
if [ -n "$CERT" ]; then
  HTTPS_STATE="已有证书"
  ok "已有证书：$CERT"
elif points_here "$DOMAIN"; then
  NAMES=("$DOMAIN")
  if points_here "$WWW"; then NAMES+=("$WWW"); fi
  ok "域名已解析到本机：${NAMES[*]}"
  DARGS=(); for n in "${NAMES[@]}"; do DARGS+=(-d "$n"); done
  if command -v certbot >/dev/null; then
    certbot certonly --webroot -w "$ACME" "${DARGS[@]}" --cert-name "$DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring \
      --deploy-hook "$NGINX -s reload" && {
        CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"; }
  elif [ -x /root/.acme.sh/acme.sh ]; then
    mkdir -p "$ETC/tls"
    /root/.acme.sh/acme.sh --issue --server letsencrypt "${DARGS[@]}" -w "$ACME" || true
    /root/.acme.sh/acme.sh --install-cert -d "$DOMAIN" --key-file "$ETC/tls/key.pem" \
      --fullchain-file "$ETC/tls/fullchain.pem" --reloadcmd "$NGINX -s reload" && {
        CERT="$ETC/tls/fullchain.pem"; KEY="$ETC/tls/key.pem"; }
  else
    warn "没找到 certbot / acme.sh，尝试安装 certbot"
    if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y certbot >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null; then dnf install -y certbot >/dev/null 2>&1 || true
    elif command -v yum >/dev/null; then yum install -y certbot >/dev/null 2>&1 || true
    fi
    if command -v certbot >/dev/null; then
      certbot certonly --webroot -w "$ACME" "${DARGS[@]}" --cert-name "$DOMAIN" \
        --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring \
        --deploy-hook "$NGINX -s reload" && {
          CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"; }
    fi
  fi
  if [ -n "$CERT" ] && [ -f "$CERT" ]; then
    write_https_conf "$CERT" "$KEY" > "$TMP/site.conf"
    apply_conf "$TMP/site.conf" "HTTPS"
    HTTPS_STATE="刚申请好证书"
  else
    warn "证书申请没成功，网站先用 HTTP。可以稍后再运行一次本脚本"
  fi
else
  warn "$DOMAIN 还没有解析到这台服务器，先用 HTTP。解析生效后再运行一次本脚本，会自动申请 HTTPS 证书"
fi

# ---------------------------------------------------------------- 收尾
say "完成"
if [ -n "$HTTPS_STATE" ]; then
  code="$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/site" || true)"
  ok "https://$DOMAIN  （本机自测：$code）"
else
  code="$(curl -s -m 8 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/api/site" || true)"
  ok "http://$DOMAIN  （本机自测：$code；HTTPS 要等域名解析后再运行一次本脚本）"
fi
echo "    后台：https://$DOMAIN/admin.html    （HTTPS 生效后才能登录后台）"
if [ -n "$NEW_ADMIN_PASS" ]; then
  echo "    后台账号：admin"
  echo "    后台密码：$NEW_ADMIN_PASS"
  echo "    （只显示这一次，请马上保存。忘了可以看：grep ADMIN_ $ENVF）"
fi
echo "    日志：journalctl -u $APP -f"
echo "    配置：$ENVF（改完执行 systemctl restart $APP）"
echo "    更新代码：再运行一次本脚本"
