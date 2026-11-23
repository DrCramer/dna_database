-- A rollback changes one reference set. The service increments its revision
-- once in the same transaction as the journal and the affected master rows.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS workspace_master_approval_rollback_targets
 ON workspace_master_approval_items(approval_id,target_id);

CREATE OR REPLACE FUNCTION workspace_master_update_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rollback_id text;
BEGIN
 rollback_id := NULLIF(current_setting('app.workspace_rollback_batch_id',true),'');
 IF rollback_id IS NOT NULL AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id AND EXISTS (
  SELECT 1 FROM workspace_master_rollbacks r
  JOIN workspace_master_approvals a ON a.id=r.approval_id
  JOIN workspace_master_approval_items i ON i.approval_id=a.id AND i.target_id=NEW.id
  WHERE r.approval_id=rollback_id::uuid AND r.xmin=pg_current_xact_id()::xid
    AND a.organization_id=NEW.organization_id AND a.state='approved'
 ) THEN
  RETURN NULL;
 END IF;

 INSERT INTO workspace_reference_versions(organization_id)
 SELECT DISTINCT org FROM unnest(ARRAY[NEW.organization_id,OLD.organization_id]) org
 WHERE org IS NOT NULL ORDER BY org ON CONFLICT DO NOTHING;
 UPDATE workspace_reference_versions SET master_revision=master_revision+1
 WHERE organization_id IN (NEW.organization_id,OLD.organization_id);
 RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS workspace_reference_revision ON master_array_profiles;
CREATE CONSTRAINT TRIGGER workspace_reference_revision
 AFTER UPDATE ON master_array_profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (
  OLD.str_data IS DISTINCT FROM NEW.str_data OR OLD.is_active IS DISTINCT FROM NEW.is_active OR
  OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.year IS DISTINCT FROM NEW.year OR
  OLD.source_workspace_profile_id IS DISTINCT FROM NEW.source_workspace_profile_id OR
  OLD.internal_number IS DISTINCT FROM NEW.internal_number OR OLD.expertise_type IS DISTINCT FROM NEW.expertise_type
 )
 EXECUTE FUNCTION workspace_master_update_revision();

COMMIT;
