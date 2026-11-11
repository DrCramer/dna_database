-- Two-person master publication. Requires 037; does not enable workspace mode.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_approve_master boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS workspace_master_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 workspace_id uuid NOT NULL REFERENCES personal_workspaces(id), author_id uuid NOT NULL REFERENCES users(id),
 search_run_id uuid NOT NULL REFERENCES workspace_search_runs(id),
 submission_key uuid NOT NULL, submission_hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','returned')),
 submitted_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
 decided_by uuid REFERENCES users(id), decision_comment text NOT NULL DEFAULT '',
 CHECK ((state='pending' AND decided_at IS NULL AND decided_by IS NULL) OR
        (state<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL AND decided_by<>author_id)),
 UNIQUE(author_id,submission_key), UNIQUE(id,search_run_id)
);
ALTER TABLE workspace_master_approvals ADD COLUMN IF NOT EXISTS encrypted_submission text;
ALTER TABLE workspace_master_approvals ADD COLUMN IF NOT EXISTS encrypted_decision text;
CREATE INDEX IF NOT EXISTS workspace_master_approval_queue ON workspace_master_approvals(organization_id,submitted_at) WHERE state='pending';
CREATE TABLE IF NOT EXISTS workspace_master_approval_items (
 approval_id uuid NOT NULL, search_run_id uuid NOT NULL, profile_id uuid NOT NULL,
 analysis_revision bigint NOT NULL, analysis_hash text NOT NULL,
 target_id uuid NOT NULL, target_fingerprint text, replace_existing boolean NOT NULL,
 publication_id uuid UNIQUE REFERENCES workspace_publications(id),
 PRIMARY KEY(approval_id,profile_id),
 FOREIGN KEY(approval_id,search_run_id) REFERENCES workspace_master_approvals(id,search_run_id),
 FOREIGN KEY(search_run_id,profile_id) REFERENCES workspace_search_profiles(search_run_id,profile_id)
);
CREATE INDEX IF NOT EXISTS workspace_master_approval_items_profile ON workspace_master_approval_items(profile_id,approval_id);
CREATE INDEX IF NOT EXISTS workspace_master_approval_author_history ON workspace_master_approvals(author_id,submitted_at DESC);
-- Separate slots enforce one pending request per source profile under concurrent submission.
CREATE TABLE IF NOT EXISTS workspace_master_approval_pending (
 profile_id uuid PRIMARY KEY REFERENCES dna_profiles(id), approval_id uuid NOT NULL,
 FOREIGN KEY(approval_id,profile_id) REFERENCES workspace_master_approval_items(approval_id,profile_id)
);
ALTER TABLE workspace_publications ADD COLUMN IF NOT EXISTS master_approval_id uuid REFERENCES workspace_master_approvals(id);
-- A new explicit metadata decision can reuse unchanged genetic evidence. Uniqueness
-- is per approved request; replay never creates another publication. Keep staff semantics.
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='workspace_publications'::regclass AND contype='u'
 AND pg_get_constraintdef(oid) IN ('UNIQUE (workspace_profile_id, analysis_revision, search_run_id)', 'UNIQUE (destination, published_id, workspace_profile_id, analysis_revision, search_run_id)')
 LOOP EXECUTE format('ALTER TABLE workspace_publications DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
DROP INDEX IF EXISTS public.workspace_publication_run_version;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_staff_publication_once ON workspace_publications(workspace_profile_id,analysis_revision,search_run_id) WHERE destination='staff';
CREATE UNIQUE INDEX IF NOT EXISTS workspace_master_publication_once ON workspace_publications(master_approval_id,workspace_profile_id) WHERE destination='master' AND master_approval_id IS NOT NULL;

CREATE OR REPLACE FUNCTION workspace_publication_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publication workspace_publications; source dna_profiles; run workspace_search_runs; proof workspace_search_profiles; refs workspace_reference_versions; w personal_workspaces; target text;
BEGIN
 target=CASE WHEN TG_TABLE_NAME='staff_profiles' THEN 'staff' ELSE 'master' END;
 IF TG_OP='UPDATE' AND (target='staff' OR NEW.comment IS NOT DISTINCT FROM OLD.comment) AND (to_jsonb(NEW)->'str_data_encrypted',to_jsonb(NEW)->'sample_name_encrypted',to_jsonb(NEW)->'metadata_encrypted',to_jsonb(NEW)->'sample_name',to_jsonb(NEW)->'str_data',to_jsonb(NEW)->'year',to_jsonb(NEW)->'internal_number',to_jsonb(NEW)->'registration_number',to_jsonb(NEW)->'expertise_type',NEW.is_active,NEW.source_workspace_profile_id,NEW.organization_id) IS NOT DISTINCT FROM
 (to_jsonb(OLD)->'str_data_encrypted',to_jsonb(OLD)->'sample_name_encrypted',to_jsonb(OLD)->'metadata_encrypted',to_jsonb(OLD)->'sample_name',to_jsonb(OLD)->'str_data',to_jsonb(OLD)->'year',to_jsonb(OLD)->'internal_number',to_jsonb(OLD)->'registration_number',to_jsonb(OLD)->'expertise_type',OLD.is_active,OLD.source_workspace_profile_id,OLD.organization_id) THEN RETURN NEW; END IF;
 IF NOT (SELECT enabled FROM workspace_configuration WHERE id=true) AND NEW.source_workspace_profile_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.is_active=true AND NEW.is_active=false AND
 (to_jsonb(NEW)->'str_data',to_jsonb(NEW)->'str_data_encrypted',to_jsonb(NEW)->'sample_name_encrypted',to_jsonb(NEW)->'metadata_encrypted',to_jsonb(NEW)->'year',to_jsonb(NEW)->'internal_number',to_jsonb(NEW)->'registration_number',to_jsonb(NEW)->'expertise_type',NEW.source_workspace_profile_id,NEW.organization_id) IS NOT DISTINCT FROM
 (to_jsonb(OLD)->'str_data',to_jsonb(OLD)->'str_data_encrypted',to_jsonb(OLD)->'sample_name_encrypted',to_jsonb(OLD)->'metadata_encrypted',to_jsonb(OLD)->'year',to_jsonb(OLD)->'internal_number',to_jsonb(OLD)->'registration_number',to_jsonb(OLD)->'expertise_type',OLD.source_workspace_profile_id,OLD.organization_id) THEN RETURN NEW; END IF;
 SELECT * INTO publication FROM workspace_publications WHERE id=NULLIF(current_setting('app.workspace_publication_id',true),'')::uuid AND published_id=NEW.id AND destination=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'FULL_SEARCH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM dna_profiles WHERE id=publication.workspace_profile_id;
 SELECT * INTO w FROM personal_workspaces WHERE id=source.workspace_id;
 SELECT * INTO run FROM workspace_search_runs WHERE id=publication.search_run_id;
 SELECT * INTO proof FROM workspace_search_profiles WHERE search_run_id=run.id AND profile_id=source.id;
 SELECT * INTO refs FROM workspace_reference_versions WHERE organization_id=source.organization_id FOR UPDATE;
 IF source.is_active IS NOT TRUE OR run.state IS DISTINCT FROM 'complete' OR proof.state IS DISTINCT FROM 'CHECKED' OR run.workspace_id IS DISTINCT FROM source.workspace_id OR run.organization_id IS DISTINCT FROM source.organization_id OR proof.stages IS DISTINCT FROM '{"internal":true,"master":true,"staff":true}'::jsonb OR proof.analysis_revision<>source.analysis_revision OR publication.analysis_revision<>source.analysis_revision OR run.workspace_revision<>w.analysis_revision OR run.master_revision<>refs.master_revision OR run.staff_revision<>refs.staff_revision OR publication.organization_id<>source.organization_id OR NEW.organization_id<>source.organization_id OR source.str_data<>NEW.str_data OR NEW.source_workspace_profile_id IS DISTINCT FROM source.id OR NEW.year IS DISTINCT FROM source.year OR COALESCE(to_jsonb(NEW)->>'internal_number',to_jsonb(NEW)->>'registration_number') IS DISTINCT FROM source.internal_number OR (target='master' AND to_jsonb(NEW)->>'expertise_type' IS DISTINCT FROM source.expertise_type) THEN
  RAISE EXCEPTION 'STALE_FULL_SEARCH' USING ERRCODE='42501';
 END IF;
 IF target='master' AND (to_jsonb(NEW)->>'str_data_encrypted' IS NOT NULL OR to_jsonb(NEW)->>'sample_name_encrypted' IS NOT NULL OR to_jsonb(NEW)->>'metadata_encrypted' IS NOT NULL OR to_jsonb(NEW)->>'sample_name' IS DISTINCT FROM source.sample_name) THEN RAISE EXCEPTION 'MASTER_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
 IF target='master' AND NOT EXISTS (
  SELECT 1 FROM workspace_master_approval_items i
  JOIN workspace_master_approvals a ON a.id=i.approval_id
  JOIN users approver ON approver.id=a.decided_by
  WHERE i.publication_id=publication.id AND i.profile_id=source.id
   AND i.search_run_id=run.id AND i.analysis_revision=source.analysis_revision
   AND i.analysis_hash=proof.analysis_hash AND publication.master_approval_id=a.id
   AND i.target_id=NEW.id AND a.search_run_id=run.id AND a.state='approved' AND a.organization_id=NEW.organization_id
   AND a.workspace_id=source.workspace_id AND a.author_id=source.user_id
   AND a.author_id<>a.decided_by AND publication.created_by=a.decided_by
   AND approver.is_active=true AND approver.can_approve_master=true
   AND approver.organization_id=a.organization_id AND run.completed_at IS NOT NULL
 ) THEN RAISE EXCEPTION 'MASTER_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;

COMMIT;
