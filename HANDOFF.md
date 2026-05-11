# Handoff — что нужно знать Claude для работы с этим проектом

Этот файл — накопленные уроки из нескольких сессий. Читай его первым при старте новой работы с Андреем, сразу после `PROGRESS_LOG.md`.

---

## 🎯 Состояние проекта (на 9 мая 2026)

### Где код

- **Текущая ветка:** `wip/uncommitted-recovery` (НЕ на `main`).
- **Последний коммит:** `8877b94 chore(scripts): Vercel REST helpers for env push and SSO protection`.
- **Опережает `main` на 7 коммитов:**
  ```
  8877b94 chore(scripts): Vercel REST helpers for env push and SSO protection
  90adb9a feat(worker): instant flip Mark-Done card to «Завершено» on /my-tasks
  c2af391 fix(worker): mark-done modal now actually persists to DB    ← на проде
  cd29f5c wip: misc uncommitted changes (needs review)
  73578df fix(media): RLS migration for all_active project access + worker receipt visibility
  e2e5fd0 fix(payroll): RLS migration without recursion + calculator updates
  d0caf76 feat(media): in-app viewer modal + gallery drawer + playback selection
  3ddd68b feat(worker): completion modal + Russian voice dictation for Mark Done
  267636a chore: gitignore certificates and .vercel artifacts
  ```
- **На `main` сейчас:** `9178945 Fix checkout video linking under RLS` (без новой работы).
- **НЕ мержить `wip/uncommitted-recovery` в main** в новой сессии до того как пройти ревью каждого коммита. Особенно `cd29f5c wip: misc uncommitted changes (needs review)` — там 30+ файлов навалом, разобрать на отдельные коммиты разумнее **до** мержа.

### Где прод

- **Production URL:** `https://check-time-five.vercel.app` ← публичный, без Vercel-логина.
- **Deployment:** `dpl_3Rhd6rfnP7AAEVBkh991xGNfwLjk` (target=production, READY на 9 мая 2026 00:02 PT).
- **Что задеплоено:** working tree состояния `c2af391` плюс uncommitted-tweak `TasksPage.tsx` (instant-flip), который потом был закоммичен как `90adb9a`. То есть прод-бинарник ≡ HEAD ветки `c2af391..90adb9a` примерно по содержимому.
- **Vercel SSO protection:** `ssoProtection: { deploymentType: "all_except_custom_domains" }` — preview-URL'ы за стеной, прод-алиас публичный.
- **Env на Vercel Preview:** заполнены 5 из 7 (Supabase URL/anon/service-role, Google Maps key, AUTH_BYPASS=false). `ANTHROPIC_API_KEY` и `OPENAI_API_KEY` — в `.env.local` локально пустые, на Vercel не залиты. AI-роуты в рантайме без них вернут ошибку — пофиксить можно одной командой `node scripts/push-preview-env.mjs` после того как ключи появятся в `.env.local`.

### Что подтверждено вручную (Андрей проверил на check-time-five.vercel.app)

- Worker нажимает «Отметить готовым» на личной задаче → модалка → submit → задача в БД получает `status="done"`, `completed_at`, `completed_by`, `metadata.completion_note/media_ids/follow_up_*`.
- F5 удерживает задачу в «Завершено» (баг ушёл).
- Owner видит «Назначено / Выполнено / Когда / комментарий» в `/tasks` и в карточке проекта.
- Общие задачи проекта — тот же flow с claim → start → modal → done.
- Голосовой ввод (микрофон в textarea «Комментарий о выполнении») — работает в браузере с поддержкой Web Speech API на ru-RU.

### Бэклог следующей сессии (приоритет сверху вниз)

1. **Частичное выполнение задач + история** — двойная кнопка в модалке («Готово полностью» / «Сохранить отчёт»), много сабмитов на одной задаче, видны всем.  
   → дизайн-документ: `PLAN_PARTIAL_COMPLETION.md`
2. **Архив задач** — Owner-only архивация, отдельная страница `/archive` с фильтрами, восстановление.  
   → дизайн-документ: `PLAN_TASK_ARCHIVE.md`
3. **Worker receipts/sums privacy** — Vasya не должен видеть суммы по проекту и чужие чеки. Сейчас уже частично сделано (см. `src/lib/worker-receipt-visibility.ts` в коммите `73578df`), нужна проверка end-to-end и UI-полировка.
4. **Компактные блоки медиа** на project page и worker views — текущий tile-grid слишком расходует экран на мобильном.
5. **Сворачиваемая папка «Завершено»** в /my-tasks и worker project view — collapse по умолчанию, разворачивается одним тапом.
6. **Реорганизация worker project page** — порядок: notes сверху, my+general tasks под проектом. Сейчас порядок другой.
7. **Известный баг:** на worker project page при открытии медиа (фото/видео) виден flicker — UI дёргается на ~200ms. Воспроизводится стабильно. Связан с MediaViewerModal или TaskAttachmentList signing.

Перед стартом каждого пункта 1–2 — Андрей отвечает на вопросы из соответствующего PLAN-документа.

---

## 👤 Про Андрея

- **Язык:** русский. Он владелец компании (Construction Clock — собственный продукт для стройки), не программист.
- **Ввод:** часто голосом, поэтому пунктуация и орфография могут быть странными. Не цепляйся, просто парси смысл.
- **Работает на Windows**, использует Claude Desktop App (не веб-интерфейс).
- **Сессии** могут длиться по много часов, иногда ночью. Андрей устаёт — отвечай компактно, не гоняй лишний текст.

## 💬 Стиль общения — что реально работает

### Всегда спрашивай разрешение перед большими шагами
Он сам не раз это подтверждал: «я рад, что ты меня всегда спрашиваешь». Не «я сейчас сделаю X», а «сделать X? Или сначала Y?». Это важно: он хочет контроль.

### Короткие ответы в чате
Длинные технические простыни его раздражают. Давай итог → конкретное действие → вопрос. Детали — в файлы, не в чат.

### Промпты для Claude Code — КОРОТКИЕ
**10-15 строк максимум**, иногда 5. Большие промпты (30+ строк с разделом «Rules» на полстраницы) Claude Code раскатывает на час вместо 15 минут. Научились на Волне 1 — промпт был на 40 строк, Claude Code упёрся в лимит Max-плана ровно на коммите.

Пример хорошего промпта (Волна 2.5):
```
Fix two regressions, keep it small:
1. /tasks as manager renders the worker shell. Make the manager route 
   show an Assign Task form + All Tasks list. Tasks table is already in DB.
2. Worker bottom tab bar has "ЧАСЫ" twice (1st and 4th tab). Rename the 
   4th — probably Профиль.
Branch wave2.5/fixes, one commit per fix. Don't touch anything else.
```

### Объясняй что делает промпт — на русском, без технических понтов
Под каждым английским промптом для Claude Code давай 2-3 абзаца на русском:
- Что конкретно изменится в приложении (в человеческих терминах)
- Почему это нужно бизнесу
- Сколько примерно времени (40-60 мин)
- Что применять руками после (миграции)

---

## 🛠️ Инструменты — что работает и что нет

### Работает надёжно
- **Windows-MCP FileSystem** — чтение/запись файлов, поиск, info. НЕ висит.
- **Claude for Chrome** — весь браузерный tool-stack (navigate, screenshot, clicks, keyboard, console).
- **FileSystem для чтения git-истории:** `.git/HEAD` → текущая ветка, `.git/logs/HEAD` → полный лог операций с хешами и временем.

### Работает нестабильно
- **Windows-MCP PowerShell** — **периодически виснет на 4 минуты без ответа**. Наблюдали много раз. Обычно восстанавливается само через 5-10 минут. Если завис — не долби, переключайся на FileSystem для чтения или на Chrome для UI-действий.

### Не работает
- **Chrome extension + file:// URL** — Chrome блокирует локальные файлы из расширения. Если нужно открыть `C:\Users\...\file.html` в браузере — запускай через PowerShell: `Start-Process 'chrome.exe' -ArgumentList "C:\path\to\file.html"`.
- **Supabase CLI в PowerShell** — `supabase db push` или `supabase functions deploy` стабильно таймаутят через Windows-MCP. Supabase CLI сам работает у Андрея в ручную, но мы его из MCP не запускаем — применяем миграции через **Supabase Dashboard SQL Editor** вручную через Chrome.

---

## 🗄️ Как применять миграции (важный паттерн)

Claude Code пишет SQL в файлы `supabase/migrations/000XX_*.sql` с шапкой `-- RUN MANUALLY`. **НЕ ПРИМЕНЯЕТ сам.**

Применяет ассистент — через Chrome + Supabase SQL Editor:

1. **Читаешь файл миграции** через FileSystem, извлекаешь SQL (без комментариев).
2. **Копируешь SQL в буфер Windows** через PowerShell:
   ```powershell
   $sql = @"
   alter table public.X add column Y ...;
   "@
   Set-Clipboard -Value $sql
   ```
   *Важно:* длинный SQL нельзя вставлять через `computer:type` — Chrome автоматика режет длинный текст. Только через буфер + Ctrl+V.
3. **Открываешь SQL Editor:** `https://supabase.com/dashboard/project/vlrajjwbaxikbwvqdpft/sql/new`
4. **Ждёшь 5-8 секунд** пока страница полностью прогрузится. Если действовать слишком рано — клик уйдёт в пустоту, нажатия не зарегистрируются.
5. **Клик в editor area → Ctrl+A → Delete → Ctrl+V → Ctrl+Enter.**
6. **Скриншот результата.** Ожидаешь `Success. No rows returned`.

### Что делать если Supabase подтягивает старый запрос
SQL Editor сохраняет предыдущие query. Если после Ctrl+A у тебя всё ещё виден старый SQL — значит Ctrl+A пришёл до того как поле получило фокус. Повтори: клик в середину editor area → ещё раз Ctrl+A.

### Destructive operations warning
Если SQL содержит `DROP POLICY IF EXISTS` или подобное — Supabase покажет модалку с warning. Нужно нажать подтверждение. Андрей обычно готов кликать сам, либо можешь тоже через `computer:left_click`.

---

## 🌿 Git workflow

- Каждая Волна — отдельная ветка `waveN/short-name`.
- Коммит per-пункт (один чистый коммит на одно логическое изменение).
- Мерж в main через `--no-ff`, чтобы история волн читалась.
- Claude Code делает коммиты автоматически (с именем `WaveN Auto <nwbuildpro@gmail.com>`).
- **Волны мержит сам Claude Code** по команде, либо короткий промпт «Merge all outstanding wave branches into main. Use --no-ff.».

### Проверка состояния без PowerShell (если висит)
```
FileSystem mode=read path=...\.git\HEAD          → текущая ветка
FileSystem mode=read path=...\.git\logs\HEAD     → полный лог с хешами
```

---

## ⚠️ Ошибки, которые я совершал — не повторяй

### 1. «Сейчас применю миграцию X» когда миграция ещё не написана
Проверяй что файл миграции реально **на диске**, прежде чем собираться его применять. Claude Code пишет миграцию **внутри Волны** — если Волна ещё не началась, миграции нет.

### 2. Длинные промпты для Claude Code
Волна 1 — 40+ строк с разделом «Rules», Claude Code упёрся в лимит Max-плана ровно на финальном коммите. Переделали на короткий формат — всё стало работать.

### 3. Попытка применить длинный SQL через `computer:type`
Не работает. Только через clipboard (Set-Clipboard → Ctrl+V).

### 4. Сразу после `navigate` пытаться кликать/печатать
Supabase Dashboard грузится 5-8 секунд. Без `wait` ответ уйдёт в пустоту. Всегда wait перед первым interaction.

### 5. Предполагать что новый чат видит те же tools
**Claude Desktop App** видит Windows-MCP + Chrome extension. **Веб-интерфейс claude.ai** видит ТОЛЬКО Chrome extension (и то с настройкой). Если Claude в новом чате говорит «не могу читать файлы» — попроси его буквально попробовать вызвать `Windows-MCP:FileSystem`. Часто они просто сами не знают что могут.

### 6. Устаревшая память
В `userMemories` были устаревшие факты: неактуальный Supabase URL (`khmcdtrzqfqabdpbcjkj`) и состояние «Prompt 0 complete». Проект давно ушёл дальше. **Не доверяй `userMemories` как источнику истины — читай файлы в проекте.**

---

## 🎯 Приоритеты по безопасности

- **Никогда не трогать RLS policies** без явного запроса. Они настроены, работают, любая правка может сломать доступы.
- **Никогда не применять миграции автоматически** — только через SQL Editor с подтверждением результата.
- **Никогда не удалять ветки** — Андрей предпочитает оставлять историю. Мерж → main → ветка остаётся.
- **Никогда не push в remote** без явного указания. Мы на local git без remote.
- **AUTH_BYPASS_ENABLED=true** — это демо-режим с автологином как Owner. **Не выключать без разрешения.**
- **Consent GPS-формы** подписаны? Если нет — никаких реальных GPS-тестов на реальных работниках. Только в демо.

---

## 🧭 Ссылки на дашборды и полезные URL

- **Supabase SQL Editor:** `https://supabase.com/dashboard/project/vlrajjwbaxikbwvqdpft/sql/new`
- **Supabase Webhooks:** `https://supabase.com/dashboard/project/vlrajjwbaxikbwvqdpft/database/hooks`
- **Supabase Edge Functions:** `https://supabase.com/dashboard/project/vlrajjwbaxikbwvqdpft/functions`
- **Localhost:** `http://localhost:3000` (нужен запущенный `npm run dev`)
- **Старый HTML (reference only):** `C:\Users\Nwbui\Desktop\APP\index - 2026-04-11T014115.087 (2).html` (~5500 строк, 229 КБ; читать через FileSystem, не через Chrome)

---

## 📊 Сокращённый словарь

- **Волна / Wave** — логический блок фич, ~40-60 мин работы Claude Code
- **AUTH_BYPASS** — демо-режим, автологин как Owner
- **Owner** — самая высокая роль, видит всё
- **Manager / Supervisor / Driver / Worker** — иерархия ролей
- **EventFeed** — лента событий на Overview (чекины, задачи, фото, визиты в магазины)
- **Before You Leave** — обязательный видеочекаут (если у работника `require_video=true`)
- **Journal** — дневник работника, тип фото/видео/заметка по дню
- **Geofence** — радиус вокруг магазина для автодетекта визитов
- **Store visit** — запись о заезде работника в supply store (Home Depot и т.д.)

---

## 🚦 Если что-то ломается в рантайме

1. **Dev server не стартует после ребута** — `cd` в проект, `npm run dev`, подожди 5-10 сек, проверь порт 3000.
2. **Hydration error в консоли** — смотри на Date/time/locale rendering, RelativeTime компонент часто виноват.
3. **Claude Code молчит 30+ минут** — проверь что он не упёрся в лимит Max-плана (красная плашка «You've hit your limit»). Ждать до 1 AM PT для reset или использовать extra-usage.
4. **Supabase SQL Editor возвращает ошибку** — читай сообщение целиком. Типичные ошибки: колонка уже существует (безопасно, миграции идемпотентны через `if not exists`), enum value уже добавлен, RLS policy duplicate name.
5. **Chrome extension отвалился от MCP** — иконка Claude в Chrome → Connect. Может потребоваться перезапустить Claude Desktop App.
