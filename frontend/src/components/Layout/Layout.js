import React from 'react';
import Header from './Header';
import PageShell from './PageShell';

const Layout = ({ children, user, onNavigate, onLogout, hasRole, fluid = false }) => {
  return (
    <div className="app-layout">
      <Header
        user={user}
        onNavigate={onNavigate}
        onLogout={onLogout}
        hasRole={hasRole}
      />
      <main className="app-main">
        <PageShell fluid={fluid}>{children}</PageShell>
      </main>
    </div>
  );
};

export default Layout;
