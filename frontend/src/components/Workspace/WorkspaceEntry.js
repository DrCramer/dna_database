import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import WorkspacePage from './WorkspacePage';
export default function WorkspaceEntry({
  legacy,
  mode = 'profiles',
  preparedFile
}) {
  const {
    workspaceMode, workspaceModeReady, workspaceModeError, retryWorkspaceMode
  } = useAuth();
  if (!workspaceModeReady) return <div className="workspace-entry-loading" role={workspaceModeError ? 'alert' : 'status'}>
    {workspaceModeError ? <><strong>Не удалось загрузить рабочую область</strong><button className="btn btn-secondary" onClick={retryWorkspaceMode}>Повторить</button></> : <><span className="workspace-loading-spinner" aria-hidden="true" /><span>Открываем рабочую область…</span></>}
  </div>;
  return workspaceMode ? <WorkspacePage mode={mode} preparedFile={preparedFile} /> : legacy;
}
