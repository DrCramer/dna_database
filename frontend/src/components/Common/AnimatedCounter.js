import React, { useState, useEffect, useRef } from 'react';

/**
 * Компонент анимированного счетчика
 * Плавно изменяет число от текущего значения к целевому
 */
const AnimatedCounter = ({ value, duration = 800, className = '', style = {} }) => {
  const [displayValue, setDisplayValue] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef(null);
  const startValueRef = useRef(0);
  const startTimeRef = useRef(null);
  const prevValueRef = useRef(0);

  useEffect(() => {
    // Сохраняем предыдущее значение для начала анимации
    startValueRef.current = prevValueRef.current;
    prevValueRef.current = value;

    // Если значение не изменилось, устанавливаем его сразу
    if (value === startValueRef.current) {
      setDisplayValue(value);
      return;
    }

    setIsAnimating(true);
    startTimeRef.current = null;

    // Функция анимации с easing
    const animate = (timestamp) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out cubic)
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const easedProgress = easeOutCubic(progress);

      // Вычисляем текущее значение
      const currentValue = startValueRef.current + (value - startValueRef.current) * easedProgress;
      setDisplayValue(Math.round(currentValue));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(value);
        setIsAnimating(false);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  return (
    <span
      className={`animated-counter ${isAnimating ? 'is-animating' : ''} ${className}`.trim()}
      style={{
        ...style
      }}
    >
      {displayValue}
    </span>
  );
};

export default AnimatedCounter;
