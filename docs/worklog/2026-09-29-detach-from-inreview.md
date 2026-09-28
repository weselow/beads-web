# 2026-09-29 — Create PR, Close Epic и перестройка веток без inreview (beads-web-5fk.4)

Три действия больше не смотрят на статус `inreview`, которого в bd нет.
**Create PR** (`src/components/bead-pr-section.tsx`) доступна всегда, когда
ветка отправлена и PR ещё нет; подсказка «Bead must be in review» убрана.
**Close Epic** (`src/components/epic-card.tsx`) решает функция `canCloseEpic`
из `src/lib/epic-parser.ts`: у эпика есть подзадачи, все они в группе done, а
сам эпик ещё не в группе done — его собственный статус больше не важен.
**Перестройка соседних веток** после слияния PR
(`server/src/routes/worktree.rs`, `rebase_open_pr_siblings`) берёт только те
ветки, у которых открыт PR (`gh pr view <ветка> --json state`); ветки без PR
и с закрытым или слитым PR попадают в `skipped`. Раньше статус читался из
`.beads/issues.jsonl`, которого в новых bd может не быть, и пропускалось всё.
Выбор вынесен в чистую функцию `split_by_open_pr`, тесты не зовут `gh`.

Самодельный статус эпика удалён: `compute_epic_status_from_children` и
`recompute_epic_statuses` в `server/src/routes/beads.rs` и их вызов из
наблюдателя за файлом (`watch.rs`) переписывали статус эпика прямо в
`issues.jsonl` в обход bd. Прогресс на карточке эпика остался, его считает
`computeEpicProgress`: готовые — группа done, «в работе» — вся группа wip
(`in_progress`, `hooked`, `blocked`, свой `inreview`), а не только
`in_progress`. Проверки `=== 'closed'` заменены на `isDoneStatus` в
`isBlocked`, `getBlockedTasks`, карточке задачи, карточке эпика, списке
подзадач и панели задачи; список статусов проекта доходит до карточек через
`KanbanColumn` (новое свойство `statuses`). Удалён мёртвый код: хук
`src/hooks/use-epics.ts`, `isEpicCompleted` и `getEpicChildren` из
`src/lib/beads-parser.ts`.

**Что проверить, если сломается.** Close Epic не появляется — смотреть, в
какой группе статусы подзадач (`/api/statuses`); подзадача со статусом не из
списка проекта не считается готовой. После слияния PR соседние ветки не
перестроились — в логе сервера строки `Skipping rebase for bead ... (PR
state: ...)`; `None` значит, что `gh pr view` не нашёл PR или сам `gh` не
работает (не авторизован, нет сети).

**Что оставлено.** Цвета и значки статусов в списке подзадач
(`getStatusIcon`, `getStatusColor` в `subtask-list.tsx`) по-прежнему знают
только четыре старых статуса — это вид, а не логика. Колонки доски — 5fk.3,
счётчики главной — 5fk.5. Старое описание в `docs/designs/epic-support.md`
упоминает `useEpics` и `isEpicCompleted` — это история, не правилось.
