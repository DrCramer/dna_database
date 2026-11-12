import React, { useMemo, useState } from 'react';
import { getStaffLocusPresentation, getStaffSamplePresentation, staffComparisonGroups } from '../../../../src/utils/staffComparisonPresentation';
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
export function storedComparisonColors() {
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
function objectNumber(profile) { return profile.internal_number || profile.objectNumber || profile.full_name || profile.sample_name || 'Без номера'; }

function Alleles({ raw, presentation, highlightAll = false }) {
  if (!presentation?.alleles?.length || !highlightAll && presentation.status !== 'partial') return formatLocusValue(raw) || '—';
  return <>{presentation.alleles.map(({ value, matched }, i) => <React.Fragment key={i}>
    {i > 0 && ','}<span className={matched ? 'workspace-duplicate-matching-allele' : undefined}
      style={matched ? { '--duplicate-allele-color': presentation.colors.partialMatchAllele } : undefined}>{value}</span>
  </React.Fragment>)}</>;
}

function ComparisonGroup({ group, ignoredLoci, colors, kind }) {
  const isStaff = kind === 'staff';
  const [page, setPage] = useState(0);
  const matches = matchesOf(group);
  const pageCount = Math.ceil(matches.length / MATCH_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const shown = useMemo(() => matches.slice(currentPage * MATCH_PAGE_SIZE, (currentPage + 1) * MATCH_PAGE_SIZE), [matches, currentPage]);
  const loci = useMemo(() => orderNormalizedLoci(getAnalysisLoci([group.reference, ...shown])), [group.reference, shown]);
  const reference = profileLoci(group.reference);
  const comparisons = useMemo(() => shown.map(match => {
    const data = profileLoci(match);
    const evidence = new Map((match.staffEvidence?.detailedMatches || []).map(detail => [detail.locus, detail]));
    const cells = Object.fromEntries(loci.map(locus => [locus, isStaff
      ? getStaffLocusPresentation({ sampleData: reference[locus], staffData: data[locus], detail: evidence.get(locus), locus, ignoredLoci, colors })
      : getLocusComparisonPresentation({ referenceData: reference[locus], comparedData: data[locus], locus,
        matchedLoci: match.matchedLoci, details: match.details, ignoredLoci, colors })]));
    return { match, data, cells, fullMatches: Object.values(cells).filter(cell => cell.status === 'full').length };
  }), [shown, loci, reference, ignoredLoci, colors, isStaff]);
  const referenceLabel = `${objectNumber(group.reference)} · ${group.reference.year ?? 'год не указан'}`;
  return <section className="workspace-duplicate-group" data-reference-id={group.reference.id}>
    <div className="workspace-duplicate-group-heading"><h3>{isStaff ? 'Объект' : 'Эталон'}: {referenceLabel}</h3><span>Найдено профилей: {matches.length.toLocaleString('ru-RU')}</span></div>
    {!Object.keys(reference).length && <p className="workspace-row-error">В результате нет снимка аллелей эталона. Выполните полный поиск заново для подсветки.</p>}
    {isStaff && (group.reference.normalizedEvidenceOnly || shown.some(m => m.normalizedEvidenceOnly)) && <p className="workspace-row-error">Показаны аллели из сохранённых деталей анализа. Для полного исходного профиля со специальными значениями выполните поиск заново.</p>}
    <div className="workspace-duplicate-scroll" role="region" aria-label={`${isStaff ? 'Сравнение объекта' : 'Сравнение с эталоном'} ${referenceLabel}`} tabIndex="0">
      <table className="workspace-duplicate-table">
        <caption className="workspace-duplicate-caption">{isStaff ? 'Аллели исследуемого объекта и найденных сотрудников.' : 'Аллели эталона и найденных дубликатов.'} Совпавшие локусы — количество полных совпадений, отмеченных зелёным.</caption>
        <thead><tr><th scope="col" data-fixed="role">Роль</th><th scope="col" data-fixed="object">{isStaff ? 'Объект / сотрудник' : 'Объект'}</th><th scope="col">Год</th>{isStaff && <th scope="col">Оценка</th>}<th scope="col" title="Количество полностью совпавших локусов (зелёные ячейки)">Совпавшие<br />локусы</th>{loci.map(locus => <th scope="col" key={locus}>{locus}</th>)}</tr></thead>
        <tbody>
          <tr className="workspace-duplicate-reference" data-profile-id={group.reference.id}>
            <td data-fixed="role">{isStaff ? 'Объект' : 'Эталон'}</td><th scope="row" data-fixed="object" title={objectNumber(group.reference)}>{objectNumber(group.reference)}</th><td>{group.reference.year ?? '—'}</td>{isStaff && <td>—</td>}<td>—</td>
            {loci.map(locus => {
              if (isStaff) {
                const p = getStaffSamplePresentation({ sampleData: reference[locus], comparisons: comparisons.map(row => row.cells[locus]), colors });
                return <td key={locus} data-locus={locus} data-status={p.status} title={`${locus}: подчёркнуты аллели, учтённые при сравнении с сотрудниками на этой странице`}
                  style={p.backgroundColor ? backgroundStyle(p.backgroundColor) : undefined}><Alleles raw={reference[locus]} presentation={p} highlightAll /></td>;
              }
              const full = comparisons.some(row => row.cells[locus].status === 'full');
              return <td key={locus} data-locus={locus} data-status={full ? 'full' : undefined}
                title={full ? 'Полное совпадение с одним из профилей на этой странице' : undefined}
                style={full ? backgroundStyle(colors.fullMatch) : undefined}>{formatLocusValue(reference[locus]) || '—'}</td>;
            })}
          </tr>
          {comparisons.map(({ match, data, cells, fullMatches }, index) => <tr key={`${match.id || index}:${match.source || ''}`} data-profile-id={match.id}>
            <td data-fixed="role">{isStaff ? 'Сотрудник' : 'Дубликат'}</td><th scope="row" data-fixed="object" title={isStaff ? `${match.full_name}${match.internal_number ? ' · № рег. ' + match.internal_number : ' · без регистрационного номера'}` : objectNumber(match)}>{isStaff ? <><span className="workspace-staff-name">{match.full_name}</span><small className="workspace-staff-registration">{match.internal_number ? '№ рег. ' + match.internal_number : 'Без регистрационного номера'}</small></> : objectNumber(match)}</th><td>{match.year ?? '—'}</td>
            {isStaff && <td className="workspace-staff-score">{match.staffEvidence.finalScore ?? match.staffEvidence.score ?? match.staffEvidence.contaminationScore ?? '—'}</td>}<td className="workspace-duplicate-count" title="Полностью совпавшие локусы">{fullMatches}</td>
            {loci.map(locus => <td key={locus} data-locus={locus} data-status={cells[locus].status}
              title={`${locus}: ${labels[cells[locus].status]}${isStaff && cells[locus].explainedAlleles.length ? '. Учтённые аллели: ' + cells[locus].explainedAlleles.join(',') : ''}`}
              style={cells[locus].backgroundColor ? backgroundStyle(cells[locus].backgroundColor) : undefined}>
              <Alleles raw={data[locus]} presentation={cells[locus]} highlightAll={isStaff} />
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {pageCount > 1 && <nav className="workspace-duplicate-pagination" aria-label={`Страницы совпадений ${referenceLabel}`}>
      <span>Совпадения {currentPage * MATCH_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * MATCH_PAGE_SIZE, matches.length)} из {matches.length}</span>
      <div><button className="btn btn-secondary btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{isStaff ? 'Предыдущие сотрудники' : 'Предыдущие совпадения'}</button><button className="btn btn-secondary btn-sm" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{isStaff ? 'Следующие сотрудники' : 'Следующие совпадения'}</button></div>
    </nav>}
  </section>;
}

export default function WorkspaceDuplicateResults({ groups, ignoredLoci = [], kind = 'duplicates', matchColors }) {
  const isStaff = kind === 'staff';
  const [page, setPage] = useState(0);
  const [savedColors] = useState(storedComparisonColors);
  const colors = matchColors || savedColors;
  const found = useMemo(() => groups.filter(group => matchesOf(group).length > 0), [groups]);
  const pageCount = Math.ceil(found.length / GROUP_PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visible = found.slice(currentPage * GROUP_PAGE_SIZE, (currentPage + 1) * GROUP_PAGE_SIZE);
  if (!found.length) return <p className="workspace-no-matches">{isStaff ? 'Контаминаций сотрудниками не найдено.' : 'Совпадений не найдено.'}</p>;
  return <div className="workspace-duplicate-results">
    <div className="workspace-duplicate-legend" aria-label="Обозначения совпадений">{[['fullMatch', 'Полное совпадение'], ['partialMatch', 'Частичное совпадение'], ['noMatch', 'Нет совпадения']].map(([key, text]) => <span key={key}><i style={{ '--duplicate-legend-color': colors[key] }} aria-hidden="true" />{text}</span>)}<span>{isStaff ? 'Цвет соответствует результату алгоритма; подчёркнуты учтённые аллели' : 'Пустые и исключённые локусы не подсвечиваются'}</span></div>
    {pageCount > 1 && <nav className="workspace-duplicate-pagination" aria-label={isStaff ? 'Страницы объектов' : 'Страницы эталонов'}>
      <span>{isStaff ? 'Объекты' : 'Эталоны'} {currentPage * GROUP_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * GROUP_PAGE_SIZE, found.length)} из {found.length}</span>
      <div><button className="btn btn-secondary btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{isStaff ? 'Предыдущие объекты' : 'Предыдущие эталоны'}</button><button className="btn btn-secondary btn-sm" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{isStaff ? 'Следующие объекты' : 'Следующие эталоны'}</button></div>
    </nav>}
    {visible.map((group, i) => <ComparisonGroup key={group.reference.id || i} group={group} ignoredLoci={ignoredLoci} colors={colors} kind={kind} />)}
  </div>;
}

export function WorkspaceStaffResults({ groups, staffProfiles, ignoredLoci, colors }) {
  const prepared = useMemo(() => staffComparisonGroups(groups, staffProfiles), [groups, staffProfiles]);
  return <WorkspaceDuplicateResults groups={prepared} ignoredLoci={ignoredLoci} kind="staff" matchColors={colors} />;
}
