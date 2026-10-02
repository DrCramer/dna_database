import React from 'react';

/** Shared page geometry. Analytical workspaces keep the full viewport width. */
const PageShell = ({ children, fluid = false }) => (
  <div className={`page-shell${fluid ? ' page-shell-fluid' : ''}`}>
    {children}
  </div>
);

export default PageShell;
