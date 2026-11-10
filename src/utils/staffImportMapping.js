// This only proposes a user-confirmed metadata transfer. It never creates a registration number.
function canTransferStaffName(row) {
  const value = String(row.objectNumber || '').trim();
  return row.expertiseType === 'staff' && !String(row.fullName || '').trim() && row.provenance?.classification?.included !== false && /^[\p{L}][\p{L}\p{M}\s.'’\-]*$/u.test(value) && (value.match(/\p{L}/gu) || []).length >= 2;
}
function transferStaffName(row) {
  if (!canTransferStaffName(row)) return row;
  const registration = /^\d+-G$/.test(row.registrationNumber || '') ? row.registrationNumber : '';
  return {
    ...row,
    fullName: row.objectNumber,
    objectNumber: registration,
    registrationNumber: registration || null
  };
}
module.exports = {
  canTransferStaffName,
  transferStaffName
};
