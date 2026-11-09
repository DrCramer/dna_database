function reportLayout(calculation, columns, rows, counted) {
  const s=calculation.summary, trio=calculation.mode==='TRIO', index=trio?'CPI':'CLR', probability=trio?'PP':'P';
  const summaryRows=[
    {key:'count',label:'Всего признаков исследовано',values:[String(s.lociCount)]},
    {key:'index',symbol:index,label:trio?'индекс родительства':'индекс идентичности',values:[s.indexText]},
    {key:'reciprocal',symbol:'1/'+index,label:trio?'индекс исключения родительства':'индекс случайного совпадения признаков',values:[s.reciprocalText]},
    {key:'probability',symbol:probability,label:trio?'вероятность родительства':'вероятность идентичности',values:[s.probabilityFractionText,s.probabilityText],emphasizeLast:true},
    {key:'complement',symbol:'1−'+probability,label:trio?'вероятность исключения родительства, %':'вероятность случайного совпадения, %',values:[s.complementText],emphasizeLast:true},
    {key:'mismatches',label:'Всего несовпадений',values:[String(s.mismatches)]}
  ];
  const frequency=f=>f?f.value.toFixed(4)+(f.origin==='locus_minimum'?'*':''):'—';
  const sections=trio?[
    {id:'I',title:'Вариант I: ребёнок и неоспариваемый родитель имеют один общий аллель или ребёнок гомозиготен.',
      alleleHeaders:['Аллель ребёнка, совпадающая с оспариваемым родителем'],
      columns:['Локус','NTR','Частота аллеля, q'],rows:[]},
    {id:'II',title:'Вариант II: ребёнок и неоспариваемый родитель гетерозиготны и имеют два общих аллеля.',
      alleleHeaders:['Аллель ребёнка, совпадающая с оспариваемым родителем','Вторая аллель ребёнка, в том числе при совпадении обоих вариантов с оспариваемым родителем'],
      columns:['Локус','NTR','Частота аллеля, q₁','NTR','Частота аллеля, q₂'],rows:[]}
  ]:[{id:'IDENT',title:'Исследуемый генотип',columns,rows}];
  if(trio)for(const row of counted){
    // Both variants have the same locus on the same workbook-ordered row.
    // The workbook's printable AR/AU/AW cells show "нет" for mutation and
    // inactive branches; the real mutation frequencies remain in numeric data.
    sections[0].rows.push([row.locus,'нет','0.0000']);
    sections[1].rows.push([row.locus,'нет','0.0000','нет','0.0000']);
    if(row.mismatch)continue;
    // The workbook puts the matching candidate first (U/W), retaining the
    // second candidate (Y/Z) in variant II and in its frequency denominator.
    const matches=f=>(row.genotypes[2]||[]).some(a=>Number(a)===Number(f.allele));
    const frequencies=[...row.frequencies].sort((a,b)=>Number(matches(b))-Number(matches(a)));
    const values=[row.locus,...frequencies.flatMap(f=>[f.allele,frequency(f)])];
    const section=sections[row.variant==='I'?0:1];section.rows[section.rows.length-1]=values;
  }
  return {layoutVersion:3,presentation:{widthMm:180,paginate:false,font:'Times New Roman'},summaryRows,sections,inputTitle:'ВВОДНЫЕ ГЕНОТИПИЧЕСКИЕ ДАННЫЕ'};
}
module.exports={reportLayout};
