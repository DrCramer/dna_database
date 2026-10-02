-- Migration 026: Convert staff profiles str_data from object to array format
-- Date: 2026-02-25
-- Description: Конвертация формата хранения локусов профилей сотрудников
-- Старый формат: {"D3S1358": {"allele1": "16", "allele2": "17"}}
-- Новый формат: {"D3S1358": ["16", "17"]}

DO $$
DECLARE
    profile_record RECORD;
    old_data JSONB;
    new_data JSONB;
    locus_key TEXT;
    locus_value JSONB;
    allele1 TEXT;
    allele2 TEXT;
    new_alleles JSONB;
BEGIN
    -- Обрабатываем каждый профиль сотрудника
    FOR profile_record IN 
        SELECT id, str_data 
        FROM staff_profiles 
        WHERE str_data IS NOT NULL
    LOOP
        old_data := profile_record.str_data;
        new_data := '{}'::jsonb;
        
        -- Обрабатываем каждый локус
        FOR locus_key, locus_value IN 
            SELECT * FROM jsonb_each(old_data)
        LOOP
            -- Проверяем формат: если это объект с allele1/allele2, конвертируем
            IF jsonb_typeof(locus_value) = 'object' AND 
               locus_value ? 'allele1' THEN
                
                allele1 := locus_value->>'allele1';
                allele2 := locus_value->>'allele2';
                
                -- Создаем массив аллелей
                IF allele2 IS NULL OR allele2 = '' THEN
                    new_alleles := jsonb_build_array(allele1);
                ELSE
                    new_alleles := jsonb_build_array(allele1, allele2);
                END IF;
                
                new_data := new_data || jsonb_build_object(locus_key, new_alleles);
            ELSE
                -- Если уже в новом формате, оставляем как есть
                new_data := new_data || jsonb_build_object(locus_key, locus_value);
            END IF;
        END LOOP;
        
        -- Обновляем профиль
        UPDATE staff_profiles 
        SET str_data = new_data,
            last_updated = CURRENT_TIMESTAMP
        WHERE id = profile_record.id;
        
    END LOOP;
    
    RAISE NOTICE 'Конвертация завершена успешно';
END $$;

-- Проверка результата
DO $$
DECLARE
    old_format_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO old_format_count
    FROM staff_profiles
    WHERE str_data IS NOT NULL
    AND EXISTS (
        SELECT 1 
        FROM jsonb_each(str_data) AS j(key, value)
        WHERE jsonb_typeof(value) = 'object' 
        AND value ? 'allele1'
        LIMIT 1
    );
    
    IF old_format_count > 0 THEN
        RAISE WARNING 'Найдено % профилей в старом формате', old_format_count;
    ELSE
        RAISE NOTICE 'Все профили сотрудников в новом формате';
    END IF;
END $$;
