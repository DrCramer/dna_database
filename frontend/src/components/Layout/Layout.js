import React from 'react';
import Header from './Header';
import PageShell from './PageShell';

const Layout = ({ children, user, onNavigate, onLogout, hasRole, fluid = false }) => {
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">К содержимому</a>
      <Header
        user={user}
        onNavigate={onNavigate}
        onLogout={onLogout}
        hasRole={hasRole}
      />
      <main id="main-content" className="app-main" tabIndex="-1">
        <PageShell fluid={fluid}>{children}</PageShell>
      </main>
    </div>
  );
};

export default Layout;
