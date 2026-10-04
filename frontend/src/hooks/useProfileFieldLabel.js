import { useAuth } from '../contexts/AuthContext';
import { resolveProfileImportFormat } from '../../../src/utils/profileImportFormat';

const GENETIC_FIELD_LABELS = {
  sample_name: '№ Экспертизы',
  sampleName: '№ Экспертизы',
  internal_number: '№ Объекта',
  internalNumber: '№ Объекта'
};

// Меняются только подписи; имя свойства и его значение остаются прежними.
export const getProfileFieldLabel = (department, field, legacyLabel) =>
  resolveProfileImportFormat(department) === 'genetic'
    ? GENETIC_FIELD_LABELS[field] || legacyLabel
    : legacyLabel;

export const useProfileFieldLabel = () => {
  const { activeDepartment } = useAuth();
  return (field, legacyLabel) => getProfileFieldLabel(activeDepartment, field, legacyLabel);
};
