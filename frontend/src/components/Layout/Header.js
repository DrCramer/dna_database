import { getUserDisplayName } from '../../../../src/utils/userDisplayName';
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import DepartmentSwitcher from '../Common/DepartmentSwitcher';
import { resolveProfileImportFormat } from '../../../../src/utils/profileImportFormat';
import ThemeSwitcher from '../Common/ThemeSwitcher';
import UiIcon from '../Common/UiIcon';

const Header = ({ user, onNavigate, onLogout, hasRole }) => {
  const { activeDepartment, workspaceMode } = useAuth();
  const displayName = getUserDisplayName(user);
  const isGenetic = workspaceMode || resolveProfileImportFormat(activeDepartment) === 'genetic';
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showNavigation, setShowNavigation] = useState(false);
  const navigationToggle = useRef(null);
  const settingsMenuRef = useRef(null);
  const navigate = path => { setShowUserMenu(false); setShowSystemMenu(false); setShowSettingsMenu(false); setShowNavigation(false); onNavigate(path); };
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
        if (document.getElementById('main-navigation')?.classList.contains('is-open')) navigationToggle.current?.focus();
        else [settingsMenuRef, systemMenuRef, userMenuRef].find(ref => ref.current?.contains(document.activeElement))?.current?.querySelector('button')?.focus();
        setShowNavigation(false);
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

  const workspaceMenu = [{path:'/analysis',label:'Мои генотипы',icon:'grid'},{path:'/upload',label:'Загрузка',icon:'upload'},{path:'/master-object-search',label:'Поиск объектов',icon:'search'},{path:'/tasks',label:'Архив задач',icon:'archive'}];
  const analystMenu = workspaceMode ? [...workspaceMenu] : [
    { path: '/dashboard', label: 'Главная', icon: 'home' },
    { path: '/tasks', label: 'Задачи', icon: 'file' },
    { path: '/analysis', label: 'Анализ генотипов', icon: 'grid' },
    { path: '/master-object-search', label: 'Поиск объектов', icon: 'search' },
    { path: '/upload', label: 'Загрузка', icon: 'upload' }
  ];

  if (isGenetic) analystMenu.push({ path: '/excel-converter', label: 'Конвертер профилей', icon: 'file' });

  const adminMainMenu = workspaceMode ? [...workspaceMenu] : [
    { path: '/dashboard', label: 'Главная', icon: 'home' },
    { path: '/tasks', label: 'Задачи', icon: 'file' },
    { path: '/analysis', label: 'Анализ', icon: 'grid' },
    { path: '/profiles', label: 'Профили', icon: 'layers' }
  ];

  if (isGenetic && ['admin', 'system_administrator', 'department_head', 'user_analyst', 'analyst'].includes(user?.role)) {
    const probability = { path: '/probability', label: 'Вероятность', icon: 'calculator' };
    analystMenu.push(probability);
    adminMainMenu.push(probability);
  }

  const adminSearchItem = { path: '/master-object-search', label: 'Поиск объектов', icon: 'search' };

  const adminSystemMenu = [
    { path: '/admin/migration-export', label: 'Выгрузка для переноса', icon: 'archive' },
    { path: '/admin/master-array-export', label: 'Экспорт мастер-массива', icon: 'download' },
    { path: '/users', label: 'Пользователи', icon: 'users' },
    { path: '/organizations', label: 'Организации', icon: 'building' },
    { path: '/departments', label: 'Отделы', icon: 'building' },
    { path: '/expert-groups', label: 'Экспертные группы', icon: 'users' },
    { path: '/staff-profiles', label: 'ДНК профили сотрудников', icon: 'layers' }
  ];

  const renderNavigation = () => {
    if (hasRole('admin') || user?.role === 'system_administrator') {
      return (
        <>
          {(hasRole('admin') ? adminMainMenu.filter(item => item.path !== adminSearchItem.path) : analystMenu.filter(item => item.path !== adminSearchItem.path)).map((item) => (
            <button
              key={item.path}
              title={item.label}
              aria-current={isActive(item.path) ? "page" : undefined}
              onClick={() => navigate(item.path)}
              className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
            >
              <UiIcon name={item.icon} className="nav-icon" />
              <span>{item.label}</span>
            </button>
          ))}

          <div className="nav-dropdown" ref={systemMenuRef}>
            <button
              onClick={() => setShowSystemMenu(!showSystemMenu)}
              className={`nav-link dropdown-trigger ${adminSystemMenu.some(item => isActive(item.path)) ? 'active' : ''}`}
              title="Система"
              aria-expanded={showSystemMenu}
              aria-controls="system-menu"
            >
              <UiIcon name="settings" className="nav-icon" />
              <span>Система</span>
              <span className="dropdown-arrow" aria-hidden="true">{showSystemMenu ? '▲' : '▼'}</span>
            </button>

            {showSystemMenu && (
              <div className="dropdown-menu" id="system-menu">
                {adminSystemMenu.filter(item => hasRole('admin') || ['/admin/master-array-export', '/admin/migration-export'].includes(item.path)).map((item) => (
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
                    <UiIcon name={item.icon} className="nav-icon" />
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
            <UiIcon name={adminSearchItem.icon} className="nav-icon" />
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
        <UiIcon name={item.icon} className="nav-icon" />
        <span>{item.label}</span>
      </button>
    ));
  };

  return (
    <header className={`app-header${!workspaceMode ? ' has-department' : ''}`}>
      <div className="header-left">
        <button onClick={() => navigate('/dashboard')} className="logo-button" aria-label="ХеликсМатч — на главную">
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
        <button ref={navigationToggle} className="navigation-toggle" aria-label="Разделы сайта" aria-expanded={showNavigation} aria-controls="main-navigation" onClick={() => setShowNavigation(!showNavigation)}><UiIcon name={showNavigation ? 'close' : 'menu'} /><span>Разделы</span></button>
      </div>

      <nav id="main-navigation" aria-label="Основные разделы" className={`header-nav${showNavigation ? ' is-open' : ''}`}>
        {renderNavigation()}
        {isGenetic && <div className="nav-dropdown" ref={settingsMenuRef}>
          <button className={`nav-link dropdown-trigger ${['/settings/panels', '/settings/allele-references', '/excel-converter'].some(isActive) ? 'active' : ''}`} title="Настройки" aria-expanded={showSettingsMenu} aria-controls="settings-menu" onClick={() => setShowSettingsMenu(!showSettingsMenu)}><UiIcon name="settings" className="nav-icon" /><span>Настройки</span><span className="dropdown-arrow" aria-hidden="true">{showSettingsMenu ? '▲' : '▼'}</span></button>
          {showSettingsMenu && <div className="dropdown-menu" id="settings-menu"><button className={`dropdown-item ${isActive('/settings/panels') ? 'active' : ''}`} onClick={() => navigate('/settings/panels')}><UiIcon name="layers" className="nav-icon" /><span className="dropdown-item-label">Панели</span></button><button className={`dropdown-item ${isActive('/settings/allele-references') ? 'active' : ''}`} onClick={() => navigate('/settings/allele-references')}><UiIcon name="book" className="nav-icon" /><span className="dropdown-item-label">Генетические справочники</span></button><button className="dropdown-item" onClick={() => navigate('/excel-converter')}><UiIcon name="file" className="nav-icon" /><span className="dropdown-item-label">Конвертер профилей</span></button></div>}
        </div>}
      </nav>

      <div className="header-right">
        {!workspaceMode && <DepartmentSwitcher />}
        <ThemeSwitcher />

        <div className="user-menu" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="user-button"
            aria-label={`Меню пользователя ${displayName}`}
            aria-expanded={showUserMenu}
            aria-controls="user-menu"
          >
            <div className="user-avatar">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <span className="user-name" title={displayName}>{displayName}</span>
            <span className="dropdown-arrow" aria-hidden="true">{showUserMenu ? '▲' : '▼'}</span>
          </button>

          {showUserMenu && (
            <div className="dropdown-menu user-dropdown" id="user-menu">
              <div className="user-info">
                <div className="user-info-name">{displayName}</div>
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
                <UiIcon name="logout" className="nav-icon" />
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
