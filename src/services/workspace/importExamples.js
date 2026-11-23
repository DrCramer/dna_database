const JSZip = require('jszip');
const XLSX = require('xlsx');
const { ASSIGNED_HEADER } = require('../../utils/emergencyAssignedNumber');

const year = 2026;
const astrObjectNumber = '990001-1';
const loci = [
  'D3S1358', 'vWA', 'D16S539', 'CSF1PO', 'TPOX', 'D8S1179', 'D21S11', 'D18S51',
  'D2S441', 'D19S433', 'TH01', 'FGA', 'D5S818', 'D13S317', 'D7S820', 'D2S1338'
];
const demoGenotype = ['15,16', '16,18', '10,11', '11,12', '8,8', '12,13', '29,30', '14,16', '10,11', '13,14', '7,9.3', '22,24', '11,12', '11,13', '10,11', '19,23'];
const differentGenotype = ['17,18', '15,17', '12,13', '10,13', '9,11', '14,15', '30,31', '15,17', '12,13', '14,15', '8,9', '23,25', '10,13', '8,12', '9,12', '20,22'];
const objectHeaders = ['Объект', 'Год', 'Тип экспертизы'];

function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = rows[0].map(header => ({ wch: Math.min(52, Math.max(12, header.length + 2)) }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function objectsWorkbook(headers, rows) {
  return workbook({ Импорт: [[...headers, ...loci], ...rows] });
}

function geneMapperExample() {
  const rows = [['Sample Name', 'Marker', 'Allele 1', 'Allele 2']];
  for (const [objectNumber, genotype] of [['DEMO-GM-01', demoGenotype], ['DEMO-GM-02', differentGenotype]]) {
    loci.forEach((locus, index) => rows.push([objectNumber, locus, ...genotype[index].split(',')]));
  }
  return rows.map(row => row.join('\t')).join('\r\n') + '\r\n';
}

function astrExample() {
  const result = [['#Type', 'Locus', 'Allele Coverage (Count) Ratio', 'Genotype', 'QC Flag', 'Total Depth of Coverage', 'Allele Depth of Coverage']];
  const detail = [['#Type', 'Locus', 'Allele', 'Flanking SNP', 'QC Flag', 'Proportion', 'Coverage']];
  loci.forEach((locus, index) => {
    const genotype = demoGenotype[index];
    const alleles = [...new Set(genotype.split(','))];
    const coverage = 100 / alleles.length;
    result.push(['ASTR', locus, '100%', genotype, 'Pass', 100, alleles.map(() => coverage).join(',')]);
    for (const allele of alleles) detail.push(['ASTR', locus, allele, '', 'Pass', coverage + '%', coverage]);
  });
  return workbook({ Result: result, Detail: detail });
}

async function createArchive() {
  const zip = new JSZip();
  zip.file('01_пример_ЧС.xlsx', objectsWorkbook([...objectHeaders, ASSIGNED_HEADER], [
    ['DEMO-CHS-01', year, 'ЧС', 'DEMO-VCH-001', ...differentGenotype]
  ]));
  zip.file('02_пример_УГ.xlsx', objectsWorkbook(objectHeaders, [
    ['DEMO-EXCEL-01', year, 'УГ', ...demoGenotype],
    ['DEMO-EXCEL-02', year, 'УГ', ...demoGenotype],
    ['DEMO-EXCEL-03', year, 'УГ', ...differentGenotype]
  ]));
  zip.file('03_пример_ГР.xlsx', objectsWorkbook(objectHeaders, [
    ['DEMO-GR-01', year, 'ГР', ...demoGenotype.slice(0, 8), ...differentGenotype.slice(8)]
  ]));
  zip.file('04_пример_сотрудники.xlsx', objectsWorkbook([...objectHeaders, 'ФИО', 'Комментарий'], [
    ['00001-G', year, 'Сотрудник', 'Демонстрационный Сотрудник Первый', 'Учебный эталон с регистрационным номером.', ...differentGenotype],
    ['', year, 'Сотрудник', 'Демонстрационный Сотрудник Второй', 'Учебный эталон без регистрационного номера.', ...demoGenotype]
  ]));
  zip.file('05_пример_выгрузка_из_GeneMapper.txt', geneMapperExample());
  zip.file('06_пример_ASTR.xlsx', astrExample());
  zip.file('README.txt', `\uFEFFПримеры загрузки в «ДНК Эксперт»

Все профили в архиве учебные.

01_пример_ЧС.xlsx — объект ЧС со столбцом «${ASSIGNED_HEADER}».
Используйте этот заголовок в новых файлах ЧС. Регистр букв в заголовке
не важен. Номер объекта указывайте отдельно в столбце «Объект».
02_пример_УГ.xlsx — три объекта УГ. У DEMO-EXCEL-01 и DEMO-EXCEL-02
совпадают 16 локусов. Загрузите этот файл отдельно, чтобы проверить поиск дубликатов.
03_пример_ГР.xlsx — один объект с типом ГР.
04_пример_сотрудники.xlsx — две записи с ФИО и комментариями. Регистрационный
номер указан в «Объект» у первого сотрудника. У второго это поле пустое.
05_пример_выгрузка_из_GeneMapper.txt — два образца в одной TAB-таблице.
При загрузке укажите год ${year} и выберите тип, например УГ.
06_пример_ASTR.xlsx — один образец с листами Result и Detail.
Укажите номер объекта ${astrObjectNumber}, год ${year} и тип, например УГ.
В конвертере подтвердите номер объекта и год.

В обычном Excel одна строка соответствует одному объекту, а каждый локус
занимает отдельный столбец. Аллели и номера с ведущими нулями сохраняйте
как текст. Пример записи аллелей — 7,9.3.
`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

let archive;
function getImportExamplesArchive() {
  archive ??= createArchive().catch(error => {
    archive = undefined;
    throw error;
  });
  return archive;
}

module.exports = { getImportExamplesArchive };
