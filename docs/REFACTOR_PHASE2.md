# Унификация модулей: Фаза 2

Фаза согласована после создания [базовых тестов ядра](MATH_CORE_BASELINE.md).
Исходная версия: `71dcbf7`. Дата проверки: 13 октября 2026 года.

## Выполнено

- Канонический корневой компонент — `frontend/src/App.js`; обновлена точка
  входа и `scripts/check-ui.js`. `App-simple.js` удалён как неподключённый.
- Все шесть активных `Legacy*` компонентов сохранены и переименованы:
  `DashboardView`, `CreateTaskPageView`, `TasksPageView`, `BayesianShell`,
  `ManagementPages`, `RouteHelpers`. CSS-классы не менялись.
- Сохранён действующий `Upload/FileUploader.js` с preview, привязкой к
  задаче и проверкой прав. Неподключённый `FileUploader-simple.js` удалён.
- Сохранён действующий `Admin/UserManagement.js` с ролями, отделениями,
  правами загрузки, сессиями и сбросом пароля. Неподключённый компонент
  `Auth/UserManagement.js` сравнен с ним и удалён; его старые роли/маршруты
  не перенесены в действующий интерфейс.
- Оба пути поиска дубликатов находятся в `duplicateDetectionService.js`.
  Совместимые экспорты прежних функций сохранены; отдельный
  `duplicateDetectionServiceOptimized.js` удалён.
- `contaminationAlgorithmV5.js` переименован в `contaminationAlgorithm.js`.
  Версия результата `v5.0`, названия совместимых экспортов и коэффициенты
  сохранены. Все действующие импорты обновлены.
- Общие операции над аллелями выделены в `src/utils/alleleComparison.js`:
  множества, пересечение с учётом повторений и сравнение массивов.
  Правила нормализации остаются у вызывающих алгоритмов. Используются
  сервисами дубликатов, контаминации и основным маршрутом анализа.
- Массовый поиск остался в `genotypeAnalysisRoutes.js`; расчёт вынесен
  в `massSearchService.js`. При более чем 100 профилях доступны до четырёх
  worker threads. `useWorkers: false` оставляет последовательный путь.
  В `statistics.mode` возвращается `multi-threaded` либо
  `single-threaded-optimized`.
- Старый неподключённый `genotypeAnalysisRoutes.optimized.js` удалён.
  Его упрощённые SQL-ограничения доступа и другой формат ответа не
  использованы. Worker получает только уже разрешённые профили;
  проверка доступа и SQL остаются в основном маршруте.

## Сохранение поведения

Перед объединением зафиксированы синтетические эталоны:

- `duplicate-baseline.json`: 26 случаев обоих путей дубликатов,
  включая гомозиготы, смеси, порядок сравнения, отсутствующие данные,
  веса, пороги и ранний выход.
- `staff-comparison-baseline.json`: 7 случаев сервисов контаминации
  сотрудников, включая повторные аллели и специальные токены.
- `mass-search-baseline.json`: 8 сценариев прежнего API, в том числе
  исключённые локусы, одинаковые номера объектов разных лет,
  формат ЧС, профиль без данных и набор из 104 профилей.

Быстрый путь дубликатов исторически асимметричен для обратного включения
в смесь и использует OR для порогов; общий путь использует AND.
Эти различия явно сохранены и покрыты эталонами. Объединение файлов
не считается исправлением или научной валидацией моделей.

Массовый поиск проверяется последовательно и через настоящие workers.
Сохраняются результаты, порядок, счётчики, дедупликация пар, предел
100 отображаемых совпадений и полный снимок для экспорта.

## Проверки

После каждого из четырёх основных шагов выполнены `npm test`,
`npm run check:ui` и `npm run build`. Итоговый Docker-образ также прошёл
эти команды на Node.js 20. Два предупреждения Webpack относятся
к размеру bundle; ошибок сборки нет.

- Стандартный набор: **189 сценариев, 178 прошли, 5 пропущены, 6 TODO**.
- Расширенный прогон с пятью отдельными PostgreSQL-БД:
  **244 сценария, 236 прошли, 1 пропущен, 7 TODO, 0 обычных падений**.
  Пропущен необязательный тест с частным исходным NGS-файлом.
- Production backend запущен с отдельными PostgreSQL/Redis и ключом.
  Общий health — `healthy`; readiness и интерфейс отвечают HTTP 200.
- Через настоящую авторизацию и API проверены 104 генетических профиля:
  последовательный и параллельный результаты идентичны, контрольный
  профиль ЧС не попал в поиск активного отделения. Снимок содержит 5356 пар.
- Проверены 257 JavaScript-файлов и 817 относительных импортов;
  новых неразрешённых импортов нет. Все ссылки на удалённые/переименованные
  модули в действующем коде исправлены.

Интеграционные фикстуры обновлены под ранее согласованные требования:
обязательный год генетической экспертизы и отсутствие `_DNA_META`.
Снимок решения проверяется в preview, панель при повторном импорте
передаётся явно. Добавлена отрицательная проверка загрузки без года.
Изменения относятся к тестам; парсер, политика загрузки и модель
идентичности объектов не менялись.

## Открытые вопросы

Шесть выполняемых TODO из Фазы 1 остаются. Расширенный прогон выявил
**DB-01**: исторический `idx_dna_profiles_year_internal_user` ограничивает
номера сразу во всех отделениях одного пользователя за один год.
Контракт двух разных отделений проверяется отдельным выполняемым TODO
в `installation.integration.test.js`; остальные тесты доступа используют
разные годы, сохраняя проверки всех разрешённых и запрещённых UUID.
Исправление индекса и миграция относятся к согласованию Фазы 5.

Полная проверка импортов также обнаружила **15 прежних ошибок** в
неподключённых фрагментах фронтенда. Сравнение с исходным commit
подтвердило, что они существовали до этой фазы:

- `BayesianAnalysisPanel.js`: отсутствуют `bayesianService`,
  `featureService`, локальный `ProgressIndicator`, `ExportButton`.
- `SearchInterface.js`: отсутствуют `settingsService` и
  `usePreventDuplicateSubmission`.
- `NotificationCenter.js`: отсутствует `notificationService`.
- `PopulationEditor.js`, `PopulationImporter.js`, `PopulationList.js`,
  `PopulationManager.js`: отсутствует `bayesianService`.
- Клиенты `dnaAnalysisService.js`, `exportService.js`,
  `organizationService.js`, `taskService.js` ссылаются на отсутствующий
  `authService`.

Эти модули не входят в текущую production-сборку. Их ревизия включена
в следующий план; скрывающие ошибку заглушки не добавлялись.

## План Фазы 3 — подтверждён и выполнен

1. Перенести 12 файлов из `src/components/bayesian/` в
   `frontend/src/components/Analysis/Bayesian/`: `BayesianAnalysisApp`,
   `ComparisonReports`, `ComparisonResults`, `GenotypeComparisonPanel`,
   `HelpSystem`, `ProgressIndicator`, `QualityAnalyzer.browser`,
   `QualityControlPanel`, `QualityReports`, `QualityResults`,
   `SampleSelector`, `StatusMessages`. Обновить `BayesianShell.js`,
   ссылки на hooks, проверку UI и настройки сборки.
2. Переименовать клиентские сервисы: `dnaAnalysisService` → `dnaAnalysisApi`,
   `exportService` → `exportApi`, `taskService` → `taskApi`,
   `organizationService` → `organizationApi`, `duplicateExportService` →
   `duplicateExportApi`. Исправить упомянутые выше отсутствующие зависимости:
   переиспользовать действующие API и UI-компоненты, добавить общий HTTP-клиент
   с текущей авторизацией/активным отделением; подтверждённо неиспользуемые
   исторические фрагменты удалить после сопоставления функций.
3. Сгруппировать серверные сервисы с обновлением всех ссылок:

| Подпапка `src/services/` | Файлы без расширения `.js` |
| --- | --- |
| `infrastructure/` | cacheService, concurrencyService, connectionPoolService, healthCheckService, jobQueueService, scheduledJobService, websocketService, dataPersistenceService, databaseInitService, settingsService |
| `security/` | authService, permissionService, profileAccessService, profileUploadPolicy, encryptionService, databaseEncryptionService, userManagementService |
| `converters/` | excelService, geneticExcelConverterService, geneticSourceDetector, ngsAstrExcelParser, latinToCyrillicConverter, fileValidationService |
| `contamination/` | staffContaminationAnalyzer, staffContaminationService, contaminationLogger |
| `profiles/` | dnaAnalysisService, alleleReferenceService, masterArrayService, staffProfileService, duplicateDetectionService, searchSnapshotStore, resultFormattingService, massSearchService |
| `tasks/` | taskService, taskCollaborationService, profileTaskRecoveryService, notificationService |
| `audit/` | auditService, auditExportService, exportService, duplicateExcelExportService |

Существующее математическое ядро `bayesian/` сохраняется.
Обновить ссылки в `src/server.js`, маршрутах, моделях, workers,
`tests/`, `scripts/`, фронтенде и `webpack.config.js`.
После каждого самостоятельного шага — полный набор тестов, сборка
и проверка импортов; в конце — изолированный запуск production.
Результаты Фазы 3: [REFACTOR_PHASE3.md](REFACTOR_PHASE3.md).
