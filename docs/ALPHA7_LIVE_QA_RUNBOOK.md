# Alpha-7 Live QA Runbook

Практический чеклист для ручной проверки production после деплоя Alpha-7.

## 1. Перед QA

- Production URL: `https://check-time-five.vercel.app`
- Текущий deployed commit: `303f3588af73731df1e6808d8676da339d781037`
- Нужные роли для проверки: owner/admin, manager, supervisor, worker, driver.
- Не проверяйте удаление на важных реальных данных, если запись нельзя безопасно удалить.
- Не запускайте SQL, миграции и не меняйте Supabase RLS/Storage policies во время QA.

## 2. Driver / Materials Setup

- Проверьте, что Sanya имеет роль `driver`.
- Если роль не `driver`, он не появится в dropdown водителей для материала.
- Если owner/admin UI доступен: `Команда` -> профиль Sanya -> `Роль` -> `Водитель` -> `Сохранить профиль`.
- В material dropdown должны быть только пользователи с ролью `driver`.
- Создайте срочную material task.
- Создайте несрочную material task.
- Driver должен получить notification/banner.
- Schedule должен показать материал на выбранную дату.
- Manager должен видеть read/taken/done без ручного refresh.

## 3. Личные сообщения

- Отправитель видит отправленное личное сообщение в истории.
- Получатель видит полученное личное сообщение в истории.
- Read status обновляется.
- Очистка notification не удаляет исходное сообщение.

## 4. Tasks

- Worker открывает/читает task.
- Worker нажимает `Взять`.
- Worker нажимает `Выполнить`.
- Manager видит обновления без ручного refresh.
- Task остаётся видимой после read/taken/done.

## 5. Project Navigation

- На проекте есть `В путь` / `Поехать`.
- Первый tap на mobile предлагает выбрать приложение.
- Выбранное приложение сохраняется для будущих tap.
- Проверьте Apple Maps.
- Проверьте Google Maps.
- Проверьте Tesla-share/copy, без Tesla API/OAuth/token.
- Copy address/location продолжает работать.

## 6. Files / Media

- Проверьте upload/open/download для PDF, Word, Excel, CSV, photo, video.
- Проверьте iPhone `.mov` / `video/quicktime`.
- Удаление saved media доступно только Andrey/Sergey.
- Non-privileged users не должны видеть или успешно выполнять delete saved media.

## 7. Roles

- Supervisor остаётся worker-like.
- Manager остаётся manager.
- Owner/admin остаётся owner/admin.
- Driver остаётся worker-like и видит material queue.

## 8. Dangerous Zones Smoke

- Payroll archive виден.
- Shift history виден.
- Archive и Trash остаются отдельными.
- Clock-in/out не изменился.

## 9. Если QA падает

- Сообщайте один failed item за раз.
- Не просите Codex “починить всё сразу”.
- Для каждого production QA бага нужен отдельный targeted hotfix commit.
