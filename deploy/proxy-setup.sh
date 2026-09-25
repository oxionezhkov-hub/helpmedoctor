#!/usr/bin/env bash
# Прокси helpmedoctor.ru → воркер Cloudflare (workers.dev) на VPS вне Cloudflare.
# Зачем: российские провайдеры пропускают к IP Cloudflare-зон только ~16 КБ на соединение,
# а VPS — обычный сервер, его не режут. Запуск на чистом Ubuntu 22.04/24.04 под root:
#   bash proxy-setup.sh
# До запуска: A-записи helpmedoctor.ru и www в Cloudflare DNS → IP сервера, прокси ВЫКЛЮЧЕН (серое облако).
set -euo pipefail
DOMAIN="helpmedoctor.ru"
UPSTREAM="helpmedoctor.oxion-ezhkov.workers.dev"
EMAIL="oxion.ezhkov@gmail.com"

echo "▶ Ставлю nginx и certbot…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx curl >/dev/null

MYIP="$(curl -4 -fsS https://ifconfig.me || curl -4 -fsS https://api.ipify.org)"
echo "▶ IP сервера: $MYIP"
for h in "$DOMAIN" "www.$DOMAIN"; do
  got="$(getent ahostsv4 "$h" | awk '{print $1; exit}' || true)"
  if [ "$got" != "$MYIP" ]; then
    echo "❌ $h указывает на ${got:-ничего}, а должен на $MYIP."
    echo "   В Cloudflare → DNS: A-запись '$h' → $MYIP, облако серое (DNS only). Подождите 5 минут и запустите снова."
    exit 1
  fi
done

echo "▶ Настраиваю прокси…"
cat > /etc/nginx/conf.d/helpmedoctor.conf <<'NGINX'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 80;
  server_name __DOMAIN__ www.__DOMAIN__;
  client_max_body_size 25m;          # голосовые и картинки
  resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off;
  resolver_timeout 5s;

  location / {
    if ($host = www.__DOMAIN__) { return 301 https://__DOMAIN__$request_uri; }
    set $upstream __UPSTREAM__;
    proxy_pass https://$upstream;
    proxy_ssl_server_name on;
    proxy_ssl_name __UPSTREAM__;
    proxy_set_header Host __UPSTREAM__;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    # WebSocket (живые обновления приёма)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    # Редиректы воркера — на наш домен
    proxy_redirect https://__UPSTREAM__/ /;
  }
}
NGINX
sed -i "s/__DOMAIN__/$DOMAIN/g; s/__UPSTREAM__/$UPSTREAM/g" /etc/nginx/conf.d/helpmedoctor.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

echo "▶ Выпускаю HTTPS-сертификат Let's Encrypt…"
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "▶ Проверка…"
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/config")"
size="$(curl -s -o /dev/null -w '%{size_download}' "https://$DOMAIN/app.js")"
echo "   /api/config → $code, app.js → $size байт"
if [ "$code" = "200" ] && [ "$size" -gt 50000 ]; then
  echo "✅ Готово: https://$DOMAIN работает через этот сервер. Сертификат продлевается автоматически."
else
  echo "⚠️ Что-то не так — пришлите этот вывод."
fi
