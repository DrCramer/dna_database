-- Год становится частью идентификатора генетического объекта.
BEGIN;
LOCK TABLE dna_profiles, master_array_profiles IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX IF EXISTS idx_dna_profiles_genetic_object;
CREATE UNIQUE INDEX idx_dna_profiles_genetic_object
  ON dna_profiles (organization_id, department_id, user_id, year, lower(btrim(internal_number)))
  WHERE is_active = true AND import_format = 'genetic' AND profile_type = 'user' AND year IS NOT NULL;

DROP INDEX IF EXISTS idx_master_array_genetic_object;
CREATE UNIQUE INDEX idx_master_array_genetic_object
  ON master_array_profiles (master_array_id, year, lower(btrim(internal_number)))
  WHERE is_active = true AND metadata->>'importFormat' = 'genetic' AND year IS NOT NULL;
COMMIT;
