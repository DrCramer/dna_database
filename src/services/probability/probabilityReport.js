const ExcelJS = require('exceljs');
const { ROLE_LABELS, probabilityDisplay } = require('./ProbabilityCalculationService');
const { reportLayout } = require('./probabilityReportLayout');
const reference = require('./data/workbook-reference.json');
function reportData(calculation) {
  if (!calculation.summary) throw new Error('Нет подтверждённого числового результата для экспорта');
  // Refresh presentation for older snapshots without changing stored numbers.
  const s = { ...calculation.summary, ...probabilityDisplay(calculation.summary, calculation.mode) };
  const singleIdent = calculation.mode === 'IDENT' && calculation.participants.length === 1;
  const columns=['Локус', ...(singleIdent ? ['', ''] : calculation.participants.map(p => ROLE_LABELS[p.role])), 'Вариант', 'Частоты p/q', calculation.mode === 'IDENT' ? '1/Q' : 'LR'];
  const order=calculation.mode==='TRIO'?reference.trioLoci:reference.identLoci;
  const counted=calculation.rows.filter(r=>r.enabled&&r.status==='OK').sort((a,b)=>order.indexOf(a.locus)-order.indexOf(b.locus));
  const rows=counted.map(r => [r.locus, ...(singleIdent ? [r.genotypes[0][0] || '', r.genotypes[0][1] || ''] : r.genotypes.map(g => g.join(', '))), r.variant,
    r.frequencies.map(f => `${f.allele}: ${f.value.toFixed(4)}${f.origin === 'locus_minimum' ? '*' : ''}`).join('; '), r.value.toExponential(6)]);
  return { ...reportLayout({ ...calculation, summary: s },columns,rows,counted), title: calculation.mode === 'IDENT' ? 'Таблица расчета.' : 'Таблица расчета вероятности родительства.',
    subtitle: 'РЕЗУЛЬТАТЫ РАСЧЕТА', mode: calculation.mode,
    metrics: [['Всего признаков исследовано', String(s.lociCount)],
      [s.indexLabel, s.indexText],
      [calculation.mode === 'IDENT' ? '1/CLR — индекс случайного совпадения признаков' : 'Индекс исключения родительства', s.reciprocalText],
      ...(calculation.mode === 'TRIO' ? [['Вероятность родительства (доля)', s.probabilityFractionText]] : []),
      [s.probabilityLabel, s.probabilityText],
      [calculation.mode === 'IDENT' ? '1−P — вероятность случайного совпадения' : 'Вероятность исключения родительства', s.complementText],
      ['Всего несовпадений', String(s.mismatches)]],
    participants: calculation.participants.map(p => ({ role: ROLE_LABELS[p.role], name: `${p.displayName}${p.year ? ' / ' + p.year : ''}` })),
    columns, rows,
    footer: [`${calculation.reference.label} · ${calculation.reference.id}`, `Формулы: ${calculation.formulaVersion} · априорная вероятность 0.5`,
      `Независимый пересчёт: ${calculation.validation.engine}; Microsoft Excel: ${calculation.validation.microsoftExcel ? 'сверено' : 'сверка не завершена'}`,
      '* Минимальная частота локуса из FREQ при отсутствии точной частоты.'],
    metadata: { id: calculation.id || null, createdAt: calculation.createdAt, formulaVersion: calculation.formulaVersion, reference: calculation.reference,
      parameters: calculation.parameters, validation: calculation.validation, excludedLoci: calculation.excludedLoci,
      sources: calculation.participants.map(({ role, sourceType, sourceId, filename, sampleName, year, sourceSnapshot, manualOverrides }) => ({ role, sourceType, sourceId, filename, sampleName, year, edited: Boolean(manualOverrides && Object.keys(manualOverrides).length) })) } };
}
async function exportXlsx(calculation) {
  const report = reportData(calculation), book = new ExcelJS.Workbook();
  const trio=calculation.mode==='TRIO', end=trio?16:report.columns.length, half=end/2;
  const sheet = book.addWorksheet(trio?'R_TRIO':'R_ident', {pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,
    margins:{left:0.59,right:0.59,top:0.59,bottom:0.59,header:0.2,footer:0.2}}});
  sheet.columns=Array.from({length:end},(_,i)=>({width:trio?5.8:[15,9,9,10,26,20][i]||15}));
  const border=Object.fromEntries(['top','right','bottom','left'].map(k=>[k,{style:'thin',color:{argb:'FF000000'}}]));
  function block(row,from,to,value,{fill,bold=false,center=false}={}){
    if(to>from)sheet.mergeCells(row,from,row,to);
    const cell=sheet.getCell(row,from);cell.value=value;cell.border=border;cell.font={name:'Times New Roman',size:10,bold};
    cell.alignment={vertical:'middle',horizontal:center?'center':'left',wrapText:true};
    if(fill)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2E2D6'}};
  }
  let number=1;block(number,1,end,report.title,{center:true});sheet.getRow(number++).height=44;
  block(number,1,end,report.subtitle,{fill:true,center:true});sheet.getRow(number++).height=24;
  for(const metric of report.summaryRows){
    const first=number;
    for(const [i,value]of metric.values.entries()){
      if(i===0)block(number,1,half,(metric.symbol?metric.symbol+'  ':'')+metric.label);
      block(number,half+1,end,value,{bold:metric.emphasizeLast&&i===metric.values.length-1});
      sheet.getRow(number++).height=29;
    }
    if(metric.values.length>1){sheet.unMergeCells(first,1,first,half);sheet.mergeCells(first,1,number-1,half);}
  }
  block(number,1,end,report.inputTitle,{fill:true,center:true});sheet.getRow(number++).height=24;
  if(trio){
    for(const [i,section]of report.sections.entries())block(number,i*8+1,i*8+8,section.title,{center:true});
    sheet.getRow(number++).height=54;
    block(number,1,2,'Локус',{center:true});block(number,3,8,report.sections[0].alleleHeaders[0],{center:true});
    block(number,9,10,'Локус',{center:true});block(number,11,13,report.sections[1].alleleHeaders[0],{center:true});block(number,14,16,report.sections[1].alleleHeaders[1],{center:true});
    sheet.getRow(number++).height=66;
    for(const [from,to,label]of [[1,2,''],[3,4,'NTR'],[5,8,'Частота аллеля, q'],[9,10,''],[11,11,'NTR'],[12,13,'Частота, q₁'],[14,14,'NTR'],[15,16,'Частота, q₂']])block(number,from,to,label,{center:true});
    sheet.getRow(number++).height=30;
    const ranges=[[[1,2],[3,4],[5,8]],[[9,10],[11,11],[12,13],[14,14],[15,16]]];
    for(let i=0;i<Math.max(...report.sections.map(s=>s.rows.length));i++){
      report.sections.forEach((section,index)=>ranges[index].forEach(([from,to],j)=>block(number,from,to,section.rows[i]?.[j]||'',{center:true})));
      sheet.getRow(number++).height=22;
    }
  }else{
    report.columns.forEach((name,i)=>block(number,i+1,i+1,name,{center:true}));sheet.getRow(number++).height=30;
    for(const row of report.rows){row.forEach((value,i)=>block(number,i+1,i+1,value,{center:true}));sheet.getRow(number++).height=22;}
  }
  for(const participant of report.participants){block(number,1,end,participant.role+': '+participant.name);sheet.getRow(number++).height=26;}
  for(const text of report.footer){block(number,1,end,text);sheet.getRow(number++).height=26;}
  sheet.pageSetup.printArea='A1:'+sheet.getColumn(end).letter+(number-1);
  const metadata = book.addWorksheet('Параметры'); metadata.columns = [{width:30},{width:110}];
  for (const [key, value] of Object.entries(report.metadata)) metadata.addRow([key, typeof value === 'object' ? JSON.stringify(value) : value]);
  // Full precision static values are separate from human-facing formatted cells.
  const values = book.addWorksheet('Числовые данные'); values.addRow(['Локус','LR / 1/Q','Вариант','Частоты (полная точность)']);
  for (const row of calculation.rows.filter(r => r.enabled && r.status === 'OK')) values.addRow([row.locus,row.value,row.variant,JSON.stringify(row.frequencies)]);
  values.addRow(['Итоговый индекс',calculation.summary.index ?? calculation.summary.indexText]);
  const fraction = report.summaryRows.find(r => r.key === 'probability').values[0];
  // Excel's General format also rounds near-one doubles to 1. Use the same
  // display bound there; raw numbers in the calculation snapshot stay intact.
  values.addRow(['Вероятность', /^[<>]/.test(fraction) ? fraction : calculation.summary.probability]);
  return book.xlsx.writeBuffer();
}
module.exports = { reportData, exportXlsx };
