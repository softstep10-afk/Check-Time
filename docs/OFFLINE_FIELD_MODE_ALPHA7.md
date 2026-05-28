# Alpha-7: offline / weak-network field mode

Цель: рабочий или водитель не должен ощущать, что приложение "сломалось", если он находится в магазине, подвале, в горах или в зоне слабого интернета.

## Что работает офлайн

- Clock-in / clock-out уже используют локальную очередь смен. События сохраняются на устройстве и отправляются при восстановлении связи.
- Фото/видео/файлы журнала уже используют локальную очередь uploads. Успех показывается только после Storage + metadata.
- "Взять" задачу, включая открытую material task, ставится в локальную очередь, если сеть недоступна.
- Start / done по задаче ставится в локальную очередь без ложного success. Статус не становится "done" до подтверждения сервера.
- Private/direct message без вложения ставится в локальную очередь и отправляется при восстановлении связи.

## Что видит пользователь

- Если сеть пропала: "Нет соединения — работаем офлайн".
- Если действие сохранено локально: "Ожидает соединения".
- Во время отправки очереди: "Синхронизация".
- После подтверждения сервера: "Отправлено".
- Если сервер отклонил действие, пользователь видит ошибку. Например, если material task уже взял другой человек, приложение показывает, что задача уже занята.

## Как избегаем дублей

- Очередь хранится локально в `localStorage` под ключом `cc_offline_field_actions`.
- Каждое действие имеет `clientActionId` и `dedupeKey`.
- Повторный tap по той же queued action не создает второй queued item.
- Для private messages в metadata пишется `client_action_id`, чтобы повторная синхронизация не создавала дубликат сообщения.
- Для open material task сервер всё равно решает "кто первый взял": route `/api/worker/claim-task` обновляет только строки с `assigned_to IS NULL`.

## Offline readable cache

Это не full PWA и не Service Worker. Это lightweight last-loaded cache для worker/driver field pages, чтобы уже открытая информация не превращалась в пустой экран при потере связи.

Кешируется только последняя успешно загруженная field-информация:

- worker task list;
- material task queue;
- worker project list;
- previously opened worker project detail summary;
- opened task detail snapshot;
- private/direct message history.

Кеш хранится локально в `localStorage` с namespace по `profile.id` + `org_id`, поэтому данные одного пользователя не должны подмешиваться другому пользователю на том же устройстве. При logout текущий actor cache очищается, где это поддерживает worker shell.

Что не кешируется:

- PINs/tokens/secrets/auth data;
- signed URLs/public URLs;
- payroll/owner financial data;
- большие файлы, фото или видео blobs.

Когда worker/driver offline, приложение показывает:

- `Офлайн — показаны последние загруженные данные`;
- `Обновлено: <time>`;
- если кеша нет: `Нет сохранённых данных для офлайн-режима. Подключитесь к интернету.`

Files/videos may still require network unless the browser already has them cached. Upload queue remains separate from readable cache.

## Ограничения

- Вложения к private message и completion evidence требуют сеть, чтобы файл реально попал в Storage. Приложение не показывает fake uploaded state.
- Если completion form содержит выбранные файлы и связи нет, форма остается открытой, чтобы пользователь не потерял выбранные данные и мог повторить после reconnect.
- Очередь локальная для устройства/browser. Если пользователь очистит storage браузера, queued actions будут потеряны.
- Offline readable cache shows last-known data, not guaranteed-fresh data. After reconnect the app refetches and updates the cache.
- Previously unseen pages will show the friendly no-cache state until they are loaded once online.

## Что не изменено

- Payroll не изменен.
- GPS rules не изменены.
- Clock-in/out calculation не изменен.
- Supabase schema/RLS/Storage policies не изменены.
- Material business rules не изменены.
- Messages не превращаются в tasks автоматически, кроме уже существующего явного task-priority flow.

## Manual QA

1. Включить airplane mode.
2. Нажать "Взять" на open material task.
3. Проверить "Ожидает соединения".
4. Вернуть интернет.
5. Проверить "Синхронизация" и затем серверное состояние задачи.
6. Включить airplane mode и отправить private message без файла.
7. Вернуть интернет, проверить что сообщение появилось у отправителя и получателя.
8. Попробовать upload на слабой сети: успех должен появиться только после Storage + metadata.
9. Проверить гонку material task: если другой человек уже взял задачу, второй видит ошибку, а дубль не создается.
10. Проверить clock-in/out в слабой сети: queued shift синхронизируется после reconnect.
11. Online: открыть `Задачи`, `Проекты`, один project detail и `Сообщения`.
12. Включить airplane mode.
13. Вернуться в `Задачи`: должны быть последние загруженные задачи, stale banner и timestamp.
14. Открыть `Проекты`: должен быть последний project list.
15. Tap по ранее открытому project: должен открыться cached project summary; по неоткрытому project должен быть friendly no-cache state.
16. Открыть `Сообщения`: должна быть последняя история messages, без исчезновения прочитанных сообщений.
17. Вернуть интернет и проверить, что stale warning уходит после свежей загрузки.
