# Локальная интеграция с DNAEXCEL

Проверено 05.10.2026: основная база — порт 3001, отдельный DNAEXCEL — порт 4100.
DNAEXCEL размещён в `/home/drcramer/dna_excel`, Compose project `dna_excel`,
собственная PostgreSQL 16, bind-хранилища `data/postgres`, `data/storage`,
`data/exports`. Рабочие данные основной базы не подключаются к DNAEXCEL.

## Подключение backend

```bash
docker network inspect dna_integration >/dev/null 2>&1 || docker network create dna_integration
```

В приватной `.env` DNA Database указать:

```env
COMPOSE_FILE=docker-compose.yml:docker-compose.integration.yml
```

Для уже работающего контейнера один раз подключить сеть:

```bash
docker network connect --alias dna-database-api dna_integration dna-prod-web
```

Если контейнер уже в сети, повторять команду не нужно. Override сохраняет
подключение при штатном `docker compose up -d --build web`. Приватная сеть
`default` остаётся подключённой. PostgreSQL и Redis не входят в общую сеть.

DNAEXCEL backend использует `http://dna-database-api:3000`,
`DNA_DATABASE_USE_LEGACY_API=true`, `DNA_DATABASE_MOCK=false` и серверный UUID
активного отделения «Генетические экспертизы». Пароли хранятся только в его `.env`.
API-код, CORS и схема основной базы в этой настройке не меняются.

## Контракт

Вход — `POST /api/auth/login`; контекст — `GET /api/users/context`;
поиск — `GET /api/profiles/search`; профиль — `GET /api/profiles/:id`.
Контекст, поиск и чтение получают `X-Active-Department-Id` и Bearer token.
UUID и имя активного отделения проверяет клиент DNAEXCEL; основное отделение
пользователя может отличаться. Запросы к `/api/integrations/ikl/v1` не используются.

Причина прежнего ложного 403 и её исправление описаны в
[LEGACY_PROFILE_ACCESS.md](LEGACY_PROFILE_ACCESS.md): поиск и чтение должны
проверять одинаковый scope профиля. Нынешняя проверка на живой базе подтвердила
чтение всех 43 результатов поиска и запрет чужого отделения.

## Результат проверки

- 56 тестов DNA Database прошли в отдельных тестовых БД; рабочие ДНК-профили
  не использовались как изменяемые fixtures.
- Проверены реальные login/context/search/get, 401, 403 и 404.
- Через браузер DNAEXCEL созданы ИКЛ, скачаны XLSX и ZIP; после перезапуска
  документы сохранены. При отключении только его общей сети снимки и TXT
  продолжили открываться и экспортироваться.
- Основной backend не пересоздавался; его image и дата запуска сохранены.
  Число профилей и контрольная сумма генетических данных до/после совпали.
- Новых миграций DNA Database нет. Все её persistent mounts сохранены.

Подробный локальный отчёт находится в
`/home/drcramer/dna_excel/INTEGRATION_REPORT.md`, эксплуатация —
`/home/drcramer/dna_excel/docs/local-integration-runbook.md`.
