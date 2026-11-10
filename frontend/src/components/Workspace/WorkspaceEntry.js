import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import WorkspacePage from './WorkspacePage';
export default function WorkspaceEntry({
  legacy,
  mode = 'profiles',
  preparedFile
}) {
  const {
    workspaceMode
  } = useAuth();
  return workspaceMode ? <WorkspacePage mode={mode} preparedFile={preparedFile} /> : legacy;
}
