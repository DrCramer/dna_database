import React, { useState } from 'react';
import { EXPERTISE_TYPE_HEADER, expertiseTypeLabel } from '../../../../src/utils/objectTypes';

const PAGE_SIZE = 50;

export default function WorkspaceColleagueResults({ groups }) {
  const [page, setPage] = useState(0);
  if (!groups) return <p className="workspace-no-matches">Выполните новый полный поиск, чтобы проверить личные массивы сотрудников.</p>;
  if (!groups.length) return <p className="workspace-no-matches">Совпадений в личных массивах сотрудников не найдено.</p>;
  const total = groups.reduce((count, group) => count + group.matches.length, 0);
  const start = page * PAGE_SIZE;
  const rows = [];
  let offset = 0;
  for (const { reference, matches } of groups) {
    if (offset >= start + PAGE_SIZE) break;
    for (let i = Math.max(0, start - offset); i < Math.min(matches.length, start + PAGE_SIZE - offset); i++) {
      rows.push({ reference, match: matches[i], key: offset + i });
    }
    offset += matches.length;
  }
  return <div className="workspace-duplicate-results">
    <div className="workspace-duplicate-scroll" role="region" aria-label="Совпадения в личных массивах сотрудников" tabIndex={0}>
      <table className="workspace-duplicate-table workspace-colleague-table">
        <thead><tr>
          <th scope="col">Ваш объект</th><th scope="col">Совпавший объект</th><th scope="col">Владелец</th>
          <th scope="col">{EXPERTISE_TYPE_HEADER}</th><th scope="col">Год</th><th scope="col">Совпавшие локусы</th>
        </tr></thead>
        <tbody>{rows.map(({ reference, match, key }) => <tr key={key}>
          <th scope="row">{[reference.internal_number, expertiseTypeLabel(reference), reference.year].filter(Boolean).join(' · ') || 'Без номера'}</th>
          <td>{match.internal_number || 'Без номера'}</td>
          <td>{match.ownerName}</td>
          <td>{expertiseTypeLabel(match) || '—'}</td>
          <td>{match.year ?? '—'}</td>
          <td>{match.matchedLoci.length} · {match.matchedLoci.join(', ')}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {total > PAGE_SIZE && <nav className="workspace-duplicate-pagination" aria-label="Страницы совпадений">
      <span>Совпадения {start + 1}–{Math.min(start + PAGE_SIZE, total)} из {total.toLocaleString('ru-RU')}</span>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={start + PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Далее</button>
      </div>
    </nav>}
  </div>;
}
