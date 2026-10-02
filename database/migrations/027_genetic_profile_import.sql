-- Новый импорт отделения «Генетические экспертизы» без искусственного года.
BEGIN;

ALTER TABLE dna_profiles
  ALTER COLUMN year DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS import_format varchar(20) NOT NULL DEFAULT 'emergency',
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

-- Исторические профили сохраняют прежнюю принадлежность владельцу.
UPDATE dna_profiles dp
SET department_id = COALESCE(dp.department_id, u.department_id),
    organization_id = COALESCE(dp.organization_id, u.organization_id)
FROM users u
WHERE dp.user_id = u.id AND (dp.department_id IS NULL OR dp.organization_id IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dna_profiles_import_format_check' AND conrelid = 'dna_profiles'::regclass) THEN
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_import_format_check
      CHECK (import_format IN ('emergency', 'genetic'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dna_profiles_import_year_check' AND conrelid = 'dna_profiles'::regclass) THEN
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_import_year_check
      CHECK (year IS NOT NULL OR import_format = 'genetic') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dna_profiles_genetic_scope_check' AND conrelid = 'dna_profiles'::regclass) THEN
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_genetic_scope_check
      CHECK (import_format <> 'genetic' OR (department_id IS NOT NULL AND organization_id IS NOT NULL));
  END IF;
END $$;

-- NOT VALID сохраняет исторические записи без года, если они уже существовали.
-- Новые INSERT/UPDATE ЧС всё равно обязаны содержать год.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dna_profiles_genetic_object
  ON dna_profiles (organization_id, department_id, user_id, lower(btrim(sample_name)))
  WHERE is_active = true AND import_format = 'genetic' AND profile_type = 'user';

CREATE INDEX IF NOT EXISTS idx_dna_profiles_department ON dna_profiles (department_id) WHERE is_active = true;

-- Утверждение задачи переносит профиль в мастер-массив с тем же отсутствующим годом.
ALTER TABLE master_array_profiles ALTER COLUMN year DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'master_array_profiles_import_year_check' AND conrelid = 'master_array_profiles'::regclass) THEN
    ALTER TABLE master_array_profiles ADD CONSTRAINT master_array_profiles_import_year_check
      CHECK (year IS NOT NULL OR COALESCE(metadata->>'importFormat', 'emergency') = 'genetic') NOT VALID;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_array_genetic_object
  ON master_array_profiles (master_array_id, lower(btrim(sample_name)))
  WHERE is_active = true AND metadata->>'importFormat' = 'genetic';

COMMIT;
