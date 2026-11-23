import React, { useEffect, useRef } from 'react';
import { formatImportIssueLocation, getWorkspaceImportIssueContext } from '../../../../src/utils/workspaceImportIssues';

const issueSubject = issue => issue.locus ? 'Локус ' + issue.locus : issue.column ? 'Столбец ' + issue.column : '';

export function WorkspaceImportIssue({ row, issue, primary = false, includeFile = false }) {
  const subject = issueSubject(issue);
  const context = getWorkspaceImportIssueContext(row, issue);
  const location = formatImportIssueLocation(context, includeFile);
  const raw = context.rawValue.length > 120 ? context.rawValue.slice(0, 120) + '…' : context.rawValue;
  return <div className={primary ? 'workspace-row-error workspace-primary-issue' : 'workspace-row-error'}>
    {subject && <strong className="workspace-issue-locus">{subject}</strong>}
    <div>{issue.message}</div>
    {location && <small className="workspace-issue-source">{location}</small>}
    {raw && <small className="workspace-issue-source">Исходное значение «{raw}»</small>}
  </div>;
}

export default function WorkspaceImportIssues({ summary, validation, activeGroup, onShowGroup, onShowAll }) {
  const panel = useRef(null);
  useEffect(() => {
    if (validation && !validation.valid) panel.current?.focus();
  }, [validation]);
  if (!summary.groups.length && !summary.globalIssues.length) return null;
  const groupItem = group => <li key={group.key}>
    <div><strong>{[issueSubject(group), group.message].filter(Boolean).join(' · ')}</strong><span className="workspace-issue-count">Объектов: {group.rowIds.size}</span>
      {group.examples.length > 0 && <p>Например: {group.examples.map(example => {
        const location = formatImportIssueLocation(example, true);
        return example.objectNumber + (location ? ' (' + location + ')' : '');
      }).join(', ')}</p>}
    </div>
    <button type="button" className="btn btn-secondary btn-sm" aria-pressed={activeGroup === group.key} onClick={() => onShowGroup(group.key)}>Показать объекты ({group.rowIds.size})</button>
  </li>;
  return <section className="workspace-import-issues" ref={panel} tabIndex="-1" aria-label="Причины ошибок импорта">
    <div className="workspace-import-issues-heading"><div><h2>Что мешает загрузке</h2><p>Выбранных объектов с ошибками: {summary.rowCount}. Исправьте данные или снимите выбор с этих объектов.</p></div>
      {activeGroup && <button className="btn btn-ghost btn-sm" onClick={onShowAll}>Показать все объекты</button>}
    </div>
    {summary.globalIssues.map((issue, index) => <p className="workspace-row-error" key={index}>{issue.message}</p>)}
    <ul>{summary.groups.slice(0, 6).map(groupItem)}</ul>
    {summary.groups.length > 6 && <details><summary>Ещё причин: {summary.groups.length - 6}</summary><ul>{summary.groups.slice(6).map(groupItem)}</ul></details>}
    {activeGroup && <p className="workspace-issue-filter-note" role="status">В таблице показаны выбранные объекты с этой ошибкой.</p>}
  </section>;
}
