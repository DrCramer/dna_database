-- Apply on an isolated staging database first. Production requires an explicit cutover.
BEGIN;
CREATE TABLE IF NOT EXISTS workspace_configuration (id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false);
INSERT INTO workspace_configuration(id,enabled) VALUES(true,false) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS personal_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), owner_id uuid NOT NULL REFERENCES users(id),
 analysis_revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,owner_id)
);
ALTER TABLE personal_workspaces ADD COLUMN IF NOT EXISTS analysis_parameters jsonb NOT NULL DEFAULT '{}';
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES personal_workspaces(id);
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS expertise_type text CHECK(expertise_type IN ('chs','ug','gr','staff'));
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS comment text NOT NULL DEFAULT '';
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS registration_number text;
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}';
ALTER TABLE dna_profiles ADD COLUMN IF NOT EXISTS analysis_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE dna_profiles DROP CONSTRAINT IF EXISTS dna_profiles_genetic_scope_check;
ALTER TABLE dna_profiles ADD CONSTRAINT dna_profiles_genetic_scope_check CHECK(import_format<>'genetic' OR organization_id IS NOT NULL AND (department_id IS NOT NULL OR workspace_id IS NOT NULL));
ALTER TABLE dna_profiles DROP CONSTRAINT IF EXISTS workspace_metadata;
ALTER TABLE dna_profiles ADD CONSTRAINT workspace_metadata CHECK(workspace_id IS NULL OR (expertise_type IS NOT NULL AND year BETWEEN 1900 AND 2100 AND year IS NOT NULL AND internal_number IS NOT NULL));
DROP INDEX IF EXISTS idx_dna_profiles_year_internal_user;
CREATE UNIQUE INDEX idx_dna_profiles_year_internal_user ON dna_profiles(organization_id,department_id,year,internal_number,user_id) WHERE is_active=true AND internal_number IS NOT NULL AND workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_profile_identity ON dna_profiles(workspace_id,expertise_type,year,lower(btrim(internal_number))) WHERE workspace_id IS NOT NULL AND is_active=true;
ALTER TABLE master_arrays ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE master_arrays ADD COLUMN IF NOT EXISTS organization_default boolean NOT NULL DEFAULT false;
UPDATE master_arrays ma SET organization_id=d.organization_id FROM departments d WHERE ma.department_id=d.id AND ma.organization_id IS NULL;
ALTER TABLE master_arrays ALTER COLUMN department_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organization_master_array ON master_arrays(organization_id) WHERE organization_default=true;
ALTER TABLE master_array_profiles ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE master_array_profiles ADD COLUMN IF NOT EXISTS expertise_type text CHECK(expertise_type IN ('chs','ug','gr'));
ALTER TABLE master_array_profiles ADD COLUMN IF NOT EXISTS comment text NOT NULL DEFAULT '';
ALTER TABLE master_array_profiles ADD COLUMN IF NOT EXISTS source_workspace_profile_id uuid REFERENCES dna_profiles(id);
UPDATE master_array_profiles p SET organization_id=ma.organization_id FROM master_arrays ma WHERE p.master_array_id=ma.id AND p.organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS published_business_identity ON master_array_profiles(organization_id,expertise_type,year,lower(btrim(internal_number))) WHERE expertise_type IS NOT NULL AND is_active=true;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS year integer CHECK(year BETWEEN 1900 AND 2100);
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS registration_number text;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS comment text NOT NULL DEFAULT '';
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS source_workspace_profile_id uuid REFERENCES dna_profiles(id);
UPDATE staff_profiles s SET organization_id=u.organization_id FROM users u WHERE u.id=s.created_by AND s.organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_registration_identity ON staff_profiles(organization_id,year,lower(registration_number)) WHERE registration_number IS NOT NULL AND year IS NOT NULL AND is_active=true;
CREATE TABLE IF NOT EXISTS workspace_reference_versions (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), master_revision bigint NOT NULL DEFAULT 1, staff_revision bigint NOT NULL DEFAULT 1
);
INSERT INTO workspace_reference_versions(organization_id) SELECT id FROM organizations ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS workspace_import_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES personal_workspaces(id), owner_id uuid NOT NULL REFERENCES users(id), organization_id uuid NOT NULL REFERENCES organizations(id),
 revision integer NOT NULL DEFAULT 1, source_checksums jsonb NOT NULL, encrypted_payload text NOT NULL, expires_at timestamptz NOT NULL,
 committed_at timestamptz, commit_key uuid, result_ids uuid[], created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_draft_expiry ON workspace_import_drafts(expires_at) WHERE committed_at IS NULL;
CREATE TABLE IF NOT EXISTS workspace_search_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES personal_workspaces(id), owner_id uuid NOT NULL REFERENCES users(id), organization_id uuid NOT NULL REFERENCES organizations(id),
 mode text NOT NULL DEFAULT 'FULL_SEARCH' CHECK(mode='FULL_SEARCH'), algorithm_version text NOT NULL,
 state text NOT NULL CHECK(state IN ('running','complete','failed','cancelled')), parameters jsonb NOT NULL,
 workspace_revision bigint NOT NULL, master_revision bigint NOT NULL, staff_revision bigint NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, error_code text, encrypted_result text
);
CREATE TABLE IF NOT EXISTS workspace_search_profiles (
 search_run_id uuid REFERENCES workspace_search_runs(id), profile_id uuid REFERENCES dna_profiles(id), analysis_revision bigint NOT NULL, analysis_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','CHECKED','NO_GENOTYPE','INSUFFICIENT_DATA')), stages jsonb NOT NULL, PRIMARY KEY(search_run_id,profile_id)
);
ALTER TABLE workspace_search_profiles DROP CONSTRAINT IF EXISTS workspace_search_profiles_state_check;
ALTER TABLE workspace_search_profiles ADD CONSTRAINT workspace_search_profiles_state_check CHECK(state IN ('PENDING','CHECKED','NO_GENOTYPE','INSUFFICIENT_DATA'));
CREATE TABLE IF NOT EXISTS workspace_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_profile_id uuid NOT NULL REFERENCES dna_profiles(id), analysis_revision bigint NOT NULL,
 organization_id uuid NOT NULL REFERENCES organizations(id), search_run_id uuid NOT NULL REFERENCES workspace_search_runs(id),
 destination text NOT NULL CHECK(destination IN ('master','staff')), published_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_profile_id,analysis_revision,search_run_id), UNIQUE(destination,published_id,workspace_profile_id,analysis_revision,search_run_id)
);
-- Metadata changes preserve genetic readiness. Any membership/genetic change increments the workspace revision.
CREATE OR REPLACE FUNCTION workspace_profile_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w personal_workspaces;
BEGIN
 IF TG_OP='INSERT' AND NEW.workspace_id IS NULL AND (SELECT enabled FROM workspace_configuration WHERE id=true) THEN RAISE EXCEPTION 'PERSONAL_WORKSPACE_REQUIRED' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_id IS NULL AND (SELECT enabled FROM workspace_configuration WHERE id=true) THEN
  IF (OLD.profile_type='master' OR NEW.profile_type='master') AND (NEW.str_data,NEW.profile_type,NEW.year,NEW.internal_number) IS DISTINCT FROM (OLD.str_data,OLD.profile_type,OLD.year,OLD.internal_number) THEN RAISE EXCEPTION 'FULL_SEARCH_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.workspace_id IS NOT NULL THEN
  SELECT * INTO w FROM personal_workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  IF NEW.user_id IS DISTINCT FROM w.owner_id OR NEW.organization_id IS DISTINCT FROM w.organization_id OR NEW.task_id IS NOT NULL THEN RAISE EXCEPTION 'WORKSPACE_OWNER_MISMATCH'; END IF;
  IF TG_OP='INSERT' OR (NEW.str_data,NEW.internal_number,NEW.year,NEW.expertise_type,NEW.is_active) IS DISTINCT FROM (OLD.str_data,OLD.internal_number,OLD.year,OLD.expertise_type,OLD.is_active) THEN
   IF TG_OP='UPDATE' THEN NEW.analysis_revision=OLD.analysis_revision+1; END IF;
   UPDATE personal_workspaces SET analysis_revision=analysis_revision+1 WHERE id=NEW.workspace_id;
  ELSE NEW.analysis_revision=OLD.analysis_revision; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_profile_revision ON dna_profiles;
CREATE TRIGGER workspace_profile_revision BEFORE INSERT OR UPDATE ON dna_profiles FOR EACH ROW EXECUTE FUNCTION workspace_profile_revision();
-- Every legacy INSERT or genetic UPDATE is covered once cutover is enabled. A role alone does not bypass the gate.
CREATE OR REPLACE FUNCTION workspace_publication_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publication workspace_publications; source dna_profiles; run workspace_search_runs; proof workspace_search_profiles; refs workspace_reference_versions; w personal_workspaces; target text;
BEGIN
 target=CASE WHEN TG_TABLE_NAME='staff_profiles' THEN 'staff' ELSE 'master' END;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)->'str_data',to_jsonb(NEW)->'year',to_jsonb(NEW)->'internal_number',to_jsonb(NEW)->'registration_number',to_jsonb(NEW)->'expertise_type',NEW.is_active,NEW.source_workspace_profile_id,NEW.organization_id) IS NOT DISTINCT FROM
 (to_jsonb(OLD)->'str_data',to_jsonb(OLD)->'year',to_jsonb(OLD)->'internal_number',to_jsonb(OLD)->'registration_number',to_jsonb(OLD)->'expertise_type',OLD.is_active,OLD.source_workspace_profile_id,OLD.organization_id) THEN RETURN NEW; END IF;
 IF NOT (SELECT enabled FROM workspace_configuration WHERE id=true) AND NEW.source_workspace_profile_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.is_active=true AND NEW.is_active=false THEN RETURN NEW; END IF;
 SELECT * INTO publication FROM workspace_publications WHERE id=NULLIF(current_setting('app.workspace_publication_id',true),'')::uuid AND published_id=NEW.id AND destination=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'FULL_SEARCH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM dna_profiles WHERE id=publication.workspace_profile_id;
 SELECT * INTO w FROM personal_workspaces WHERE id=source.workspace_id;
 SELECT * INTO run FROM workspace_search_runs WHERE id=publication.search_run_id;
 SELECT * INTO proof FROM workspace_search_profiles WHERE search_run_id=run.id AND profile_id=source.id;
 SELECT * INTO refs FROM workspace_reference_versions WHERE organization_id=source.organization_id FOR UPDATE;
 IF source.is_active IS NOT TRUE OR run.state IS DISTINCT FROM 'complete' OR proof.state IS DISTINCT FROM 'CHECKED' OR run.workspace_id IS DISTINCT FROM source.workspace_id OR run.organization_id IS DISTINCT FROM source.organization_id OR proof.stages IS DISTINCT FROM '{"internal":true,"master":true,"staff":true}'::jsonb OR proof.analysis_revision<>source.analysis_revision OR run.workspace_revision<>w.analysis_revision OR run.master_revision<>refs.master_revision OR run.staff_revision<>refs.staff_revision OR publication.organization_id<>source.organization_id OR NEW.organization_id<>source.organization_id OR source.str_data<>NEW.str_data OR NEW.source_workspace_profile_id IS DISTINCT FROM source.id OR NEW.year IS DISTINCT FROM source.year OR COALESCE(to_jsonb(NEW)->>'internal_number',to_jsonb(NEW)->>'registration_number') IS DISTINCT FROM source.internal_number OR (target='master' AND to_jsonb(NEW)->>'expertise_type' IS DISTINCT FROM source.expertise_type) THEN
  RAISE EXCEPTION 'STALE_FULL_SEARCH' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_publication_gate ON master_array_profiles;
CREATE TRIGGER workspace_publication_gate BEFORE INSERT OR UPDATE ON master_array_profiles FOR EACH ROW EXECUTE FUNCTION workspace_publication_gate();
DROP TRIGGER IF EXISTS workspace_publication_gate ON staff_profiles;
CREATE TRIGGER workspace_publication_gate BEFORE INSERT OR UPDATE ON staff_profiles FOR EACH ROW EXECUTE FUNCTION workspace_publication_gate();
CREATE OR REPLACE FUNCTION workspace_reference_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid; genetic_change boolean;
BEGIN
 IF TG_TABLE_NAME='dna_profiles' THEN
  IF COALESCE(NEW.profile_type,'')<>'master' AND COALESCE(OLD.profile_type,'')<>'master' THEN RETURN NULL; END IF;
 END IF;
 org=COALESCE(NEW.organization_id,OLD.organization_id);
 IF org IS NULL THEN RETURN NULL; END IF;
 genetic_change=TG_OP IN ('INSERT','DELETE');
 IF TG_OP='UPDATE' THEN genetic_change=(NEW.str_data,NEW.is_active,NEW.organization_id,to_jsonb(NEW)->'year',to_jsonb(NEW)->'internal_number',to_jsonb(NEW)->'registration_number',to_jsonb(NEW)->'expertise_type',to_jsonb(NEW)->'source_workspace_profile_id') IS DISTINCT FROM (OLD.str_data,OLD.is_active,OLD.organization_id,to_jsonb(OLD)->'year',to_jsonb(OLD)->'internal_number',to_jsonb(OLD)->'registration_number',to_jsonb(OLD)->'expertise_type',to_jsonb(OLD)->'source_workspace_profile_id'); END IF;
 IF TG_TABLE_NAME='dna_profiles' AND TG_OP='UPDATE' THEN genetic_change=genetic_change OR NEW.profile_type IS DISTINCT FROM OLD.profile_type; END IF;
 IF genetic_change THEN
  FOR org IN SELECT DISTINCT value FROM unnest(ARRAY[NEW.organization_id,OLD.organization_id]) value WHERE value IS NOT NULL LOOP
  INSERT INTO workspace_reference_versions(organization_id) VALUES(org) ON CONFLICT DO NOTHING;
  IF TG_TABLE_NAME='staff_profiles' THEN UPDATE workspace_reference_versions SET staff_revision=staff_revision+1 WHERE organization_id=org;
  ELSE UPDATE workspace_reference_versions SET master_revision=master_revision+1 WHERE organization_id=org; END IF;
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS workspace_reference_revision ON master_array_profiles;
CREATE CONSTRAINT TRIGGER workspace_reference_revision AFTER UPDATE ON master_array_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.str_data IS DISTINCT FROM NEW.str_data OR OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.year IS DISTINCT FROM NEW.year OR OLD.source_workspace_profile_id IS DISTINCT FROM NEW.source_workspace_profile_id OR to_jsonb(OLD)->'internal_number' IS DISTINCT FROM to_jsonb(NEW)->'internal_number' OR to_jsonb(OLD)->'registration_number' IS DISTINCT FROM to_jsonb(NEW)->'registration_number' OR to_jsonb(OLD)->'expertise_type' IS DISTINCT FROM to_jsonb(NEW)->'expertise_type') EXECUTE FUNCTION workspace_reference_revision();
DROP TRIGGER IF EXISTS workspace_reference_membership ON master_array_profiles;
CREATE CONSTRAINT TRIGGER workspace_reference_membership AFTER INSERT OR DELETE ON master_array_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_reference_revision();
DROP TRIGGER IF EXISTS workspace_reference_revision ON staff_profiles;
CREATE CONSTRAINT TRIGGER workspace_reference_revision AFTER UPDATE ON staff_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.str_data IS DISTINCT FROM NEW.str_data OR OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.year IS DISTINCT FROM NEW.year OR OLD.source_workspace_profile_id IS DISTINCT FROM NEW.source_workspace_profile_id OR to_jsonb(OLD)->'internal_number' IS DISTINCT FROM to_jsonb(NEW)->'internal_number' OR to_jsonb(OLD)->'registration_number' IS DISTINCT FROM to_jsonb(NEW)->'registration_number' OR to_jsonb(OLD)->'expertise_type' IS DISTINCT FROM to_jsonb(NEW)->'expertise_type') EXECUTE FUNCTION workspace_reference_revision();
DROP TRIGGER IF EXISTS workspace_reference_membership ON staff_profiles;
CREATE CONSTRAINT TRIGGER workspace_reference_membership AFTER INSERT OR DELETE ON staff_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION workspace_reference_revision();
DROP TRIGGER IF EXISTS workspace_legacy_master_reference ON dna_profiles;
CREATE TRIGGER workspace_legacy_master_reference AFTER INSERT OR UPDATE OR DELETE ON dna_profiles FOR EACH ROW EXECUTE FUNCTION workspace_reference_revision();
-- An array becoming inactive changes the effective master reference set as well.
CREATE OR REPLACE FUNCTION workspace_array_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid;
BEGIN
 IF (NEW.is_active,NEW.organization_id) IS DISTINCT FROM (OLD.is_active,OLD.organization_id) THEN
  FOR org IN SELECT DISTINCT value FROM unnest(ARRAY[NEW.organization_id,OLD.organization_id]) value WHERE value IS NOT NULL LOOP
   INSERT INTO workspace_reference_versions(organization_id) VALUES(org) ON CONFLICT DO NOTHING;
   UPDATE workspace_reference_versions SET master_revision=master_revision+1 WHERE organization_id=org;
  END LOOP;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS workspace_array_revision ON master_arrays;
CREATE TRIGGER workspace_array_revision AFTER UPDATE ON master_arrays FOR EACH ROW EXECUTE FUNCTION workspace_array_revision();
ALTER TABLE master_array_profiles DROP CONSTRAINT IF EXISTS master_array_profiles_master_array_id_year_internal_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS legacy_master_identity ON master_array_profiles(master_array_id,year,internal_number) WHERE expertise_type IS NULL;
DROP INDEX IF EXISTS idx_master_array_genetic_object;
CREATE UNIQUE INDEX idx_master_array_genetic_object ON master_array_profiles(master_array_id,year,lower(btrim(internal_number))) WHERE is_active=true AND metadata->>'importFormat'='genetic' AND year IS NOT NULL AND expertise_type IS NULL;
DROP INDEX IF EXISTS idx_dna_profiles_genetic_object;
CREATE UNIQUE INDEX idx_dna_profiles_genetic_object ON dna_profiles(organization_id,department_id,user_id,year,lower(btrim(internal_number))) WHERE is_active=true AND import_format='genetic' AND profile_type='user' AND year IS NOT NULL AND workspace_id IS NULL;
ALTER TABLE probability_calculations ALTER COLUMN department_id DROP NOT NULL;
ALTER TABLE genotype_panels ALTER COLUMN department_id DROP NOT NULL;
ALTER TABLE genotype_panel_references ALTER COLUMN department_id DROP NOT NULL;
ALTER TABLE allele_reference_sets ALTER COLUMN department_id DROP NOT NULL;
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='workspace_publications'::regclass AND contype='u' AND array_length(conkey,1) IN (2,4) LOOP
  EXECUTE format('ALTER TABLE workspace_publications DROP CONSTRAINT %I',constraint_name);
 END LOOP; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_publication_run_version ON workspace_publications(workspace_profile_id,analysis_revision,search_run_id);
COMMIT;
