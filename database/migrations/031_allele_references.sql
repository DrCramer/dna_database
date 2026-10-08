-- Версионированные справочники; существующие профили и частоты не изменяются.
BEGIN;
CREATE TABLE IF NOT EXISTS allele_reference_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  name varchar(150) NOT NULL CHECK (btrim(name) <> ''),
  type varchar(30) NOT NULL CHECK (type IN ('KIT_LADDER','NIST_VARIANTS','Y_STR_REFERENCE','OBSERVED_REFERENCE')),
  manufacturer varchar(150), kit_name varchar(150), kit_version varchar(150),
  source_title varchar(300) NOT NULL, source_url text NOT NULL,
  source_version varchar(150) NOT NULL, source_date date,
  imported_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  content_hash varchar(64) NOT NULL,
  created_by uuid REFERENCES users(id),
  previous_set_id uuid,
  UNIQUE (id, organization_id, department_id),
  FOREIGN KEY (previous_set_id, organization_id, department_id)
    REFERENCES allele_reference_sets(id, organization_id, department_id),
  CHECK (previous_set_id IS NULL OR previous_set_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_allele_reference_version
  ON allele_reference_sets (organization_id, department_id, lower(btrim(name)), source_version);
CREATE TABLE IF NOT EXISTS allele_reference_values (
  id bigserial PRIMARY KEY,
  reference_set_id uuid NOT NULL REFERENCES allele_reference_sets(id),
  locus_name varchar(30) NOT NULL, allele varchar(30) NOT NULL,
  classification varchar(40) NOT NULL CHECK (classification IN ('IN_LADDER','KNOWN_VARIANT','OFF_LADDER','TRIALLELIC_VARIANT','OBSERVED')),
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (reference_set_id, locus_name, allele)
);
CREATE TABLE IF NOT EXISTS genotype_panel_references (
  panel_id uuid NOT NULL, reference_set_id uuid NOT NULL,
  organization_id uuid NOT NULL, department_id uuid NOT NULL,
  linked_by uuid REFERENCES users(id), linked_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (panel_id, reference_set_id),
  FOREIGN KEY (panel_id, organization_id, department_id) REFERENCES genotype_panels(id, organization_id, department_id),
  FOREIGN KEY (reference_set_id, organization_id, department_id) REFERENCES allele_reference_sets(id, organization_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_panel_reference_set ON genotype_panel_references(reference_set_id);
COMMIT;
