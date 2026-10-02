import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const ThemeToggle = ({ className = '', showLabel = true }) => {
  const { theme, toggleTheme, getThemeIcon, getThemeLabel, systemTheme } = useTheme();

  const getTooltip = () => {
    switch (theme) {
      case 'light':
        return 'Переключить на темную тему';
      case 'dark':
        return 'Переключить на автоматическую тему';
      case 'auto':
        return `Переключить на светлую тему (сейчас: ${systemTheme === 'dark' ? 'темная' : 'светлая'})`;
      default:
        return 'Переключить тему';
    }
  };

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      title={getTooltip()}
      aria-label={`Текущая тема: ${getThemeLabel()}. ${getTooltip()}`}
    >
      <span className="theme-icon" role="img" aria-hidden="true">
        {getThemeIcon()}
      </span>
      {showLabel && (
        <span className="theme-label">
          {getThemeLabel()}
        </span>
      )}
    </button>
  );
};

export default ThemeToggle;
