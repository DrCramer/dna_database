import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset className="theme-switcher" aria-label="Выбор темы оформления">
      <legend className="theme-switcher-title">Тема</legend>

      <input
        type="radio"
        name="theme"
        id="theme-light"
        value="light"
        checked={theme === 'light'}
        onChange={(event) => setTheme(event.target.value)}
      />
      <label htmlFor="theme-light" title="Светлая тема">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </label>

      <input
        type="radio"
        name="theme"
        id="theme-auto"
        value="auto"
        checked={theme === 'auto'}
        onChange={(event) => setTheme(event.target.value)}
      />
      <label htmlFor="theme-auto" title="Системная тема">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </svg>
      </label>

      <input
        type="radio"
        name="theme"
        id="theme-dark"
        value="dark"
        checked={theme === 'dark'}
        onChange={(event) => setTheme(event.target.value)}
      />
      <label htmlFor="theme-dark" title="Темная тема">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </label>

      <div className="theme-switcher-slider" />
    </fieldset>
  );
};

export default ThemeSwitcher;
