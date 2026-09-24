#!/usr/bin/env bash
# Поднимает мок Telegram + wrangler dev (заглушка ИИ) в фоне. Остановить: scripts/dev-local.sh stop
cd "$(dirname "$0")/.."
if [ "${1:-}" = "stop" ]; then
  ps -eo pid,args | grep -E "[w]orkerd|[m]ock-telegram|[w]rangler dev" | awk '{print $1}' | xargs -r kill 2>/dev/null
  exit 0
fi
mkdir -p .wrangler
node scripts/mock-telegram.mjs > .wrangler/mock-tg.log 2>&1 &
npx wrangler dev -c wrangler.test.jsonc --port 8787 --ip 127.0.0.1 --test-scheduled > .wrangler/dev.log 2>&1 &
for i in $(seq 1 60); do curl -s http://127.0.0.1:8787/api/config >/dev/null 2>&1 && exit 0; sleep 1; done
echo "dev server did not start"; exit 1
