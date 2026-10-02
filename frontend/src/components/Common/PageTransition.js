import React, { useEffect, useState } from 'react';
import './PageTransition.css';

/**
 * Компонент для плавных переходов между страницами
 * Оборачивает содержимое страницы и добавляет анимацию появления
 */
const PageTransition = ({ children, className = '', fast = false }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Принудительно запускаем анимацию
    setIsVisible(false);
    
    // Небольшая задержка для плавного появления
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, fast ? 10 : 30);

    return () => clearTimeout(timer);
  }, [children, fast]); // Перезапускаем при изменении children

  // Быстрая анимация для дашборда (возврат)
  const duration = fast ? '0.25s' : '0.35s';
  const distance = fast ? '15px' : '20px';

  return (
    <div
      className={`page-wrapper ${fast ? 'page-wrapper-fast' : ''} ${isVisible ? 'is-visible' : ''} ${className}`.trim()}
      style={{
        '--page-transition-duration': duration,
        '--page-transition-distance': distance
      }}
    >
      {children}
    </div>
  );
};

export default PageTransition;
