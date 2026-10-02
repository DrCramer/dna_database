-- Migration 025: Profile Contamination Search Log
-- Date: 2026-02-24
-- Description: Создание таблицы для логирования результатов поиска контаминации между профилями
-- Это позволит отслеживать статистику по периодам и привозам для оценки работы лаборатории

-- Создание таблицы для логирования поиска контаминации между профилями
CREATE TABLE IF NOT EXISTS profile_contamination_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Профили
    reference_profile_id UUID NOT NULL REFERENCES dna_profiles(id) ON DELETE CASCADE,
    matched_profile_id UUID NOT NULL REFERENCES dna_profiles(id) ON DELETE CASCADE,
    
    -- Информация о профилях (денормализация для быстрого доступа)
    reference_sample_name VARCHAR(255),
    reference_internal_number VARCHAR(100),
    reference_import_number VARCHAR(100),
    reference_year INTEGER,
    
    matched_sample_name VARCHAR(255),
    matched_internal_number VARCHAR(100),
    matched_import_number VARCHAR(100),
    matched_year INTEGER,
    
    -- Результаты анализа
    match_type VARCHAR(50) NOT NULL, -- 'full_match', 'partial_match' (контаминация), 'no_match'
    matching_loci_count INTEGER NOT NULL,
    total_loci_compared INTEGER NOT NULL,
    match_percentage DECIMAL(5,2) NOT NULL,
    
    -- Детали совпадений
    matched_loci JSONB, -- Список совпадающих локусов
    contaminated_loci JSONB, -- Детали контаминированных локусов (для partial_match)
    
    -- Параметры поиска
    search_mode VARCHAR(50), -- 'task', 'master_array', 'department_tasks', 'full_search'
    algorithm_used VARCHAR(50), -- 'duplicate_v5', 'contamination_v2', etc.
    min_matches_threshold INTEGER,
    ignored_loci TEXT[], -- Массив игнорируемых локусов
    
    -- Контекст
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    
    -- Метаданные
    search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    searched_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Индексы для уникальности (один результат на пару профилей в рамках одного поиска)
    CONSTRAINT unique_search_result UNIQUE(reference_profile_id, matched_profile_id, search_date)
);

-- Создание индексов для оптимизации запросов
CREATE INDEX idx_contamination_log_reference ON profile_contamination_log(reference_profile_id);
CREATE INDEX idx_contamination_log_matched ON profile_contamination_log(matched_profile_id);
CREATE INDEX idx_contamination_log_match_type ON profile_contamination_log(match_type);
CREATE INDEX idx_contamination_log_search_date ON profile_contamination_log(search_date);
CREATE INDEX idx_contamination_log_task ON profile_contamination_log(task_id);
CREATE INDEX idx_contamination_log_department ON profile_contamination_log(department_id);
CREATE INDEX idx_contamination_log_searched_by ON profile_contamination_log(searched_by);

-- Индексы для статистики по периодам
CREATE INDEX idx_contamination_log_ref_year ON profile_contamination_log(reference_year);
CREATE INDEX idx_contamination_log_ref_import ON profile_contamination_log(reference_import_number);
CREATE INDEX idx_contamination_log_matched_year ON profile_contamination_log(matched_year);
CREATE INDEX idx_contamination_log_matched_import ON profile_contamination_log(matched_import_number);

-- Индекс для поиска по дате и типу совпадения
CREATE INDEX idx_contamination_log_date_type ON profile_contamination_log(search_date, match_type);

-- GIN индексы для JSONB полей
CREATE INDEX idx_contamination_log_matched_loci ON profile_contamination_log USING GIN (matched_loci);
CREATE INDEX idx_contamination_log_contaminated_loci ON profile_contamination_log USING GIN (contaminated_loci);

-- Создание представления для статистики по привозам
CREATE VIEW contamination_stats_by_import AS
SELECT 
    reference_import_number,
    reference_year,
    COUNT(*) as total_searches,
    COUNT(CASE WHEN match_type = 'full_match' THEN 1 END) as full_matches,
    COUNT(CASE WHEN match_type = 'partial_match' THEN 1 END) as contaminations,
    AVG(match_percentage) as avg_match_percentage,
    MIN(search_date) as first_search,
    MAX(search_date) as last_search
FROM profile_contamination_log
GROUP BY reference_import_number, reference_year
ORDER BY reference_year DESC, reference_import_number DESC;

-- Создание представления для статистики по периодам
CREATE VIEW contamination_stats_by_period AS
SELECT 
    DATE_TRUNC('month', search_date) as period,
    COUNT(*) as total_searches,
    COUNT(DISTINCT reference_profile_id) as unique_references,
    COUNT(CASE WHEN match_type = 'full_match' THEN 1 END) as full_matches,
    COUNT(CASE WHEN match_type = 'partial_match' THEN 1 END) as contaminations,
    AVG(match_percentage) as avg_match_percentage,
    COUNT(DISTINCT searched_by) as unique_users
FROM profile_contamination_log
GROUP BY DATE_TRUNC('month', search_date)
ORDER BY period DESC;

-- Создание представления для детального просмотра с именами
CREATE VIEW contamination_log_detailed AS
SELECT 
    pcl.*,
    ref_prof.sample_name as ref_full_sample_name,
    match_prof.sample_name as match_full_sample_name,
    t.title as task_name,
    d.name as department_name,
    u.username as searched_by_username
FROM profile_contamination_log pcl
LEFT JOIN dna_profiles ref_prof ON pcl.reference_profile_id = ref_prof.id
LEFT JOIN dna_profiles match_prof ON pcl.matched_profile_id = match_prof.id
LEFT JOIN tasks t ON pcl.task_id = t.id
LEFT JOIN departments d ON pcl.department_id = d.id
LEFT JOIN users u ON pcl.searched_by = u.id
ORDER BY pcl.search_date DESC;

-- Добавление комментариев
COMMENT ON TABLE profile_contamination_log IS 'Лог результатов поиска контаминации между профилями для статистики и анализа работы лаборатории';
COMMENT ON COLUMN profile_contamination_log.match_type IS 'Тип совпадения: full_match (полное), partial_match (контаминация), no_match (нет совпадения)';
COMMENT ON COLUMN profile_contamination_log.search_mode IS 'Режим поиска: task (в задаче), master_array (в мастер массиве), department_tasks (в задачах отдела), full_search (полный поиск)';

-- Предоставление прав доступа
GRANT ALL PRIVILEGES ON profile_contamination_log TO dna_user;
GRANT SELECT ON contamination_stats_by_import TO dna_user;
GRANT SELECT ON contamination_stats_by_period TO dna_user;
GRANT SELECT ON contamination_log_detailed TO dna_user;
