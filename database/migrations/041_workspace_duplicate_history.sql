BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.workspace_search_runs
  ADD COLUMN IF NOT EXISTS duplicate_pair_keys text[],
  ADD COLUMN IF NOT EXISTS duplicate_history_complete boolean;

CREATE INDEX IF NOT EXISTS workspace_duplicate_history_scope
  ON public.workspace_search_runs(workspace_id, owner_id, organization_id, algorithm_version, completed_at, id)
  WHERE state = 'complete' AND encrypted_result IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspace_duplicate_history_keys
  ON public.workspace_search_runs USING gin(duplicate_pair_keys)
  WHERE state = 'complete' AND encrypted_result IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspace_duplicate_history_pending
  ON public.workspace_search_runs(algorithm_version, completed_at, id)
  WHERE state = 'complete' AND encrypted_result IS NOT NULL AND duplicate_pair_keys IS NULL;

CREATE OR REPLACE FUNCTION public.clear_workspace_duplicate_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'complete' OR NEW.encrypted_result IS NULL THEN
    NEW.duplicate_pair_keys := NULL;
    NEW.duplicate_history_complete := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clear_workspace_duplicate_history ON public.workspace_search_runs;
CREATE TRIGGER clear_workspace_duplicate_history BEFORE UPDATE OF state, encrypted_result
  ON public.workspace_search_runs FOR EACH ROW EXECUTE FUNCTION public.clear_workspace_duplicate_history();

COMMIT;
