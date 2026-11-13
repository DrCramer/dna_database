// Shared browser/server dictionary; business types do not select a source format or a role.
const OBJECT_TYPES = Object.freeze({
  chs: 'ЧС',
  ug: 'УГ',
  gr: 'ГР',
  staff: 'Сотрудник'
});
const WORKSPACE_WRITE_ROLES = Object.freeze(['admin','system_administrator','department_head','user_analyst','analyst']);
function objectMetadataIssues(row) {
  const issues=[];const add=(code,message)=>issues.push({code,message});
  if (typeof row.objectNumber !== 'string' || row.objectNumber.length > 100 || /[\u0000-\u001f\u007f]/.test(row.objectNumber) || row.expertiseType !== 'staff' && !row.objectNumber.trim()) add('OBJECT_NUMBER', 'Укажите полный номер объекта (до 100 символов).');
  if (!Number.isInteger(row.year) || row.year < 1900 || row.year > 2100) add('YEAR', 'Укажите год от 1900 до 2100.');
  if (!Object.hasOwn(OBJECT_TYPES, row.expertiseType || '')) add('TYPE', 'Выберите тип экспертизы.');
  if (row.expertiseType === 'staff') {
    if (row.objectNumber && !/^\d+-G$/.test(row.objectNumber)) add('REGISTRATION', 'Если номер сотрудника указан, он должен содержать цифры и латинскую -G; ведущие нули сохраняются.');
    if (row.registrationNumber && row.registrationNumber !== row.objectNumber) add('REGISTRATION_CONFLICT', 'Номер объекта и № рег. различаются.');
    if (typeof row.fullName !== 'string' || !row.fullName.trim() || row.fullName.length > 200) add('FULL_NAME', 'Укажите ФИО сотрудника (до 200 символов).');
  } else if (row.fullName) add('FULL_NAME_TYPE', 'ФИО допустимо только для сотрудника.');
  if (typeof row.comment !== 'string' || row.comment.length > 20000) add('COMMENT', 'Комментарий должен быть текстом до 20000 символов.');
  return issues;
}
module.exports = { OBJECT_TYPES, WORKSPACE_WRITE_ROLES, objectMetadataIssues };
