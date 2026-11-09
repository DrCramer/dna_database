BEGIN;
CREATE TABLE IF NOT EXISTS public.probability_calculations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id),
 department_id uuid NOT NULL REFERENCES public.departments(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 mode text NOT NULL CHECK (mode IN ('IDENT','TRIO')),
 formula_version text NOT NULL,
 reference_version text NOT NULL,
 snapshot_encrypted text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS probability_calculations_owner_idx ON public.probability_calculations(user_id,department_id,organization_id,created_at DESC);
COMMENT ON COLUMN public.probability_calculations.snapshot_encrypted IS 'AES-256-GCM snapshot of inputs, frequency/formula version and static result; no raw TXT attachments';
COMMIT;
