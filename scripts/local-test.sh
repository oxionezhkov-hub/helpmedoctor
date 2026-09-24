#!/usr/bin/env bash
# Локальный сквозной тест: мок Telegram + wrangler dev (заглушка ИИ) + test/e2e.mjs
set -u
cd "$(dirname "$0")/.."
cleanup() { kill $TG_PID $DEV_PID 2>/dev/null; ps -eo pid,args | grep -E "[w]orkerd" | awk "{print \$1}" | xargs -r kill 2>/dev/null; }
trap cleanup EXIT
rm -rf .wrangler/state
for kv in "profile:555 oldprof" "patient:pat_555_1 oldpat1" "patient:pat_555_0 oldpat0" "test:pat_555_0 oldtest"; do
  set -- $kv
  npx wrangler kv key put --binding HELPMEDOCTOR "$1" --path "test/fixtures/$2.json" --local -c wrangler.test.jsonc >/dev/null 2>&1
done
node scripts/mock-telegram.mjs > .wrangler/mock-tg.log 2>&1 & TG_PID=$!
npx wrangler dev -c wrangler.test.jsonc --port 8787 --ip 127.0.0.1 --test-scheduled > .wrangler/dev.log 2>&1 & DEV_PID=$!
for i in $(seq 1 60); do curl -s http://127.0.0.1:8787/api/config >/dev/null 2>&1 && break; sleep 1; done
node test/e2e.mjs
