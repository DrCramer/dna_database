import React, { useMemo, useState } from 'react';
import { getAnalysisLoci, profileLoci } from '../../../../src/utils/analysisLoci';
import { orderNormalizedLoci } from '../../../../src/utils/normalizedExcelLayout';
import { getLocusComparisonPresentation, formatLocusValue, normalizeMatchColors } from '../../../../src/utils/locusComparisonPresentation';

const GROUP_PAGE_SIZE = 5;
const MATCH_PAGE_SIZE = 50;
const labels = {
  full: 'Полное совпадение',
  partial: 'Частичное совпадение',
  no_match: 'Нет совпадения',
  no_data: 'Нет данных для сравнения',
  not_compared: 'Не участвовал в сравнении'
};
function storedColors() {
  try {
    return normalizeMatchColors(JSON.parse(localStorage.getItem('genotypeAnalysisSettings') || '{}').colors);
  } catch {
    return normalizeMatchColors();
  }
}
function backgroundStyle(color) {
  const channels = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { '--duplicate-cell-bg': color, '--duplicate-cell-fg': luminance > 0.179 ? '#142019' : '#ffffff' };
}
function matchesOf(group) { return group.exportMatches || group.matches || []; }
function objectNumber(profile) { return profile.internal_number ?? profile.objectNumber ?? profile.sample_name ?? 'Без номера'; }

function Alleles({ raw, presentation }) {
  if (presentation?.status !== 'partial') return formatLocusValue(raw) || '—';
  return <>{presentation.alleles.map(({ value, matched }, i) => <React.Fragment key={i}>
    {i > 0 && ','}<span className={matched ? 'workspace-duplicate-matching-allele' : undefined}
      style={matched ? { '--duplicate-allele-color': presentation.colors.partialMatchAllele } : undefined}>{value}</span>
  </React.Fragment>)}</>;
}

function ComparisonGroup({ group, ignoredLoci, colors }) {
  const [page, setPage] = useState(0);
  const matches = matchesOf(group);
  const pageCount = Math.ceil(matches.length / MATCH_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const shown = useMemo(() => matches.slice(currentPage * MATCH_PAGE_SIZE, (currentPage + 1) * MATCH_PAGE_SIZE), [matches, currentPage]);
  const loci = useMemo(() => orderNormalizedLoci(getAnalysisLoci([group.reference, ...shown])), [group.reference, shown]);
  const reference = profileLoci(group.reference);
  const comparisons = useMemo(() => shown.map(match => {
    const data = profileLoci(match);
    const cells = Object.fromEntries(loci.map(locus => [locus, getLocusComparisonPresentation({
      referenceData: reference[locus], comparedData: data[locus], locus,
      matchedLoci: match.matchedLoci, details: match.details, ignoredLoci, colors
    })]));
    return { match, data, cells, fullMatches: Object.values(cells).filter(cell => cell.status === 'full').length };
  }), [shown, loci, reference, ignoredLoci, colors]);
  const referenceLabel = `${objectNumber(group.reference)} · ${group.reference.year ?? 'год не указан'}`;
  return <section className="workspace-duplicate-group" data-reference-id={group.reference.id}>
    <div className="workspace-duplicate-group-heading"><h3>Эталон: {referenceLabel}</h3><span>Найдено профилей: {matches.length.toLocaleString('ru-RU')}</span></div>
    {!Object.keys(reference).length && <p className="workspace-row-error">В результате нет снимка аллелей эталона. Выполните полный поиск заново для подсветки.</p>}
    <div className="workspace-duplicate-scroll" role="region" aria-label={`Сравнение с эталоном ${referenceLabel}`} tabIndex="0">
      <table className="workspace-duplicate-table">
        <caption className="workspace-duplicate-caption">Аллели эталона и найденных дубликатов. Совпавшие локусы — количество полных совпадений, отмеченных зелёным.</caption>
        <thead><tr><th scope="col" data-fixed="role">Роль</th><th scope="col" data-fixed="object">Объект</th><th scope="col">Год</th><th scope="col" title="Количество полностью совпавших локусов (зелёные ячейки)">Совпавшие<br />локусы</th>{loci.map(locus => <th scope="col" key={locus}>{locus}</th>)}</tr></thead>
        <tbody>
          <tr className="workspace-duplicate-reference" data-profile-id={group.reference.id}>
            <td data-fixed="role">Эталон</td><th scope="row" data-fixed="object" title={objectNumber(group.reference)}>{objectNumber(group.reference)}</th><td>{group.reference.year ?? '—'}</td><td>—</td>
            {loci.map(locus => {
              const full = comparisons.some(row => row.cells[locus].status === 'full');
              return <td key={locus} data-locus={locus} data-status={full ? 'full' : undefined}
                title={full ? 'Полное совпадение с одним из профилей на этой странице' : undefined}
                style={full ? backgroundStyle(colors.fullMatch) : undefined}>{formatLocusValue(reference[locus]) || '—'}</td>;
            })}
          </tr>
          {comparisons.map(({ match, data, cells, fullMatches }, index) => <tr key={`${match.id || index}:${match.source || ''}`} data-profile-id={match.id}>
            <td data-fixed="role">Дубликат</td><th scope="row" data-fixed="object" title={objectNumber(match)}>{objectNumber(match)}</th><td>{match.year ?? '—'}</td><td className="workspace-duplicate-count" title="Полностью совпавшие локусы">{fullMatches}</td>
            {loci.map(locus => <td key={locus} data-locus={locus} data-status={cells[locus].status}
              title={`${locus}: ${labels[cells[locus].status]}`}
              style={cells[locus].backgroundColor ? backgroundStyle(cells[locus].backgroundColor) : undefined}>
              <Alleles raw={data[locus]} presentation={cells[locus]} />
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {pageCount > 1 && <nav className="workspace-duplicate-pagination" aria-label={`Страницы совпадений ${referenceLabel}`}>
      <span>Совпадения {currentPage * MATCH_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * MATCH_PAGE_SIZE, matches.length)} из {matches.length}</span>
      <div><button className="btn btn-secondary btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Предыдущие совпадения</button><button className="btn btn-secondary btn-sm" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Следующие совпадения</button></div>
    </nav>}
  </section>;
}

export default function WorkspaceDuplicateResults({ groups, ignoredLoci = [] }) {
  const [page, setPage] = useState(0);
  const [colors] = useState(storedColors);
  const found = useMemo(() => groups.filter(group => matchesOf(group).length > 0), [groups]);
  const pageCount = Math.ceil(found.length / GROUP_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = found.slice(currentPage * GROUP_PAGE_SIZE, (currentPage + 1) * GROUP_PAGE_SIZE);
  if (!found.length) return <p className="workspace-no-matches">Совпадений не найдено.</p>;
  return <div className="workspace-duplicate-results">
    <div className="workspace-duplicate-legend" aria-label="Обозначения совпадений">{[['fullMatch', 'Полное совпадение'], ['partialMatch', 'Частичное совпадение'], ['noMatch', 'Нет совпадения']].map(([key, text]) => <span key={key}><i style={{ '--duplicate-legend-color': colors[key] }} aria-hidden="true" />{text}</span>)}<span>Пустые и исключённые локусы не подсвечиваются</span></div>
    {pageCount > 1 && <nav className="workspace-duplicate-pagination" aria-label="Страницы эталонов">
      <span>Эталоны {currentPage * GROUP_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * GROUP_PAGE_SIZE, found.length)} из {found.length}</span>
      <div><button className="btn btn-secondary btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Предыдущие эталоны</button><button className="btn btn-secondary btn-sm" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Следующие эталоны</button></div>
    </nav>}
    {visible.map((group, i) => <ComparisonGroup key={group.reference.id || i} group={group} ignoredLoci={ignoredLoci} colors={colors} />)}
  </div>;
}
