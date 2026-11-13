import React from 'react';

export default function PageHeader({ title, description, actions, children }) {
  return <header className="page-header">
    <div className="page-title-section"><h1 className="page-title">{title}</h1>{description && <p className="page-subtitle">{description}</p>}{children}</div>
    {actions && <div className="header-actions">{actions}</div>}
  </header>;
}
