-- Миграция: Добавление GIN индексов для пре-фильтрации в мастер массиве
-- Дата: 2026-02-18
-- Описание: Создание индексов для ускорения поиска по ключевым локусам (SE33, D1S1656, D3S1358, TH01)

-- Создать общий GIN индекс для всех JSONB данных локусов
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_str_data_gin 
ON master_array_profiles USING GIN (str_data);

-- Создать специализированные GIN индексы для ключевых локусов
-- Эти индексы ускоряют оператор ?| (contains any)

-- SE33 - самый вариабельный локус (вес 1.3)
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_se33 
ON master_array_profiles USING GIN ((str_data->'SE33'));

-- D1S1656 - второй по вариабельности (вес 1.25)
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_d1s1656 
ON master_array_profiles USING GIN ((str_data->'D1S1656'));

-- D3S1358 - стабильный локус (вес 1.0)
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_d3s1358 
ON master_array_profiles USING GIN ((str_data->'D3S1358'));

-- TH01 - дополнительный локус (вес 0.95)
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_th01 
ON master_array_profiles USING GIN ((str_data->'TH01'));

-- Комментарии к индексам
COMMENT ON INDEX idx_master_array_profiles_str_data_gin IS 
'GIN индекс для быстрого поиска по всем локусам в JSONB';

COMMENT ON INDEX idx_master_array_profiles_se33 IS 
'GIN индекс для пре-фильтрации по локусу SE33 (самый вариабельный)';

COMMENT ON INDEX idx_master_array_profiles_d1s1656 IS 
'GIN индекс для пре-фильтрации по локусу D1S1656 (второй по вариабельности)';

COMMENT ON INDEX idx_master_array_profiles_d3s1358 IS 
'GIN индекс для пре-фильтрации по локусу D3S1358 (стабильный)';

COMMENT ON INDEX idx_master_array_profiles_th01 IS 
'GIN индекс для пре-фильтрации по локусу TH01 (дополнительный)';
