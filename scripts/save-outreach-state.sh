#!/usr/bin/env bash
set -euo pipefail

cd "$1"
git add -A
git diff --cached --quiet && exit 0
git -c user.name=outreach-bot -c user.email=outreach-bot@users.noreply.github.com \
  commit -q -m "Сохранить состояние рассылки"
for attempt in 1 2 3 4; do
  git push -q origin outreach-state && exit 0
  git pull -q --rebase origin outreach-state
  sleep 3
done
exit 1
