# Handoff — что нужно знать Claude для работы с этим проектом

Этот файл — накопленные уроки из нескольких сессий. Читай его первым при старте новой работы с Андреем, сразу после `PROGRESS_LOG.md`.

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
