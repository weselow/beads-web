# 2026-09-29 — типы chore и decision, подсказка разделов описания (beads-web-e3q.3)

В `src/lib/issue-types.ts` добавлены типы chore (значок Wrench, цвет
`text-t-secondary`) и decision (значок Scale, цвет `text-status-progress`); они
сами появились в окне создания, в отборе по типу на доске и в выборе типа в
карточке задачи. У каждого типа теперь есть список разделов описания, которые
ждёт `bd lint`: task, feature, story — Acceptance Criteria; epic — Success
Criteria; spike — Goal, Findings; decision — Decision, Rationale, Alternatives
Considered; у bug, chore, milestone — ничего. Окно создания показывает эти
заголовки в подсказке пустого поля описания (`descriptionPlaceholder`), так что
текст пользователя никогда не меняется. Тип, которого beads-web не знает
(convoy, agent и другие из bd), раньше показывался как Task; теперь он
показывается под своим именем с серым пунктирным значком, в отбор Task не
попадает, а в карточке задачи выбор типа дописывает его в список
(`issueTypeChoices`), как уже сделано для статусов.

**Почему так.** Подсказка в поле, а не кнопка «вставить шаблон»: ничего не
навязывает и не требует решать, что делать с уже введённым текстом. Пустой тип
по-прежнему считается task — так его создаёт bd. Поиск типа идёт через `Map`,
а не обычный объект, чтобы тип с именем вроде `toString` не нашёл чужое поле.

**Если сломалось — смотреть сначала.** `getIssueTypeMeta` в
`src/lib/issue-types.ts`: от неё зависят карточки, отбор в `kanban-board.tsx`
(сравнивает `value` с выбранным типом) и выбор типа в `bead-detail.tsx`.
Тесты — `src/lib/__tests__/issue-types.test.ts` и
`src/components/__tests__/issue-type-choices.test.tsx`.

**Не трогали.** Сервер и `src/types/index.ts` (там параллельно идёт
beads-web-e3q.1); проверку разделов при сохранении — это дело `bd lint`.
