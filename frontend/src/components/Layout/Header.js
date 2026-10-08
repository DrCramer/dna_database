import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import DepartmentSwitcher from '../Common/DepartmentSwitcher';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import ThemeSwitcher from '../Common/ThemeSwitcher';

const Header = ({ user, onNavigate, onLogout, hasRole }) => {
  const { activeDepartment } = useAuth();
  const isGenetic = resolveProfileImportFormat(activeDepartment) === 'genetic';
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const settingsMenuRef = useRef(null);
  const navigate = path => { setShowUserMenu(false); setShowSystemMenu(false); setShowSettingsMenu(false); onNavigate(path); };
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSystemMenu, setShowSystemMenu] = useState(false);
  const userMenuRef = useRef(null);
  const systemMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target)) setShowSettingsMenu(false);
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
      if (systemMenuRef.current && !systemMenuRef.current.contains(event.target)) {
        setShowSystemMenu(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setShowSettingsMenu(false);
        setShowUserMenu(false);
        setShowSystemMenu(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const isActive = (path) => window.location.pathname === path;

  const analystMenu = [
    { path: '/dashboard', label: 'Главная', icon: '🏠' },
    { path: '/tasks', label: 'Задачи', icon: '📋' },
    { path: '/analysis', label: 'Анализ генотипов', icon: '🔬' },
    { path: '/master-object-search', label: 'Поиск объектов', icon: '🔎' },
    { path: '/upload', label: 'Загрузка профилей', icon: '📁' }
  ];

  if (isGenetic) analystMenu.push({ path: '/excel-converter', label: 'Конвертер Excel', icon: '📑' });

  const adminMainMenu = [
    { path: '/dashboard', label: 'Главная', icon: '🏠' },
    { path: '/tasks', label: 'Задачи', icon: '📋' },
    { path: '/analysis', label: 'Анализ', icon: '🔬' },
    { path: '/profiles', label: 'Профили', icon: '🗂️' }
  ];

  const adminSearchItem = { path: '/master-object-search', label: 'Поиск объектов', icon: '🔎' };

  const adminSystemMenu = [
    { path: '/users', label: 'Пользователи', icon: '👥' },
    { path: '/organizations', label: 'Организации', icon: '🏢' },
    { path: '/departments', label: 'Отделы', icon: '🏛️' },
    { path: '/expert-groups', label: 'Экспертные группы', icon: '👨‍🔬' },
    { path: '/staff-profiles', label: 'ДНК профили сотрудников', icon: '🧬' }
  ];

  const renderNavigation = () => {
    if (hasRole('admin')) {
      return (
        <>
          {adminMainMenu.map((item) => (
            <button
              key={item.path}
              title={item.label}
              aria-current={isActive(item.path) ? "page" : undefined}
              onClick={() => navigate(item.path)}
              className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}

          <div className="nav-dropdown" ref={systemMenuRef}>
            <button
              onClick={() => setShowSystemMenu(!showSystemMenu)}
              className="nav-link dropdown-trigger"
              title="Система"
              aria-expanded={showSystemMenu}
              aria-controls="system-menu"
            >
              <span className="nav-icon">⚙️</span>
              <span>Система</span>
              <span className="dropdown-arrow">{showSystemMenu ? '▲' : '▼'}</span>
            </button>

            {showSystemMenu && (
              <div className="dropdown-menu" id="system-menu">
                {adminSystemMenu.map((item) => (
                  <button
                    key={item.path}
                    title={item.label}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                    onClick={() => {
                      navigate(item.path);
                      setShowSystemMenu(false);
                    }}
                    className={`dropdown-item ${isActive(item.path) ? 'active' : ''} ${item.path === '/staff-profiles' ? 'dropdown-item-multiline' : ''}`}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="dropdown-item-label">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            key={adminSearchItem.path}
            title={adminSearchItem.label}
            aria-current={isActive(adminSearchItem.path) ? "page" : undefined}
            onClick={() => navigate(adminSearchItem.path)}
            className={`nav-link ${isActive(adminSearchItem.path) ? 'active' : ''}`}
          >
            <span className="nav-icon">{adminSearchItem.icon}</span>
            <span>{adminSearchItem.label}</span>
          </button>
        </>
      );
    }

    return analystMenu.map((item) => (
      <button
        key={item.path}
        title={item.label}
        aria-current={isActive(item.path) ? 'page' : undefined}
        onClick={() => navigate(item.path)}
        className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
      >
        <span className="nav-icon">{item.icon}</span>
        <span>{item.label}</span>
      </button>
    ));
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <button onClick={() => navigate('/dashboard')} className="logo-button">
          <div className="hm-loader-container hm-loader-small">
            <div className="dna-loader">
              <div className="dna-row row-1">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-2">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-3">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-4">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-5">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-6">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-7">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
              <div className="dna-row row-8">
                <div className="dna-line"></div>
                <div className="dot dot-left"></div>
                <div className="dot dot-right"></div>
              </div>
            </div>
          </div>
          <span className="logo-text">ХеликсМатч</span>
        </button>
      </div>

      <nav className="header-nav">
        {renderNavigation()}
        {isGenetic && <div className="nav-dropdown" ref={settingsMenuRef}>
          <button className="nav-link dropdown-trigger" title="Настройки" aria-expanded={showSettingsMenu} aria-controls="settings-menu" onClick={() => setShowSettingsMenu(!showSettingsMenu)}><span className="nav-icon">⚙️</span><span>Настройки</span><span className="dropdown-arrow">{showSettingsMenu ? '▲' : '▼'}</span></button>
          {showSettingsMenu && <div className="dropdown-menu" id="settings-menu"><button className={`dropdown-item ${isActive('/settings/panels') ? 'active' : ''}`} onClick={() => navigate('/settings/panels')}><span className="nav-icon">🧬</span><span className="dropdown-item-label">Панели</span></button><button className={`dropdown-item ${isActive('/settings/allele-references') ? 'active' : ''}`} onClick={() => navigate('/settings/allele-references')}><span className="nav-icon">📚</span><span className="dropdown-item-label">Генетические справочники</span></button><button className="dropdown-item" onClick={() => navigate('/excel-converter')}><span className="nav-icon">📑</span><span className="dropdown-item-label">Конвертер Excel</span></button></div>}
        </div>}
      </nav>

      <div className="header-right">
        <DepartmentSwitcher />
        <ThemeSwitcher />

        <div className="user-menu" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="user-button"
            aria-label={`Меню пользователя ${user?.username || ''}`}
            aria-expanded={showUserMenu}
            aria-controls="user-menu"
          >
            <div className="user-avatar">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <span className="user-name">{user?.username || 'Пользователь'}</span>
            <span className="dropdown-arrow">{showUserMenu ? '▲' : '▼'}</span>
          </button>

          {showUserMenu && (
            <div className="dropdown-menu user-dropdown" id="user-menu">
              <div className="user-info">
                <div className="user-info-name">{user?.username}</div>
                <div className="user-info-role">
                  {user?.role === 'admin'
                    ? 'Администратор'
                    : user?.role === 'department_head'
                      ? 'Руководитель'
                      : 'Эксперт'}
                </div>
              </div>
              <div className="dropdown-divider"></div>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  onLogout();
                }}
                className="dropdown-item logout-item"
              >
                <span className="nav-icon">🚪</span>
                <span>Выйти</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
