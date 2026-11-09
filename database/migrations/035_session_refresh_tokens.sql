BEGIN;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS refresh_token_hash text;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz;
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS session_family_id uuid;
-- JavaScript stored ISO UTC expirations in the former timestamp column.
-- Preserve their UTC meaning independently of the connection TimeZone.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='user_sessions' AND column_name='expires_at' AND data_type='timestamp without time zone') THEN
  ALTER TABLE public.user_sessions ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_refresh_hash_idx ON public.user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_sessions_family_idx ON public.user_sessions(session_family_id);
COMMIT;
