BEGIN;
DROP INDEX IF EXISTS public.idx_dna_profiles_year_internal_user;
CREATE UNIQUE INDEX idx_dna_profiles_year_internal_user ON public.dna_profiles(organization_id,department_id,year,internal_number,user_id)
 WHERE is_active=true AND internal_number IS NOT NULL;
COMMIT;
