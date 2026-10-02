import React from 'react';
import Header from './Header';
import './Layout.css';

const Layout = ({ children, user, onNavigate, onLogout, hasRole }) => {
  return (
    <div className="app-layout">
      <Header 
        user={user}
        onNavigate={onNavigate}
        onLogout={onLogout}
        hasRole={hasRole}
      />
      <main className="app-main">
        {children}
      </main>
    </div>
  );
};

export default Layout;
