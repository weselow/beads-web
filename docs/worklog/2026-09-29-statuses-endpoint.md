# 2026-09-29 — сервер: список статусов проекта /api/statuses (beads-web-5fk.1)

Новый запрос `GET /api/statuses?path=<папка или dolt://база>` отдаёт статусы
проекта: `{"statuses":[{"name","category","builtin"}],"source":...}`. Сначала
семь встроенных статусов bd в его порядке (open, in_progress, blocked,
deferred, closed, pinned, hooked), затем свои статусы проекта. Группа
(`category`) всегда одна из `active`, `wip`, `done`, `frozen`; свой статус без
группы (`unspecified` или пусто) считается `wip` — обычно это ступень между
open и closed вроде проверки, а `bd ready` его не предлагает. Код —
`server/src/routes/statuses.rs`; нужен страницам из задач beads-web-5fk.2
и 5fk.5.

**Откуда берётся список (`source`).** `dolt-project` — у проекта работает
свой Dolt-сервер (ступень 0, та же проверка порта, что в `/api/beads`,
вынесена в `beads::live_project_dolt`): встроенные плюс строка
`status.custom` из таблицы `config` по SQL. `cli` — иначе `bd statuses --json`.
`dolt-direct` — проекты `dolt://` на общем Dolt-сервере, тоже по SQL.
`fallback` — встроенный список, если bd старый (нет `bd statuses`), упал или
SQL не ответил. Строку `status.custom` разбираем в двух видах: `name` и
`name:category` через запятую (в сервер-для-1с.рф там просто `inreview`).
Повторы имён, в том числе совпадающие со встроенными, отбрасываются.

**Память.** Ответ хранится в памяти сервера по пути проекта 3 минуты
(`STATUS_CACHE_TTL`): вызов bd во встроенном проекте идёт около 2 секунд.
Список `fallback` не запоминается — иначе сбой bd на 3 минуты спрятал бы свои
статусы проекта. Поменяли `status.custom` — страница увидит это не позже чем
через 3 минуты или после перезапуска beads-web.

**Что проверить, если сломается.** В журнале сервера на каждый не из памяти
запрос есть строка `read project statuses` с полями `project`, `source`,
`count`, `duration_ms`. `source="fallback"` — рядом warn с причиной:
`bd statuses failed`, `status.custom SQL read failed` или `Dolt server is not
running`. Проверка вручную: `bd statuses --json` в папке проекта и
`bd config get status.custom`.

**Что оставлено.** Общий Dolt-сервер (ступень 1) для обычных папок не
опрашивается — только свой сервер проекта или bd. Пул соединений к своему
серверу проекта теперь собирает одна функция `dolt::port_pool` (раньше тот же
код был в двух местах). Страница и счётчики на главной не менялись.
