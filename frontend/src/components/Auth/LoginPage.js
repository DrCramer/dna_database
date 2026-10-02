import React, { useEffect, useState } from 'react';
import './LoginPage.css';

const LoginPage = ({
  onNavigate,
  setShowTransition,
  setTransitionStatus,
  user,
  login,
  error,
  clearError
}) => {
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [allowRedirect, setAllowRedirect] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user && allowRedirect) {
      onNavigate('/dashboard');
    }
  }, [user, allowRedirect, onNavigate]);

  useEffect(() => {
    clearError();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setAllowRedirect(false);

    const timeoutIds = [];

    try {
      await login(credentials.username, credentials.password);
      setIsAuthenticating(true);

      const loginContainer = document.querySelector('.helix-login-panel');
      if (loginContainer) {
        loginContainer.classList.add('fade-out');
      }

      timeoutIds.push(setTimeout(() => {
        setShowTransition(true);
      }, 200));

      timeoutIds.push(setTimeout(() => {
        setTransitionStatus('Доступ подтвержден. Подготавливаем рабочую область...');
      }, 1200));

      timeoutIds.push(setTimeout(() => {
        setShowTransition(false);
        setAllowRedirect(true);
      }, 2500));
    } catch (requestError) {
      console.error('Ошибка входа:', requestError);

      timeoutIds.forEach((id) => clearTimeout(id));

      const loginContainer = document.querySelector('.helix-login-panel');
      if (loginContainer) {
        loginContainer.classList.remove('fade-out');
      }

      setIsAuthenticating(false);
      setAllowRedirect(false);
      setIsLoading(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setCredentials((previous) => ({
      ...previous,
      [name]: value
    }));
  };

  if (user) {
    return null;
  }

  return (
    <div className="helix-login-page">
      <div className="helix-glow helix-glow-primary" />
      <div className="helix-glow helix-glow-secondary" />

      <div className="helix-login-layout">
        <section className="helix-login-aside">
          <div className="helix-brand-badge">Система судебно-генетического анализа</div>
          <h1 className="helix-aside-title">Единая рабочая среда для ДНК-анализа и экспертных задач.</h1>
          <p className="helix-aside-text">
            Система поддерживает загрузку профилей, сравнение генотипов, контроль задач
            и работу в светлой и темной темах оформления.
          </p>

          <div className="helix-feature-list">
            <div className="helix-feature-item">
              <span className="helix-feature-icon">🧬</span>
              <div>
                <strong>Анализ генотипов</strong>
                <p>Поиск совпадений, сравнение локусов и экспертная интерпретация.</p>
              </div>
            </div>
            <div className="helix-feature-item">
              <span className="helix-feature-icon">📋</span>
              <div>
                <strong>Работа по задачам</strong>
                <p>Распределение, контроль и фиксация результатов по отделам.</p>
              </div>
            </div>
            <div className="helix-feature-item">
              <span className="helix-feature-icon">🌗</span>
              <div>
                <strong>Две темы оформления</strong>
                <p>Комфортная работа в светлом и темном режимах.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="helix-login-panel">
          <div className="helix-branding">
            <div className="helix-logo-wrapper">
              <div className="hm-loader-container hm-loader-medium">
                <div className="dna-loader">
                  <div className="dna-row row-1"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-2"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-3"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-4"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-5"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-6"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-7"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                  <div className="dna-row row-8"><div className="dna-line" /><div className="dot dot-left" /><div className="dot dot-right" /></div>
                </div>
              </div>
            </div>

            <h2 className="helix-title">HelixMatch</h2>
            <p className="helix-subtitle">Вход в аналитическую систему</p>
          </div>

          <form onSubmit={handleSubmit} className="helix-form">
            {error && (
              <div className="helix-error">
                <svg className="helix-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}

            <div className="helix-field">
              <label htmlFor="username" className="helix-label">Имя пользователя</label>
              <div className="helix-input-wrapper">
                <svg className="helix-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  id="username"
                  type="text"
                  name="username"
                  value={credentials.username}
                  onChange={handleChange}
                  className="helix-input"
                  placeholder="Введите имя пользователя"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="helix-field">
              <label htmlFor="password" className="helix-label">Пароль</label>
              <div className="helix-input-wrapper">
                <svg className="helix-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={credentials.password}
                  onChange={handleChange}
                  className="helix-input"
                  placeholder="Введите пароль"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="helix-password-toggle"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button type="submit" disabled={isLoading} className="helix-submit">
              <span>{isAuthenticating ? 'Подготавливаем вход...' : 'Войти в систему'}</span>
              <svg className="helix-submit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            </button>
          </form>

        </section>
      </div>
    </div>
  );
};

export default LoginPage;
