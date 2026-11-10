const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  canTransferStaffName,
  transferStaffName
} = require('../src/utils/staffImportMapping');
const {
  decodeUploadFilename,
  normalizeStoredImportFilename
} = require('../src/utils/uploadFilename');
test('Multipart UTF-8 filename is decoded once without damaging Unicode or Latin-1 names', () => {
  for (const name of ['Сотрудники_2.xlsx', 'Профили_2026 😀.txt', '日本語.xlsx', 'Café.xlsx', 'ASCII.xlsx', 'Ã©.xlsx']) {
    assert.equal(decodeUploadFilename(Buffer.from(name, 'utf8').toString('latin1')), name);
  }
  for (const name of ['Сотрудники_2.xlsx', 'Профили 😀.txt', 'Café.xlsx', 'Müller.xlsx', 'Ðuke.xlsx', 'ASCII.xlsx']) assert.equal(decodeUploadFilename(name), name);
  const row = {
    sourceFilename: Buffer.from('Сотрудники_2.xlsx', 'utf8').toString('latin1'),
    provenance: {
      checksum: 'fixture'
    },
    strData: {
      TH01: ['7', '9.3']
    }
  };
  const fixed = normalizeStoredImportFilename(row);
  assert.equal(fixed.sourceFilename, 'Сотрудники_2.xlsx');
  assert.equal(fixed.provenance.sourceFilename, 'Сотрудники_2.xlsx');
  assert.equal(fixed.provenance.originalUploadedFilename, row.sourceFilename);
  assert.equal(fixed.strData, row.strData);
  assert.equal(normalizeStoredImportFilename(fixed), fixed);
  const literal = {
    sourceFilename: 'Ã©.xlsx',
    provenance: {
      sourceFilenameDecoded: true
    }
  };
  assert.equal(normalizeStoredImportFilename(literal), literal);
});
test('Staff name transfer preserves source and alleles; registration is never invented', () => {
  const row = {
    draftRowId: 'fixture',
    objectNumber: 'Тестов Т. Т.',
    expertiseType: 'staff',
    fullName: '',
    registrationNumber: null,
    year: 2026,
    strData: {
      TH01: ['7', '9.3'],
      D21S11: ['30', '*']
    },
    provenance: {
      sourceObjectNumber: 'Тестов Т. Т.'
    }
  };
  assert(canTransferStaffName(row));
  const moved = transferStaffName(row);
  assert.equal(moved.fullName, row.objectNumber);
  assert.equal(moved.objectNumber, '');
  assert.equal(moved.registrationNumber, null);
  assert.equal(moved.strData, row.strData);
  assert.equal(moved.provenance, row.provenance);
  assert.equal(row.fullName, '');
  assert.equal(transferStaffName({
    ...row,
    registrationNumber: '00870-G'
  }).objectNumber, '00870-G');
  for (const value of [{
    ...row,
    fullName: 'Уже заполнено'
  }, {
    ...row,
    expertiseType: 'ug'
  }, {
    ...row,
    objectNumber: '00870-G'
  }, {
    ...row,
    objectNumber: 'STAFF_01'
  }, {
    ...row,
    objectNumber: 'SYN-123'
  }, {
    ...row,
    provenance: {
      classification: {
        included: false
      }
    }
  }]) assert.equal(transferStaffName(value), value);
});
