BEGIN;
SET LOCAL lock_timeout = '10s';
-- No data conversion or invented registration numbers. NULL keeps unnumbered
-- employees distinct under the existing unique index and publication gate.
DO $$
BEGIN
 IF to_regclass('public.personal_workspaces') IS NULL THEN RETURN; END IF;
 ALTER TABLE dna_profiles DROP CONSTRAINT IF EXISTS workspace_metadata;
 ALTER TABLE dna_profiles ADD CONSTRAINT workspace_metadata CHECK (
   workspace_id IS NULL OR (expertise_type IS NOT NULL AND year IS NOT NULL
     AND year BETWEEN 1900 AND 2100
     AND (internal_number IS NOT NULL OR expertise_type='staff'))
 );
END $$;
COMMIT;
