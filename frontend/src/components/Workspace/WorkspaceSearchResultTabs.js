import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import UiIcon from '../Common/UiIcon';
import WorkspaceDuplicateResults, { WorkspaceStaffResults } from './WorkspaceDuplicateResults';

export default function WorkspaceSearchResultTabs({ result, colors, staffActions, onDuplicateExport, exportingDuplicates }) {
  const id = useId();
  const buttons = useRef([]);
  const results = useRef(null);
  const scrollPositions = useRef([]);
  const pendingScroll = useRef(null);
  const staffCount = result.staff.filter(group => group.matches.length > 0).length;
  const tabs = [
    { id: 'internal', label: 'Внутри личного массива', icon: 'grid', count: result.internal.results.length, groups: result.internal.results },
    { id: 'master', label: 'Мастер-массив', icon: 'layers', count: result.master.results.length, groups: result.master.results, references: result.referenceCounts?.master },
    { id: 'staff', label: 'Контаминация сотрудников', icon: 'users', count: staffCount, groups: result.staff, references: result.referenceCounts?.staff }
  ];
  const [selection, setSelection] = useState(() => {
    const firstWithMatches = result.outdated ? -1 : tabs.findIndex(tab => tab.count > 0);
    const active = Math.max(0, firstWithMatches);
    return { active, visited: [active] };
  });

  useLayoutEffect(() => {
    if (pendingScroll.current) {
      const { scroller, top } = pendingScroll.current;
      pendingScroll.current = null;
      scroller.scrollTop = top;
    }
  }, [selection.active]);

  const select = index => {
    if (index === selection.active) return;
    const scroller = results.current?.closest('.workspace-search-results');
    if (scroller) {
      scrollPositions.current[selection.active] = scroller.scrollTop;
      const tabsTop = results.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        + scroller.scrollTop - scroller.clientTop;
      pendingScroll.current = {
        scroller,
        top: scrollPositions.current[index] ?? Math.min(scroller.scrollTop, Math.max(0, tabsTop))
      };
    }
    setSelection(current => ({
      active: index,
      visited: current.visited.includes(index) ? current.visited : [...current.visited, index]
    }));
  };

  const handleTabKey = (event, index) => {
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(next);
    buttons.current[next]?.focus({ preventScroll: true });
  };

  const ignoredLoci = result.parameters?.ignoredLoci || [];
  return <div ref={results}>
    <div className="workspace-result-tabbar">
      <div className="workspace-result-tabs" role="tablist" aria-label="Разделы результатов поиска">
        {tabs.map((tab, index) => <button
          key={tab.id}
          ref={button => { buttons.current[index] = button; }}
          type="button"
          id={`${id}-tab-${index}`}
          role="tab"
          aria-label={tab.label}
          aria-controls={`${id}-panel-${index}`}
          aria-selected={selection.active === index}
          aria-describedby={`${id}-count-${index}`}
          tabIndex={selection.active === index ? 0 : -1}
          onClick={() => select(index)}
          onKeyDown={event => handleTabKey(event, index)}
        >
          <UiIcon name={tab.icon} className="workspace-icon" />
          <span className="workspace-result-tab-label">{tab.label}</span>
          <span className="workspace-count-pill" id={`${id}-count-${index}`}>
            {result.outdated ? 'Архив' : tab.count.toLocaleString('ru-RU')}
          </span>
        </button>)}
      </div>
    </div>
    {tabs.map((tab, index) => <div
      className="workspace-result-panel"
      key={tab.id}
      id={`${id}-panel-${index}`}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${index}`}
      tabIndex={0}
      hidden={selection.active !== index}
    >
      {!result.outdated && selection.visited.includes(index) && <>
        {(tab.references != null || tab.id === 'staff' && staffCount > 0) && <div className="workspace-result-actions">
          {tab.references != null && <p>Эталонов проверено: {tab.references.toLocaleString('ru-RU')}</p>}
          {tab.id === 'staff' && staffCount > 0 && staffActions}
        </div>}
        {tab.id === 'staff' ? <WorkspaceStaffResults
          groups={tab.groups}
          staffProfiles={result.staffProfiles}
          ignoredLoci={result.parameters?.staffOptions?.ignoredLoci ?? ignoredLoci}
          colors={colors}
        /> : <WorkspaceDuplicateResults
          groups={tab.groups}
          ignoredLoci={ignoredLoci}
          onExport={historyFilter => onDuplicateExport(tab.id, historyFilter)}
          exporting={exportingDuplicates}
        />}
      </>}
    </div>)}
  </div>;
}
