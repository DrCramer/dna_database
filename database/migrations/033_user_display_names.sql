BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name character varying(150);
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
UPDATE public.users SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';
COMMIT;
