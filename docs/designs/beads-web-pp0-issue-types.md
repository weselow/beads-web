# Новые типы задач bd (story, spike, milestone, decision, chore) в beads-web

**Задача:** beads-web-pp0
**Дата:** 2026-09-29
**Состояние:** исследование закончено, предложение ждёт решения пользователя

## Зачем этот документ

bd 1.0–1.3 добавил типы задач story, spike, milestone, decision и chore
к прежним task, bug, feature, epic. В задаче pp0 (апрель 2026) были идеи:
отдельные представления для историй и исследований, вкладка вех, шкала времени.
Прежде чем решать, что делать в beads-web, мы изучили две вещи: как такие
типы показывают известные планировщики и что с ними делает сам bd.

Тип и статус — разные вещи. Статус — этап задачи (open, in_progress, closed),
им занимался эпик beads-web-5fk. Тип — что это за работа (задача, ошибка,
эпик). Этот документ — о типах.

## Что значит каждый тип

| Тип | Что это | Результат |
|---|---|---|
| story (история) | Желание от лица пользователя: «хочу, чтобы…». Что нужно и зачем, без плана | Разбирается на эпик и задачи |
| spike (исследование) | Работа, где нужен ответ, а не код; время ограничено заранее | Выводы и решение; код, если был, выбрасывают |
| milestone (веха) | Контрольная точка без своей работы: «к этому моменту готово вот это» | Готова, когда закрыто всё, что к ней привязано |
| decision (решение) | Запись принятого решения: что решили, почему, какие были варианты | Действует, пока не заменено новым |
| chore (обслуживание) | Нужная, но невидимая пользователю работа: зависимости, чистка, сборка | Обычная задача |

## Как это устроено в планировщиках

Изучены Jira, Linear, YouTrack, GitHub, GitLab, Pivotal Tracker, Trello,
Shortcut, Azure DevOps.

**Главное: вкладок по типу задачи нет ни у кого.** Работу делят по стадии —
склад идей → текущая работа → выпуск — или по вложенности. Тип задачи — фильтр.

**Истории и склад идей.** Отдельное место для «ещё не решённого» есть почти
везде, но это панель, экран или статус, а не тип:

- Linear — входящий ящик Triage, скрыт из всех видов; кнопки «принять»,
  «отклонить», «дубликат», «отложить». Сам Linear называет user stories
  вредной практикой и пишет обычные задачи.
- Jira — экран Backlog отдельно от доски; задачу перетаскивают в спринт.
- YouTrack — Backlog как боковая панель слева от доски, её содержимое задаёт
  сохранённый поиск; задачи перетаскивают на доску.
- Pivotal Tracker — панели Icebox → Backlog → Current → Done.
- Trello — личный Inbox для быстрой записи мыслей.

Главная жалоба — склад превращается в «кладбище задач». Отсюда правило
«в Icebox не дольше 90 дней» и кнопки «отложить / отклонить» в Linear.

**Вехи и выпуски — самый устоявшийся образец:**

- GitHub — страница вехи: срок, процент готовности, открыто/закрыто, список;
  фильтр `milestone:`.
- GitLab — задачи вехи в трёх колонках, графики сгорания работы, процент, даты;
  доску можно ограничить вехой.
- Jira — страница Releases и страница версии с полосой прогресса.
- Linear — вехи внутри проекта: процент, дата, фильтр.
- YouTrack — версия как значение поля, отчёты и доска по версиям.

Во всех, кроме Pivotal, веха — отдельная сущность, к которой привязывают
задачи. В bd веха — тип задачи, похоже только на release marker в Pivotal.

**Исследования.** Встроенного типа или экрана нет нигде; в Jira делают задачу
с меткой. Выводы пишут в описание или комментарий, продолжение связывают
ссылкой. Нужен ли вообще отдельный тип — спорят даже в сообществе Atlassian.

**Решения.** В трекерах поддержки нет. ADR (Architecture Decision Record)
хранят файлами в репозитории (`docs/adr/`) со статусами Proposed / Accepted /
Superseded или в Confluence (шаблон Decision и страница Decision log).
Принятые записи не правят — новое решение заменяет старое со ссылкой.

**Обслуживание.** Отдельный тип в Pivotal и Shortcut; в Pivotal не
оценивается и не входит в скорость команды. Отдельных видов нет нигде.

**Что есть почти у всех:** страница вехи с прогрессом; фильтр доски по вехе
и по эпику; «ещё не решено» отдельно от «в работе»; прогресс родителя по
дочерним задачам; сохранённые виды вместо жёстких вкладок.

**Чего нет ни у кого:** вкладок по типу карточки; экрана для исследований;
решений внутри трекера.

## Что делает с этими типами сам bd

Проверено на bd 1.3.0 (f45b249ce) и его исходниках.

- **Своё поведение есть только у epic:** `bd epic status` и
  `bd epic close-eligible` считают прямых детей (закрытым считается ровно
  `closed`), `bd show` пишет «N/M complete», эпик помечается в выводе.
- **story, spike, milestone, decision, chore — просто значение поля
  `issue_type`.** Правила очереди `bd ready`, блокировок, закрытия и подсчёта
  для них те же, что для task. Ограничений «кто кому родитель» нет.
- bd подсказывает разделы описания (проверяют `bd lint` и
  `bd create --validate`):
  - task, feature, story — Acceptance Criteria;
  - epic — Success Criteria;
  - spike — Goal, Findings;
  - decision — Decision, Rationale, Alternatives Considered;
  - milestone, chore — ничего.
- **Команды для вех нет.** Пометка «contains no work itself» ничем не
  проверяется: веха с открытыми детьми видна в `bd ready` как готовая работа.
  Вехи из Linear (`bd linear sync --milestones`) и GitLab bd превращает
  в **эпики**, а не в milestone.
- **decision** — единственный тип с инструкцией у авторов bd
  (`plugins/beads/skills/beads/commands/decision.md`): задача открыта —
  решение действует; закрыта — заменено или отменено. Замена: новое решение,
  связь `related` на старое, комментарий «Superseded by …», закрытие старого.
- **spike** по инструкции авторов: ограничить время, записать выводы,
  завести продолжение со связью `discovered-from`, закрыть с рекомендацией.
- Полезное для интерфейса: `bd update --type` меняет тип задачи;
  `bd update --defer <дата>` прячет задачу из `bd ready` до даты, потом она
  сама возвращается в open. Сокращённые имена типов (`ms`, `timebox`)
  в `bd list --type` не работают — передавать полные имена.

**Что в beads-web сейчас.** Значки и цвета для story, spike, milestone есть
(`src/lib/issue-types.ts`); chore и decision beads-web не знает. Отбор по
типу есть в строке фильтров («All types»). Отдельных представлений нет.
В проекте beads-web задач новых типов нет ни одной.

## Выводы

1. Вкладки по типу противоречат тому, как устроены все изученные планировщики.
   Если делить экран, то по стадии: идеи / работа / выпуски.
2. В bd на новых типах нечего строить, кроме их значения: всё поведение —
   наша собственная трактовка. Значит, делать немного и только то, что
   явно нужно.
3. Самое полезное для одного человека с агентами — склад идей: место, куда
   быстро записать «хочу…», не засоряя доску, и откуда идея уходит в работу.
4. Вехи полезны, если выпуски оформлять вехами (сейчас выпуск `v9l` —
   обычная задача, по сути веха). Это можно сделать позже и скромно.
5. Для исследований, решений и обслуживания отдельные экраны не нужны.

## Предложение

### 1. Панель «Ideas» для историй — делать

**Где.** Кнопка «Ideas» с числом идей в строке фильтров доски, рядом с
«Memory» и «Agents». По нажатию справа выезжает панель — так же, как у
Memory (`src/components/memory-panel.tsx`, `Sheet` с `side="right"`,
ширина `sm:max-w-lg md:max-w-xl`). Доска остаётся главным экраном и видна
под панелью; панель закрывается крестиком, клавишей Esc или повторным
нажатием кнопки.

**Что внутри.**

- Сверху — поле быстрой записи: написал «хочу…», нажал Enter — создана
  задача типа story (`bd create --type story`). Описание можно дописать потом.
- Ниже — список идей: задачи типа story в статусе open, новые сверху.
  У каждой: заголовок, возраст («3 дня назад»), первые строки описания,
  число комментариев. Идеи старше 90 дней помечены — чтобы склад не стал
  кладбищем.
- Отдельный свёрнутый блок «Отложенные» — идеи со статусом deferred и датой,
  когда они вернутся.
- Нажатие на идею открывает обычную карточку задачи (та же, что с доски):
  там описание, комментарии, правка.

**Три действия у каждой идеи:**

- **«В работу»** — идея становится эпиком, фичей или задачей (выбор в
  маленьком меню) через `bd update --type`. Номер, описание, комментарии и
  история сохраняются; задача уходит с панели на доску, в Open. Разбор на
  подзадачи — как сейчас, при планировании.
- **«Отложить»** — до даты (`bd update --defer`): через неделю, месяц или
  выбранный день. В срок идея сама вернётся в список.
- **«Отклонить»** — закрыть с причиной (`bd close --reason`).

**Доска.** Задачи типа story на доске не показываются, иначе идеи
смешаются с работой. Если в отборе по типу явно выбрать «Story», они видны —
это запасной путь.

**Почему не колонка на доске.** Колонки доски теперь — статусы bd
(эпик beads-web-5fk). Колонка «Ideas» была бы колонкой по типу среди
колонок по статусу: история в статусе open попадала бы и в Open, и в Ideas,
и пришлось бы решать, где она на самом деле. К тому же колонка отнимает
ширину у рабочих колонок и смешивает «задумано» с «делается» — ровно то,
от чего планировщики уходят.

**Почему не вкладка.** Вкладка «Доска | Идеи» — тоже рабочий вариант (так
делает Jira: Board и Backlog — разные экраны). Но это новый элемент страницы,
а боковые панели в beads-web уже есть, и открыть идеи одной кнопкой, не
уходя с доски, проще. Если список идей станет длинным и панели будет мало,
тот же список можно показать на отдельной вкладке — ничего не переделывая.

**Открытые вопросы:**

- «В работу» — менять тип истории (одна запись, предлагается выше) или
  оставлять историю как запись «зачем» и создавать эпик рядом со ссылкой?
- Считать ли идеи на главной странице в счётчиках проекта? Предложение: нет,
  иначе склад идей раздувает «активные».
- Нужна ли идеям очередь `bd ready`? Сейчас истории в open видны агентам
  в `bd ready` как готовая работа. Возможно, их стоит заводить сразу
  отложенными или помечать меткой — решить при планировании.

### 2. Вехи — позже, отдельной задачей

Отдельную страницу не делать. Достаточно:

- на карточке вехи — полоса готовности по её дочерним задачам, как у эпика
  (та же формула, что `bd epic status`, но для любого родителя);
- отбор доски по вехе.

Имеет смысл, если выпуски начнём оформлять вехами.

### 3. Исследования, решения, обслуживание — без экранов

- Научить beads-web типам chore и decision (`src/lib/issue-types.ts`):
  значок, цвет, выбор при создании.
- В окне создания задачи подсказывать разделы описания для выбранного типа
  (как советует bd: у spike — Goal и Findings, у decision — Decision,
  Rationale, Alternatives Considered).

## Источники

Планировщики:

- Linear: [Triage](https://linear.app/docs/triage),
  [Project milestones](https://linear.app/docs/project-milestones),
  [Custom views](https://linear.app/docs/custom-views),
  [Write issues, not user stories](https://linear.app/method/write-issues-not-user-stories)
- Jira: [Kanban backlog](https://support.atlassian.com/jira-software-cloud/docs/use-your-kanban-backlog/),
  [Release page](https://support.atlassian.com/jira-software-cloud/docs/use-the-release-page-to-check-the-progress-of-a-version/),
  [Versions in Kanban](https://support.atlassian.com/jira-software-cloud/docs/configure-versions-in-a-kanban-project/),
  [Swimlanes](https://support.atlassian.com/jira-software-cloud/docs/configure-swimlanes/),
  [Is a Spike issue type worth it?](https://community.atlassian.com/forums/Jira-questions/Is-a-Spike-Issue-Type-Worth-It/qaq-p/2232646)
- YouTrack: [Agile board UI](https://www.jetbrains.com/help/youtrack/cloud/agile-board-ui.html),
  [Gantt charts](https://www.jetbrains.com/help/youtrack/cloud/gantt-charts.html)
- GitHub: [Milestones](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones),
  [Sub-issue progress](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields),
  [Issue types](https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization),
  [обсуждение про вехи и итерации](https://github.com/orgs/community/discussions/11832)
- GitLab: [Milestones](https://docs.gitlab.com/user/project/milestones/),
  [Epics](https://docs.gitlab.com/user/group/epics/),
  [Issue boards](https://docs.gitlab.com/user/project/issue_board/),
  [Milestones or iterations?](https://forum.gitlab.com/t/milestones-or-iterations/46184)
- Trello: [Inbox](https://support.atlassian.com/trello/docs/trello-inbox/)
- Pivotal Tracker (сервис закрыт 30.04.2025, справка недоступна):
  [Tracker guidelines](https://blog.bitwrangler.com/2016/07/25/tracker-guidelines.html)
- Azure DevOps: [Features and epics](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/define-features-epics)
- Shortcut: [Milestones → Objectives](https://help.shortcut.com/hc/en-us/articles/23307428661908-What-s-Changed-from-Milestones-to-Objectives)
- SAFe: [Spikes](https://framework.scaledagile.com/spikes)
- Решения: [MADR](https://adr.github.io/madr/),
  [Microsoft: ADR](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record),
  [Confluence Decision template](https://www.atlassian.com/software/confluence/templates/decision)

bd (gastownhall/beads, коммит f45b249ce):

- `internal/storage/sqlbuild/ready.go` — какие типы скрыты из `bd ready`
- `internal/storage/issueops/close.go` — правило закрытия
- `internal/storage/issueops/epic_closure.go` — подсчёт `bd epic status`
- `plugins/beads/skills/beads/commands/decision.md` — как работать с решениями
- `plugins/beads/skills/beads/resources/WORKFLOWS.md` — исследования
- `examples/linear-workflow/README.md` — вехи Linear → эпики bd
