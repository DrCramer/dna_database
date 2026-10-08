import React from 'react';
export const confidenceNames = { HIGH: 'Высокая', MEDIUM: 'Средняя', LOW: 'Низкая', UNKNOWN: 'Недостаточно данных' };
const resultNames = { IN_KIT_LADDER: 'присутствует в лестнице', KNOWN_VARIANT: 'известный вариант', OBSERVED_IN_LOCAL_REFERENCE: 'подтверждённая локальная запись', NOT_REPORTED_IN_REFERENCE: 'не найдена в справочнике', NO_REFERENCE_DATA: 'нет данных по локусу', OBSERVED_IN_POPULATION: 'наблюдалась в популяции', NOT_OBSERVED_IN_DATASET: 'нет наблюдения в этой базе' };
export default function ReferenceEvidence({ reference }) {
  if (!reference) return null;
  return <details className="converter-reference-evidence" open={reference.ambiguous}>
    <summary>Референсная проверка · {confidenceNames[reference.confidence]} ({reference.confidence})</summary>
    <p>{reference.reason}</p><p>{reference.ladder?.reason}</p>
    {reference.suggestedValue && <p><strong>Предполагаемое исправление: {reference.suggestedValue}</strong></p>}
    {reference.candidates.map((candidate, index) => <div key={index}><strong>Вариант: {candidate.value || '—'} · {confidenceNames[candidate.confidence]}</strong>
      {!candidate.evidence.length && <p>Подходящих референсных данных нет.</p>}
      <ul>{candidate.evidence.map((item, index) => <li key={index}>{item.allele}: {resultNames[item.result] || item.result} · {item.referenceName} · версия {item.referenceVersion?.slice(0, item.sourceType === 'POPULATION_DATA' ? 12 : 150)}{item.frequency != null && ` · частота ${item.frequency}`}{item.sourceUrl && <> · <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Источник</a></>}</li>)}</ul>
    </div>)}
  </details>;
}
