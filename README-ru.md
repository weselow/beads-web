<div align="center">

# BEADS WEB

**Визуальный центр управления задачами beads.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

<br>

![Beads Web — Kanban Board](screenshots/kanban-main.png)

<br>

[Зачем](#зачем) · [Происхождение](#происхождение) · [Возможности](#возможности) · [Темы](#темы) · [Установка](#установка) · [Разработка](#разработка) · [FAQ](#faq) · [Troubleshooting](docs/troubleshooting/README.md)

**[English version](README.md)**

</div>

---

## Зачем

Beads CLI — мощный инструмент для трекинга задач, но:
- Нет визуального обзора статусов задач по колонкам
- Нет drag-and-drop для перемещения задач между состояниями
- Нет возможности увидеть прогресс epic-ов одним взглядом
- Нет визуального разделения между заблокированными, готовыми и задачами в работе

Beads Web даёт вам Kanban-доску в реальном времени, мультипроектный дашборд и git-операции — не покидая браузер.

## Происхождение

Вдохновлено проектом [Beads-Kanban-UI](https://github.com/AvivK5498/Beads-Kanban-UI) от Aviv Kaplan. Автор оригинала, по всей видимости, прекратил разработку — PR-ы остаются без ревью месяцами.

Этот форк значительно отклонился от оригинала: изменено 84 файла, добавлено ~9500 строк.

<details>
<summary>Что изменилось (кратко)</summary>

- 7 визуальных тем с сохранением выбора и предотвращением мерцания
- Inline-редактирование полей bead (клик для редактирования заголовка, описания, заметок)
- Копирование ID bead по клику
- Прямая интеграция с Dolt через SQL (без работы с файловой системой)
- Обнаружение проектов из баз данных Dolt одним кликом
- Поддержка нескольких дисков Windows
- Файловый браузер для добавления проектов
- Декомпозированные компоненты (bead-detail, epic-card и др.)
- Настройка тестов через Vitest
- Полная декомпозиция и рефакторинг компонентов
- Drag-and-drop обновление статусов

</details>

Полный changelog с обоснованиями: [docs/changelog.md](docs/changelog.md)

## Возможности

- **Мультипроектный дашборд** — все проекты в одном месте с кольцевыми диаграммами статусов
- **Kanban-доска** — Open → In Progress → In Review → Closed с обновлением перетаскиванием
- **Поддержка epic-ов** — группировка задач с визуальными прогресс-барами, просмотр подзадач
- **GitOps** — создание, просмотр и мёрж PR-ов прямо с доски. CI-статус, конфликты мёржа, автозакрытие
- **Панель памяти** — просмотр, поиск, редактирование записей базы знаний
- **7 тем** — Default Dark, Glassmorphism, Neo-Brutalist, Linear Minimal, Soft Light, Notion Warm, GitHub Clean
- **Интеграция с Dolt** — подключение к базам данных Dolt напрямую, без указания пути в файловой системе
- **Синхронизация в реальном времени** — SSE file watcher для локальных проектов, polling для Dolt

## Темы

Тема Soft Light показана на главном скриншоте выше.

<details>
<summary>Посмотреть все 7 тем</summary>

**Default Dark**
![Default Dark](screenshots/kanban-default.png)

**Glassmorphism**
![Glassmorphism](screenshots/kanban-glassmorphism.png)

**Neo-Brutalist**
![Neo-Brutalist](screenshots/kanban-neo-brutalist.png)

**Linear Minimal**
![Linear Minimal](screenshots/kanban-linear-minimal.png)

**Notion Warm**
![Notion Warm](screenshots/kanban-notion-warm.png)

**GitHub Clean**
![GitHub Clean](screenshots/kanban-github-clean.png)

</details>

## Технологии

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS, Radix UI, dnd-kit
- **Backend**: Rust (Axum), SQLite, Dolt SQL
- **Сборка**: Статический экспорт, встроенный в Rust-бинарник через rust-embed

## Установка

### Требования

- [Beads CLI](https://github.com/steveyegge/beads) (`bd`) установлен и доступен в PATH

### Скачать

Скачайте бинарник для вашей платформы со страницы [GitHub Releases](https://github.com/weselow/beads-web/releases/latest):

| Платформа | Файл |
|----------|------|
| Windows x64 | `beads-web-win-x64.exe` |
| macOS Apple Silicon | `beads-web-darwin-arm64` |
| macOS Intel | `beads-web-darwin-x64` |
| Linux x64 | `beads-web-linux-x64` |

### Менеджеры пакетов

**Homebrew (macOS / Linux):**

```bash
brew install weselow/beads-web/beads-web
```

**winget (Windows):**

```powershell
winget install weselow.beads-web
```

### Запуск

```bash
# macOS/Linux — сделайте исполняемым, затем запустите
chmod +x beads-web-*
./beads-web-darwin-arm64

# Windows
beads-web-win-x64.exe
```

Откройте http://localhost:3008. Frontend встроен в бинарник — Node.js и Rust не требуются.

## Разработка

Требования: Node.js 20+, [Rust toolchain](https://rustup.rs/) и [Beads CLI](https://github.com/steveyegge/beads) (`bd`) в PATH.

```bash
git clone https://github.com/weselow/beads-web.git
cd beads-web
npm install
```

Есть два сценария: **режим разработки** (frontend с горячей перезагрузкой) и **сборка из исходников** (готовый бинарник).

### Режим разработки (горячая перезагрузка frontend)

Dev-сервер Next.js (порт 3007) отдаёт frontend с горячей перезагрузкой; бэкенд на Rust (порт 3008) отдаёт API. Они общаются между собой через CORS — на бэкенде он открыт.

1. **Укажите frontend адрес бэкенда:**

   ```bash
   cp .env.local.example .env.local   # задаёт NEXT_PUBLIC_BACKEND_URL=http://localhost:3008
   ```

2. **Сначала соберите папку `out/`** (пока `output: 'export'` ещё включён). Сервер на Rust встраивает `out/` через rust-embed, поэтому она должна существовать до сборки бэкенда:

   ```bash
   npm run build
   ```

3. **Только после этого** закомментируйте `output: 'export'` в `next.config.js` — `next dev` несовместим со статическим экспортом.

4. **Запустите оба сервера** в разных терминалах:

   ```bash
   npm run dev              # Терминал 1 — frontend на http://localhost:3007
   cd server && cargo run   # Терминал 2 — бэкенд/API на http://localhost:3008
   ```

5. Откройте **http://localhost:3007**. Правки frontend перезагружаются на лету; запросы к API уходят на бэкенд на порт 3008.

> Шаг с `.env.local` / `NEXT_PUBLIC_BACKEND_URL` нужен **только для разработки**. Для сборки готового бинарника уберите его (или оставьте переменную незаданной) — там frontend и бэкенд работают на одном адресе.

### Сборка из исходников (готовый бинарник)

Собирает тот же самодостаточный бинарник, что публикует CI в [Releases](https://github.com/weselow/beads-web/releases/latest) — frontend встроен, поэтому Node.js и Rust при запуске не нужны.

```bash
npm install
# оставьте `output: 'export'` включённым в next.config.js (это значение по умолчанию)
npm run build                 # статический экспорт → out/
cd server
cargo build --release         # бинарник → server/target/release/beads-server (.exe на Windows)
```

Запустите бинарник и откройте **http://localhost:3008**:

```bash
./server/target/release/beads-server
```

## FAQ

**В: Нужен ли Dolt?**
О: Нет. Beads Web работает с локальными проектами через `bd` CLI. Dolt добавляет прямой доступ по SQL и поддержку удалённых баз данных.

**В: Как добавить проект?**
О: Нажмите "Add Project" на дашборде. Перейдите в папку проекта или введите `dolt://` URL.

## Благодарности

- [Beads-Kanban-UI](https://github.com/AvivK5498/Beads-Kanban-UI) от Aviv Kaplan — оригинальный проект
- [beads](https://github.com/steveyegge/beads) от Steve Yegge — git-нативный трекинг задач
- [Claude Protocol](https://github.com/weselow/claude-protocol) — фреймворк оркестрации (отлично работает в связке)

## Лицензия

MIT
