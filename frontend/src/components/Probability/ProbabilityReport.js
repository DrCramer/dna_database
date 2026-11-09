import React from 'react';
import { ReportSymbol } from './ProbabilityMath';

export default function ProbabilityReport({ report, view }) {
  const sections=view?.sections||report.sections;
  const geometry=view?.layout;
  return <article className="probability-a4" aria-label="Отчёт для A4" style={geometry?{
    '--report-description-height':geometry.descriptionHeight/11+'em',
    '--report-upper-height':geometry.upperHeight/11+'em',
    '--report-lower-height':geometry.lowerHeight/11+'em'
  }:undefined}>
    <h2 className="probability-report-title">{report.title}</h2>
    <h3 className="probability-report-band">{report.subtitle}</h3>
    <table className="probability-report-summary"><colgroup><col/><col/></colgroup><tbody>
      {report.summaryRows.flatMap(metric=>metric.values.map((value,i)=><tr key={metric.key+'-'+i}>
        {i===0&&<td rowSpan={metric.values.length} className="probability-report-label">{metric.symbol&&<ReportSymbol symbol={metric.symbol}/>}<span>{metric.symbol?'('+metric.label+')':metric.label}</span></td>}
        <td className={metric.emphasizeLast&&i===metric.values.length-1?'probability-report-emphasis':''}>{value}</td>
      </tr>))}
    </tbody></table>
    <h3 className="probability-report-band">{report.inputTitle}</h3>
    <div className={'probability-report-variants'+(report.mode==='IDENT'?' probability-report-ident':'')}>
      {sections.map(section=><section className="probability-report-variant" data-variant={section.id} key={section.id}>
        <p className="probability-report-description">{section.title}</p>
        <table className="probability-report-genotypes"><colgroup>{section.columns.map((_,i)=><col key={i}/>)}</colgroup><thead>{report.mode==='TRIO'?<>
          <tr><th rowSpan="2">Локус</th>{section.alleleHeaders.map((text,i)=><th colSpan="2" key={i}>{text}</th>)}</tr>
          <tr>{section.columns.slice(1).map((text,i)=><th key={i}>{text}</th>)}</tr>
        </>:<tr>{section.columns.map((text,i)=><th key={i}>{text}</th>)}</tr>}</thead>
        <tbody>{section.rows.map((row,i)=><tr key={i}>{section.columns.map((_,j)=><td key={j}>{row[j]||''}</td>)}</tr>)}</tbody></table>
      </section>)}
    </div>
    <footer className="probability-report-footer">{report.participants.map(p=><p key={p.role}>{p.role}: {p.name}</p>)}{report.footer.map((text,i)=><p key={i}>{text}</p>)}</footer>
  </article>;
}
