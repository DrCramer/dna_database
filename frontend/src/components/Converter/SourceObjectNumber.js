import React, { useId, useState } from 'react';
export default function SourceObjectNumber({ file, disabled, apply, onDraftChange }) {
  const id = useId();
  const [value, setValue] = useState(file.ngs.objectNumber || file.ngs.suggestedObjectNumber || '');
  const confirmed = file.ngs.objectConfirmed && value === file.ngs.objectNumber;
  return <form className="converter-source-object" onSubmit={event => { event.preventDefault(); if (value.trim()) apply(value.trim()); }}>
    <label htmlFor={id}>Полный номер объекта</label>
    <div className="converter-object-input"><input id={id} className="form-input" value={value} maxLength={100} disabled={disabled} placeholder="Например, 251-3" onChange={event => { setValue(event.target.value); onDraftChange(event.target.value); }} />
      {confirmed ? <span className="converter-year-confirmed">Подтверждён</span> : <button className="btn btn-secondary" disabled={disabled || !value.trim()} type="submit">Подтвердить номер</button>}
    </div>
    {!file.ngs.objectConfirmed && <small>Номер из имени файла необходимо подтвердить.</small>}
  </form>;
}
