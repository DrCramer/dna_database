import React, { useId, useRef } from 'react';
import UiIcon from './UiIcon';
import { getPageHelp } from './pageHelpTopics';

export default function PageHelp({ path, workspaceMode, className = '' }) {
  const titleId = useId();
  const trigger = useRef(null);
  const dialog = useRef(null);
  const topic = getPageHelp(path, workspaceMode);
  if (!topic) return null;

  return <>
    <button ref={trigger} className={`btn btn-secondary page-help-trigger ${className}`.trim()}
      type="button" aria-haspopup="dialog" aria-label="Справка" title="Справка"
      onClick={() => dialog.current.showModal()}>
      <UiIcon name="help" /><span>Справка</span>
    </button>
    <dialog ref={dialog} className="page-help-dialog" aria-labelledby={titleId}
      onClose={() => trigger.current?.focus()}>
      <div className="modal-header">
        <h2 id={titleId}>Справка · {topic.title}</h2>
        <form method="dialog">
          <button className="close-modal-button" type="submit" aria-label="Закрыть справку">
            <UiIcon name="close" />
          </button>
        </form>
      </div>
      <div className="modal-body">
        <ul className="page-help-points">{topic.points.map(point => <li key={point}>{point}</li>)}</ul>
      </div>
    </dialog>
  </>;
}
