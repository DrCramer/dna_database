-- Additive and idempotent. Never enables a schedule or changes publication gates.
BEGIN;
CREATE TABLE IF NOT EXISTS workspace_search_cpu_requests (
 id uuid PRIMARY KEY, priority integer NOT NULL CHECK(priority IN(0,1)),
 created_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_search_cpu_lease (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), request_id uuid, token uuid, lease_until timestamptz
);
INSERT INTO workspace_search_cpu_lease(id) VALUES(true) ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF to_regclass('personal_workspaces') IS NULL THEN RETURN; END IF;
 CREATE TABLE IF NOT EXISTS workspace_night_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'Europe/Moscow', days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  start_time text NOT NULL DEFAULT '22:00', end_time text NOT NULL DEFAULT '07:00',
  finish_policy text NOT NULL DEFAULT 'pause' CHECK(finish_policy IN('pause','finish')),
  max_workers integer NOT NULL DEFAULT 2 CHECK(max_workers BETWEEN 1 AND 16),
  chunk_size integer NOT NULL DEFAULT 16 CHECK(chunk_size BETWEEN 1 AND 64),
  revision bigint NOT NULL DEFAULT 1, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE UNIQUE INDEX IF NOT EXISTS workspace_night_owner_scope ON personal_workspaces(id,organization_id,owner_id);
 CREATE TABLE IF NOT EXISTS workspace_search_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, owner_id uuid NOT NULL,
  workspace_id uuid NOT NULL, window_key text NOT NULL, origin text NOT NULL CHECK(origin IN('scheduled','trial')),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','paused','paused_window','retry_wait','complete','failed','cancelled')),
  policy_revision bigint NOT NULL, parameters jsonb NOT NULL, manifest text, lease_token uuid, lease_until timestamptz,
  heartbeat_at timestamptz, attempt integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(), stage text, completed integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0, waiting_reason text, error_code text,
  search_run_id uuid REFERENCES workspace_search_runs(id), result_run_id uuid REFERENCES workspace_search_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  FOREIGN KEY(workspace_id,organization_id,owner_id) REFERENCES personal_workspaces(id,organization_id,owner_id),
  UNIQUE(workspace_id,window_key), UNIQUE(id,organization_id,owner_id)
 );
 CREATE UNIQUE INDEX IF NOT EXISTS workspace_night_one_active ON workspace_search_jobs(workspace_id)
  WHERE state IN('queued','running','paused','paused_window','retry_wait');
 CREATE INDEX IF NOT EXISTS workspace_night_queue ON workspace_search_jobs(next_retry_at,created_at) WHERE state IN('queued','retry_wait','paused_window','running');
 CREATE TABLE IF NOT EXISTS workspace_search_job_chunks (
  job_id uuid NOT NULL, organization_id uuid NOT NULL, owner_id uuid NOT NULL, manifest text NOT NULL,
  stage text NOT NULL CHECK(stage IN('internal','master','staff')), chunk_index integer NOT NULL,
  encrypted_result text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,stage,chunk_index),
  FOREIGN KEY(job_id,organization_id,owner_id) REFERENCES workspace_search_jobs(id,organization_id,owner_id) ON DELETE CASCADE
 );
 CREATE TABLE IF NOT EXISTS workspace_search_job_events (
  id bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES workspace_search_jobs(id) ON DELETE CASCADE,
  state text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
 );
 ALTER TABLE workspace_search_runs ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';
END $$;
COMMIT;
