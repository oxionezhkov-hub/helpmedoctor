# Help me, Doctor 👩‍⚕️

Тренажёр врача: ИИ-пациенты с жалобами, расспрос (текстом или голосом), обследования, осмотр, диагноз — и разбор приёма от «профессора», опыт, стрики, задания дня и тесты «работа над ошибками».

Работает в двух местах **на одних данных**:

- Telegram-бот [@helpmedoctor_aibot](https://t.me/helpmedoctor_aibot);
- веб-приложение `https://helpmedoctor.ru/app` (запасной адрес — `https://helpmedoctor.oxion-ezhkov.workers.dev/app`) — открывается и внутри Telegram (кнопка «Приложение»), и в обычном браузере на телефоне или компьютере.

Начали приём в боте — продолжайте на сайте, и наоборот. Открытые вкладки обновляются сами (WebSocket).

## Архитектура

```
Telegram ──webhook──►┐
                     │  Cloudflare Worker (src/index.js)
Браузер / Mini App ─►┤   ├─ /api/*        API веб-приложения
                     │   ├─ /tg/webhook   бот (src/bot/)
                     │   ├─ /payment-callback  Точка Банк
                     │   └─ /app          статика (public/)
                     │
                     ├─► UserDO (Durable Object на каждого врача) — профиль, пациенты, приёмы, тесты
                     │     • строгая консистентность: бот и сайт видят одно и то же
                     │     • тяжёлые ИИ-задачи (новый пациент, разбор) — в alarm(), лимит 15 минут
                     │     • WebSocket-рассылка изменений в открытые вкладки
                     ├─► HubDO (один на сервис) — реестр пользователей, вход на сайт, платежи, статистика, рассылки
                     └─► Workers AI — Llama 3.3 70B (текст) и Whisper (голос)
```

- **ИИ** — только Workers AI (binding `AI`), без внешних ключей. Промпты короткие, у каждого вызова свой лимит токенов, история диалога сжимается в резюме, результаты анализов кэшируются в рамках приёма, разбор и «что было дальше» — один вызов вместо двух.
- **Старые данные** из KV `HELPMEDOCTOR` переносятся в UserDO автоматически при первом обращении пользователя (или при утренней рассылке). KV после этого только читается.
- **Вход на сайт**: внутри Telegram — по подписи `initData`; в браузере — «Войти через Telegram» (бот с одноразовым кодом), «Войти через Яндекс ID» или «Войти через Google» (OAuth 2.0, `src/lib/oauth.js`).
  Вошедший без Telegram получает веб-аккаунт (uid вида `w123…`, бот ему не пишет). В профиле → «Способы входа» можно привязать Telegram (бот спросит подтверждение, прогресс, подписка и платежи склеятся в Telegram-аккаунт, старые сессии продолжат работать) и второй сервис входа.
- **Оплата**: вебхуку Точки не доверяем — статус платежа перепроверяется запросом к API Точки.

```
src/
  index.js          роутинг, API, вебхуки, cron
  config.js         тарифы, специализации, задания дня, модели ИИ
  do/user.js        UserDO — вся игровая логика
  do/hub.js         HubDO — общие данные
  bot/handlers.js   бот: команды, кнопки, ввод
  bot/render.js     тексты и клавиатуры бота
  lib/              ai, prompts, game, auth, telegram, tochka, util
public/             веб-приложение (без сборки: index.html, app.js, app.css)
test/               юнит-тесты, сквозной тест, скриншот-тест
scripts/            локальный запуск, мок Telegram, настройка вебхука
```

## Деплой

Деплоится автоматически через GitHub Actions при пуше в `main` (`.github/workflows/deploy.yml`).

### Один раз: секреты репозитория

GitHub → Settings → Secrets and variables → Actions → New repository secret:

| Секрет | Что это |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → шаблон **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | ID аккаунта Cloudflare (правая колонка на странице Workers) |
| `TELEGRAM_TOKEN` | токен бота от @BotFather |
| `TOCHKA_TOKEN` | JWT-токен API Точки |
| `SESSION_SECRET` | любая длинная случайная строка (подпись сессий сайта) |

Для входа через Google и Яндекс (по желанию — без ключей кнопки просто не показываются):

| Секрет | Где взять |
|---|---|
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | [oauth.yandex.ru](https://oauth.yandex.ru/) → Создать приложение → «Веб-сервисы», права: доступ к логину, имени и почте. Redirect URI: `https://helpmedoctor.ru/api/auth/oauth/yandex/callback` и `https://helpmedoctor.oxion-ezhkov.workers.dev/api/auth/oauth/yandex/callback` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth consent screen (External, scopes: openid, email, profile) → Credentials → OAuth client ID → Web application. Authorized redirect URIs: `https://helpmedoctor.ru/api/auth/oauth/google/callback` и `https://helpmedoctor.oxion-ezhkov.workers.dev/api/auth/oauth/google/callback` |

> ⚠️ Токены из старой версии лежали прямо в коде. Выпустите новые: @BotFather → `/revoke`, новый токен в интернет-банке Точки, а ключ сервисного аккаунта Google удалите — он больше не нужен.

### Вручную (без GitHub)

```bash
npm install
npx wrangler login
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put TOCHKA_TOKEN
npx wrangler secret put SESSION_SECRET
npm run deploy
```

### После первого деплоя (по желанию)

Кнопка меню «Приложение», список команд и секрет вебхука:

```bash
# сгенерируйте секрет и сохраните его в воркер:
npx wrangler secret put WEBHOOK_SECRET
# затем перерегистрируйте вебхук с тем же секретом:
TELEGRAM_TOKEN=... WEBHOOK_SECRET=... npm run webhook
```

Вебхук работает и без этого шага (старый адрес `/` поддерживается). Если задали `WEBHOOK_SECRET` в воркере — обязательно запустите `npm run webhook`, иначе бот перестанет получать сообщения.

## Разработка

```bash
npm test            # юнит-тесты
npm run test:e2e    # сквозной тест: бот + сайт + миграция + вход + безопасность
                    # (локальный wrangler dev, ИИ и Telegram подменены заглушками)
npm run check       # сборка воркера без деплоя
scripts/dev-local.sh && node test/ui.mjs   # скриншоты экранов в .wrangler/shots (нужен playwright)
node scripts/build-site.mjs  # пересобрать сайт: главная, демо, посадочные, блог, sitemap.xml, llms.txt
node scripts/build-pdf.mjs   # PDF-материалы из content/telegram-channel/pdf/*.html (нужен playwright)
```

Сайт (`public/*.html`) — статичные страницы из `scripts/build-site.mjs`; тексты посадочных — `scripts/site/landings.mjs`, статьи — `scripts/site/posts/`. Все кнопки сайта ведут в веб-версию `/app?from=<место>`; метка уходит в Метрику, а при входе через Google или Яндекс сохраняется как источник регистрации (ref). Демо-приём, липкая кнопка, окно при уходе и живые цифры — `public/site.js`.

Материалы для Telegram-канала: `content/telegram-channel/resources.md` (подборка ресурсов с правовым статусом и контент-план), PDF в фирменном стиле — `content/telegram-channel/pdf/` (общий стиль `_brand.css`, готовые файлы — `out/`).

Настройки без секретов — в `wrangler.jsonc` (`vars`). Модель ИИ меняется в `src/config.js` (`AI_MODEL`).
