import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('auto');
  const [systemTheme, setSystemTheme] = useState('light');
  const [effectiveTheme, setEffectiveTheme] = useState('light');

  // Определяем системную тему
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    // Устанавливаем начальное значение
    setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

    // Слушаем изменения системной темы
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Загружаем сохраненную тему из localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme-preference');
    if (savedTheme && ['light', 'dark', 'auto'].includes(savedTheme)) {
      setTheme(savedTheme);
    }
  }, []);

  // Вычисляем эффективную тему
  useEffect(() => {
    const newEffectiveTheme = theme === 'auto' ? systemTheme : theme;
    setEffectiveTheme(newEffectiveTheme);

    // Применяем тему к документу
    document.documentElement.setAttribute('data-theme', newEffectiveTheme);
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${newEffectiveTheme}`);
  }, [theme, systemTheme]);

  const setThemePreference = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme-preference', newTheme);
  };

  const toggleTheme = () => {
    const themes = ['light', 'dark', 'auto'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setThemePreference(themes[nextIndex]);
  };

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return '☀️';
      case 'dark':
        return '🌙';
      case 'auto':
        return '🔄';
      default:
        return '🔄';
    }
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Светлая';
      case 'dark':
        return 'Темная';
      case 'auto':
        return 'Авто';
      default:
        return 'Авто';
    }
  };

  const value = {
    theme,
    systemTheme,
    effectiveTheme,
    setTheme: setThemePreference,
    toggleTheme,
    getThemeIcon,
    getThemeLabel,
    isLight: effectiveTheme === 'light',
    isDark: effectiveTheme === 'dark',
    isAuto: theme === 'auto'
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};