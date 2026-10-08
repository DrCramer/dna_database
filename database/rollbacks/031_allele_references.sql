-- Применять после возврата к предыдущей версии приложения и сохранения справочников.
-- Откат удаляет только новые справочники и связи, не профили, панели или population_data.
BEGIN;
DROP TABLE IF EXISTS genotype_panel_references;
DROP TABLE IF EXISTS allele_reference_values;
DROP TABLE IF EXISTS allele_reference_sets;
COMMIT;
