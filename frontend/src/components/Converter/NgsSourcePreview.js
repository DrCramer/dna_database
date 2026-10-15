import React, { useState } from 'react';

const statusNames = { OK: 'QC согласован', MISSING: 'Нет данных', WARNING: 'Предупреждение', NEEDS_REVIEW: 'Требуется проверка', ERROR: 'Ошибка', AUTO_FIXED: 'Подтверждено' };

export default function NgsSourcePreview({ file, options, update, disabled }) {
  const [objectNumber, setObjectNumber] = useState(file.ngs.objectNumber || file.ngs.suggestedObjectNumber || '');
  const [selected, setSelected] = useState(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const ngs = file.ngs;
  const record = ngs.records.find(item => item.key === selected);
  const apply = (decision, description) => {
    if (!record?.cell) return;
    update({ ...options, cells: { ...options.cells, [record.cell.id]: { ...decision, reason: reason.trim() || description, timestamp: new Date().toISOString() } } });
    setSelected(null);
  };
  return <div className="converter-ngs">
    <h3>NGS ASTR+ · Result / Detail</h3>
    <form className="converter-actions" onSubmit={event => { event.preventDefault(); update({ ...options, files: { ...options.files, [file.id]: { ...options.files?.[file.id], objectNumber, objectConfirmed: true } } }); }}>
      <label>Полный номер объекта<input className="form-input" value={objectNumber} maxLength={100} disabled={disabled} onChange={event => setObjectNumber(event.target.value)} placeholder="Например, 251-3" /></label>
      <button className="btn btn-primary" disabled={disabled || !objectNumber.trim()} type="submit">Подтвердить номер</button>
    </form>
    <p>{ngs.objectConfirmed ? `Принятый номер: ${ngs.objectNumber}.` : 'Номер ещё не подтверждён.'} {ngs.suggestedObjectNumber && `Предложение из имени файла: ${ngs.suggestedObjectNumber}.`} {objectNumber !== ngs.objectNumber && 'Изменённый номер вступит в силу после подтверждения.'}</p>
    {!ngs.detailAvailable && <p className="alert alert-warning">Detail недоступен: проверка QC ограничена, непустые генотипы требуют подтверждения.</p>}
    {ngs.locusReport && <details><summary>Каталог маркеров: {ngs.locusReport.total} исходных · {ngs.locusReport.supported.length} поддерживаются · {ngs.locusReport.aliases.length} aliases · {ngs.locusReport.unknown.length} неизвестны · {ngs.locusReport.ambiguous.length} неоднозначны</summary>
      <p>Поддерживаются: {ngs.locusReport.supported.join(', ') || '—'}</p><p>Aliases: {ngs.locusReport.aliases.map(alias => `${alias.original} → ${alias.canonical}`).join(', ') || '—'}</p><p>Неизвестны: {ngs.locusReport.unknown.join(', ') || '—'}</p><p>Неоднозначны: {ngs.locusReport.ambiguous.join(', ') || '—'}</p>
    </details>}
    <details open={ngs.objectConfirmed && ngs.records.some(item => item.cell?.hard)}><summary>Проверка локусов · {ngs.records.filter(item => item.cell?.hard).length} требуют решения</summary>
    <p>Result: {ngs.resultCount || 0} строк · Detail: {ngs.detailCount || 0} строк. Нажмите на локус для просмотра доказательств QC и принятия решения.</p>
    <div className="converter-scroll"><table className="converter-issue-table"><thead><tr>{['Локус', 'Исходный Genotype', 'QC Result', 'Coverage', 'Аллелей', 'Принятое значение / статус'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>
      {ngs.records.map(item => <tr key={item.key}>
        <td><button className="btn btn-secondary" disabled={disabled} onClick={() => { setSelected(item.key); setValue(item.cell?.normalizedValue || item.rawGenotype || ''); setReason(''); }}>{item.cell?.locus || item.locus || item.originalLocus || '(без имени)'}</button></td>
        <td>{item.rawGenotype || '—'}</td><td>{item.resultRows.map(row => row.qcFlag).join('; ') || '—'}</td><td>{item.resultRows.map(row => row.totalCoverage ?? '—').join(' / ')}</td><td>{item.qc.originalAlleles.length}</td>
        <td>{item.cell?.normalizedValue || '—'}<br />{item.cell?.userDecision ? 'Решение пользователя сохранено' : statusNames[item.qc.status] || item.qc.status}{item.cell?.hard && ' · Требуется решение'}{!item.cell && ' · Проверьте сопоставление маркера и источник'}</td>
      </tr>)}
    </tbody></table></div>
    </details>
    {record && <div className="modal-overlay"><div className="modal-content modal-lg converter-ngs-dialog" role="dialog" aria-modal="true" aria-labelledby="ngs-locus-title">
      <h2 id="ngs-locus-title">{record.cell?.locus || record.originalLocus} · {file.name}</h2>
      <p>Исходный генотип: <strong>{record.rawGenotype || '—'}</strong>. Предлагаемый: <strong>{record.qc.suggestedValue || 'нет'}</strong>.</p>
      <p>{record.cell?.reason || record.qc.issues.map(issue => issue.reason).join(' ') || 'Result и Detail согласованы.'}</p>
      {record.qc.suggestedValue && <p>Предложение основано на двух различных сигналах Pass из Detail. Оно применяется только после подтверждения.</p>}
      <div className="converter-scroll"><table className="converter-issue-table"><thead><tr>{['Лист / строка', 'Маркер', 'Генотип / аллель', 'QC', 'Coverage', 'Proportion', 'Flanking SNP', 'Структура / последовательности'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>
        {[...record.resultRows, ...record.detailRows].map(row => <tr key={`${row.sourceSheet}:${row.sourceRow}`}><td>{row.sourceSheet} · {row.sourceRow}</td><td>{row.originalLocus}</td><td>{row.genotype || row.allele || '—'}</td><td>{row.qcFlag || '—'}</td><td>{row.coverage ?? row.totalCoverage ?? '—'}</td><td>{row.proportion ?? '—'}</td><td>{row.flankingSnp || '—'}</td><td><details><summary>Показать исходные поля</summary><pre>{JSON.stringify(row.original, null, 2)}</pre></details></td></tr>)}
      </tbody></table></div>
      <label>Причина решения<input className="form-input" maxLength={1000} value={reason} disabled={disabled} onChange={event => setReason(event.target.value)} /></label>
      {record.cell ? <><div className="converter-actions">
        {record.qc.suggestedValue && <button className="btn btn-primary" disabled={disabled} onClick={() => apply({ action: 'manual', value: record.qc.suggestedValue }, 'Приняты предложенные сигналы Pass')}>Принять {record.qc.suggestedValue}</button>}
        {!record.cell.events?.some(event => event.code === 'SINGLE_DIPLOID') && <button className="btn btn-secondary" disabled={disabled} onClick={() => apply({ action: 'keep' }, 'Подтверждён исходный набор аллелей с учётом QC')}>Подтвердить исходный набор</button>}
        {record.cell.events?.some(event => event.code === 'SINGLE_DIPLOID') && <button className="btn btn-secondary" disabled={disabled} onClick={() => apply({ action: 'homozygous' }, 'Подтверждена гомозигота')}>Подтвердить гомозиготу</button>}
        <button className="btn btn-secondary" disabled={disabled} onClick={() => apply({ action: 'unknown' }, 'Генотип отмечен как неопределённый')}>Неопределённый результат</button>
        <button className="btn btn-secondary" disabled={disabled} onClick={() => apply({ action: 'missing' }, 'Результат локуса исключён')}>Исключить результат локуса</button>
      </div><div className="converter-manual"><label>Принятые аллели через запятую<input className="form-input" maxLength={500} value={value} disabled={disabled} onChange={event => setValue(event.target.value)} /></label><button className="btn btn-primary" disabled={disabled} onClick={() => apply({ action: 'manual', value }, 'Аллели заданы вручную')}>Проверить и принять</button></div></> : <p>Сначала сопоставьте неизвестный маркер с каталогом или исправьте настройки источника.</p>}
      <button className="btn btn-secondary" onClick={() => setSelected(null)}>Закрыть</button>
    </div></div>}
  </div>;
}
