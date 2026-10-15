import React, { useId, useState } from 'react';

export default function SourceYear({ file, disabled, apply, onDraftChange }) {
  const id = useId();
  const [year, setYear] = useState(String(file.year ?? file.geneMapper?.suggestedYear ?? ''));
  const valid = year === '' || /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2100;
  const confirmed = year !== '' && year === String(file.year ?? '');
  return <div className="converter-source-year">
    <label htmlFor={id}>Год исследования</label>
    <div className="converter-year-input">
      <input id={id} className="form-input" type="number" min="1900" max="2100" step="1" value={year} disabled={disabled}
        onChange={event => { setYear(event.target.value); onDraftChange?.(event.target.value); }} placeholder="2026" aria-invalid={!valid} />
      {!confirmed && <button type="button" className="btn btn-secondary" disabled={disabled || !valid || year === String(file.year ?? '')} onClick={() => apply(year)}>Подтвердить год</button>}
      {confirmed && <span className="converter-year-confirmed">Подтверждён</span>}
    </div>
    {!valid && <span role="alert">Введите год от 1900 до 2100.</span>}
  </div>;
}
