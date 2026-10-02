-- Миграция: Добавление GIN индексов для vWA и D21S11
-- Дата: 2026-02-18
-- Описание: Расширение индексов для стратегии "2 группы по 3 локуса"

-- vWA - "мощный" локус (вес 1.0)
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_vwa 
ON master_array_profiles USING GIN ((str_data->'vWA'));

-- D21S11 - "стабильный" локус (вес 1.1)
CREATE INDEX IF NOT EXISTS idx_master_array_profiles_d21s11 
ON master_array_profiles USING GIN ((str_data->'D21S11'));

-- Комментарии к индексам
COMMENT ON INDEX idx_master_array_profiles_vwa IS 
'GIN индекс для пре-фильтрации по локусу vWA (группа "мощные")';

COMMENT ON INDEX idx_master_array_profiles_d21s11 IS 
'GIN индекс для пре-фильтрации по локусу D21S11 (группа "стабильные")';
