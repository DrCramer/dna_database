import React from 'react';

export function Fraction({ numerator, denominator }) {
  return <span className="probability-fraction"><span>{numerator}</span><span>{denominator}</span></span>;
}
export function ReportSymbol({ symbol }) {
  if(!symbol)return null;
  const parts=symbol.split('/');
  return <span className="probability-math" role="math" aria-label={symbol}>{parts.length===2?<Fraction numerator={parts[0]} denominator={<i>{parts[1]}</i>}/>:<i>{symbol}</i>}</span>;
}
export default function ProbabilityHelp({ mode, onClose }) {
  const presence=<><span>2p − p<sup>2</sup></span></>;
  const both=<><span>(2p − p<sup>2</sup>) + (2q − q<sup>2</sup>) − 2pq</span></>;
  const formulas=mode==='TRIO'?[
    {numerator:<>1 − μ</>,denominator:<>({presence})</>,text:'Вариант I. У оспариваемого родителя есть обязательная отцовская аллель ребёнка p: ребёнок гомозиготен либо другая аллель ребёнка определяется неоспариваемым родителем.'},
    {numerator:<>μ</>,denominator:<>1 − ({presence})</>,text:'Вариант I. Обязательная отцовская аллель p отсутствует у оспариваемого родителя. Используется мутационная ветвь.'},
    {numerator:<>1 − μ</>,denominator:both,text:'Вариант II. Ребёнок и неоспариваемый родитель имеют одинаковый гетерозиготный генотип p/q. У оспариваемого родителя есть одна или обе аллели ребёнка.'},
    {numerator:<>μ</>,denominator:<>1 − [{both}]</>,text:'Вариант II. При одинаковом гетерозиготном генотипе ребёнка и неоспариваемого родителя у оспариваемого родителя нет ни одной из двух аллелей ребёнка.'}
  ]:[
    {prefix:'Q',expression:<>p<sup>2</sup></>,text:'Гомозиготный генотип p/p: частота генотипа равна квадрату частоты аллели p.'},
    {prefix:'Q',expression:<>2pq</>,text:'Гетерозиготный генотип p/q: используются частоты двух разных аллелей.'}
  ];
  return <aside className="probability-help" aria-label="Справка по формулам">
    <div className="probability-help-heading"><h2>ОСНОВНЫЕ РАСЧЁТНЫЕ ФОРМУЛЫ · {mode}</h2><button className="btn btn-secondary" onClick={onClose}>Закрыть справку</button></div>
    <p className="probability-help-banner">Расчёт {mode==='TRIO'?'LR':'частоты генотипа Q'} выполняется независимо для каждого анализируемого локуса</p>
    <p className="probability-help-legend"><i>Здесь и далее:</i> μ = 10<sup>−3</sup> — вероятность мутации; p, q — частоты рассматриваемых аллелей в FREQ.</p>
    <div className="probability-formula-list">{formulas.map((f,i)=><div className="probability-formula-row" key={i}>
      <div className="probability-formula-box" role="math"><i>{f.prefix||'LR'}</i> = {f.expression||<Fraction numerator={f.numerator} denominator={f.denominator}/>}</div><p>{f.text}</p>
    </div>)}</div>
    <p className="probability-help-banner">Итог по включённым локусам</p>
    <div className="probability-formula-row"><div className="probability-formula-box" role="math">{mode==='TRIO'?<><i>CPI</i> = ∏<sub>i=1</sub><sup>n</sup> LR<sub>i</sub></>:<><i>CLR</i> = <Fraction numerator="1" denominator={<>∏<sub>i=1</sub><sup>n</sup> Q<sub>i</sub></>}/></>}</div><p>{mode==='TRIO'?'Индекс родительства: произведение локусных LR.':'Индекс идентичности: обратная величина произведения частот генотипов.'}</p></div>
    <div className="probability-formula-row"><div className="probability-formula-box" role="math"><i>{mode==='TRIO'?'PP':'P'}</i> = <Fraction numerator="1" denominator={<>1 + <Fraction numerator="1" denominator={mode==='TRIO'?'CPI':'CLR'}/></>}/> × 100%</div><p>{mode==='TRIO'?'Вероятность родительства':'Вероятность идентичности'} при равных априорных шансах гипотез (0.5).</p></div>
    <details className="probability-help-notes"><summary>Источники, ограничения и сохранение</summary>
      <p>IDENT оценивает один генотип. TRIO требует генотипов неоспариваемого родителя, ребёнка и оспариваемого родителя. Отсутствие неоспариваемого родителя и несовместимость его генотипа с ребёнком в текущей модели не разрешены.</p>
      <p>Локусы определены расчётными таблицами исходной книги. В IDENT формула 1/(2pq) применяется ко всем поддерживаемым гетерозиготным локусам, включая не охваченные итоговым диапазоном книги. Половые маркеры скрыты, исходные данные сохраняются. Неполные локусы по умолчанию выключены. ?, OL, смеси и нерешённые флаги качества блокируют явно выбранный локус. Одиночная аутосомная аллель и пара вида 30,* учитываются как 30,30 по принятому правилу.</p>
      <p>Частоты взяты из версии FREQ исходной книги. Звёздочка рядом с частотой в отчёте означает минимум частоты этого локуса, применённый при отсутствии точной частоты в ветви совпадения; это отдельная пометка, не аллель *. В мутационной ветви требуется точная частота.</p>
      <p>По решению пользователя числитель совпадения TRIO равен 1−μ; TRIO_AN исходной книги использует 1. Числовые контроли пересчитаны в Calc, сверка в Microsoft Excel не завершена. Модель не предназначена для смесей, dropout и близкого родства.</p>
      <p>Снимки сохраняют исходники и правки. PNG и XLSX сохраняют весь отчёт целиком с шириной под A4 (180 мм). Варианты I и II показывают одинаковые локусы на одинаковых строках. Для вставки в Word скачайте PNG.</p>
    </details>
  </aside>;
}
