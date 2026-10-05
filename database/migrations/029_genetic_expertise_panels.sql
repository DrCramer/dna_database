-- Номера экспертиз, полные номера объектов и необязательные генетические панели.
BEGIN;
LOCK TABLE dna_profiles, master_array_profiles IN SHARE ROW EXCLUSIVE MODE;

-- Проверяем новые ключи до удаления старых индексов. Конфликты требуют разбора,
-- а не удаления профилей; вся транзакция откатывается при ошибке.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM dna_profiles
    WHERE is_active = true AND import_format = 'genetic' AND profile_type = 'user'
    GROUP BY organization_id, department_id, user_id, lower(btrim(internal_number)) HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM master_array_profiles
    WHERE is_active = true AND metadata->>'importFormat' = 'genetic'
    GROUP BY master_array_id, lower(btrim(internal_number)) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Конфликт полных номеров genetic-объектов: миграция отменена без удаления данных'; END IF;
  IF EXISTS (SELECT 1 FROM dna_profiles WHERE import_format = 'genetic' AND nullif(btrim(internal_number), '') IS NULL)
     OR EXISTS (SELECT 1 FROM master_array_profiles WHERE metadata->>'importFormat' = 'genetic' AND nullif(btrim(internal_number), '') IS NULL)
  THEN RAISE EXCEPTION 'Пустой номер genetic-объекта: миграция отменена'; END IF;
END $$;

DROP INDEX IF EXISTS idx_dna_profiles_genetic_object;
DROP INDEX IF EXISTS idx_master_array_genetic_object;

UPDATE dna_profiles SET sample_name = btrim(split_part(btrim(internal_number), '-', 1))
WHERE import_format = 'genetic' AND sample_name = internal_number
  AND btrim(split_part(btrim(internal_number), '-', 1)) <> '';
UPDATE master_array_profiles SET sample_name = btrim(split_part(btrim(internal_number), '-', 1))
WHERE metadata->>'importFormat' = 'genetic' AND sample_name = internal_number
  AND btrim(split_part(btrim(internal_number), '-', 1)) <> '';

CREATE UNIQUE INDEX idx_dna_profiles_genetic_object
  ON dna_profiles (organization_id, department_id, user_id, lower(btrim(internal_number)))
  WHERE is_active = true AND import_format = 'genetic' AND profile_type = 'user';
CREATE UNIQUE INDEX idx_master_array_genetic_object
  ON master_array_profiles (master_array_id, lower(btrim(internal_number)))
  WHERE is_active = true AND metadata->>'importFormat' = 'genetic';

CREATE TABLE IF NOT EXISTS genotype_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  name varchar(150) NOT NULL CHECK (btrim(name) <> ''),
  description text,
  loci_order jsonb NOT NULL CHECK (jsonb_typeof(loci_order) = 'array' AND jsonb_array_length(loci_order) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, organization_id, department_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_genotype_panels_name
  ON genotype_panels (organization_id, department_id, lower(btrim(name)));
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS panel_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dna_profiles_panel_scope_fkey') THEN
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_panel_scope_fkey
      FOREIGN KEY (panel_id, organization_id, department_id)
      REFERENCES genotype_panels (id, organization_id, department_id);
    ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_panel_format_check
      CHECK (panel_id IS NULL OR import_format = 'genetic');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dna_profiles_panel ON dna_profiles(panel_id) WHERE panel_id IS NOT NULL;
COMMIT;
