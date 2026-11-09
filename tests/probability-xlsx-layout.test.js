const test=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {calculate,ROLES}=require('../src/services/probability/ProbabilityCalculationService');
const {exportXlsx}=require('../src/services/probability/probabilityReport');
const {wrappedTextHeight}=require('../src/services/probability/xlsxRowHeight');
const {probabilityExportFilename}=require('../src/utils/probabilityExportFilename');
function trio(){return calculate({mode:'TRIO',participants:ROLES.TRIO.map((role,i)=>({role,displayName:['606','607','608'][i],loci:{D5S818:[['11','12'],['11','12'],['11','11']][i]}}))});}

test('XLSX row 12 fits the narrow merged TRIO header and preserves values, merges and A4',async()=>{
 const c=trio(),before=JSON.stringify(c),book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(c));
 const sheet=book.getWorksheet('R_TRIO'),row=sheet.getRow(12);
 assert.ok(row.height>66,'long right header needs more than the former fixed height');
 assert.equal(sheet.getCell('N12').value,'Вторая аллель ребёнка, в том числе при совпадении обоих вариантов с оспариваемым родителем');
 assert.equal(sheet.getCell('N12').alignment.wrapText,true);assert.ok(sheet.model.merges.includes('N12:P12'));
 for(const [address,widths] of [['A12',[5.8,5.8]],['C12',Array(6).fill(5.8)],['K12',Array(3).fill(5.8)],['N12',Array(3).fill(5.8)]])
  assert.ok(row.height>=wrappedTextHeight(sheet.getCell(address).value,widths));
 assert.equal(sheet.pageSetup.paperSize,9);assert.equal(sheet.pageSetup.fitToWidth,1);assert.equal(sheet.getRow(13).height,30);
 assert.equal(JSON.stringify(c),before);assert.equal(book.getWorksheet('Числовые данные').getCell('B2').value,c.rows[0].value);
});
test('Wrapped-row sizing responds to width, font size, newlines and long unbroken text',()=>{
 const text='Аллель ребёнка, совпадающая с оспариваемым родителем';
 assert.ok(wrappedTextHeight(text,[5.8,5.8,5.8])>wrappedTextHeight(text,Array(6).fill(5.8)));
 assert.ok(wrappedTextHeight(text,[10],14)>wrappedTextHeight(text,[10],10));
 assert.ok(wrappedTextHeight('Первая\nВторая\nТретья',[40])>wrappedTextHeight('Первая',[40]));
 assert.ok(wrappedTextHeight('Ж'.repeat(100),[5.8])>66);
});
test('IDENT first data row remains compact; single and paired object names remain distinct',async()=>{
 const c=calculate({mode:'IDENT',participants:[{role:'object',displayName:'258-11x',loci:{TH01:['7','9']}}]});
 const book=new ExcelJS.Workbook();await book.xlsx.load(await exportXlsx(c));assert.equal(book.getWorksheet('R_ident').getRow(12).height,22);
 assert.equal(probabilityExportFilename(c),'Probability_258-11x.xlsx');
 assert.equal(probabilityExportFilename(trio()),'Probability_606_607_608.xlsx');
 assert.equal(probabilityExportFilename({participants:[{sampleName:'250-1',displayName:'Other'},{displayName:'250-2'}]}),'Probability_250-1_250-2.xlsx');
 assert.equal(probabilityExportFilename({participants:[{displayName:'Ручной ввод'},{displayName:''}]}),'Probability_Объект-1_Объект-2.xlsx');
});
test('Download names safely preserve Cyrillic/object numbers and stay below filesystem byte limits',()=>{
 const participants=[{displayName:' ../Объект 12/2026\r\n" '},{displayName:'258-11x'}];
 const filename=probabilityExportFilename({participants});assert.equal(filename,'Probability_Объект-12-2026_258-11x.xlsx');
 assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(filename));
 const long=probabilityExportFilename({participants:Array.from({length:3},()=>({displayName:'Экспертиза-'.repeat(40)}))});
 assert.ok(Buffer.byteLength(long,'utf8')<=240);assert.ok(long.endsWith('.xlsx'));assert.equal(probabilityExportFilename(null),'Probability.xlsx');
});
