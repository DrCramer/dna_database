-- Allow partial genotypes in the master array after a completed search and approval.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION workspace_partial_master_proof(state text, stages jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT state='INSUFFICIENT_DATA' AND stages='{"internal":false,"master":false,"staff":false}'::jsonb;
$$;

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
 IF target='master' AND NULLIF(current_setting('app.workspace_master_approval_id',true),'') IS NOT NULL THEN
  SELECT pub.* INTO publication
  FROM workspace_master_approval_items i JOIN workspace_publications pub ON pub.id=i.publication_id
  WHERE i.approval_id=NULLIF(current_setting('app.workspace_master_approval_id',true),'')::uuid
   AND i.target_id=NEW.id AND pub.published_id=NEW.id AND pub.destination=target;
 ELSE
  SELECT * INTO publication FROM workspace_publications WHERE id=NULLIF(current_setting('app.workspace_publication_id',true),'')::uuid AND published_id=NEW.id AND destination=target;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'FULL_SEARCH_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO source FROM dna_profiles WHERE id=publication.workspace_profile_id;
 SELECT * INTO w FROM personal_workspaces WHERE id=source.workspace_id;
 SELECT * INTO run FROM workspace_search_runs WHERE id=publication.search_run_id;
 SELECT * INTO proof FROM workspace_search_profiles WHERE search_run_id=run.id AND profile_id=source.id;
 SELECT * INTO refs FROM workspace_reference_versions WHERE organization_id=source.organization_id FOR UPDATE;
 IF source.is_active IS NOT TRUE OR run.state IS DISTINCT FROM 'complete' OR run.workspace_id IS DISTINCT FROM source.workspace_id OR run.organization_id IS DISTINCT FROM source.organization_id OR proof.analysis_revision<>source.analysis_revision OR publication.analysis_revision<>source.analysis_revision OR run.workspace_revision<>w.analysis_revision OR run.master_revision<>refs.master_revision OR run.staff_revision<>refs.staff_revision OR publication.organization_id<>source.organization_id OR NEW.organization_id<>source.organization_id OR source.str_data<>NEW.str_data OR NEW.source_workspace_profile_id IS DISTINCT FROM source.id OR NEW.year IS DISTINCT FROM source.year OR COALESCE(to_jsonb(NEW)->>'internal_number',to_jsonb(NEW)->>'registration_number') IS DISTINCT FROM source.internal_number OR (target='master' AND to_jsonb(NEW)->>'expertise_type' IS DISTINCT FROM source.expertise_type) THEN
  RAISE EXCEPTION 'STALE_FULL_SEARCH' USING ERRCODE='42501';
 END IF;
 IF target='master' AND proof.state='NO_GENOTYPE'
    AND proof.stages='{"internal":false,"master":false,"staff":false}'::jsonb
    AND workspace_empty_master_genotype(source.str_data) THEN
  IF TG_OP='UPDATE' AND (OLD.str_data_encrypted IS NOT NULL OR NOT workspace_empty_master_genotype(OLD.str_data)) THEN
   RAISE EXCEPTION 'EMPTY_MASTER_REPLACEMENT' USING ERRCODE='42501';
  END IF;
 ELSIF target='master' AND workspace_partial_master_proof(proof.state, proof.stages)
    AND NOT workspace_empty_master_genotype(source.str_data) THEN
  -- Comparison thresholds govern matches; a completed full search may still yield a partial record.
  NULL;
 ELSIF proof.state IS DISTINCT FROM 'CHECKED' OR proof.stages IS DISTINCT FROM '{"internal":true,"master":true,"staff":true}'::jsonb THEN
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
