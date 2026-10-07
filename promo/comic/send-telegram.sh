#!/usr/bin/env bash
# Отправить готовые серии в Telegram через Bot API (sendVideo), с подписью.
# Нужно: TELEGRAM_BOT_TOKEN — токен бота, TG_CHAT_ID — числовой id получателя (он должен был хоть раз написать боту /start).
#   ./send-telegram.sh google smoker granny student mama
set -euo pipefail
cd "$(dirname "$0")"
: "${TELEGRAM_BOT_TOKEN:?нужен TELEGRAM_BOT_TOKEN}" "${TG_CHAT_ID:?нужен TG_CHAT_ID}"
for E in "$@"; do
  F=series/$E/priem-$E.mp4
  CAP=$(python3 -c "import json,sys;e=json.load(open('series/$E/episode.json'));print(f\"«{e['title']}» — {e['final']}\")")
  W=1080 H=1920 DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$F" | cut -d. -f1)
  curl -sS --fail-with-body -F chat_id="$TG_CHAT_ID" -F caption="$CAP" -F supports_streaming=true \
    -F width=$W -F height=$H -F duration=$DUR -F video=@"$F" \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo" | python3 -c "import json,sys;r=json.load(sys.stdin);print('$E', 'ok' if r.get('ok') else r)"
done
