# Driver Role Setup Alpha-7

## Почему Sanya может не появляться в списке водителей

В workflow материалов водитель определяется по существующей роли профиля: `driver`.

В коде нет правила вида `name === "Sanya"` или `name === "Саня"`. Это сделано специально, чтобы не привязывать бизнес-логику к имени, которое можно изменить или написать по-разному.

Если профиль Sanya в production сейчас имеет роль `worker`, `supervisor`, `manager` или любую другую роль, он не появится в driver-only dropdown в "Добавить материал".

## Как owner/admin назначает Sanya водителем

Используйте обычный UI управления командой:

1. Войти как owner/admin.
2. Открыть `Команда`.
3. Найти профиль Sanya.
4. Открыть профиль через кнопку редактирования.
5. В поле `Роль` выбрать `Водитель`.
6. Нажать `Сохранить профиль`.
7. Вернуться в проект и открыть `Добавить материал`.

После сохранения роли `driver` Sanya должен появиться в dropdown водителей. SQL, миграции и ручное изменение базы для этого не нужны, если owner/admin UI доступен.

Ограничения:

- Manager не может назначить роль `driver`.
- Supervisor не имеет manager-tier доступа и не может назначать роли.
- Worker не может назначать роли.
- Driver остаётся worker-like пользователем и не получает manager/admin dashboard.
- Driver видит material-focused workflow.
- Обычные workers продолжают видеть обычные задачи.

## Что не делать

- Не запускать случайный SQL.
- Не хардкодить Sanya или `Саня` в коде.
- Не менять роль всех workers глобально.
- Не менять Supabase RLS.
- Не менять Storage policies.
- Не менять database schema.
- Не создавать migrations.

## Что проверить после назначения

- Sanya появляется в material dropdown после установки роли `driver`.
- Обычные non-driver workers не появляются в material dropdown.
- Sanya видит material tasks в driver-focused queue.
- Schedule показывает material tasks на нужную дату.
- Owner/manager видит material badges на проекте.
- Manager видит read/taken/done status по material task.

## Что остаётся отдельно

Direct SQL Supabase Step 0 остаётся заблокированным отдельно. Production RLS/Storage policy verification также остаётся отдельной заблокированной проверкой, пока нет прямого SQL/dashboard доступа.
