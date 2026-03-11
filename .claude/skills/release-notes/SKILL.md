---
name: release-notes
description: Create a GitHub release with bilingual release notes (EN + RU). Bumps version, tags, pushes, publishes via gh CLI.
user-invocable: true
---

# Release Notes

Создание нового релиза проекта beads-web на GitHub.

## Перед началом

Прочитай `editor-profile.md` в папке этого навыка. Весь текст пиши по этим правилам.

## Входные данные

Пользователь вызывает `/release-notes` и опционально указывает:
- Тип версии: `patch`, `minor`, `major` (по умолчанию определи сам по коммитам)
- Дополнительный контекст для заметок

## Алгоритм

### 1. Собери информацию

```bash
# Текущая версия
grep '"version"' package.json

# Последний релиз
gh release list --limit 1

# Коммиты с последнего релиза
git log <last-tag>..HEAD --oneline

# Файлы в каждом коммите
git diff-tree --no-commit-id --name-only -r <hash>
```

### 2. Определи версию

- `patch` (0.x.Y) — только фиксы, правки CSS, мелкие доработки
- `minor` (0.X.0) — новая функциональность, новые компоненты, новые API-эндпоинты
- `major` (X.0.0) — ломающие изменения, миграции

Предложи версию пользователю, дождись подтверждения.

### 3. Напиши release notes

Формат — билингвальный (основной EN, русский в `<details>`):

```markdown
## What's New

### Название блока
- Пункт 1 — что конкретно сделано, без воды
- Пункт 2 — факт, а не описание процесса

<details><summary>🇷🇺 На русском</summary>

### Название блока
- Пункт 1
- Пункт 2

</details>
```

Правила текста (из editor-profile.md):
- Конкретика: «Dynamic NOT NULL column discovery» — не «improved database handling»
- Короткие фразы: один буллет = одна мысль
- Активный залог: «Settings dialog edits name and path» — не «Name and path can be edited»
- Без штампов: не «enhanced user experience», не «improved workflow»
- Группируй по смыслу: Features, Fixes, UI, Themes, Breaking Changes

### 4. Покажи текст пользователю

Выведи полный текст release notes. Дождись подтверждения перед публикацией.

### 5. Опубликуй

```bash
# Обнови версию
# package.json
# server/Cargo.toml

# Коммит + тег + пуш
git add package.json server/Cargo.toml
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z

# Создай релиз
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

### 6. Подтверди

Выведи ссылку на релиз. CI соберёт бинарники автоматически.

## Пример хорошего release note

```markdown
## What's New

### Project Settings
- Settings dialog: edit project name, path, and local path
- `⋮` button in the project header opens settings
- Dolt projects: set a local path to enable "Open in editor / file manager" button

### Dolt CRUD Fixes
- Create beads via Dolt: dynamic NOT NULL column discovery from `information_schema`
- Fixed `localPath` deserialization (serde `camelCase`)
```

## Пример плохого release note

```markdown
## What's New

### Improvements
- Enhanced project management capabilities with a new settings dialog
- Improved the overall user experience for Dolt-based projects
- Various bug fixes and performance improvements
```
